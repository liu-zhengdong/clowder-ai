import { posix } from 'node:path';
import {
  type EvolutionExplorationDetailV1,
  type EvolutionExplorationExperimentV1,
  type EvolutionExplorationRequestV1,
  type EvolutionResolvedExplorationReviewV1,
  type OwnerTruthRefV1,
  refIdentity,
} from '@cat-cafe/shared';
import { z } from 'zod';

const nonempty = z.string().trim().min(1);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const exactVersion = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const memberNames = z.array(nonempty).min(1).max(32);
const commitSchema = z
  .object({
    sha,
    authoredAt: z.string().datetime({ offset: true }),
    subject: nonempty,
    members: memberNames,
  })
  .strict();
const releaseSchema = z
  .object({
    id: z.string().regex(/^H\d{2}$/),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    parent: z
      .string()
      .regex(/^H\d{2}$/)
      .nullable(),
    version: exactVersion,
    members: memberNames,
    commits: z.array(commitSchema).min(1).max(64),
  })
  .strict();
const relationSchema = z.enum([
  'citation_only',
  'discussed_delivery',
  'method_reference',
  'preserved_delivery',
  'documented_delivery',
  'later_disposition',
  'later_method_reference',
]);
const citedCommitSchema = z
  .object({
    sha: z.string().regex(/^[a-f0-9]{10}$/),
    fullSha: sha,
    authoredAt: z.string().datetime({ offset: true }),
    subject: nonempty,
    members: memberNames,
    relation: relationSchema,
  })
  .strict();
const caseSchema = z
  .object({
    caseId: nonempty.optional(),
    documentedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    occurredWindow: z.object({ start: nonempty, end: nonempty }).strict().optional(),
    kind: z.enum(['incident', 'delivery-window']),
    summary: nonempty,
    link: nonempty.nullable().optional(),
    browsingBucket: z
      .string()
      .regex(/^H\d{2}$/)
      .nullable(),
    actualUseStatus: z.literal('unconfirmed'),
    sourceTextSha256: sha256,
    citedMemberCommits: z.array(citedCommitSchema).max(32),
  })
  .strict();

export const requestReviewHarnessLineageIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal('owner-reviewed-source-index'),
    snapshotCommit: sha,
    ownerReviewCommit: sha,
    ownerReviewRef: nonempty,
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    members: z.record(nonempty, z.array(nonempty).min(1).max(32)),
    releases: z.array(releaseSchema).min(1).max(128),
    cases: z.array(caseSchema).min(1).max(128),
  })
  .strict()
  .superRefine((index, ctx) => {
    const releases = new Map(index.releases.map((release) => [release.id, release]));
    if (releases.size !== index.releases.length) ctx.addIssue({ code: 'custom', message: 'duplicate history release' });
    index.releases.forEach((release, position) => {
      if (release.parent !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['releases', position, 'parent'],
          message: 'calendar browsing buckets cannot claim version ancestry',
        });
    });
    index.cases.forEach((entry, position) => {
      if (!entry.browsingBucket || !releases.has(entry.browsingBucket))
        ctx.addIssue({ code: 'custom', path: ['cases', position, 'browsingBucket'], message: 'case bucket missing' });
    });
  });

export type RequestReviewHarnessLineageIndex = z.infer<typeof requestReviewHarnessLineageIndexSchema>;

const ref = (kind: string, id: string, version: string): OwnerTruthRefV1 => ({
  ownerFeatureId: 'F314',
  ownerStateRef: `harness-history:${kind}:${id}`,
  version,
});

const indexRef = (index: RequestReviewHarnessLineageIndex) => ref('index', 'development-process', index.snapshotCommit);

const releaseRef = (release: RequestReviewHarnessLineageIndex['releases'][number]) =>
  ref('release', release.id, release.version);

const commitRef = (commit: { fullSha?: string; sha: string }) => {
  const fullSha = commit.fullSha ?? commit.sha;
  return ref('commit', fullSha, fullSha);
};

function caseRef(entry: RequestReviewHarnessLineageIndex['cases'][number]) {
  return ref('case', entry.caseId ?? entry.sourceTextSha256.slice(0, 16), entry.sourceTextSha256);
}

function sourceHref(index: RequestReviewHarnessLineageIndex, link?: string | null): string {
  const raw = link || 'README.md';
  const [file, anchor] = raw.split('#', 2);
  const path = posix.normalize(posix.join('docs/discussions/f314-incident-archive', file || 'README.md'));
  return `https://github.com/zts212653/clowder-ai/blob/${index.snapshotCommit}/${path}${anchor ? `#${anchor}` : ''}`;
}

function commitHref(commit: { fullSha?: string; sha: string }): string {
  return `https://github.com/zts212653/clowder-ai/commit/${commit.fullSha ?? commit.sha}`;
}

function ownerReviewHref(index: RequestReviewHarnessLineageIndex): string {
  return `https://github.com/zts212653/clowder-ai/blob/${index.ownerReviewCommit}/${posix.normalize(index.ownerReviewRef)}`;
}

function conditions(index: RequestReviewHarnessLineageIndex, entry: RequestReviewHarnessLineageIndex['cases'][number]) {
  const source = caseRef(entry);
  const windowLabel = entry.occurredWindow
    ? `${entry.occurredWindow.start} → ${entry.occurredWindow.end}`
    : entry.occurredOn;
  return {
    environment: {
      label: 'F314 开发事故档案',
      detail: '固定 Git cut 上的历史原文索引；不是生产运行回放。',
      sourceRef: indexRef(index),
    },
    sampleSet: {
      label: '1 条历史案例原文',
      detail: '案例是具名原件，不是概率样本，也不代表同类事故总数。',
      sourceRef: source,
    },
    measurement: {
      label: '描述性来源核对',
      detail: '只核发生时间、原文引用和成员提交；不测版本效果。',
      sourceRef: indexRef(index),
    },
    groundTruth: {
      label: '案例原文与可核 Git/PR 引用',
      detail: '引用证明原文谈到该对象；不自动证明采用、因果或效用。',
      sourceRef: source,
      status: 'bounded' as const,
    },
    window: {
      label: windowLabel,
      detail: '发生时间或原文明确的有界观察窗；与文档整理日期分开。',
      sourceRef: ref('window', entry.sourceTextSha256, entry.sourceTextSha256),
    },
    exposure: 'public_development' as const,
    limitation: '日期组只用于浏览；本案例实际沿用版本未确认，不能用它判断哪一版有效。',
    threshold: {
      status: 'unknown' as const,
      detail: '没有冻结的版本效用门槛；这是历史来源阅读，不是比较实验。',
    },
    comparison: {
      design: 'undeclared' as const,
      method: '未建立版本效果比较；不把日期前后或引用提交拼成配对。',
    },
    preparationRefs: [
      { label: '打开案例原文', ref: source, href: sourceHref(index, entry.link) },
      {
        label: 'F314 owner 核对',
        ref: ref('owner-review', 'development-process', index.ownerReviewCommit),
        href: ownerReviewHref(index),
      },
    ],
  };
}

function projectExperiment(
  index: RequestReviewHarnessLineageIndex,
  entry: RequestReviewHarnessLineageIndex['cases'][number],
  release: RequestReviewHarnessLineageIndex['releases'][number],
): EvolutionExplorationExperimentV1 {
  return {
    experimentRef: caseRef(entry),
    nodeRef: releaseRef(release),
    sourceRef: caseRef(entry),
    title: entry.summary.slice(0, 240),
    status: 'recorded',
    recordCount: 1,
    conditions: conditions(index, entry),
    metrics: [],
  };
}

function projectDetail(
  index: RequestReviewHarnessLineageIndex,
  entry: RequestReviewHarnessLineageIndex['cases'][number],
  experiment: EvolutionExplorationExperimentV1,
): EvolutionExplorationDetailV1 {
  const evidence = caseRef(entry);
  const citations = entry.citedMemberCommits;
  return {
    status: 'resolved',
    experimentRef: experiment.experimentRef,
    nodeRef: experiment.nodeRef,
    records: [
      {
        recordRef: ref('record', entry.sourceTextSha256, entry.sourceTextSha256),
        experimentRef: experiment.experimentRef,
        nodeRef: experiment.nodeRef,
        caseId: entry.caseId ?? entry.sourceTextSha256.slice(0, 16),
        label: entry.summary.slice(0, 240),
        inputRef: evidence,
        evidenceRef: evidence,
        windowRef: experiment.conditions.window.sourceRef,
        measurementRef: experiment.conditions.measurement.sourceRef,
        input: [
          { label: '发生时间', value: experiment.conditions.window.label },
          { label: '文档整理日期', value: entry.documentedOn },
          { label: '日期浏览组', value: `${entry.browsingBucket}（不代表实际沿用）` },
        ],
        output: [
          { label: '实际沿用版本', value: '未确认' },
          {
            label: '成员提交引用',
            value: citations.length ? citations.map((item) => item.sha).join('、') : '未找到可核成员提交引用',
          },
        ],
        result: { status: 'unknown', label: '历史案例来源已归档；不是版本效用判定。' },
        values: {},
        media: [],
        sources: [
          { label: '案例原文', ref: evidence, href: sourceHref(index, entry.link) },
          ...citations.slice(0, 15).map((citation) => ({
            label: `原文引用 · ${citation.relation}`,
            ref: commitRef(citation),
            href: commitHref(citation),
          })),
        ],
      },
    ],
  };
}

export function projectRequestReviewHarnessExploration(
  input: EvolutionExplorationRequestV1,
  rawIndex: unknown,
  readAt: string,
): EvolutionResolvedExplorationReviewV1 | null {
  const parsed = requestReviewHarnessLineageIndexSchema.safeParse(rawIndex);
  if (!parsed.success) return null;
  const index = parsed.data;
  const byId = new Map(index.releases.map((release) => [release.id, release]));
  const nodes: EvolutionResolvedExplorationReviewV1['nodes'] = index.releases.map((release) => ({
    kind: 'public_archive',
    nodeRef: releaseRef(release),
    title: `${release.id} · ${release.date}`,
    summary: `作者日期 ${release.date} 的 ${release.commits.length} 个提交浏览组；不代表发布、加载或采用。`,
    sourceRef: indexRef(index),
    changes: release.commits.slice(0, 32).map((commit) => ({
      label: commit.members.join('、'),
      detail: commit.subject,
      sourceRef: commitRef(commit),
      ownerHref: commitHref(commit),
    })),
    parentEdges: [],
  }));
  const pairs = index.cases.map((entry) => {
    const browsingBucket = entry.browsingBucket;
    if (!browsingBucket) throw new Error('validated F314 case bucket disappeared');
    const release = byId.get(browsingBucket);
    if (!release) throw new Error('validated F314 browsing bucket disappeared');
    const experiment = projectExperiment(index, entry, release);
    return { entry, experiment };
  });
  const requested = new Set(
    [input.selectedExperimentRef, input.comparisonExperimentRef]
      .filter((value): value is NonNullable<typeof value> => value !== undefined)
      .map(refIdentity),
  );
  return {
    schemaVersion: 1,
    status: 'resolved',
    programRef: input.programRef,
    objectRef: input.objectRef,
    sourceRef: indexRef(index),
    readAt,
    nodes,
    experiments: pairs.map(({ experiment }) => experiment),
    details: pairs
      .filter(({ experiment }) => requested.has(refIdentity(experiment.experimentRef)))
      .map(({ entry, experiment }) => projectDetail(index, entry, experiment)),
    blockers: [{ code: 'historical_index_not_adoption', ownerRef: input.objectRef }],
  };
}
