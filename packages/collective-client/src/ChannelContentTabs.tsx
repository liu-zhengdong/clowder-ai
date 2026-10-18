import { useSharedArtifacts } from './use-collective-artifacts.js';
export type ChannelContent = 'conversation' | 'roadmap' | 'artifacts';

export function ChannelContentTabs({
  content,
  hasRoadmap,
  onSelect,
}: {
  readonly content: ChannelContent;
  readonly hasRoadmap: boolean;
  readonly onSelect: (content: ChannelContent) => void;
}) {
  const shared = useSharedArtifacts();
  return (
    <nav className="scene-tabs" aria-label="频道内容">
      <button
        type="button"
        className={content === 'conversation' ? 'scene-tab-active' : undefined}
        aria-current={content === 'conversation' ? 'page' : undefined}
        onClick={() => onSelect('conversation')}
      >
        对话
      </button>
      {hasRoadmap && (
        <button
          type="button"
          className={content === 'roadmap' ? 'scene-tab-active' : undefined}
          aria-current={content === 'roadmap' ? 'page' : undefined}
          onClick={() => onSelect('roadmap')}
        >
          Roadmap
        </button>
      )}
      {shared?.api && (
        <button
          type="button"
          className={content === 'artifacts' ? 'scene-tab-active' : undefined}
          aria-current={content === 'artifacts' ? 'page' : undefined}
          onClick={() => onSelect('artifacts')}
        >
          作品
        </button>
      )}
    </nav>
  );
}
