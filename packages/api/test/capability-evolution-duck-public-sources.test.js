import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { createDuckCapabilityPublicAdapter } from '../dist/infrastructure/capability-evolution/adapters/microduck-exploration/duck-capability-public-adapter.js';
import { createMicroduckRuntimeAdapter } from '../dist/infrastructure/capability-evolution/adapters/microduck-owner-runtime.js';
import { ProgramAdapterRegistry } from '../dist/infrastructure/capability-evolution/adapters/program-adapter-registry.js';
import { capabilityEvolutionProgramRoutes } from '../dist/routes/capability-evolution-program-routes.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const programId = 'evolution-program:352afab60afb6263b8386eaed12dba03';
const objectRef = {
  ownerFeatureId: 'F311',
  ownerStateRef:
    'capability:%E7%8C%AB%E7%8C%AB%E5%B8%A6%E9%B8%AD%E9%B8%AD%E5%8D%8F%E5%90%8C%E8%B8%A2%E7%90%83%E8%B5%9B',
};
const apps = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

async function fixture({
  user = 'default-user',
  workspaceId = 'user:default-user',
  target = objectRef,
  id = programId,
  readBytes,
} = {}) {
  const app = Fastify();
  if (user)
    app.addHook('preHandler', (request, _reply, done) => {
      request.sessionUserId = user;
      done();
    });
  const registry = new ProgramAdapterRegistry();
  registry.register(createMicroduckRuntimeAdapter());
  registry.register(createDuckCapabilityPublicAdapter({ repoRoot, readBytes }));
  const program = { programId: id, objectRef: target, workspaceId, sequence: 33 };
  await app.register(capabilityEvolutionProgramRoutes, {
    service: { get: async () => ({ program }) },
    adapterRegistry: registry,
  });
  apps.push(app);
  return app;
}

test('the existing duck goal reads football and both Cortex experiments without changing its target', async () => {
  const app = await fixture();
  const response = await app.inject({
    url: `/api/capability-evolution/programs/${encodeURIComponent(programId)}/exploration`,
  });
  assert.equal(response.statusCode, 200, response.body);
  const read = response.json();
  assert.deepEqual(read.objectRef, objectRef);
  assert.equal(read.programRef.ownerStateRef, programId);
  assert.ok(read.nodes.some((node) => node.title === 'v8'));
  const cortex = read.nodes.find((node) => node.title === 'Cortex · 两场公开比赛');
  assert.ok(cortex);
  assert.deepEqual(cortex.parentEdges, []);
  assert.equal(read.experiments.filter((run) => run.nodeRef.ownerStateRef === cortex.nodeRef.ownerStateRef).length, 2);
  assert.ok(read.nodes.every((node) => node.kind === 'public_archive'));
  assert.equal('currentVersionRefs' in read, false);
});

const explorationUrl = (id = programId) => `/api/capability-evolution/programs/${encodeURIComponent(id)}/exploration`;
const select = (experimentRef) => `?${new URLSearchParams({ selectedExperimentRef: JSON.stringify(experimentRef) })}`;

test('both Cortex run records preserve their own conditions, observed results and exact original bytes', async () => {
  const app = await fixture();
  const catalog = (await app.inject({ url: explorationUrl() })).json();
  const runs = catalog.experiments.filter((run) => run.experimentRef.ownerStateRef.startsWith('cortex-run:'));
  assert.deepEqual(
    runs.map((run) => run.conditions.window.label),
    ['0–120秒', '0–240秒'],
  );
  assert.ok(
    runs.every(
      (run) => run.conditions.threshold.status === 'unknown' && run.conditions.comparison.design === 'undeclared',
    ),
  );
  for (const [index, run] of runs.entries()) {
    const response = await app.inject({ url: explorationUrl() + select(run.experimentRef) });
    assert.equal(response.statusCode, 200, response.body);
    const record = response.json().details[0].records[0];
    assert.equal(record.values.blue_goals, index);
    assert.equal(record.result.status, 'observed');
    assert.ok(record.sources.every((source) => source.href.includes('35dfed114be3ca292aac304a888d4a9519d0dbea')));
    assert.ok(
      record.input.find((fact) => fact.label === '局部反馈').value.includes(index ? 'simulator state' : 'sensor'),
    );
    const query = new URLSearchParams({
      experimentRef: JSON.stringify(run.experimentRef),
      recordRef: JSON.stringify(record.recordRef),
    });
    const media = await app.inject({ url: `${explorationUrl()}-media/${record.media[0].mediaRef.version}?${query}` });
    assert.equal(media.statusCode, 200, media.body.slice(0, 100));
    assert.equal(createHash('sha256').update(media.rawPayload).digest('hex'), record.media[0].mediaRef.version);
    query.set('recordRef', JSON.stringify({ ...record.recordRef, version: 'f'.repeat(64) }));
    assert.equal(
      (await app.inject({ url: `${explorationUrl()}-media/${record.media[0].mediaRef.version}?${query}` })).statusCode,
      404,
    );
  }
});

test('auth, workspace, exact Program and original target fences reject neighboring readers before bytes are read', async () => {
  for (const [options, status] of [
    [{ user: '' }, 401],
    [{ workspaceId: 'user:someone-else' }, 404],
    [{ id: 'evolution-program:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, 422],
    [{ target: { ...objectRef, ownerStateRef: `${objectRef.ownerStateRef}-neighbor` } }, 422],
    [{ target: { ...objectRef, version: 'unbound-version' } }, 422],
  ]) {
    let reads = 0;
    const app = await fixture({
      ...options,
      readBytes: async () => {
        reads++;
        throw Error('unexpected archive read');
      },
    });
    const response = await app.inject({ url: explorationUrl(options.id) });
    assert.equal(response.statusCode, status, response.body);
    assert.equal(reads, 0);
  }
});

test('a corrupted Cortex inventory cannot answer a Cortex selection using football instead', async () => {
  const app = await fixture();
  const catalog = (await app.inject({ url: explorationUrl() })).json();
  const cortexRun = catalog.experiments.find((run) => run.experimentRef.ownerStateRef.startsWith('cortex-run:'));
  const broken = await fixture({
    readBytes: async (path) =>
      path.endsWith('/cortex/evidence/20260910/manifest.json')
        ? Buffer.from('{}')
        : new Uint8Array(await readFile(path)),
  });
  const response = await broken.inject({ url: explorationUrl() + select(cortexRun.experimentRef) });
  assert.equal(response.statusCode, 422, response.body);
  assert.ok(!response.json().details);
});

test('public source reading supplies no owner version or execution capability', async () => {
  const adapter = createDuckCapabilityPublicAdapter({ repoRoot });
  assert.equal(adapter.versionReview, undefined);
  assert.equal(adapter.preparationReview, undefined);
  for (const verb of ['observe', 'permission', 'mutate', 'verify', 'writeback', 'freshOutcome', 'rollback'])
    assert.deepEqual(await adapter[verb]({}), { status: 'blocked', code: 'owner_route_unavailable' });
});
