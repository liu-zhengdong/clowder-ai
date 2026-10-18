import './helpers/setup-cat-registry.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InvocationQueue } from '../dist/domains/cats/services/agents/invocation/InvocationQueue.js';
import { InvocationRegistry } from '../dist/domains/cats/services/agents/invocation/InvocationRegistry.js';
import { InvocationTracker } from '../dist/domains/cats/services/agents/invocation/InvocationTracker.js';
import { QueueProcessor } from '../dist/domains/cats/services/agents/invocation/QueueProcessor.js';
import { AgentRouter } from '../dist/domains/cats/services/agents/routing/AgentRouter.js';
import { assembleIncrementalContext } from '../dist/domains/cats/services/agents/routing/route-helpers.js';
import { cursorFor } from '../dist/domains/cats/services/stores/cursor.js';
import { InMemoryTurnExecutionStore } from '../dist/domains/cats/services/stores/memory/InMemoryTurnExecutionStore.js';
import { DeliveryCursorStore } from '../dist/domains/cats/services/stores/ports/DeliveryCursorStore.js';
import { InvocationRecordStore } from '../dist/domains/cats/services/stores/ports/InvocationRecordStore.js';
import { MessageStore } from '../dist/domains/cats/services/stores/ports/MessageStore.js';
import { ThreadStore } from '../dist/domains/cats/services/stores/ports/ThreadStore.js';
import { migrateRouterOpts } from './helpers/agent-registry-helpers.js';

const noop = () => {};
const FIRST = 'REVIEW_FIRST_SOURCE_ONLY';
const SECOND = 'REVIEW_SECOND_SOURCE_ONLY';

// Real Queue → AgentRouter → context projection → invocation lifecycle. Only
// the provider is controlled; an explicit barrier holds the first receiver.
for (const topology of ['serial', 'parallel']) {
  test(`${topology}: two queued A2A requests are each exposed only to their owning turn`, async () => {
    const messages = new MessageStore();
    const threads = new ThreadStore();
    const thread = threads.create('owner', 'pending prompt delivery');
    const turns = new InMemoryTurnExecutionStore();
    const registry = new InvocationRegistry();
    const tracker = new InvocationTracker();
    const prompts = [];
    const firstStarted = Promise.withResolvers();
    const secondStarted = Promise.withResolvers();
    const firstMayFinish = Promise.withResolvers();
    const service = {
      async *invoke(prompt) {
        prompts.push(prompt);
        if (prompts.length === 1) {
          firstStarted.resolve();
          await firstMayFinish.promise;
        } else secondStarted.resolve();
        yield { type: 'text', catId: 'opus', content: 'Review complete.', timestamp: Date.now() };
        yield { type: 'done', catId: 'opus', timestamp: Date.now() };
      },
    };
    const router = new AgentRouter(
      await migrateRouterOpts({
        claudeService: service,
        codexService: {
          async *invoke() {
            yield { type: 'text', catId: 'codex', content: 'Peer finished.', timestamp: Date.now() };
            yield { type: 'done', catId: 'codex', timestamp: Date.now() };
          },
        },
        registry,
        messageStore: messages,
        threadStore: threads,
        turnExecutionStore: turns,
      }),
    );
    const queue = new InvocationQueue(undefined, { invocationTracker: tracker });
    const processor = new QueueProcessor({
      queue,
      router,
      messageStore: messages,
      invocationTracker: tracker,
      invocationRecordStore: new InvocationRecordStore(),
      turnExecutionStore: turns,
      socketManager: { emitToUser: noop, broadcastToRoom: noop, broadcastAgentMessage: noop },
      log: { info: noop, warn: noop, error: noop },
    });
    const admit = (content, targets = ['opus']) =>
      queue.send(
        messages,
        {
          userId: 'owner',
          threadId: thread.id,
          from: { kind: 'agent', catId: 'codex' },
          content,
          mentions: targets,
          timestamp: Date.now(),
          idempotencyKey: content,
        },
        {
          kind: 'message_wake',
          userId: 'owner',
          threadId: thread.id,
          from: { kind: 'agent', catId: 'codex' },
          content,
          targetCats: targets,
          sourceCategory: 'a2a',
          ownerAuthProvenance: 'strict',
          intent: 'execute',
          autoExecute: true,
          messageDisposition: 'next_work',
        },
      );
    const first = await admit(FIRST, topology === 'parallel' ? ['opus', 'codex'] : ['opus']);
    const second = await admit(SECOND);
    const drain = processor.requestDrain(thread.id);
    try {
      await firstStarted.promise;
      assert.match(prompts[0], new RegExp(FIRST));
      assert.doesNotMatch(
        prompts[0],
        new RegExp(SECOND),
        'pending request must not be worked before its Queue delivery',
      );
      assert.equal(messages.getById(second.message.id).lifecycle.dispatchRefs.length, 0);
      firstMayFinish.resolve();
      await secondStarted.promise;
      await drain;
      assert.match(prompts[1], new RegExp(SECOND), 'deferred request must arrive in its own turn');
      assert.equal(prompts.length, 2, 'one actual receiver per request, with no redundant receiver');
      for (const source of [first.message, second.message]) {
        const refs = messages.getById(source.id).lifecycle.dispatchRefs.filter((ref) => ref.targetId === 'opus');
        assert.equal(refs.length, 1);
        const response = messages.getById(refs[0].statusMessageId);
        assert.deepEqual(response.lifecycle.inputMessageIds, [source.id]);
      }
      assert.equal(queue.list(thread.id, 'owner').length, 0);
    } finally {
      firstMayFinish.resolve();
      await drain;
    }
  });
}

for (const contextMode of ['hot', 'cold']) {
  test(`${contextMode}: pending work cannot leak through navigation, smart-window anchors, or reply previews`, async () => {
    const messages = new MessageStore();
    const append = (content, extra = {}) =>
      messages.append({
        userId: 'owner',
        threadId: 'prompt-visibility',
        from: { kind: 'agent', catId: 'codex' },
        content,
        mentions: ['opus'],
        timestamp: Date.now(),
        ...extra,
      });
    const first = append(FIRST);
    const second = append(SECOND);
    const third = append('A visible reference whose pending parent is not delivered yet.', {
      replyTo: second.id,
      mentions: [],
    });
    const deliveryCursorStore = new DeliveryCursorStore();
    const deps = { messageStore: messages, deliveryCursorStore, invocationDeps: {} };
    const options = {
      effectiveMaxContextTokens: 10000,
      resolvePendingPromptMessageIds: async () => [second.id],
      contextProjection: {
        coordinate: {
          providerCarrier: { provider: 'codex', carrier: 'exec_json' },
          invocationOrigin: 'interactive',
          routeTopology: 'serial',
        },
        contextEpoch: 1,
        contextMode,
        transition: 'scope_first_seen',
        reason: 'no_prior_session',
      },
    };
    const projection = await assembleIncrementalContext(
      deps,
      'owner',
      'prompt-visibility',
      'opus',
      first.id,
      'play',
      options,
    );
    assert.ok(projection.exposedMessageIds.includes(first.id));
    assert.ok(!projection.exposedMessageIds.includes(second.id));
    assert.doesNotMatch(projection.contextText, new RegExp(SECOND));
    assert.doesNotMatch(projection.navigationHeader, new RegExp(SECOND));
    assert.ok(
      projection.projectionAudit.messageRefs.some(
        (item) => item.messageRef === second.id && item.reason === 'pending_delivery',
      ),
    );
    assert.equal(projection.boundaryId, cursorFor(first), 'a visible tail must not acknowledge pending work');
    await deliveryCursorStore.ackSeenCursor('owner', 'opus', 'prompt-visibility', projection.boundaryId);
    await deliveryCursorStore.ackCursor('owner', 'opus', 'prompt-visibility', projection.boundaryId);
    const next = await assembleIncrementalContext(deps, 'owner', 'prompt-visibility', 'opus', second.id, 'play', {
      ...options,
      resolvePendingPromptMessageIds: async () => [],
    });
    assert.ok(next.projectedMessageIds.includes(second.id));
    assert.ok(next.projectedMessageIds.includes(third.id));
    assert.equal(next.includesCurrentUserMessage, true);
    assert.match(next.navigationHeader, /传球:.*→ 你/);
    assert.match(next.contextText, new RegExp(`\\[↩[^\\n]*${SECOND}`));
  });
}

// Recovery is a second cursor writer: a valid proof beyond a pending gap must
// not consume that gap, even when it is the very first unseen message.
for (const pendingPosition of ['middle', 'first', 'after-cursor']) {
  test(`delivery recovery preserves a pending gap at ${pendingPosition}`, async () => {
    const messages = new MessageStore();
    const cursors = new DeliveryCursorStore();
    const threadId = 'pending-recovery';
    const append = (content, extra = {}) =>
      messages.append({
        userId: 'owner',
        threadId,
        from: { kind: 'agent', catId: 'codex' },
        content,
        mentions: ['opus'],
        timestamp: Date.now(),
        ...extra,
      });
    const first = pendingPosition === 'first' ? undefined : append(FIRST);
    if (pendingPosition === 'after-cursor') await cursors.ackCursor('owner', 'opus', threadId, cursorFor(first));
    const pending = append(SECOND);
    const later = append('Later source with a valid delivery proof');
    append('Completed later source', {
      from: { kind: 'agent', catId: 'opus' },
      origin: 'stream',
      mentions: [],
      extra: {
        stream: { invocationId: 'parent', turnInvocationId: 'child' },
        causal: { kind: 'invocation_reply', triggerMessageId: later.id },
        deliveryBoundary: {
          v: 1,
          userId: 'owner',
          threadId,
          catId: 'opus',
          turnInvocationId: 'child',
          sourceMessageId: later.id,
          cursor: cursorFor(later),
        },
      },
    });
    const deps = { messageStore: messages, deliveryCursorStore: cursors, invocationDeps: {} };
    const projection = await assembleIncrementalContext(deps, 'owner', threadId, 'opus', first?.id, 'play', {
      effectiveMaxContextTokens: 10000,
      resolvePendingPromptMessageIds: async () => [pending.id],
    });
    const previousCursor = pendingPosition === 'after-cursor' ? cursorFor(first) : undefined;
    assert.equal(
      await cursors.getCursor('owner', 'opus', threadId),
      previousCursor,
      'recovery must not acknowledge a proven later source across the gap',
    );
    assert.equal(projection.boundaryId, first ? cursorFor(first) : undefined);
  });
}
