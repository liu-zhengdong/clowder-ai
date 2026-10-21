import type { CatId } from '@cat-cafe/shared';
import type { AgentMessage, MessageMetadata } from '../../types.js';
import type { AgentSessionEvent } from './types.js';

export function projectSessionEvent(
  event: AgentSessionEvent,
  ctx: { catId: CatId; metadata: MessageMetadata },
): AgentMessage[] {
  const { metadata } = ctx;
  let message: Omit<AgentMessage, 'catId' | 'metadata' | 'timestamp'>;
  switch (event.type) {
    case 'native_bound':
      metadata.sessionId = event.nativeSessionId;
      message = { type: 'session_init', sessionId: event.nativeSessionId };
      break;
    case 'context':
      if (event.usage) metadata.usage = event.usage;
      metadata.model = event.model ?? metadata.model;
      return [];
    case 'continuity':
    case 'compaction_observed':
    case 'input_read':
      return [];
    case 'output':
      message = { type: 'text', content: event.text, textMode: event.textMode };
      if (event.message)
        message.outputMessage = {
          ...event.message,
          provider: metadata.provider,
          runtimeSessionId: metadata.sessionId,
          turnId: event.turn.nativeTurnId,
        };
      break;
    case 'tool_call':
      message = {
        type: 'tool_use',
        toolName: event.name,
        toolUseId: event.callId,
        toolInput:
          event.input !== null && typeof event.input === 'object' && !Array.isArray(event.input)
            ? (event.input as Record<string, unknown>)
            : { value: event.input },
      };
      break;
    case 'tool_result':
      message = {
        type: 'tool_result',
        toolName: event.name,
        toolUseId: event.callId,
        toolResultStatus: event.status,
        content: typeof event.output === 'string' ? event.output : JSON.stringify(event.output),
      };
      break;
    case 'status':
      message = { type: 'status', content: event.detail ?? event.phase };
      break;
    case 'error':
      message = { type: 'error', error: event.message, errorCode: event.code, errorDisposition: event.disposition };
      break;
    case 'done':
      message = {
        type: 'done',
        ...(event.outcome !== 'completed' ? { errorCode: event.errorCode ?? event.outcome } : {}),
      };
      break;
  }
  return [{ ...message, catId: ctx.catId, metadata: { ...metadata }, timestamp: Date.now() }];
}
