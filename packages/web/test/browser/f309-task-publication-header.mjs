import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';
import { startComposerWorkspaceOwner } from './f309-composer-workspace-owner.mjs';
import { forwardHiddenImageOwner, verifyHiddenImageRemoval } from './f309-hidden-image-reference.mjs';
import { openChatPage } from './f309-ordinary-workspace-journey-chat-progress.mjs';
import { mediaFixture } from './fixtures/f309-artifact-review-media.mjs';

const evidence = process.env.F309_TASK_HEADER_EVIDENCE_DIR ?? '/tmp/cat-cafe-evidence/f309-task-publication-header';

/** Real Next + original publication/Task/review routes. Session/history issuance and the cat callback are controlled. */
export function registerTaskPublicationHeaderJourneys(suite) {
  for (const [label, width, dark, recovery] of [
    ['desktop-light', 1440, false, false],
    ['390-dark', 390, true, false],
    ['hidden-image-recovery', 1440, false, true],
  ]) {
    test(
      recovery
        ? 'hidden image reference: acknowledged removal survives the active document reload'
        : `task publication header: Works card current/history, chooser and comparison retain their owners ${label}`,
      { timeout: 150_000 },
      async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'f309-task-header-'));
        let owner, opened, composer;
        try {
          await mkdir(evidence, { recursive: true });
          const { startReviewHost } = await tsImport(
            new URL('./fixtures/f309-artifact-review-host.mjs', import.meta.url).href,
            import.meta.url,
          );
          await mediaFixture(root, 'png');
          owner = await startReviewHost(root, 'image/png');
          if (recovery)
            composer = await startComposerWorkspaceOwner(path.join(root, 'composer'), {
              configure: async ({ draftStore }) => ({
                readTaskDraft: () => draftStore.getOwnerComposerDraft('operator', owner.thread.id),
              }),
            });
          const {
            default: { artifactObjectId },
          } = await tsImport(
            new URL('../../src/components/workbench/artifact-object-key.ts', import.meta.url).href,
            import.meta.url,
          );
          let view = await owner.reviews.prepare(owner.prepare, owner.human);
          const name = await mediaFixture(root, 'png', 2),
            publication = owner.publish(name);
          await owner.catCallback('respond', {
            reviewId: view.review.reviewId,
            expectedRevision: view.review.revision,
            expectedTaskRevision: 1,
            expectedOwnerRevision: 1,
            operationId: 'task-header-new-round',
            artifactRef: `/uploads/${name}`,
            expectedArtifactRevision: String(publication.timestamp),
            responses: [],
          });
          view = await owner.reviews.read(view.review.reviewId, owner.human);
          const inventory = await fetch(`${owner.apiOrigin}/api/threads/${owner.thread.id}/artifacts`).then(
            (response) => response.json(),
          );
          const artifact = inventory.artifacts.find(
            (item) => item.sourceMessageId === owner.publication.id && item.url === '/uploads/review-input.png',
          );
          assert.ok(artifact, 'the original publication is located by its actual source message and URL');
          assert.equal(view.review.rounds.length, 2);
          const before = JSON.stringify(view.review);
          const url = new URL(suite().baseUrl);
          url.pathname = `/thread/${owner.thread.id}`;
          url.searchParams.set('shell', 'v2');
          const calls = [];
          opened = await openChatPage(() => ({ ...suite(), baseUrl: url.href }), {
            width,
            dark,
            resetLocalStorage: !recovery,
            messages: owner.messages.getByThread(owner.thread.id).map((message) => ({ ...message, type: 'assistant' })),
            handleApi: async (request, url) => {
              const thread = composer ? { ...owner.thread, projectPath: composer.root } : owner.thread;
              if (url.pathname === '/api/threads') return { body: { threads: [thread] } };
              if (url.pathname === `/api/threads/${owner.thread.id}`) return { body: thread };
              if (
                composer &&
                (url.pathname.startsWith('/api/workspace/') ||
                  url.pathname === `/api/threads/${owner.thread.id}/composer-draft`)
              )
                return forwardHiddenImageOwner(request, url, composer, calls);
              if (
                !(
                  url.pathname.includes('artifact-reviews') ||
                  url.pathname.includes('content-publications') ||
                  url.pathname.includes('content-reviews') ||
                  url.pathname.includes('content-modifications') ||
                  url.pathname === '/api/cats' ||
                  url.pathname.endsWith('/artifacts') ||
                  url.pathname === '/api/artifacts'
                )
              )
                return;
              const response = await fetch(`${owner.apiOrigin}${url.pathname}${url.search}`, {
                method: request.method(),
                headers: { 'content-type': 'application/json' },
                ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}),
              });
              calls.push({ method: request.method(), path: url.pathname, status: response.status });
              const contentType = response.headers.get('content-type');
              assert.ok(contentType, 'the original HTTP owner names its response type');
              if (!contentType.includes('json'))
                return { raw: Buffer.from(await response.arrayBuffer()), contentType, status: response.status };
              const body = await response.json();
              // This existing test host has the original artifact aggregator but no complete F232 file ledger.
              // Name that read boundary honestly; the publication/review owner and its exact DTO remain real.
              if (url.pathname.endsWith('/artifacts') && url.searchParams.get('view') === 'works')
                Object.assign(body, { view: 'works', complete: false, workLineage: 'unavailable' });
              return { body, status: response.status };
            },
          });
          const { page, context, errors } = opened;
          await context.route('**/uploads/**', async (route) => {
            const url = new URL(route.request().url());
            await route.fulfill({ response: await route.fetch({ url: `${owner.apiOrigin}${url.pathname}` }) });
          });
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('[data-testid="workspace-panel-toggle"][data-client-interactive="true"]').waitFor();
          await page.getByLabel('消息输入框').fill('原Chat未发送的说明');
          await page.getByTestId('header-works').click();
          const card = page.locator(`[data-home-artifact-id="${artifactObjectId(artifact)}"]`);
          await card.waitFor();
          await card.click();
          const preview = page.getByRole('dialog', { name: artifact.name, exact: true });
          await preview.getByRole('button', { name: '批注', exact: true }).click();
          const originalReview = page.getByRole('button', { name: /^继续.+的审阅：/ });
          await originalReview.waitFor();
          assert.equal(await originalReview.count(), 1, 'only the original Task review is offered');
          await originalReview.click();
          const surface = page.getByTestId('artifact-review-surface').filter({ visible: true });
          await surface.waitFor({ timeout: 30_000 });
          await surface.getByRole('button', { name: '查看最新版本', exact: true }).click();
          const version = surface.getByRole('combobox', { name: '审阅版本', exact: true });
          if (recovery) {
            await verifyHiddenImageRemoval({ page, composer, owner, evidence, calls });
            assert.deepEqual(errors, []);
            return;
          }
          const observations = [];
          for (const round of [1, 2]) {
            await version.selectOption(String(round));
            await surface.getByTestId('workspace-content-review-media').waitFor();
            assert.equal(await surface.locator('h2').count(), 0);
            const chooser = surface.getByRole('button', { name: '切换原作品', exact: true });
            assert.equal(await chooser.count(), 1);
            const compact = await chooser.evaluate(
              (button) => button.parentElement === document.querySelector('[aria-label="审阅版本"]')?.parentElement,
            );
            assert.equal(compact, true);
            if (round === 1) await surface.getByText('可继续讨论，画面不可改。', { exact: false }).waitFor();
            observations.push({ round, compact, titleCount: 0 });
            await page.screenshot({ path: `${evidence}/${label}-round${round}.png` });
          }
          const image = surface.getByTestId('review-media-stage').locator('img');
          const originalElement = await image.evaluate((node) => {
            node.dataset.headerProbe = 'original-owner';
            return node.dataset.headerProbe;
          });
          await surface.getByRole('button', { name: '切换原作品', exact: true }).click();
          await page.getByRole('button', { name: '返回作品', exact: true }).click();
          await version.waitFor();
          assert.equal(await image.getAttribute('data-header-probe'), originalElement);
          assert.equal(await version.inputValue(), '2');
          // The original Navigator deliberately restores trigger focus in the next animation frame.
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
          assert.equal(
            await surface
              .getByRole('button', { name: '切换原作品', exact: true })
              .evaluate((button) => button === document.activeElement),
            true,
          );
          await surface.getByRole('button', { name: '对比版本', exact: true }).click();
          const compare = page.getByTestId('artifact-media-compare');
          await compare.waitFor();
          assert.equal(await surface.getByRole('button', { name: '切换原作品', exact: true }).count(), 1);
          assert.ok(!(await compare.textContent()).includes(view.review.title));
          await compare.getByRole('button', { name: '返回作品', exact: true }).click();
          await version.waitFor();
          assert.equal(await page.getByLabel('消息输入框').inputValue(), '原Chat未发送的说明');
          assert.equal(JSON.stringify((await owner.reviews.read(view.review.reviewId, owner.human)).review), before);
          assert.ok(
            calls.some((call) => call.path === `/api/artifact-reviews/${view.review.reviewId}` && call.status === 200),
          );
          assert.deepEqual(errors, []);
          await writeFile(
            `${evidence}/${label}.json`,
            JSON.stringify(
              {
                url: page.url(),
                api: owner.apiOrigin,
                reviewId: view.review.reviewId,
                taskId: owner.taskId,
                observations,
                calls,
                errors,
                sameOwner: true,
                reviewUnchanged: true,
              },
              null,
              2,
            ),
          );
          await page.screenshot({ path: `${evidence}/${label}-returned.png` });
        } catch (error) {
          if (opened) {
            await opened.page.screenshot({ path: `${evidence}/${label}-failure.png` });
            await writeFile(
              `${evidence}/${label}-failure.json`,
              JSON.stringify(
                {
                  url: opened.page.url(),
                  error: String(error),
                  text: await opened.page.locator('body').innerText(),
                  errors: opened.errors,
                },
                null,
                2,
              ),
            );
          }
          throw error;
        } finally {
          if (opened) {
            await opened.context.unrouteAll({ behavior: 'wait' });
            await opened.context.close();
          }
          await owner?.close();
          await composer?.close();
          await rm(root, { recursive: true, force: true });
        }
      },
    );
  }
}
