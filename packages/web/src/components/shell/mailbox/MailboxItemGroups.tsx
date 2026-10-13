import type { ReactNode } from 'react';
import { useShellCopy } from '../shell-copy';
import { mailboxEntryCopy } from './mailbox-entry.shell-copy';
import type { MailboxDisplayRow } from './mailbox-rows';

/** Group the canonical rows without losing retained decisions, repairs or original actions. */
export function MailboxItemGroups({
  section,
  rows,
  complete,
  readKnown,
  renderRow,
  mentionControls,
  decisionsComplete = complete,
}: {
  section: 'pending' | 'ignored';
  mentionControls?: ReactNode;
  decisionsComplete?: boolean;
  rows: MailboxDisplayRow[];
  complete: boolean;
  readKnown: boolean;
  renderRow: (row: MailboxDisplayRow) => ReactNode;
}) {
  const t = useShellCopy(mailboxEntryCopy);
  if (section === 'ignored' && rows.length === 0) {
    return (
      <p data-testid="mailbox-ignored-empty" className="m-0 py-2 text-sm" style={{ color: 'var(--shell-muted)' }}>
        {!readKnown ? t.state.unconfirmed : complete ? t.ignoredEmpty : t.ignoredPageEmpty}
      </p>
    );
  }
  const waiting = (row: MailboxDisplayRow) =>
    row.kind === 'item' && (row.item.approval?.resolution === 'open' || row.item.choiceRequest !== undefined);
  const groups = [
    {
      id: 'decisions',
      label: t.decisions,
      empty: !readKnown ? t.state.unconfirmed : decisionsComplete ? t.decisionsEmpty : t.decisionsPageEmpty,
      rows: rows.filter(waiting),
    },
    {
      id: 'mentions',
      label: t.mentions,
      empty: !readKnown ? t.state.unconfirmed : complete ? t.mentionsEmpty : t.mentionsPageEmpty,
      rows: rows.filter((row) => row.kind === 'item' && row.item.kind === 'user_mention'),
    },
  ];
  const other = rows.filter((row) => row.kind === 'item' && row.item.kind !== 'user_mention' && !waiting(row));
  const retained = rows.filter((row) => row.kind === 'retained');
  if (other.length) groups.push({ id: 'other', label: t.other, empty: '', rows: other });
  if (retained.length) groups.push({ id: 'results', label: t.results, empty: '', rows: retained });
  return (
    <div className="flex flex-col gap-5">
      {(section === 'ignored' ? groups.filter((group) => group.rows.length > 0) : groups).map((group) => (
        <section key={group.id} data-testid={`mailbox-group-${group.id}`} aria-label={group.label}>
          <h3 className="mb-2 mt-0 text-sm font-semibold">{group.label}</h3>
          {group.id === 'mentions' ? mentionControls : null}
          {group.rows.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">{group.rows.map(renderRow)}</ul>
          ) : (
            <p className="m-0 py-2 text-sm" style={{ color: 'var(--shell-muted)' }}>
              {group.empty}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
