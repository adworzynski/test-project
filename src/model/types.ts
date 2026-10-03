export type ArtifactType =
  | 'brief'
  | 'prd'
  | 'requirement'
  | 'screen-map'
  | 'screen'
  | 'design-tokens'
  | 'adr'
  | 'story'
  | 'criterion'
  | 'task'
  | 'change'
  | 'release'
  | 'decision'
  | 'constraint'
  | 'source';

export type DeltaOp = 'added' | 'modified' | 'removed';

export interface Diagnostic {
  level: 'error' | 'warning';
  code: string;
  message: string;
  file?: string;
  line?: number;
  id?: string;
}

/** A node of the artifact graph: a whole file (top-level) or a section inside one (sub-item). */
export interface ArtifactNode {
  id: string;
  type: ArtifactType;
  title: string;
  status: string;
  /** Repo-relative posix path of the file that defines the node. */
  file: string;
  /** 1-based line where the node starts (front-matter for files, heading for sections). */
  line: number;
  /** For sub-items: the id of the containing artifact. */
  parent?: string;
  /** Outgoing typed links, e.g. { implements: ['FR-001'] }. */
  links: Record<string, string[]>;
  /** Front-matter of a top-level artifact (empty for sub-items). */
  fm: Record<string, unknown>;
  /** Markdown body (for sub-items: the section text including its heading). */
  body: string;
  hash: string;
  children: string[];
  /** Set on items inside a change's Delta section. */
  delta?: DeltaOp;
  /** Requirement priority (MoSCoW) and kind. */
  priority?: string;
  kind?: 'FR' | 'NFR';
  /** Criterion clauses. */
  given?: string[];
  when?: string[];
  then?: string[];
  /** Task / checklist state. */
  checked?: boolean;
  lines: number;
}

export interface Checkbox {
  text: string;
  checked: boolean;
  line: number;
  id?: string;
}
