import type { ArtifactReviewAnchor } from '@cat-cafe/shared';
import { useEffect, useRef, useState } from 'react';
import { addMediaSelectionToChat, addMediaWorkToChat } from '@/components/content-review/media-chat-composer';
import {
  MEDIA_SELECTION_REFUSAL_COPY,
  mediaChatTarget,
  pendingMediaAttachment,
  sameMediaSource,
} from '@/components/content-review/media-chat-selection';
import type { PendingChatMark } from '@/components/content-review/ReviewPendingChatMarks';
import { useComposerContextAttachments } from '@/components/useComposerContextAttachments';
import { useChatStore } from '@/stores/chatStore';
import { useWorkspaceSurfaceVisibility } from '../WorkspaceSurfaceVisibility';
import type { ContentReviewView, ContentReviewWorkflow } from './content-review-contract';
import type { WorkspaceAnnotationTarget } from './useWorkspaceContentReview';
import { workspaceReviewRequestSource } from './workspace-modification-source';

/**
 * 「引用到聊天」 for a circled place on a work: it lands in the one chat composer as a media attachment, naming the
 * version that was reviewed through the same source builder "请猫修改" uses, and writes nothing to the review. A
 * surface that knows the work better (a media round with a Task) hands over its own target through the workflow.
 */
export function useWorkspaceMediaChat({
  view,
  path,
  workflow,
  target,
  draft,
  setDraft,
  setTarget,
  referenceOnOpen = false,
}: {
  readonly view: ContentReviewView;
  readonly path: string;
  readonly workflow?: ContentReviewWorkflow;
  readonly target: WorkspaceAnnotationTarget | null;
  readonly draft: string;
  readonly setDraft: (draft: string) => void;
  readonly setTarget: (target: WorkspaceAnnotationTarget | null) => void;
  readonly referenceOnOpen?: boolean;
}) {
  const threadId = useChatStore((state) => state.currentThreadId);
  const visible = useWorkspaceSurfaceVisibility();
  const composerDraft = useComposerContextAttachments(threadId ?? '');
  const [notice, setNotice] = useState<{ kind: 'selection' | 'whole'; message: string } | null>(null);
  const source = view.currentSource ?? view.review.source;
  const mime = source.kind === 'text' || source.kind === 'video-project' ? null : source.mime;
  const chatMedia =
    workflow && 'chatMedia' in workflow
      ? (workflow.chatMedia ?? null)
      : mime
        ? mediaChatTarget({
            title: path.split('/').at(-1) || path,
            mime,
            source: workspaceReviewRequestSource(view),
          })
        : null;
  const pending = chatMedia ? pendingMediaAttachment(composerDraft) : undefined;
  const marks: readonly PendingChatMark[] | undefined =
    pending && chatMedia && sameMediaSource(pending, chatMedia)
      ? pending.selections.map((item) => ({ id: item.id, anchor: item.selection }))
      : undefined;
  const addSelection = (anchor: ArtifactReviewAnchor) => {
    if (!chatMedia) {
      setNotice({
        kind: 'selection',
        message: MEDIA_SELECTION_REFUSAL_COPY[mime && mime !== 'image/png' ? 'not_image' : 'invalid'],
      });
      return false;
    }
    const result = addMediaSelectionToChat(threadId ?? null, chatMedia, anchor, draft, referenceOnOpen);
    if (result.kind === 'refused') {
      setNotice({ kind: 'selection', message: MEDIA_SELECTION_REFUSAL_COPY[result.reason] });
      return false;
    }
    setNotice(null);
    setDraft('');
    setTarget(null);
    return true;
  };
  const add = () => {
    if (target?.kind === 'media_anchor') addSelection(target.anchor);
  };
  const addWork = () => {
    if (!chatMedia) return;
    const result = addMediaWorkToChat(threadId ?? null, chatMedia, referenceOnOpen);
    setNotice(
      result.kind === 'refused' ? { kind: 'whole', message: MEDIA_SELECTION_REFUSAL_COPY[result.reason] } : null,
    );
  };
  const addWorkRef = useRef(addWork);
  addWorkRef.current = addWork;
  const referenceKey = JSON.stringify(chatMedia);
  const mayReference = visible && referenceOnOpen && !!chatMedia && view.canWrite && view.sourceState === 'current';
  useEffect(() => {
    // A retained hidden owner restoring beside another work is not an explicit image open.
    // Opening the visible work references it; an unselected message names this whole work;
    // the existing composer operation preserves its draft, existing regions and admission fences.
    if (mayReference) addWorkRef.current();
  }, [mayReference, referenceKey, threadId]);
  return {
    target: chatMedia,
    offered: target?.kind === 'media_anchor',
    wholeWorkOffered: mime === 'image/png' && !!chatMedia && view.canWrite && view.sourceState === 'current',
    add,
    addSelection,
    addWork,
    notice: notice && (notice.kind === 'whole' || target?.kind === 'media_anchor') ? notice.message : null,
    clearNotice: () => setNotice(null),
    marks,
  };
}
