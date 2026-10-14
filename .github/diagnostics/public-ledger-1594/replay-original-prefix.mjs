import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output, probe, planPath] = process.argv.slice(2).map((value) => resolve(value));
const packageRoot = join(root, 'packages/api');
const target = 'test/memory/entity-projection-liveness.test.js';
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
mkdirSync(output, { recursive: true });
const receipt = { kind: 'original-prefix-diagnostic', startedAt: new Date().toISOString(), files: [], status: 'setup' };
const save = () => writeFileSync(join(output, 'prefix-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
try {
  receipt.head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(receipt.head, '66316ad7dcad3c8b8faf44250913d92f5dbe9ec0');
  receipt.planSha256 = sha256(planPath);
  assert.equal(receipt.planSha256, 'd1b51b00c67c713f79832a0c2f741a47203698037a2ad36c8c90cec8bbf77b5c');
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const { filesForPublicTestLane, runNodePublicTestFile } = await import(pathToFileURL(join(packageRoot, 'scripts/run-public-test-shard.mjs')));
  const { assertPublicTestIsolation, denySanctuaryEndpoints } = await import(pathToFileURL(join(packageRoot, 'scripts/public-test-isolation-preflight.mjs')));
  const { currentPublicTestProvenance, samePublicTestProvenance } = await import(pathToFileURL(join(packageRoot, 'scripts/public-test-provenance.mjs')));
  receipt.provenance = currentPublicTestProvenance(packageRoot);
  assert(samePublicTestProvenance(plan.plannerProvenance, receipt.provenance));
  const lane = filesForPublicTestLane(plan, 'distributable-5');
  assert.equal(lane.length, 465);
  assert.equal(lane.indexOf(target), 287);
  receipt.planFingerprint = plan.planFingerprint;
  receipt.isolation = assertPublicTestIsolation({ resourceScope: 'distributable' }).attestation;
  receipt.originalTestSha256 = sha256(join(packageRoot, target));
  assert.equal(receipt.originalTestSha256, 'a693cf0b599504e7e7cbeaccd18afc340c2d479a82163c479ac4a21ff0667005');
  receipt.status = 'prefix_running';
  save();
  for (const file of lane.slice(0, 287)) {
    const result = await runNodePublicTestFile({ file, packageRoot, resourceScope: 'distributable' });
    receipt.files.push(result);
    save();
    if (result.status !== 'passed') {
      receipt.status = 'prefix_failed';
      throw new Error(`Predecessor failed; target was not run: ${file}`);
    }
  }
  const require = createRequire(join(packageRoot, 'package.json'));
  const binding = dirname(require.resolve('better-sqlite3/package.json'));
  const extension = join(output, 'r04-io.so');
  execFileSync('cc', ['-O2', '-shared', '-fPIC', '-I', join(binding, 'deps/sqlite3'), join(probe, 'io-probe.c'), '-o', extension], { stdio: 'inherit' });
  receipt.status = 'target_running';
  receipt.targetStartedAt = new Date().toISOString();
  save();
  const { env } = denySanctuaryEndpoints(process.env);
  // The diagnostic import is an argv entry only. Only the canonical resource
  // guard propagates through NODE_OPTIONS into application worker processes.
  const args = ['--import', join(packageRoot, 'scripts/public-test-external-resource-guard.mjs'),
    '--import', join(packageRoot, 'test/helpers/setup-cat-registry.js'),
    '--import', join(probe, 'trace-preload.mjs'), '--test', '--test-concurrency=1', target];
  const result = spawnSync(process.execPath, args, {
    cwd: packageRoot, stdio: 'inherit', timeout: 90_000,
    env: { ...env, CAT_CAFE_PUBLIC_TEST_RESOURCE_SCOPE: 'distributable',
      R04_SOURCE_ROOT: root, R04_TRACE_DIR: output, R04_VFS_EXTENSION: extension },
  });
  Object.assign(receipt, { platform: process.platform, arch: process.arch, node: process.version,
    targetArgv: args, exit: result.status, signal: result.signal, error: result.error?.message,
    finalTestSha256: sha256(join(packageRoot, target)),
    status: result.status === 0 ? 'target_passed_cause_unresolved' : 'target_failed' });
  assert.equal(receipt.finalTestSha256, receipt.originalTestSha256);
  process.exitCode = result.status ?? 1;
} catch (error) {
  receipt.error = error.message;
  if (receipt.status !== 'prefix_failed') receipt.status = 'inconclusive';
  process.exitCode = 1;
  console.error(error);
} finally {
  receipt.finishedAt = new Date().toISOString();
  save();
}
