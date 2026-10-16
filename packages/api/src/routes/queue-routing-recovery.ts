import { createCatId } from '@cat-cafe/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { queueEntryOwnerId } from '../domains/cats/services/agents/invocation/InvocationQueue.js';
import { queueEntryId } from '../domains/cats/services/agents/invocation/queue-ledger/QueueLedger.js';
import { isOwnerRecoverableRoutingTarget } from '../domains/cats/services/agents/invocation/queue-routing-recovery-policy.js';
import { resolveStrictUserId } from '../utils/request-identity.js';
import type { QueueRoutesOptions } from './queue.js';

type Params = { threadId: string; sourceMessageId: string; targetCatId: string };
type Authorize = (request: FastifyRequest, reply: FastifyReply, threadId: string) => Promise<{ userId: string } | null>;

/** Only current Queue/History truth authorizes an owner attempt on the original source and target. */
export function registerQueueRoutingRecovery(
  app: FastifyInstance,
  deps: QueueRoutesOptions,
  authorize: Authorize,
): void {
  const resolve = async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
    const { threadId, sourceMessageId, targetCatId } = request.params;
    const owner = await authorize(request, reply, threadId);
    if (!owner) return null;
    const source = await deps.messageStore?.getById(sourceMessageId);
    if (
      !source ||
      source.threadId !== threadId ||
      source.userId !== owner.userId ||
      source.deletedAt ||
      source.recall ||
      source._tombstone ||
      source.deliveryStatus === 'canceled' ||
      source.visibility === 'whisper'
    ) {
      reply.code(404).send({ error: '原消息不存在或不可重试', code: 'ROUTING_RECOVERY_NOT_FOUND' });
      return null;
    }
    const entryId = queueEntryId(source.id);
    const entry = await deps.invocationQueue.getDurableEntry(threadId, entryId);
    const dispatch = source.lifecycle?.dispatchRefs?.find((ref) => ref.targetId === targetCatId);
    const response = dispatch?.statusMessageId ? await deps.messageStore?.getById(dispatch.statusMessageId) : undefined;
    const pending =
      entry && queueEntryOwnerId(entry) === owner.userId && isOwnerRecoverableRoutingTarget(entry, source, targetCatId);
    const status = pending
      ? entry.status === 'claimed'
        ? 'running'
        : entry.delivery.routingHeldTargetIds?.includes(targetCatId)
          ? 'failed'
          : 'running'
      : response?.lifecycle?.kind === 'response'
        ? response.lifecycle.status === 'completed'
          ? 'succeeded'
          : response.lifecycle.status === 'processing'
            ? 'running'
            : 'unavailable'
        : 'unavailable';
    return { userId: owner.userId, threadId, entryId, targetCatId, status };
  };

  app.get<{ Params: Params }>(
    '/api/threads/:threadId/messages/:sourceMessageId/routing-targets/:targetCatId',
    async (request, reply) => {
      const current = await resolve(request, reply);
      if (current) return { status: current.status };
    },
  );
  app.post<{ Params: Params }>(
    '/api/threads/:threadId/messages/:sourceMessageId/routing-targets/:targetCatId/retry',
    async (request, reply) => {
      if (!resolveStrictUserId(request)) {
        reply.code(401);
        return { error: '请登录后重试', code: 'AUTH_REQUIRED' };
      }
      const current = await resolve(request, reply);
      if (!current) return;
      if (resolveStrictUserId(request) !== current.userId) {
        reply.code(401);
        return { error: '请登录后重试', code: 'AUTH_REQUIRED' };
      }
      if (current.status !== 'failed' || deps.isCatAvailable?.(createCatId(current.targetCatId)) === false) {
        reply.code(409);
        return { error: '该目标已在执行、已完成或当前不可重试，请刷新状态', code: 'ROUTING_RECOVERY_STALE' };
      }
      const result = await deps.queueProcessor.retryRoutingTarget(
        current.threadId,
        current.userId,
        current.entryId,
        current.targetCatId,
      );
      if (!result.started) {
        reply.code(409);
        return { error: '本次未执行；成员仍被暂停、正在忙碌或消息状态已变化', code: 'ROUTING_RECOVERY_NOT_STARTED' };
      }
      reply.code(202);
      return { status: 'retrying' };
    },
  );
}
