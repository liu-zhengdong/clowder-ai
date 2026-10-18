import { useState } from 'react';
import type { SharedArtifact } from './collective-artifact-client.js';

const emptyFilters = { query: '', channel: '', media: 'all', sort: 'recent' };

export function useArtifactLibraryFilters(catalogue: readonly SharedArtifact[], channelId?: string) {
  const [filters, setFilters] = useState(emptyFilters);
  const update = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const channelWorks = catalogue.filter((item) => !channelId || item.sourceLocation.channelId === channelId);
  const query = filters.query.trim().toLocaleLowerCase();
  const artifacts = channelWorks
    .filter(
      (item) =>
        (!filters.channel || item.sourceLocation.channelId === filters.channel) &&
        (filters.media === 'all' || item.mediaType.startsWith(filters.media)) &&
        item.title.toLocaleLowerCase().includes(query),
    )
    .sort((a, b) =>
      filters.sort === 'name'
        ? a.title.localeCompare(b.title, 'zh-CN')
        : (b.versions.at(-1)?.recordedAt ?? '').localeCompare(a.versions.at(-1)?.recordedAt ?? '') ||
          a.artifactId.localeCompare(b.artifactId),
    );
  return { filters, update, artifacts, channelWorks, clear: () => setFilters(emptyFilters) };
}

export function SharedArtifactLibraryFilters({
  model,
  channelId,
}: {
  readonly model: ReturnType<typeof useArtifactLibraryFilters>;
  readonly channelId?: string;
}) {
  const { filters, update, channelWorks } = model;
  const channels = [...new Set(channelWorks.map((item) => item.sourceLocation.channelId))].sort();
  return (
    <form
      className="shared-artifact-library-filters"
      aria-label="作品筛选"
      onSubmit={(event) => event.preventDefault()}
    >
      <label>
        作品名称
        <input
          type="search"
          aria-label="搜索作品"
          placeholder="按名称找回作品"
          value={filters.query}
          onChange={(event) => update('query', event.target.value)}
        />
      </label>
      {!channelId && (
        <label>
          来自频道
          <select
            aria-label="作品来源频道"
            value={filters.channel}
            onChange={(event) => update('channel', event.target.value)}
          >
            <option value="">全部频道</option>
            {channels.map((id) => (
              <option key={id} value={id}>
                #{id}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        类型
        <select value={filters.media} onChange={(event) => update('media', event.target.value)}>
          <option value="all">全部类型</option>
          <option value="text/markdown">Markdown</option>
          {channelWorks.some((item) => item.mediaType.startsWith('image/')) && <option value="image/">图片</option>}
          {channelWorks.some((item) => item.mediaType.startsWith('video/')) && <option value="video/">视频</option>}
        </select>
      </label>
      <label>
        排列
        <select value={filters.sort} onChange={(event) => update('sort', event.target.value)}>
          <option value="recent">最近记录的版本</option>
          <option value="name">作品名称</option>
        </select>
      </label>
    </form>
  );
}
