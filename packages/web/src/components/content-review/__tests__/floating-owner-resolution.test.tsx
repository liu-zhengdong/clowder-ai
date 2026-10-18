import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useF307ExperienceWorkbenchStore } from '@/components/workbench/experience-workbench-store';
import { createFilePreviewSurface } from '@/components/workbench/real-surface-adapters';
import { ArtworkLightboxProvider, useArtworkLightboxScope } from '../ArtworkLightboxScope';

let scope: NonNullable<ReturnType<typeof useArtworkLightboxScope>>;
function Consumer() {
  scope = useArtworkLightboxScope()!;
  return <input aria-label="preserved composer host" defaultValue="local draft" />;
}
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <ArtworkLightboxProvider threadId="thread-a">
        <Consumer />
      </ArtworkLightboxProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function work(path: string) {
  return {
    url: `http://api.test/${path}`,
    title: path,
    alt: path,
    mediaType: 'image' as const,
    surface: createFilePreviewSurface({
      worktreeId: 'listed-alias',
      path,
      navigationOrigin: { kind: 'chat-file-link', threadId: 'thread-a', messageId: `original-${path}` },
    }),
  };
}
it('canonical file resolution in a float retains the original Chat return without changing Workbench topology', async () => {
  const before = useF307ExperienceWorkbenchStore.getState();
  const original = work('original.png');
  await act(async () => scope.open(original));
  await act(async () =>
    scope.resolve(createFilePreviewSurface({ worktreeId: 'canonical-root', path: 'original.png' })),
  );
  expect(scope.work?.surface?.navigationOrigin).toEqual(original.surface.navigationOrigin);
  expect(scope.work?.surface?.ownerStateRef.key).toBe('canonical-root');
  expect(useF307ExperienceWorkbenchStore.getState()).toBe(before);
});
it('a late resolution from a previous floating work cannot replace the newly opened work', async () => {
  await act(async () => scope.open(work('first.png')));
  const late = scope.resolve;
  const next = work('second.png');
  await act(async () => scope.open(next));
  await act(async () => late(createFilePreviewSurface({ worktreeId: 'canonical-root', path: 'first.png' })));
  expect(scope.work).toBe(next);
});

it('resets only the floating presentation across threads and ignores callbacks from the previous visit', async () => {
  const switchThread = (threadId: string) =>
    act(async () =>
      root.render(
        <ArtworkLightboxProvider threadId={threadId}>
          <Consumer />
        </ArtworkLightboxProvider>,
      ),
    );
  const composer = host.querySelector('input');
  await act(async () => scope.open(work('original.png')));
  const oldOpen = scope.open;
  const oldClose = scope.close;
  const oldResolve = scope.resolve;
  await switchThread('thread-b');
  expect(scope.work).toBeNull();
  expect(host.querySelector('input')).toBe(composer);
  await act(async () => oldOpen(work('late-a.png')));
  expect(scope.work).toBeNull();

  // Returning to the same id is a new visit; old A callbacks still have no authority.
  await switchThread('thread-a');
  const current = work('original.png');
  await act(async () => scope.open(current));
  await act(async () => {
    oldResolve(createFilePreviewSurface({ worktreeId: 'stale-root', path: 'original.png' }));
    oldClose();
    oldOpen(work('late-a.png'));
  });
  expect(scope.work).toBe(current);
  expect(host.querySelector('input')).toBe(composer);
});
