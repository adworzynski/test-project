import type { ArtifactType } from './types.js';

export interface TypeDef {
  type: ArtifactType;
  prefix: string;
  label: string;
  /** Directory under .keel/artifacts for top-level types. */
  dir?: string;
  /** Template file in the pack's templates/ directory. */
  template?: string;
  /** Sub-item types this artifact can contain as `### ID: title` sections. */
  contains?: ArtifactType[];
  statuses: string[];
  /** Status an approval sets. */
  approvedStatus: string;
  /** Budget key in keel.yaml budgets.lines. */
  budget?: string;
}

const GENERIC = ['draft', 'pending-review', 'approved', 'rejected', 'in-progress', 'done', 'archived'];

export const TYPES: Record<ArtifactType, TypeDef> = {
  brief: {
    type: 'brief',
    prefix: 'BR',
    label: 'Brief',
    dir: 'brief',
    template: 'brief.md',
    statuses: GENERIC,
    approvedStatus: 'approved',
    budget: 'brief',
  },
  prd: {
    type: 'prd',
    prefix: 'PRD',
    label: 'PRD',
    dir: 'prd',
    template: 'prd.md',
    contains: ['requirement'],
    statuses: GENERIC,
    approvedStatus: 'approved',
    budget: 'prd',
  },
  requirement: { type: 'requirement', prefix: 'FR', label: 'Requirement', statuses: GENERIC, approvedStatus: 'approved' },
  'screen-map': {
    type: 'screen-map',
    prefix: 'SM',
    label: 'Screen map',
    dir: 'screens',
    template: 'screen-map.md',
    contains: ['screen'],
    statuses: GENERIC,
    approvedStatus: 'approved',
    budget: 'screens',
  },
  screen: { type: 'screen', prefix: 'SC', label: 'Screen', statuses: GENERIC, approvedStatus: 'approved' },
  'design-tokens': {
    type: 'design-tokens',
    prefix: 'DT',
    label: 'Design tokens',
    dir: 'tokens',
    template: 'design-tokens.md',
    statuses: GENERIC,
    approvedStatus: 'approved',
    budget: 'tokens',
  },
  adr: {
    type: 'adr',
    prefix: 'ADR',
    label: 'ADR',
    dir: 'adr',
    template: 'adr.md',
    statuses: ['proposed', 'pending-review', 'accepted', 'rejected', 'deprecated', 'superseded', 'draft'],
    approvedStatus: 'accepted',
    budget: 'adr',
  },
  story: {
    type: 'story',
    prefix: 'ST',
    label: 'Story',
    dir: 'stories',
    template: 'story.md',
    contains: ['criterion', 'task'],
    statuses: GENERIC,
    approvedStatus: 'approved',
    budget: 'story',
  },
  criterion: { type: 'criterion', prefix: 'AC', label: 'Criterion', statuses: GENERIC, approvedStatus: 'approved' },
  task: { type: 'task', prefix: 'TK', label: 'Task', statuses: ['todo', 'done'], approvedStatus: 'done' },
  change: {
    type: 'change',
    prefix: 'CH',
    label: 'Change',
    dir: 'changes',
    template: 'change-feature.md',
    contains: ['criterion', 'requirement', 'task'],
    statuses: GENERIC,
    approvedStatus: 'approved',
  },
  release: {
    type: 'release',
    prefix: 'RL',
    label: 'Release checklist',
    dir: 'release',
    template: 'release-mobile.md',
    statuses: GENERIC,
    approvedStatus: 'approved',
  },
  decision: { type: 'decision', prefix: 'D', label: 'Decision', statuses: ['active', 'superseded'], approvedStatus: 'active' },
  constraint: { type: 'constraint', prefix: 'CN', label: 'Constraint', statuses: ['active', 'retired'], approvedStatus: 'active' },
  source: {
    type: 'source',
    prefix: 'SRC',
    label: 'Imported source',
    dir: 'sources',
    statuses: ['draft', 'approved', 'archived'],
    approvedStatus: 'approved',
  },
};

/** Top-level types that live in their own files. */
export const FILE_TYPES = (Object.values(TYPES) as TypeDef[]).filter((t) => t.dir).map((t) => t.type);

/** Sub-item ID prefixes and the type they map to. NFR is a requirement too. */
export const SUB_PREFIXES: Record<string, ArtifactType> = {
  FR: 'requirement',
  NFR: 'requirement',
  SC: 'screen',
  AC: 'criterion',
  TK: 'task',
};

export const ID_RE = /^(BR|PRD|FR|NFR|SM|SC|DT|ADR|ST|AC|TK|CH|RL|D|CN|SRC)-(\d{3,})$/;
export const ID_IN_TEXT_RE = /\b(BR|PRD|FR|NFR|SM|SC|DT|ADR|ST|AC|TK|CH|RL|CN|SRC)-\d{3,}\b/g;

export function typeForId(id: string): ArtifactType | undefined {
  const m = id.match(ID_RE);
  if (!m) return undefined;
  const prefix = m[1]!;
  if (SUB_PREFIXES[prefix]) return SUB_PREFIXES[prefix];
  return (Object.values(TYPES) as TypeDef[]).find((t) => t.prefix === prefix)?.type;
}

export function prefixFor(type: ArtifactType): string {
  return TYPES[type].prefix;
}

/** Statuses that count as "approved or beyond" for gate checks. */
export const APPROVED_OR_LATER = new Set(['approved', 'accepted', 'in-progress', 'done', 'archived']);
export const DONE_STATUSES = new Set(['done', 'archived']);

export function isApproved(status: string): boolean {
  return APPROVED_OR_LATER.has(status);
}

/** Canonical front-matter key order, so files written by Keel diff and merge cleanly (NF-9). */
export const FM_ORDER = [
  'id',
  'type',
  'status',
  'title',
  'track',
  'priority',
  'epic',
  'ui',
  'links',
  'criteria',
  'files',
  'owner',
  'created',
  'updated',
];
