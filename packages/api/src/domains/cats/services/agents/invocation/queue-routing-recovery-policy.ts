import type { StoredMessage } from '../../stores/ports/MessageStore.js';
import type { QueueLedgerEntry } from './queue-ledger/QueueLedger.js';

/** A durable policy hold is valid only when the owner can recover this exact source and target. */
export function isOwnerRecoverableRoutingTarget(
  entry: QueueLedgerEntry,
  source: StoredMessage | null | undefined,
  targetCatId: string,
): boolean {
  return Boolean(
    source &&
      entry.owner.kind === 'user' &&
      source.id === entry.payload.messageId &&
      source.threadId === entry.threadId &&
      source.userId === entry.owner.userId &&
      !source.deletedAt &&
      !source.recall &&
      !source._tombstone &&
      source.deliveryStatus !== 'canceled' &&
      source.visibility !== 'whisper' &&
      entry.targets.includes(targetCatId) &&
      !source.lifecycle?.dispatchRefs?.some((ref) => ref.targetId === targetCatId) &&
      entry.kind !== 'private_input' &&
      !(entry.from.kind === 'agent' && entry.sourceCategory === 'continuation') &&
      !entry.execution.liveSessionId &&
      !entry.execution.executionScope,
  );
}
