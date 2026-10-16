import type { DurableManagedGateJob } from '../domains/ball-custody/durable-managed-gate-job.js';
import {
  rawDurableGateRecord,
  writeDurableGateRecord,
} from '../domains/ball-custody/durable-managed-gate-job-store.js';
import { readUnixProcessSnapshotSync } from '../utils/cli-process-ownership.js';
import {
  cleanupAndDrainDurableManagedGateAttempt,
  type DurableManagedGateAttemptProcess,
  waitForDurableManagedGateAttemptClose,
} from './managed-runner-durable-child.js';

export async function cleanupManagedRecoveryAttempt(
  durableJob: DurableManagedGateJob,
  attempt: DurableManagedGateAttemptProcess,
  budgetMs: number,
  pollMs: number,
) {
  const startedAt = Date.now();
  const cooperativeSignals = [];
  // Alpha owns S3's cancellation/receipt transaction. Give that child a bounded
  // chance to finish it before the existing token sweep stops every descendant.
  if (durableJob.kind === 'alpha_revision_v1' && attempt.currentExit() === null && attempt.child.pid) {
    const identity = readUnixProcessSnapshotSync({ pids: [attempt.child.pid] })?.get(attempt.child.pid);
    if (identity) {
      const sentAt = Date.now();
      if (attempt.child.kill('SIGTERM')) {
        cooperativeSignals.push({ processIdentity: identity, signal: 'SIGTERM' as const, sentAt });
        await waitForDurableManagedGateAttemptClose(attempt, Math.min(5000, Math.floor(budgetMs / 2)));
      }
    }
  }
  const swept = await cleanupAndDrainDurableManagedGateAttempt(
    attempt,
    Math.max(1, budgetMs - (Date.now() - startedAt)),
    pollMs,
  );
  const cleanup = { ...swept, signals: [...cooperativeSignals, ...swept.signals] };
  if (durableJob.recordStorage === 'sqlite_v1') {
    const current = rawDurableGateRecord(durableJob);
    if (
      !current ||
      current.attemptToken !== attempt.attemptToken ||
      !writeDurableGateRecord(durableJob, { ...current, cleanupProven: cleanup.proven, updatedAt: Date.now() })
    ) {
      throw new Error('managed_job_cleanup_receipt_fenced');
    }
  }
  return cleanup;
}
