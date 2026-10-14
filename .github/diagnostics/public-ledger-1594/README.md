# Public ledger diagnostic

This temporary diagnostic branch traces the original 400,000-row entity projection regression
at public candidate `66316ad7dcad3c8b8faf44250913d92f5dbe9ec0` (PR #1594).
The test and its 100ms ledger-write threshold remain unchanged. A passing diagnostic run does
not erase the earlier CI failure or identify its historical cause.

The archive contains three portable source files: `trace-original-test.mjs`, `trace-preload.mjs`
and `io-probe.c`. The runner compiles a SQLite VFS observation extension, initializes it before
measured calls, and invokes the exact original test once. No delay injection is enabled.
It records VFS read/write/sync, lock failure, SQLite sleep, resource use and Linux main-thread
scheduler timing, plus runner/storage context and original test hashes before/after execution.

The GitHub-hosted Ubuntu job uses Node 24.20.0, locked public dependencies, read-only repository
permissions and the existing network-isolated test launcher. It does not change application
code, assertions, the sync branch, main, tags, releases or user data. Its workflow triggers only
on pushes to this diagnostic branch. It is not intended for merge.

Archive SHA256: `85f8588ac26daba2f2906a6e2f2ac372f0f93a8d3b5489fcc751fa92324ff552`.
The entire result, including any failure or absence of a slow sample, is retained for diagnosis.
