import path from 'node:path';
import { ProjectPaths, findProjectRoot } from './paths.js';
import { loadConfig, type KeelConfig } from './config.js';
import { loadGraph, type Graph } from './graph/graph.js';
import { loadWorkflows, type Workflow } from './workflow/load.js';
import { KeelError } from './util/errors.js';
import { exists } from './util/fs.js';

/** Everything a command needs about the current Keel project. Graph and workflows load lazily. */
export class Project {
  readonly paths: ProjectPaths;
  private _config?: KeelConfig;
  private _graph?: Graph;
  private _workflows?: Map<string, Workflow>;

  constructor(readonly root: string) {
    this.paths = new ProjectPaths(root);
  }

  static open(cwd: string): Project {
    const root = process.env.KEEL_ROOT ? path.resolve(process.env.KEEL_ROOT) : findProjectRoot(cwd);
    if (!root || !exists(path.join(root, '.keel', 'keel.yaml')))
      throw new KeelError('No Keel project found here or in a parent folder. Run `keel init` to create one.');
    return new Project(root);
  }

  get config(): KeelConfig {
    return (this._config ??= loadConfig(this.paths.config));
  }

  get graph(): Graph {
    return (this._graph ??= loadGraph(this.paths));
  }

  get workflows(): Map<string, Workflow> {
    return (this._workflows ??= loadWorkflows(this.paths.workflows).workflows);
  }

  /** Drops cached graph after writes. */
  reload(): this {
    this._graph = undefined;
    this._workflows = undefined;
    return this;
  }

  abs(rel: string): string {
    return path.join(this.root, rel);
  }
}
