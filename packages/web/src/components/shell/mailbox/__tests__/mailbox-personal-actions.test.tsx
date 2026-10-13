import type { UnifiedAttentionItemV1 } from '@cat-cafe/shared';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailboxPanel } from '../../MailboxPanel';
import { writeShellLanguage } from '../../shell-language';
import { deriveMailboxPanelState } from '../../unified-mailbox-state';
import type { UnifiedAttentionView } from '../../use-unified-attention';
import { useApprovalSessions } from '../use-approval-sessions';
import { OWNER, okRead } from './mailbox-fixtures';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/utils/api-client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/hooks/useCatNameResolver', () => ({ useCatNameResolver: () => (id: string) => id }));
const coordinate = {
  kind: 'mailbox' as const,
  decisionRef: 'mention:source',
  version: 'sha256:exact-producer-version',
};
const item: UnifiedAttentionItemV1 = {
  decisionRef: coordinate.decisionRef,
  kind: 'user_mention',
  summary: 'A real mention',
  linkedNeedsMe: [],
  preferenceCoordinate: coordinate,
  userMention: {
    threadId: 'thread_source',
    messageId: 'message-source',
    catId: 'codex61-sol',
    timestamp: 10,
    content: 'Please look here',
    expectedRevision: 2,
  },
};
const source = {
  status: 'available' as const,
  startedAt: 1,
  observedAt: 2,
  coverage: 'owner_personal_ignored_items' as const,
  exhaustiveness: 'complete' as const,
};
let mode: 'visible' | 'ignored';
let history: boolean;
let view: UnifiedAttentionView;
let revision: number;
let owner: string;
let refuse: boolean;
let previewReads: number;
let changePreview: boolean;
let previewPartial: boolean;
let root: Root;
let host: HTMLDivElement;
const writes = () => mocks.apiFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
function Wrapper() {
  const sessions = useApprovalSessions(view);
  return (
    <MailboxPanel
      anchor={createRef()}
      view={view}
      sessions={sessions}
      state={deriveMailboxPanelState(view.result)}
      section={history ? 'history' : mode === 'ignored' ? 'ignored' : 'pending'}
      onOpenPlace={vi.fn()}
      onClose={vi.fn()}
    />
  );
}
const render = async () => act(async () => root.render(<Wrapper />));
const click = async (id: string) =>
  act(async () => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.click());
function read() {
  const result = okRead([item]);
  if (result.kind !== 'ok') throw new Error('Fixture');
  result.read.sources.personalPreferences = source;
  result.read.personalView = {
    mode,
    preferenceRevision: revision,
    originalTotalCount: 1,
    visibleTotalCount: mode === 'visible' ? 1 : 0,
    ignoredTotalCount: mode === 'ignored' ? 1 : 0,
    originalAttentionCount: 0,
    visibleAttentionCount: 0,
    ignoredAttentionCount: 0,
  };
  result.read.attentionCount = 0;
  result.read.identity.ownerUserId = owner;
  view = { result, staleRead: null, refetch: vi.fn(), readsStarted: () => 1, resultGeneration: 1 };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mode = 'visible';
  history = false;
  localStorage.clear();
  revision = 4;
  owner = OWNER;
  refuse = false;
  previewReads = 0;
  changePreview = false;
  previewPartial = false;
  read();
  mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/session') return Response.json({ userId: owner });
    if (path === '/api/concierge/work/mentions/last-handling')
      return Response.json({ ownerUserId: owner, receipt: { undoId: 'canonical-last', handled: 1, remaining: 1 } });
    if (path === '/api/concierge/work/mentions/restore') return Response.json({ restored: true });
    if (path.startsWith('/api/concierge/work/mentions/handling-preview')) {
      previewReads++;
      const scope = new URL(path, 'http://localhost').searchParams.get('period');
      const requests = Array.from({ length: 26 }, (_, index) => ({
        threadId: `thread_${index}`,
        messageId: `message-${index}`,
        expectedRevision: 2,
        preferenceCoordinate: {
          kind: 'mailbox',
          decisionRef: `mention:${index}`,
          version: changePreview && previewReads > 1 && index === 0 ? 'sha256:new-version' : `sha256:version-${index}`,
        },
      }));
      return Response.json({
        ownerUserId: owner,
        period: scope,
        coverage: { state: previewPartial ? 'partial' : 'complete' },
        consistency: { state: previewPartial ? 'uncertain' : 'verified', reasons: [] },
        readWindow: { startedAt: 10, endedAt: 12, consistency: 'independent_source_reads' },
        counts: { week: 26, earlier: 0 },
        requests: previewPartial ? [] : requests,
        personalView: { mode: 'visible', preferenceRevision: 4, originalCount: 26, visibleCount: 26, ignoredCount: 0 },
      });
    }
    if (path === '/api/config/ignored-items') {
      if (init?.method === 'PATCH')
        return refuse
          ? Response.json({ snapshot: { ownerUserId: owner, revision: 5, entries: [] } }, { status: 409 })
          : Response.json({
              ownerUserId: owner,
              revision: ++revision,
              entries: mode === 'visible' ? [{ coordinate, ignoredAt: 20 }] : [],
            });
      return Response.json({ ownerUserId: owner, revision, entries: [] });
    }
    throw new Error(`Unexpected request ${path}`);
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  mocks.apiFetch.mockReset();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Mailbox exact personal ignore actions through the original preference lane', () => {
  it.each([
    'zh',
    'en',
  ] as const)('keeps individual handled recovery separate from personal ignore (%s)', async (language) => {
    writeShellLanguage(language);
    history = true;
    if (view.result.kind !== 'ok' || !item.userMention) throw new Error('Fixture');
    view.result.read.mentionPeriod = 'handled';
    view.result.read.items = [{ ...item, userMention: { ...item.userMention, handled: true } }];
    await render();
    await click('mailbox-item-toggle');
    const restore = document.querySelector('[data-testid="mailbox-mention-restore"]');
    expect(restore).not.toBeNull();
    expect(restore?.textContent).toBe(language === 'en' ? 'Return to to-do' : '放回待办');
    expect(document.querySelector('[data-testid="mailbox-mentions-undo"]')?.textContent).toBe(
      language === 'en' ? 'Undo last handled batch (1 item)' : '撤销刚才的批量处理（1 件）',
    );
    expect(document.querySelector('[data-testid="mailbox-item-ignore"]')).toBeNull();
    expect(document.querySelector('[data-testid="mailbox-item-restore"]')).toBeNull();
    await click('mailbox-mention-restore');
    const calls = mocks.apiFetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('/api/concierge/work/mentions/restore');
    expect(JSON.parse(calls[0][1].body)).toEqual({
      threadId: 'thread_source',
      messageId: 'message-source',
      expectedRevision: 2,
    });
    expect(writes()).toHaveLength(0);
  });

  it.each([
    'zh',
    'en',
  ] as const)('names the proven empty ignored view instead of pending groups (%s)', async (language) => {
    writeShellLanguage(language);
    mode = 'ignored';
    read();
    if (view.result.kind !== 'ok' || !view.result.read.personalView) throw new Error('Fixture');
    view.result.read.items = [];
    view.result.read.totalCount = 0;
    view.result.read.personalView.originalTotalCount = 0;
    view.result.read.personalView.ignoredTotalCount = 0;
    await render();
    const panel = document.querySelector('[data-testid="mailbox-panel"]');
    expect(panel?.textContent).toContain(language === 'en' ? 'No ignored items yet' : '还没有忽略的事项');
    expect(panel?.textContent).not.toContain(
      language === 'en' ? 'Nothing waiting for your decision' : '暂无等你决定的事',
    );
    expect(panel?.textContent).not.toContain(language === 'en' ? 'No @you requests' : '暂无 @你 请求');
  });

  it('ignores only the server-issued item version without a canonical decision or mention write', async () => {
    await render();
    await click('mailbox-item-toggle');
    expect(document.querySelector('[data-testid="mailbox-item-ignore"]')).not.toBeNull();
    await click('mailbox-item-ignore');
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      expectedOwnerUserId: OWNER,
      expectedRevision: 4,
      ignore: [coordinate],
      restore: [],
    });
    expect(mocks.apiFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(document.querySelector('[data-testid="mailbox-mention-resolve"]')).toBeNull();
    expect(document.querySelector('[data-testid="mailbox-personal-undo"]')).not.toBeNull();
  });
  it('restores the exact ignored version using the same writer', async () => {
    mode = 'ignored';
    read();
    await render();
    await click('mailbox-item-toggle');
    await click('mailbox-item-restore');
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      expectedOwnerUserId: OWNER,
      expectedRevision: 4,
      ignore: [],
      restore: [coordinate],
    });
  });
  it('does not announce success when the preference revision changed', async () => {
    refuse = true;
    await render();
    await click('mailbox-item-toggle');
    await click('mailbox-item-ignore');
    expect(writes()).toHaveLength(1);
    expect(document.querySelector('[data-testid="mailbox-personal-undo"]')).toBeNull();
    expect(document.querySelector('[data-testid="mailbox-personal-notice"]')?.textContent).toContain('有变化');
    expect(view.refetch).toHaveBeenCalled();
  });
  it('previews and confirms all 26 versions across the page boundary before one personal PATCH', async () => {
    if (view.result.kind === 'ok') {
      view.result.read.mentionCounts = { today: 26, week: 26, earlier: 0, handled: 0 };
    }
    await render();
    expect(document.querySelector('[data-testid="mailbox-mentions-ignore-all"]')).not.toBeNull();
    await click('mailbox-mentions-ignore-all');
    expect(writes()).toHaveLength(0);
    expect(document.querySelector('[data-testid="mailbox-mentions-ignore-confirm"]')?.textContent).toContain('26');
    await click('mailbox-mentions-ignore-confirm');
    expect(previewReads).toBe(2);
    expect(writes()).toHaveLength(1);
    const body = JSON.parse(writes()[0][1].body);
    expect(body.expectedOwnerUserId).toBe(OWNER);
    expect(body.expectedRevision).toBe(4);
    expect(body.ignore).toHaveLength(26);
    expect(body.restore).toEqual([]);
    expect(mocks.apiFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it('does not hide a changed producer version between full-set preview and confirmation', async () => {
    changePreview = true;
    await render();
    await click('mailbox-mentions-ignore-all');
    await click('mailbox-mentions-ignore-confirm');
    expect(previewReads).toBe(2);
    expect(writes()).toHaveLength(0);
    expect(document.querySelector('[data-testid="mailbox-bulk-ignore-notice"]')?.textContent).toContain('有变化');
  });
  it('does not offer a confirmation or a zero claim from a partial full-set preview', async () => {
    previewPartial = true;
    await render();
    await click('mailbox-mentions-ignore-all');
    expect(previewReads).toBe(1);
    expect(writes()).toHaveLength(0);
    expect(document.querySelector('[data-testid="mailbox-mentions-ignore-confirm"]')).toBeNull();
    expect(document.querySelector('[data-testid="mailbox-bulk-ignore-notice"]')?.textContent).toContain('无法');
  });

  it('does not submit a whole-set ignore after the authenticated owner changes', async () => {
    await render();
    await click('mailbox-mentions-ignore-all');
    owner = 'different-owner';
    await click('mailbox-mentions-ignore-confirm');
    expect(writes()).toHaveLength(0);
    expect(document.querySelector('[data-testid="mailbox-bulk-ignore-notice"]')?.textContent).toContain('无法');
  });
  it('does not reuse a partial confirmation read', async () => {
    await render();
    await click('mailbox-mentions-ignore-all');
    previewPartial = true;
    await click('mailbox-mentions-ignore-confirm');
    expect(previewReads).toBe(2);
    expect(writes()).toHaveLength(0);
  });

  it('refuses a write from a stale owner read instead of adopting a newer preference revision', async () => {
    revision = 5;
    await render();
    await click('mailbox-item-toggle');
    await click('mailbox-item-ignore');
    expect(writes()).toHaveLength(0);
  });
});
