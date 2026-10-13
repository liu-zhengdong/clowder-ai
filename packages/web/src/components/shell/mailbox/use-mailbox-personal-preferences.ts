import type { UnifiedAttentionPreferenceCoordinate } from '@cat-cafe/shared';
import { useRef, useState } from 'react';
import { useIgnoredItemPreferences } from '@/hooks/useIgnoredItemPreferences';
import type { UnifiedAttentionView } from '../use-unified-attention';

export interface MailboxPersonalActions {
  mode: 'visible' | 'ignored';
  disabled: boolean;
  change: (coordinate: UnifiedAttentionPreferenceCoordinate, restore?: boolean) => Promise<boolean>;
}

/** Use only the original owner-private writer, bound to the version shown by the exact personal read. */
export function useMailboxPersonalPreferences(view: UnifiedAttentionView) {
  const read = view.result.kind === 'ok' ? view.result.read : null;
  const personal = read?.personalView;
  const preferences = useIgnoredItemPreferences(read?.identity.ownerUserId, personal !== undefined);
  const currentView = useRef(view);
  currentView.current = view;
  const [undo, setUndo] = useState<{ owner: string; coordinates: UnifiedAttentionPreferenceCoordinate[] } | null>(null);
  const ready = Boolean(
    read &&
      personal &&
      preferences.ready &&
      !preferences.saving &&
      personal.preferenceRevision === preferences.snapshot?.revision &&
      read.identity.ownerUserId === preferences.snapshot?.ownerUserId &&
      read.status === 'available' &&
      read.consistency.state === 'verified' &&
      Object.values(read.sources).every(
        (source) => source.status === 'available' && source.exhaustiveness === 'complete',
      ) &&
      view.resultGeneration === view.readsStarted(),
  );
  const save = async (coordinates: UnifiedAttentionPreferenceCoordinate[], restore: boolean) => {
    const live = currentView.current;
    if (!ready || !read || live.result !== view.result || live.resultGeneration !== live.readsStarted()) return false;
    const success = await preferences.change(restore ? [] : coordinates, restore ? coordinates : []);
    if (success && !restore) setUndo({ owner: read.identity.ownerUserId, coordinates });
    if (success && restore) setUndo(null);
    if (!success) live.refetch();
    return success;
  };
  const actions: MailboxPersonalActions | undefined = personal
    ? {
        mode: personal.mode,
        disabled: !ready,
        change: (coordinate, restore = false) => save([coordinate], restore),
      }
    : undefined;
  return {
    actions,
    error: preferences.error,
    loading: preferences.loading,
    saving: preferences.saving,
    undo:
      undo && read?.identity.ownerUserId === undo.owner && preferences.snapshot?.ownerUserId === undo.owner
        ? undo
        : null,
    ignoreBatch: (coordinates: UnifiedAttentionPreferenceCoordinate[], owner: string, revision: number) =>
      read?.identity.ownerUserId === owner && preferences.snapshot?.revision === revision
        ? save(coordinates, false)
        : Promise.resolve(false),
    dismissUndo: () => setUndo(null),
    undoLast: () => (undo ? save(undo.coordinates, true) : Promise.resolve(false)),
  };
}
