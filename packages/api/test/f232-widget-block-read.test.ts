import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import type { StoredMessage } from '../src/domains/cats/services/stores/ports/MessageStore.js';
import { registerArtifactWidgetBlockRoute } from '../src/routes/artifact-widget-block-route.js';

const owner = 'widget-read-owner';
const headers = { 'x-cat-cafe-user': owner };
const threadId = 'thread-widget-read';
const messageId = 'msg-widget-read';
const html = '<!doctype html><html><body><button id="b">click me</button></body></html>';

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: messageId,
    threadId,
    userId: owner,
    catId: 'opus-48',
    from: { kind: 'agent', catId: 'opus-48' },
    content: '',
    timestamp: 1_700_000_000_000,
    deliveryStatus: 'delivered',
    extra: {
      rich: {
        blocks: [
          { kind: 'html_widget', v: 1, id: 'widget-a', html, title: '同名' },
          { kind: 'html_widget', v: 1, id: 'widget-b', html, title: '同名' },
          { kind: 'interactive', v: 1, id: 'choice-a', interactiveType: 'select', options: [] },
        ],
      },
    },
    ...overrides,
  } as StoredMessage;
}

async function appWith(stored: StoredMessage | null) {
  const app = Fastify();
  registerArtifactWidgetBlockRoute(app, {
    messageStore: { getById: async (id: string) => (id === messageId ? stored : null) },
  });
  return app;
}

async function get(stored: StoredMessage | null, blockId: string, options: { user?: string; thread?: string } = {}) {
  const app = await appWith(stored);
  try {
    return await app.inject({
      method: 'GET',
      url: `/api/threads/${options.thread ?? threadId}/artifacts/${messageId}/blocks/${blockId}`,
      headers: { 'x-cat-cafe-user': options.user ?? owner },
    });
  } finally {
    await app.close();
  }
}

test('reads the exact html_widget block named by the coordinate', async () => {
  const response = await get(message(), 'widget-b');
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.block.id, 'widget-b');
  assert.equal(body.block.kind, 'html_widget');
  assert.equal(body.block.html, html);
  assert.equal(body.messageId, messageId);
});

test('two same-name widgets in one message resolve to their own block, never the first one', async () => {
  const first = await get(message(), 'widget-a');
  const second = await get(message(), 'widget-b');
  assert.equal(first.json().block.id, 'widget-a');
  assert.equal(second.json().block.id, 'widget-b');
});

test('a block that is not html_widget is unavailable even when the id exists', async () => {
  const response = await get(message(), 'choice-a');
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'widget_block_unavailable');
});

test('a missing block id is unavailable, not a fallback to another widget', async () => {
  const response = await get(message(), 'does-not-exist');
  assert.equal(response.statusCode, 404);
});

test('another thread cannot read the block', async () => {
  const response = await get(message(), 'widget-a', { thread: 'thread-other' });
  assert.equal(response.statusCode, 404);
});

test('another user cannot read the block', async () => {
  const response = await get(message(), 'widget-a', { user: 'someone-else' });
  assert.equal(response.statusCode, 404);
});

test('deleted, internal and unpublished messages are unavailable', async () => {
  for (const stored of [
    message({ deletedAt: 1 }),
    message({ from: { kind: 'system', service: 'scheduler' } }),
    message({ origin: 'briefing' }),
    message({ deliveryStatus: 'queued', catId: null, from: { kind: 'user', userId: owner } }),
  ]) {
    const response = await get(stored, 'widget-a');
    assert.equal(response.statusCode, 404);
  }
});

test('a missing message is unavailable', async () => {
  const response = await get(null, 'widget-a');
  assert.equal(response.statusCode, 404);
});
