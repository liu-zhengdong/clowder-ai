import type { UnifiedAttentionReadV1 } from '@cat-cafe/shared';
import { useEffect, useState } from 'react';
import { useShellCopy } from '../shell-copy';
import type { UnifiedAttentionView } from '../use-unified-attention';
import { MailboxPeriodFilter } from './MailboxPeriodFilter';
import { MentionHandlingConfirmation } from './MentionHandlingConfirmation';
import { mailboxEntryCopy } from './mailbox-entry.shell-copy';
import type { MentionIgnorePeriod } from './personal-mention-preview';
import type { useMailboxPersonalPreferences } from './use-mailbox-personal-preferences';
import { usePersonalMentionBatch } from './use-personal-mention-batch';

/** One named full-set ignore action. Canonical handling history and recovery remain distinct. */
export function MailboxMentionControls({
  read,
  view,
  personal,
}: {
  read: UnifiedAttentionReadV1 | null;
  view: UnifiedAttentionView;
  personal: ReturnType<typeof useMailboxPersonalPreferences>;
}) {
  const t = useShellCopy(mailboxEntryCopy);
  const period = read?.mentionPeriod === 'today' || read?.mentionPeriod === 'earlier' ? read.mentionPeriod : 'week';
  const [scope, setScope] = useState<MentionIgnorePeriod>(period);
  useEffect(() => setScope(period), [period]);
  const batch = usePersonalMentionBatch(read, view, personal);
  const labels = { today: t.today, week: t.week, earlier: t.earlierPeriod, all: t.allTime };
  return (
    <div className="mb-3 flex flex-col gap-2 text-xs" data-testid="mailbox-mention-controls">
      <MailboxPeriodFilter read={read} view={view} busy={batch.busy} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="mailbox-bulk-ignore-scope">{t.bulkScope}</label>
        <select
          id="mailbox-bulk-ignore-scope"
          value={scope}
          disabled={batch.busy}
          className="shell-focusable rounded-lg border px-2 py-1"
          style={{ background: 'var(--shell-paper)', borderColor: 'var(--shell-hairline)' }}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'today' || value === 'week' || value === 'earlier' || value === 'all') setScope(value);
          }}
        >
          {(['today', 'week', 'earlier', 'all'] as const).map((value) => (
            <option key={value} value={value}>
              {labels[value]}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="mailbox-mentions-ignore-all"
          disabled={batch.busy || personal.actions?.disabled !== false}
          className="shell-nav-row shell-focusable rounded-lg px-2 py-1 disabled:opacity-50"
          onClick={() => void batch.prepare(scope)}
        >
          {t.ignoreAll(labels[scope])}
        </button>
      </div>
      {batch.notice ? (
        <p role="status" className="m-0" data-testid="mailbox-bulk-ignore-notice">
          {batch.notice === 'empty'
            ? t.bulkEmpty
            : batch.notice === 'changed'
              ? t.preferenceConflict
              : t.preferenceUnavailable}
        </p>
      ) : null}
      {batch.snapshot ? (
        <MentionHandlingConfirmation
          count={batch.snapshot.requests.length}
          scope={batch.snapshot.period}
          counts={batch.snapshot.counts}
          busy={batch.busy}
          onConfirm={() => void batch.confirm()}
          onCancel={batch.cancel}
          personal={{
            title: t.ignoreDialog,
            description: t.ignoreExplanation(batch.snapshot.requests.length, labels[batch.snapshot.period]),
            confirm: t.ignoreConfirm(batch.snapshot.requests.length),
            cancel: t.cancel,
          }}
        />
      ) : null}
    </div>
  );
}
