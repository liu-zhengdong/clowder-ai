import { ShellGlyph } from '../ShellIcons';
import { useShellCopy } from '../shell-copy';
import { mailboxEntryCopy } from './mailbox-entry.shell-copy';
import type { OriginalPlace } from './original-place';

/**
 * The way back to the original place. An exact place says "打开原处处理". Where the panel cannot find the one item it says so
 * and opens the list that owns it, under its own name, instead of letting a list pass for the place. `quiet` is the same
 * way back as a second thing to do (below a card that already carries the decision), not the one way forward.
 */
export function PlaceAction({
  place,
  onOpen,
  quiet = false,
}: {
  place: OriginalPlace;
  onOpen: (place: OriginalPlace) => void;
  quiet?: boolean;
}) {
  const t = useShellCopy(mailboxEntryCopy);
  const listLabel = { approval: t.approvalList, 'needs-me': t.workList };
  // A list is still reachable through the mailbox's second layer; it is not this proposal's original place.
  if (quiet && place.kind === 'list') return null;
  return (
    <div className={quiet ? 'flex items-center' : 'flex items-center justify-between gap-3'}>
      {place.kind === 'list' ? (
        <p className="m-0 text-xs" style={{ color: 'var(--shell-muted)' }} data-testid="mailbox-place-note">
          {t.originalUnavailable}
        </p>
      ) : !quiet ? (
        <span />
      ) : null}
      <button
        type="button"
        data-testid="mailbox-open-original"
        data-place={place.kind}
        onClick={() => onOpen(place)}
        className="shell-focusable inline-flex items-center gap-1.5 flex-none rounded-lg px-3 py-1.5 text-sm font-medium"
        style={
          quiet
            ? {
                background: 'transparent',
                color: 'var(--shell-primary-text)',
                border: '1px solid var(--shell-hairline)',
              }
            : { background: 'var(--shell-primary)', color: 'var(--shell-primary-on)' }
        }
      >
        <ShellGlyph name="chevronRight" className="h-4 w-4" />
        {place.kind === 'exact' ? (quiet ? t.originalQuiet : t.original) : listLabel[place.destination]}
      </button>
    </div>
  );
}
