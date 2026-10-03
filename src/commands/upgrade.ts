import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { exists, readText, readTextIf, walk, writeText, ensureDir } from '../util/fs.js';
import { PACK_DIR } from '../paths.js';
import { stringifyConfig } from '../config.js';
import { compileAgents } from '../agents/compile.js';
import type { Project } from '../project.js';

export interface UpgradeFile {
  file: string;
  action: 'added' | 'updated' | 'merged' | 'conflict' | 'kept' | 'unchanged' | 'deleted-by-user';
}

export interface UpgradeResult {
  from: string;
  to: string;
  files: UpgradeFile[];
  dryRun: boolean;
}

/** Three-way merge with git's merge-file; returns merged text and whether conflicts remain. */
function merge3(ours: string, base: string, theirs: string): { text: string; conflicts: boolean } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-merge-'));
  try {
    const [o, b, t] = ['ours', 'base', 'theirs'].map((n) => path.join(dir, n));
    fs.writeFileSync(o!, ours);
    fs.writeFileSync(b!, base);
    fs.writeFileSync(t!, theirs);
    const r = spawnSync('git', ['merge-file', '-p', '-L', 'yours', '-L', 'pack base', '-L', 'new pack', o!, b!, t!], { encoding: 'utf8' });
    if (r.status === null || r.status < 0) throw new Error('git merge-file failed');
    return { text: r.stdout, conflicts: r.status > 0 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `keel upgrade` (WF-7): merges a newer pack into the project. Files the user never edited are replaced;
 * edited files get a three-way merge; conflicts are written with markers and reported. Nothing silent.
 */
export function upgradePack(project: Project, opts: { from?: string; dryRun?: boolean } = {}): UpgradeResult {
  const packDir = opts.from ? path.resolve(opts.from) : PACK_DIR;
  const newVersion = (YAML.parse(readTextIf(path.join(packDir, 'pack.yaml')) ?? '{}') as { version?: string }).version ?? '0.0.0';
  const targets: [string, string][] = [
    ['workflows', project.paths.workflows],
    ['templates', project.paths.templates],
    ['agents', project.paths.agents],
    ['skills', path.join(project.paths.agents, 'skills')],
  ];
  const files: UpgradeFile[] = [];
  for (const [sub, dest] of targets) {
    const src = path.join(packDir, sub);
    if (!exists(src)) continue;
    for (const rel of walk(src, src, { ignoreDirs: new Set() })) {
      if (sub === 'agents' && rel.startsWith('skills/')) continue;
      const theirs = readText(path.join(src, rel));
      const basePath = path.join(project.paths.pack, sub, rel);
      const base = readTextIf(basePath);
      const target = path.join(dest, rel);
      const ours = readTextIf(target);
      const shown = path.relative(project.root, target).split(path.sep).join('/');
      let action: UpgradeFile['action'];
      let write: string | undefined;
      if (ours === undefined) {
        if (base !== undefined) action = 'deleted-by-user';
        else {
          action = 'added';
          write = theirs;
        }
      } else if (theirs === base || ours === theirs) action = ours === theirs ? 'unchanged' : 'kept';
      else if (base === undefined) {
        const m = merge3(ours, '', theirs);
        action = m.conflicts ? 'conflict' : 'merged';
        write = m.text;
      } else if (ours === base) {
        action = 'updated';
        write = theirs;
      } else {
        const m = merge3(ours, base, theirs);
        action = m.conflicts ? 'conflict' : 'merged';
        write = m.text;
      }
      files.push({ file: shown, action });
      if (!opts.dryRun) {
        if (write !== undefined) writeText(target, write);
        writeText(basePath, theirs);
      }
    }
  }
  const from = project.config.pack.version;
  if (!opts.dryRun) {
    const cfg = { ...project.config, pack: { ...project.config.pack, version: newVersion } };
    writeText(project.paths.config, stringifyConfig(cfg));
    ensureDir(project.paths.pack);
    writeText(path.join(project.paths.pack, 'pack.yaml'), readTextIf(path.join(packDir, 'pack.yaml')) ?? '');
    project.reload();
    compileAgents(project);
  }
  return { from, to: newVersion, files: files.filter((f) => f.action !== 'unchanged'), dryRun: !!opts.dryRun };
}
