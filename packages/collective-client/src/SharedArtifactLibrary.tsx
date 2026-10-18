import { useEffect, useRef, useState } from 'react';
import type { SharedArtifact } from './collective-artifact-client.js';
import { SharedArtifactHistory } from './SharedArtifactHistory.js';
import { SharedArtifactLibraryFilters, useArtifactLibraryFilters } from './SharedArtifactLibraryFilters.js';
import { useSharedArtifacts } from './use-collective-artifacts.js';

export function SharedArtifactCard({ artifact }: { readonly artifact: SharedArtifact }) {
  const shared = useSharedArtifacts();
  const [historyOpen, setHistoryOpen] = useState(false);
  const mediaLabel =
    artifact.mediaType === 'text/markdown' ? 'Markdown' : artifact.mediaType.startsWith('image/') ? '图片' : '视频';
  const card = (
    <button type="button" className="shared-artifact-card" onClick={() => shared?.open(artifact)}>
      <span className="shared-artifact-page" aria-hidden="true">
        ≡
      </span>
      <span>
        <strong>{artifact.title}</strong>
        <small>
          {mediaLabel} · 第 {artifact.versions.at(-1)?.ownerRevision} 版
        </small>
        {artifact.availability === 'owner_unavailable' && <small>内容所在的 Café 暂时不可用</small>}
        <small>
          #{artifact.sourceLocation.channelId} · {shared?.humanName(artifact.publishedByHumanId)}分享
        </small>
        {artifact.versions.at(-1)?.adoptedByHumanId && (
          <small>{shared?.humanName(artifact.versions.at(-1)?.adoptedByHumanId ?? '')}采用了这一版</small>
        )}
      </span>
      <span>打开</span>
    </button>
  );
  if (artifact.mediaType !== 'image/png' && artifact.mediaType !== 'video/mp4') return card;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {card}
      <button type="button" onClick={() => setHistoryOpen(true)}>
        版本记录
      </button>
      {historyOpen && <SharedArtifactHistory artifact={artifact} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
export function SharedArtifactCards({ eventId }: { readonly eventId: string }) {
  const shared = useSharedArtifacts();
  if (shared?.status !== 'ready') return null;
  return (
    <>
      {shared.catalogue
        .filter((item) => item.sourceEventId === eventId)
        .map((item) => (
          <SharedArtifactCard key={item.artifactId} artifact={item} />
        ))}
    </>
  );
}
export function SharedArtifactLibrary({
  channelId,
  title = '共同作品',
  active = true,
  filterable = false,
  onOpenNavigation,
}: {
  readonly channelId?: string;
  readonly title?: string;
  readonly active?: boolean;
  readonly filterable?: boolean;
  readonly onOpenNavigation?: () => void;
}) {
  const shared = useSharedArtifacts();
  const model = useArtifactLibraryFilters(shared?.catalogue ?? [], channelId);
  const scroll = useRef<HTMLElement>(null);
  const position = useRef(0);
  useEffect(() => {
    if (active && scroll.current) scroll.current.scrollTop = position.current;
  }, [active]);
  if (!shared) return null;
  // Retain filters and the return position without duplicating the channel's cards or controls in the DOM.
  if (!active) return <section ref={scroll} hidden className="shared-artifact-library" aria-label={title} />;
  return (
    <section
      ref={scroll}
      hidden={!active}
      onScroll={(event) => {
        if (active) position.current = event.currentTarget.scrollTop;
      }}
      className="shared-artifact-library"
      aria-label={title}
    >
      <header>
        {onOpenNavigation && (
          <button type="button" className="mobile-navigation" aria-label="频道导航" onClick={onOpenNavigation}>
            ☰
          </button>
        )}
        <h2>{title}</h2>
        <p>正文和版本在同一处，讨论留在原消息。</p>
      </header>
      {filterable && <SharedArtifactLibraryFilters model={model} channelId={channelId} />}
      <SharedArtifactLibraryContents model={model} filterable={filterable} />
    </section>
  );
}

function SharedArtifactLibraryContents({
  model,
  filterable,
}: {
  readonly model: ReturnType<typeof useArtifactLibraryFilters>;
  readonly filterable: boolean;
}) {
  const shared = useSharedArtifacts();
  if (!shared) return null;
  if (shared.status === 'loading') return <output>正在读取作品…</output>;
  if (shared.status !== 'ready')
    return (
      <div role="alert">
        <p>{shared.status === 'access_denied' ? '你已无法查看这里的作品。' : '暂时读不到作品，请稍后重试。'}</p>
        <button type="button" onClick={() => void shared.refresh()}>
          重新读取
        </button>
      </div>
    );
  if (model.artifacts.length)
    return (
      <>
        {filterable && <output className="shared-artifact-library-count">找到 {model.artifacts.length} 件作品</output>}
        <div className="shared-artifact-grid">
          {model.artifacts.map((item) => (
            <SharedArtifactCard key={item.artifactId} artifact={item} />
          ))}
        </div>
      </>
    );
  if (model.channelWorks.length)
    return (
      <div className="channel-empty">
        <h3>没有匹配的作品</h3>
        <button type="button" onClick={model.clear}>
          清除作品筛选
        </button>
      </div>
    );
  return (
    <div className="channel-empty">
      <h3>还没有共同作品</h3>
      <p>在一条讨论消息的「更多」里分享作品，作品和来源会一起留在这里。</p>
    </div>
  );
}
