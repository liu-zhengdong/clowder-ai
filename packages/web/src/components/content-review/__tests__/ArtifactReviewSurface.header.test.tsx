import type { ArtifactReviewView } from '@cat-cafe/shared';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtifactReviewSurface } from '../ArtifactReviewSurface';
import { compareAsset } from './media-compare.fixture';

const mocks = vi.hoisted(() => ({ controller: vi.fn() }));
vi.mock('../useArtifactReview', () => ({
  useArtifactReview: (reviewId: string) => mocks.controller(reviewId),
  reviewDraftPrefix: (user: string, id: string) => `cat-cafe:review:${user}:${id}:`,
}));
vi.mock('../useReviewMediaSource', () => ({
  useReviewMediaSource: () => ({ src: 'blob:original-owner-media', error: null }),
}));
vi.mock('@/utils/api-client', () => ({
  API_URL: 'http://api.test',
  apiFetch: vi.fn(async () => new Response(JSON.stringify({ requests: [], contexts: [] }))),
}));
vi.mock('../ReviewActor', () => ({ ReviewActor: () => <span>原作者</span> }));

function reviewView(): ArtifactReviewView {
  const stamp = '2026-10-13T20:00:00Z';
  return {
    review: {
      version: 2,
      reviewId: `review-${'a'.repeat(64)}`,
      revision: 3,
      title: '修改《原Task作品.png》',
      contentRef: 'published-pair',
      task: { taskId: 'task-one', threadId: 'thread-one', ownerUserId: 'operator', observedRevision: 1 },
      createdAt: stamp,
      updatedAt: stamp,
      rounds: [1, 2].map((number) => ({
        number,
        asset: compareAsset(number),
        openedAt: stamp,
        state: 'awaiting_human',
        annotations: [],
        responses: [],
      })),
    },
    authority: { state: 'current', canWrite: true, taskRevision: 1, ownerCatId: 'codex-astra' },
    pendingVersion: false,
    continuation: {
      taskId: 'task-one',
      expectedRevision: 1,
      artifactRef: 'content:published-pair',
      reviewEvidenceRef: 'review:one',
      ownerCatId: 'codex-astra',
    },
  };
}

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  mocks.controller.mockReturnValue({
    view: reviewView(),
    error: null,
    pending: null,
    saving: false,
    loading: false,
    act: vi.fn().mockResolvedValue(false),
    retry: vi.fn(),
    refresh: vi.fn(),
    revokeAccess: vi.fn(),
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

for (const round of [1, 2]) {
  it(`keeps the host's sole title and actual chooser beside Task version ${round}`, async () => {
    const choose = vi.fn(),
      back = vi.fn(),
      version = vi.fn();
    await act(async () =>
      root.render(
        <ArtifactReviewSurface
          reviewId={reviewView().review.reviewId}
          initialRound={round}
          titleInHost
          leadingAction={
            <button type="button" onClick={choose}>
              切换原作品
            </button>
          }
          onBack={back}
          onVersionChange={version}
        />,
      ),
    );
    expect(container.querySelector('h2')).toBeNull();
    const select = container.querySelector<HTMLSelectElement>('[aria-label="审阅版本"]');
    const switchButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '切换原作品',
    );
    expect(switchButton).toBeDefined();
    expect(switchButton?.parentElement).toBe(select?.parentElement);
    expect(select?.value).toBe(String(round));
    if (round === 1) expect(container.textContent).toContain('可继续讨论，画面不可改');
    await act(async () => switchButton?.click());
    expect(choose).toHaveBeenCalledOnce();
    expect(mocks.controller().act).not.toHaveBeenCalled();
  });
}

for (const error of [null, '暂时无法读取原Task']) {
  it(`keeps the chooser and original back/refresh usable while ${error ? 'read fails' : 'loading'}`, async () => {
    const controller = { ...mocks.controller(), view: null, error },
      choose = vi.fn(),
      back = vi.fn();
    mocks.controller.mockReturnValue(controller);
    await act(async () =>
      root.render(
        <ArtifactReviewSurface
          reviewId="review-one"
          titleInHost
          leadingAction={
            <button type="button" onClick={choose}>
              切换原作品
            </button>
          }
          onBack={back}
        />,
      ),
    );
    const button = (name: string) =>
      [...container.querySelectorAll('button')].find((item) => item.textContent === name);
    expect(button('切换原作品')).toBeDefined();
    await act(async () => {
      button('切换原作品')?.click();
      button('返回')?.click();
      button('刷新')?.click();
    });
    expect(choose).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledOnce();
    expect(controller.refresh).toHaveBeenCalledOnce();
    if (error) expect(container.querySelector('[role="alert"]')?.textContent).toBe(error);
  });
}

it('retains missing-round identity and the chooser until an explicit current-version selection', async () => {
  await act(async () =>
    root.render(
      <ArtifactReviewSurface
        reviewId="review-one"
        initialRound={9}
        titleInHost
        leadingAction={<button type="button">切换原作品</button>}
        onBack={vi.fn()}
      />,
    ),
  );
  expect(container.querySelector('h2')).toBeNull();
  expect(container.textContent).toContain('第 9 版暂不可读取');
  expect(container.textContent).toContain('切换原作品');
  expect(container.querySelector('img')).toBeNull();
  const current = [...container.querySelectorAll('button')].find((button) => button.textContent === '查看当前第 2 版');
  await act(async () => current?.click());
  expect(container.querySelector<HTMLSelectElement>('[aria-label="审阅版本"]')?.value).toBe('2');
  expect(container.querySelector('h2')).toBeNull();
  expect(mocks.controller().act).not.toHaveBeenCalled();
});

it('moves one real chooser into comparison and restores it without a hidden duplicate ref or work title', async () => {
  const trigger = createRef<HTMLButtonElement>(),
    choose = vi.fn();
  await act(async () =>
    root.render(
      <ArtifactReviewSurface
        reviewId="review-one"
        titleInHost
        leadingAction={
          <button type="button" ref={trigger} onClick={choose}>
            切换原作品
          </button>
        }
        onBack={vi.fn()}
      />,
    ),
  );
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="对比版本"]')?.click());
  const compare = container.querySelector('[data-testid="artifact-media-compare"]');
  expect(compare).not.toBeNull();
  expect(compare?.textContent).not.toContain(reviewView().review.title);
  expect(
    [...container.querySelectorAll('button')].filter((button) => button.textContent === '切换原作品'),
  ).toHaveLength(1);
  expect(compare?.contains(trigger.current)).toBe(true);
  await act(async () => trigger.current?.click());
  expect(choose).toHaveBeenCalledOnce();
  const back = [...compare!.querySelectorAll('button')].find((button) => button.textContent === '返回作品');
  await act(async () => back?.click());
  expect(container.querySelector('[data-testid="artifact-media-compare"]')).toBeNull();
  expect(container.querySelector('[aria-label="审阅版本"]')?.parentElement?.contains(trigger.current)).toBe(true);
});
