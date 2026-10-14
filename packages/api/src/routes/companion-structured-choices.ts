import { isDeepStrictEqual } from 'node:util';
import type {
  RuntimeInteractionRecord,
  UnifiedAttentionChoiceRequest,
  UnifiedAttentionItemV1,
  UnifiedAttentionRuntimeInteraction,
} from '@cat-cafe/shared';

function decisionRef(record: RuntimeInteractionRecord): string {
  return `f306.runtime_interaction:${record.request.interactionId}`;
}

/** Keep updatedAt as the published witness until Task655 explicitly migrates the canonical record revision. */
function runtimeRevision(record: RuntimeInteractionRecord): number {
  return record.updatedAt;
}

function projectRuntimeInteraction(record: RuntimeInteractionRecord): UnifiedAttentionRuntimeInteraction | null {
  if (record.status !== 'pending' || !record.cardRef) return null;
  return {
    interactionId: record.request.interactionId,
    revision: runtimeRevision(record),
    kind: record.request.kind,
    requesterCatId: record.request.owner.catId,
    createdAt: record.request.createdAt,
    title: record.request.title,
    cardRef: record.cardRef,
  };
}

function projectChoice(record: RuntimeInteractionRecord): UnifiedAttentionChoiceRequest | undefined {
  if (record.request.kind !== 'question' || !record.cardRef) return undefined;
  return {
    interactionId: record.request.interactionId,
    revision: runtimeRevision(record),
    requesterCatId: record.request.owner.catId,
    createdAt: record.request.createdAt,
    title: record.request.title,
    questions: record.request.questions,
    cardRef: record.cardRef,
  };
}

function exactNeedsMeWitness(
  item: UnifiedAttentionItemV1,
  record: RuntimeInteractionRecord,
  runtime: UnifiedAttentionRuntimeInteraction,
): boolean {
  const taskRef = record.request.entrustedWorkTaskRef;
  if (!taskRef) return false;
  return item.linkedNeedsMe.some(
    ({ ownerRead, receipt }) =>
      receipt.producer.producerId === 'f306.runtime_interaction' &&
      receipt.producer.subjectRef === runtime.interactionId &&
      receipt.producer.revision === runtime.revision &&
      receipt.taskRef.subjectRef === taskRef.subjectRef &&
      receipt.taskRef.observedRevision === taskRef.observedRevision &&
      ownerRead.envelope.subjectRef === taskRef.subjectRef &&
      ownerRead.envelope.revision === taskRef.observedRevision,
  );
}

function exactApprovalAlias(
  item: UnifiedAttentionItemV1,
  record: RuntimeInteractionRecord,
  runtime: UnifiedAttentionRuntimeInteraction,
  ownerUserId: string,
): boolean {
  const approval = item.approval;
  if (
    record.request.kind !== 'approval' ||
    record.request.owner.userId !== ownerUserId ||
    !approval ||
    approval.sourceFeatureId !== 'F306' ||
    approval.proposalId !== runtime.interactionId ||
    approval.requesterCatId !== runtime.requesterCatId ||
    approval.resolution !== 'open' ||
    approval.navigation.state !== 'anchored' ||
    approval.navigation.approvalCardRef.threadId !== runtime.cardRef.threadId ||
    approval.navigation.approvalCardRef.messageId !== runtime.cardRef.messageId
  ) {
    return false;
  }
  const witnesses =
    approval.needsMeDecisionRefs?.filter(
      (candidate) =>
        candidate.producerId === 'f306.runtime_interaction' && candidate.subjectRef === runtime.interactionId,
    ) ?? [];
  return witnesses.length === 1 && witnesses[0]?.revision === runtime.revision;
}

function attachRuntimeProjection(
  item: UnifiedAttentionItemV1,
  runtime: UnifiedAttentionRuntimeInteraction,
  choice: UnifiedAttentionChoiceRequest | undefined,
): boolean {
  if (item.runtimeInteraction && !isDeepStrictEqual(item.runtimeInteraction, runtime)) return false;
  if (choice && item.choiceRequest && !isDeepStrictEqual(item.choiceRequest, choice)) return false;
  item.runtimeInteraction = runtime;
  if (choice) item.choiceRequest = choice;
  return true;
}

/** Merge all canonical pending F306 kinds, preserving the legacy question projection. */
export function mergeStructuredChoices(
  items: UnifiedAttentionItemV1[],
  records: RuntimeInteractionRecord[],
  reasons: Set<string>,
  ownerUserId: string,
): UnifiedAttentionItemV1[] {
  for (const record of records) {
    const runtime = projectRuntimeInteraction(record);
    if (!runtime) continue;
    const choice = projectChoice(record);
    const ref = decisionRef(record);
    const sameIdentity = items.filter((item) => item.decisionRef === ref);
    const exact = sameIdentity.find(
      (item) => exactApprovalAlias(item, record, runtime, ownerUserId) || exactNeedsMeWitness(item, record, runtime),
    );
    if (exact) {
      if (!attachRuntimeProjection(exact, runtime, choice)) {
        reasons.add('ambiguous_decision_identity');
        items.push(runtimeItem(ref, record, runtime, choice));
      }
      continue;
    }
    if (sameIdentity.length > 0) reasons.add('producer_version_or_link_unverified');
    items.push(runtimeItem(ref, record, runtime, choice));
  }
  return items;
}

function runtimeItem(
  decisionRefValue: string,
  record: RuntimeInteractionRecord,
  runtimeInteraction: UnifiedAttentionRuntimeInteraction,
  choiceRequest: UnifiedAttentionChoiceRequest | undefined,
): UnifiedAttentionItemV1 {
  const onlyQuestion = choiceRequest?.questions.length === 1 ? choiceRequest.questions[0] : undefined;
  const summary = onlyQuestion?.question ?? record.request.title;
  return {
    decisionRef: decisionRefValue,
    kind: 'judgment',
    summary,
    runtimeInteraction,
    ...(choiceRequest ? { choiceRequest } : {}),
    linkedNeedsMe: [],
  };
}
