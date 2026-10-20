import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IMessageStore } from '../domains/cats/services/stores/ports/MessageStore.js';
import { isInternalNonQuotableParent, isTimelinePublished } from '../domains/cats/services/stores/visibility.js';
import { resolveUserId } from '../utils/request-identity.js';

/**
 * F232 PR-A — 按坐标读回一个 `html_widget` 原块。
 *
 * 作品目录只带 `sourceMessageId + widgetBlockId`，不带 HTML 正文。面板打开一条 HTML 作品时
 * 走这里按坐标取正文，并在服务端重新核对：
 *   - 消息属于请求里的 thread；
 *   - 消息属于当前用户（与 GET /api/messages 同一套归属口径）；
 *   - 消息未删除、已发布、不是内部 system/briefing 行；
 *   - 块 id 命中，且 `kind === 'html_widget'`。
 *
 * 任何一项不满足都返回 404：不泄露「这条消息存在但你没权限」，也绝不退化成
 * 「取这一条消息里的第一个 widget」。
 */
export interface ArtifactWidgetBlockRouteDeps {
  messageStore: Pick<IMessageStore, 'getById'>;
}

const paramsSchema = z
  .object({
    threadId: z.string().min(1),
    messageId: z.string().min(1),
    blockId: z.string().min(1),
  })
  .strict();

function unavailable(reply: { code: (status: number) => unknown }) {
  reply.code(404);
  return { error: 'widget_block_unavailable' };
}

export function registerArtifactWidgetBlockRoute(app: FastifyInstance, deps: ArtifactWidgetBlockRouteDeps): void {
  app.get('/api/threads/:threadId/artifacts/:messageId/blocks/:blockId', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) return unavailable(reply);

    const userId = resolveUserId(request, { defaultUserId: 'default-user' });
    if (!userId) {
      reply.code(401);
      return { error: 'identity_required' };
    }

    const { threadId, messageId, blockId } = parsed.data;
    const message = await deps.messageStore.getById(messageId);
    if (!message || message.deletedAt) return unavailable(reply);
    // 归属先于内容：别人的消息与不存在的消息返回同一个响应。
    if (message.userId !== userId || message.threadId !== threadId) return unavailable(reply);
    if (isInternalNonQuotableParent(message) || !isTimelinePublished(message)) return unavailable(reply);

    const block = (message.extra?.rich?.blocks ?? []).find((candidate) => candidate.id === blockId);
    if (!block || block.kind !== 'html_widget') return unavailable(reply);

    return {
      threadId,
      messageId,
      block: {
        id: block.id,
        kind: block.kind,
        v: block.v,
        html: block.html,
        ...(block.title === undefined ? {} : { title: block.title }),
        ...(block.height === undefined ? {} : { height: block.height }),
      },
    };
  });
}
