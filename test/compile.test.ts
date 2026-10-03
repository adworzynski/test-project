import { describe, it, expect } from 'vitest';
import { compileAgents, upsertBlock, BEGIN, END } from '../src/agents/compile.js';
import { newProject, read, write, exists } from './helpers.js';

describe('instruction compiler (AE-1, AE-2)', () => {
  it('writes every agent format, skills in three places, MCP config and hooks', () => {
    const p = newProject();
    for (const f of [
      'AGENTS.md',
      'CLAUDE.md',
      '.github/copilot-instructions.md',
      '.cursor/rules/keel.mdc',
      '.mcp.json',
      '.cursor/mcp.json',
      '.vscode/mcp.json',
      '.codex/config.toml',
      '.claude/settings.json',
      '.claude/skills/keel-implement/SKILL.md',
      '.agents/skills/keel-implement/SKILL.md',
      '.github/skills/keel-implement/SKILL.md',
    ])
      expect(exists(p.root, f), f).toBe(true);
    expect(read(p.root, 'CLAUDE.md')).toContain('@AGENTS.md');
    expect(JSON.parse(read(p.root, '.mcp.json')).mcpServers.keel).toMatchObject({ command: 'keel', args: ['mcp'] });
    expect(read(p.root, '.codex/config.toml')).toContain('[mcp_servers.keel]');
    const settings = JSON.parse(read(p.root, '.claude/settings.json'));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('keel context --session --hook claude');
    expect(read(p.root, '.cursor/rules/keel.mdc')).toMatch(/^---\ndescription: .*\nalwaysApply: true\n---/);
    expect(read(p.root, '.agents/skills/keel-discovery/SKILL.md')).toMatch(/^---\nname: keel-discovery\ndescription: /);
  });

  it('is idempotent and keeps user content around its block', () => {
    const p = newProject();
    write(p.root, 'AGENTS.md', '# My project\n\nHand-written notes.\n\n' + read(p.root, 'AGENTS.md'));
    write(p.root, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }));
    compileAgents(p);
    const again = compileAgents(p);
    expect(again.written).toEqual([]);
    const agents = read(p.root, 'AGENTS.md');
    expect(agents.startsWith('# My project\n\nHand-written notes.')).toBe(true);
    expect(agents.split(BEGIN.slice(0, 20)).length).toBe(2);
    const s = JSON.parse(read(p.root, '.claude/settings.json'));
    expect(s.permissions.allow).toEqual(['Bash(npm test)']);
    expect(s.hooks.Stop.map((h: { hooks: { command: string }[] }) => h.hooks[0]!.command)).toEqual(['say done', 'keel cost hook claude']);
  });

  it('compiles constitution edits into every agent and warns about size limits', () => {
    const p = newProject();
    write(p.root, '.keel/agents/constitution.md', '# Project constitution\n\n- Always use the repository pattern.\n');
    compileAgents(p);
    expect(read(p.root, 'AGENTS.md')).toContain('Always use the repository pattern.');
    write(p.root, '.keel/agents/constitution.md', '# Big\n\n' + 'x'.repeat(40000) + '\n');
    const r = compileAgents(p);
    expect(r.warnings.join('\n')).toMatch(/AGENTS\.md is \d+ bytes, over the 32768-byte limit/);
  });

  it('only writes files for the configured agents', () => {
    const p = newProject('flutter', { agents: ['codex'] });
    expect(exists(p.root, 'AGENTS.md')).toBe(true);
    expect(exists(p.root, 'CLAUDE.md')).toBe(false);
    expect(exists(p.root, '.cursor/rules/keel.mdc')).toBe(false);
    expect(exists(p.root, '.agents/skills/keel-next/SKILL.md')).toBe(true);
  });

  it('upsertBlock replaces only the managed block', () => {
    const once = upsertBlock('intro\n', 'A');
    const twice = upsertBlock(once + 'outro\n', 'B');
    expect(twice).toBe(`intro\n\n${BEGIN}\nB\n${END}\noutro\n`);
  });
});

describe('init git hook', () => {
  it('installs a commit-msg hook only when none exists', async () => {
    const { git: g, tmpDir, write: w, read: r } = await import('./helpers.js');
    const { initProject } = await import('../src/commands/init.js');
    const root = tmpDir();
    g(root, 'init', '-q');
    w(root, 'pubspec.yaml', 'name: a\n');
    const res = initProject(root, { ci: false });
    expect(res.gitHook).toMatch(/commit-msg$/);
    expect(r(root, '.git/hooks/commit-msg')).toContain('keel hook commit-msg');
    const root2 = tmpDir();
    g(root2, 'init', '-q');
    w(root2, 'pubspec.yaml', 'name: a\n');
    w(root2, '.git/hooks/commit-msg', '#!/bin/sh\necho mine\n');
    expect(initProject(root2, { ci: false }).gitHook).toBeUndefined();
    expect(r(root2, '.git/hooks/commit-msg')).toBe('#!/bin/sh\necho mine\n');
  });
});
