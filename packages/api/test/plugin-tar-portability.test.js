import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  HostInventoryControlPlane,
  LocalPluginPackageAdmission,
  MemoryPluginInventoryStore,
  packageDirectoryName,
} from '../dist/domains/plugin/index.js';
import { installPlugin, resolvePluginsDir } from '../dist/infrastructure/connectors/plugins/plugin-installer.js';
import { manifest } from './plugin-official-package-installer.fixture.js';

// Build fixture bytes without tar so fixture creation cannot mask a consumer's
// drive-colon bug when the Windows lane places GNU tar first on PATH.
function archive(entries) {
  const blocks = entries.flatMap(([name, content]) => {
    const bytes = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    const octal = (value, width) => `${value.toString(8).padStart(width - 1, '0')}\0`;
    header.write(octal(0o644, 8), 100, 8);
    header.write(octal(0, 8), 108, 8);
    header.write(octal(0, 8), 116, 8);
    header.write(octal(bytes.length, 12), 124, 12);
    header.write(octal(0, 12), 136, 12);
    header.fill(0x20, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257, 6);
    header.write('00', 263, 2);
    const sum = [...header].reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    return [header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)];
  });
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

async function privateRoot(run) {
  const root = await mkdtemp(join(tmpdir(), 'plugin tar ; $literal '));
  try {
    // POSIX GNU tar also treats a colon-bearing archive operand as remote.
    const scoped = join(root, process.platform === 'win32' ? 'windows drive' : 'drive:operand');
    await mkdir(scoped);
    await run(scoped);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('local directory admission packages and verifies real bytes with the selected tar', async () => {
  await privateRoot(async (root) => {
    const source = join(root, 'source package');
    await mkdir(join(source, 'dist'), { recursive: true });
    await mkdir(join(source, 'schemas'));
    await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest()));
    const entrypoint = 'throw new Error("package admission must not execute this");\n';
    await writeFile(join(source, 'dist', 'entrypoint.js'), entrypoint);
    await writeFile(join(source, 'schemas', 'official.test.v1.schema.json'), JSON.stringify({ type: 'object' }));
    const packagesRoot = join(root, 'Host packages');
    const store = new MemoryPluginInventoryStore();
    const admission = new LocalPluginPackageAdmission({
      inventory: new HostInventoryControlPlane(store),
      packagesRoot,
      grantPolicy: () => ['events.publish'],
    });

    const result = await admission.install({ kind: 'local-directory', path: source });

    assert.equal(result.pluginId, 'official.test-source');
    const snapshot = await store.snapshot();
    assert.equal(snapshot.instances.length, 1);
    assert.equal(snapshot.instances[0].runtimeState, 'stopped');
    assert.deepEqual(snapshot.grants[0].effectiveGrants, ['events.publish']);
    const bytes = await readFile(join(packagesRoot, packageDirectoryName(result.packageDigest), 'package.tgz'));
    assert.equal(result.packageDigest, `sha512-${createHash('sha512').update(bytes).digest('base64')}`);
    assert.equal(await readFile(join(source, 'dist', 'entrypoint.js'), 'utf8'), entrypoint);
    assert.equal((await readdir(packagesRoot)).some((name) => name.startsWith('.local-directory-')), false);
  });
});

function connectorBytes(id, entrypoint = 'throw new Error("installer must not execute this");\n') {
  return archive([
    [
      `${id}/connector.yaml`,
      `id: ${id}\nname: Portable Connector\ndocs_url: https://example.com\nconfig: []\nsteps:\n  - text: Step 1\n  - text: Step 2\n  - text: Step 3\n`,
    ],
    [`${id}/index.js`, entrypoint],
  ]);
}

test('connector installation and update accept an absolute archive path without changing its bytes or config', async () => {
  await privateRoot(async (root) => {
    const sourceArchive = join(root, 'source package ; $literal.tgz');
    const bytes = connectorBytes('portable-test');
    await writeFile(sourceArchive, bytes);
    const projectRoot = join(root, 'project root');
    const first = await installPlugin(projectRoot, sourceArchive, new Set());
    assert.equal(first.action, 'installed', JSON.stringify(first));
    assert.equal(first.id, 'portable-test');
    const configPath = join(projectRoot, '.cat-cafe', 'im-connector-config', 'portable-test.json');
    await mkdir(join(configPath, '..'), { recursive: true });
    await writeFile(configPath, '{"owner":"preserve"}');

    const second = await installPlugin(projectRoot, sourceArchive, new Set());
    assert.equal(second.action, 'updated', JSON.stringify(second));
    assert.deepEqual(await readFile(sourceArchive), bytes);
    assert.equal(await readFile(configPath, 'utf8'), '{"owner":"preserve"}');
    await access(join(resolvePluginsDir(projectRoot), 'portable-test', 'index.js'));
    assert.equal((await readdir(resolvePluginsDir(projectRoot))).some((name) => name.startsWith('.tmp-install-')), false);
  });
});

test('connector tar portability preserves archive-layout rejection and cleanup', async () => {
  await privateRoot(async (root) => {
    const sourceArchive = join(root, 'multiple roots.tgz');
    await writeFile(sourceArchive, archive([['first/index.js', 'one'], ['second/index.js', 'two']]));
    const projectRoot = join(root, 'project');
    const result = await installPlugin(projectRoot, sourceArchive, new Set());
    assert.equal(result.code, 'INVALID_ARCHIVE', JSON.stringify(result));
    assert.match(result.message, /exactly one top-level directory/);
    assert.deepEqual(await readdir(resolvePluginsDir(projectRoot)), []);
  });
});
