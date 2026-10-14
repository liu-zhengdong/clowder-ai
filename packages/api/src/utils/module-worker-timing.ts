export interface ModuleWorkerTiming {
  phase: 'settled' | 'released';
  outcome: 'success' | 'failed' | 'aborted' | 'timeout' | 'rejected';
  started: boolean;
  elapsedMs: number;
  /** Admission to start; includes scheduling delay, not the worker's own execution. */
  queueMs: number;
  /** Start to settlement (spawn/import, work, serialization and IPC); not CPU time. */
  runMs: number;
  /** Settlement to actual exit/capacity release. Zero at settlement. */
  releaseLagMs: number;
  activeAtAdmission: number;
  queuedAtAdmission: number;
}
