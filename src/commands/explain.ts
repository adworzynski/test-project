import { projectTrack, changeTrack } from '../workflow/engine.js';
import { allSteps } from '../workflow/load.js';
import { KeelError } from '../util/errors.js';
import type { Project } from '../project.js';

const TOPICS: Record<string, string> = {
  config: `keel.yaml
  profile, stack        Solo mobile (flutter, expo, swiftui, compose) or Solo web. Sets test globs and release checklist.
  agents                Which agents get compiled files: claude, copilot, cursor, codex.
  budgets.lines         Line caps per artifact (brief, prd, story, adr, screens, tokens) and per change (quick, feature).
  budgets.context_tokens  Context pack budget (default 20000).
  budgets.cost_warn_usd   Warn before a step whose past runs averaged more than this.
  sensitive.paths       Globs that move a Quick change to Feature (auth, payments, schema).
  router                Quick limits: max files and lines touched.
  planning              require_screens (UI stories link a screen), require_stack_adrs (ADRs before stories).
  verify.tests          Test file globs scanned for @keel AC-… tags.
  verify.results        Test report files: JUnit XML, flutter --machine JSON, Jest JSON.
  verify.run            Command \`keel verify --run\` executes.
  verify.require        done: finished work must have evidence (default); all: every criterion.
  verify.drift          advisory (default) or blocking.
  verify.dependencies   policy blocking|advisory|off, min_age_days (30), allow (globs of internal packages).
  mcp                   Command agents use to start the Keel MCP server.
  pricing               USD per million tokens per model, added to the built-in Claude price table.`,
  gates: `Gates
  approval   A step ends at pending-review; a person runs keel approve <id> or keel reject <id> -m "…".
             Records who, when and the artifact hash in .keel/gates/<id>.yaml.
  evidence   keel done <id> succeeds only when every criterion has a linked passing test or a human
             waiver (keel waive AC-… -m "…"). Agents asking for done without evidence get the list of
             uncovered criteria.
  checklist  A release is done only when every box is ticked, every story is done and every criterion is covered.`,
  ids: `IDs
  BR brief · PRD PRD · FR/NFR requirement · SM screen map · SC screen · DT design tokens · ADR decision
  ST story · AC acceptance criterion · TK task · CH change · RL release · D decision log · CN constraint · SRC imported source
  Sections whose heading starts with an ID (### AC-012: …) are artifacts too. Commits carry Keel-Ref: <id>.`,
};

/** `keel explain [topic]` (NV-5): what the current step is for and what good output looks like. */
export function explain(project: Project, topic?: string): string {
  if (topic && TOPICS[topic]) return TOPICS[topic]!;
  const wfs = [...project.workflows.values()];
  if (topic === 'tracks') {
    return wfs
      .map((w) => [`${w.name} (${w.id}): ${w.description ?? ''}`, ...allSteps(w).map(({ stage, step }) => `  ${stage.name} › ${step.id}: ${step.name}${step.gate !== 'none' ? ` [${step.gate} gate]` : ''}${step.skill ? ` · skill ${step.skill}` : ''}`)].join('\n'))
      .join('\n\n');
  }
  let found: { wf: string; stage: string; step: (typeof wfs)[number]['stages'][number]['steps'][number] } | undefined;
  if (topic) {
    const t = topic.toUpperCase();
    const item = project.graph.get(t);
    if (item?.type === 'change') {
      const tr = changeTrack(project, item);
      if (tr?.current) found = { wf: tr.workflow.name, stage: tr.current.stage.name, step: tr.current.step };
    }
    for (const w of wfs) for (const s of allSteps(w)) if (!found && s.step.id === topic) found = { wf: w.name, stage: s.stage.name, step: s.step };
    if (!found) throw new KeelError(`No step or topic "${topic}". Try: keel explain tracks | config | gates | ids | <step id> | <CH-id>`);
  } else {
    const active = project.graph.byType('change').find((c) => c.status === 'in-progress' || c.status === 'draft');
    const tr = active ? changeTrack(project, active) : projectTrack(project);
    if (!tr?.current) return 'Nothing in progress. `keel explain tracks` lists every step; `keel new "<description>"` starts a change.';
    found = { wf: tr.workflow.name, stage: tr.current.stage.name, step: tr.current.step };
  }
  const st = found.step;
  return [
    `${found.wf} › ${found.stage} › ${st.name} (${st.id})`,
    '',
    st.explain ?? 'No explanation written for this step.',
    '',
    `Produces: ${st.produces.join(', ') || 'nothing'}${st.inputs.length ? ` · reads: ${st.inputs.join(', ')}` : ''}`,
    `Gate: ${st.gate === 'none' ? 'none' : st.gate}${st.gate !== 'none' ? ` (keel explain gates)` : ''}`,
    st.skill ? `Skill: ${st.skill} (Claude Code: /${st.skill}; other agents: "use the ${st.skill} skill")` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
