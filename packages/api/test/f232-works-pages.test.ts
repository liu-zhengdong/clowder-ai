import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { withBallCustodyTaskEvents } from '../src/domains/ball-custody/BallCustodyTaskStore.js';
import { readGlobalWorksPage, WorksPageError } from '../src/domains/cats/services/agents/routing/global-works-page.js';
import { TaskStore } from '../src/domains/cats/services/stores/ports/TaskStore.js';
import { threadsRoutes } from '../src/routes/threads.js';

const owner = 'works-page-owner';
const headers = { 'x-cat-cafe-user': owner };
const file = (id: string, timestamp: number) => ({
  id,
  threadId: 'T',
  userId: owner,
  catId: 'codex61-sol',
  timestamp,
  content: '',
  mentions: [],
  extra: { rich: { blocks: [{ kind: 'file', v: 1, id, url: `/uploads/${id}.pdf`, fileName: `${id}.pdf` }] } },
});

test('cursor positions cannot retain revoked thread access, and failed source reads never become an empty success', async () => {
  const input = {
    userId: owner,
    threads: [{ id: 'T', createdBy: owner }],
    tasks: { listByThreadPage: async () => ({ tasks: [] }) },
    messages: {
      getByThreadBeforeBounded: async () => ({
        messages: [],
        scannedCount: 128,
        storageRoundTrips: 1,
        exhausted: false,
        nextCursor: { timestamp: 1, id: 'older' },
      }),
    },
    accepted: async () => [],
  };
  const first = await readGlobalWorksPage(input);
  assert.equal(first.complete, false);
  assert.ok(first.nextCursor);
  await assert.rejects(
    readGlobalWorksPage({ ...input, cursor: first.nextCursor, threads: [] }),
    (error) => error instanceof WorksPageError && error.statusCode === 409,
  );
  await assert.rejects(
    readGlobalWorksPage({ ...input, cursor: first.nextCursor, userId: 'another-owner' }),
    (error) => error instanceof WorksPageError && error.statusCode === 400,
  );
  await assert.rejects(
    readGlobalWorksPage({
      ...input,
      messages: {
        getByThreadBeforeBounded: async () => {
          throw new Error('storage unavailable');
        },
      },
    }),
    /storage unavailable/,
  );
});

test('many PR attachments in one task page resume within the 512-candidate budget without dropping formal attachments', async () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({
    id: `task-${i}`,
    kind: 'work',
    userId: owner,
    title: 'Accepted delivery',
    ownerCatId: 'codex61-sol',
    updatedAt: i,
    entrustedWork: { artifactRefs: Array.from({ length: 64 }, (_, j) => `pr:org/repo#${i * 64 + j + 1}`) },
  }));
  const input = {
    userId: owner,
    threads: [{ id: 'T', createdBy: owner }],
    tasks: {
      listByThreadPage: async (_thread, _limit, afterId) => ({
        tasks: tasks.slice(afterId ? tasks.findIndex((t) => t.id === afterId) + 1 : 0),
      }),
    },
    messages: {
      getByThreadBeforeBounded: async () => ({ messages: [], scannedCount: 0, storageRoundTrips: 0, exhausted: true }),
    },
    accepted: async () => [],
  };
  const refs = new Set<string>();
  let cursor: string | undefined;
  for (let request = 0; request < 4; request++) {
    const page = await readGlobalWorksPage({ ...input, cursor });
    assert.ok(page.artifacts.length <= 512);
    page.artifacts.forEach((row) => {
      assert.ok(!refs.has(row.ref));
      refs.add(row.ref);
    });
    cursor = page.nextCursor;
    if (!cursor) {
      assert.equal(page.complete, true);
      break;
    }
  }
  assert.equal(refs.size, 1280);
});

test('global Works yields a bounded page before scanning long history, then resumes without losing older works', async () => {
  const app = Fastify();
  const messages = Array.from({ length: 700 }, (_, i) => file(`m-${String(i).padStart(4, '0')}`, i + 1));
  let rawReads = 0;
  let custodyEvents = 0;
  const tasks = new TaskStore();
  tasks.listByThreadPage = () => ({ tasks: [], scannedCount: 0 });
  tasks.listByThread = () => assert.fail('unbounded task read');
  await app.register(threadsRoutes, {
    threadStore: { list: async () => [{ id: 'T', title: 'Long history', createdBy: owner }] },
    messageStore: {
      getByThread: () => assert.fail('paged Works must not start an unbounded visible-message refill'),
      getByThreadBeforeBounded: async (_thread, time, limit, beforeId, userId, scanLimit) => {
        assert.equal(userId, owner);
        assert.ok(limit <= 128 && scanLimit <= 128);
        const eligible = [...messages]
          .reverse()
          .filter((m) => m.timestamp < time || (m.timestamp === time && m.id < beforeId));
        const rows = eligible.slice(0, scanLimit);
        rawReads += rows.length;
        const last = rows.at(-1);
        return {
          messages: rows.reverse(),
          scannedCount: rows.length,
          storageRoundTrips: 0,
          exhausted: eligible.length <= scanLimit,
          ...(last ? { nextCursor: { timestamp: last.timestamp, id: last.id } } : {}),
        };
      },
    },
    taskStore: withBallCustodyTaskEvents(tasks, {
      record: async () => {
        custodyEvents += 1;
      },
    }),
    artifactWorkLineage: { current: { resolve: async ({ artifacts }) => artifacts.map(() => undefined) } },
  });
  try {
    let cursor: string | undefined;
    const seen = new Set<string>();
    let complete = false;
    let requests = 0;
    do {
      const before = rawReads;
      const response = await app.inject({
        method: 'GET',
        url: `/api/artifacts?view=works&read=pages${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers,
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.ok(rawReads - before <= 128, 'one HTTP request must not scan the whole 700-message history');
      for (const artifact of body.artifacts) {
        assert.ok(!seen.has(artifact.sourceMessageId), 'continuation must not duplicate publication coordinates');
        seen.add(artifact.sourceMessageId);
      }
      cursor = body.nextCursor;
      complete = body.complete;
      if (requests++ === 0) assert.equal(complete, false, 'the first batch cannot claim the global total is complete');
      assert.ok(requests < 15, 'cursor must make progress');
    } while (cursor);
    assert.equal(complete, true);
    assert.equal(seen.size, 700);
    assert.equal(custodyEvents, 0, 'catalogue reads must not emit custody events');
  } finally {
    await app.close();
  }
});
