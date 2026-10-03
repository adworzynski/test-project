import http from 'node:http';
import { computeStatus, type StatusData } from '../workflow/status.js';
import { computeCoverage, type CoverageReport } from '../verify/coverage.js';
import { summarizeCost } from '../ledger/ledger.js';
import { cmpId } from '../graph/graph.js';
import { Project } from '../project.js';
import type { ArtifactNode } from '../model/types.js';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const COV_LABEL: Record<string, string> = { passed: 'Pass', failed: 'Fail', waived: 'Waived', untested: 'No test', 'not-run': 'Not run', skipped: 'Skipped' };
const COLUMNS = ['draft', 'pending-review', 'approved', 'in-progress', 'done'];

function badge(status: string): string {
  return `<span class="badge s-${esc(status)}">${esc(status.replace('-', ' '))}</span>`;
}

function card(n: ArtifactNode, project: Project, cov: CoverageReport): string {
  const crit = project.graph.criteriaOf(n.id);
  const ok = crit.filter((c) => ['passed', 'waived'].includes(cov.byId.get(c.id)?.status ?? '')).length;
  return `<li class="card"><strong>${esc(n.id)}</strong> ${esc(n.title)}<br><span class="muted">${n.type === 'change' ? esc(String(n.fm.track ?? '')) + ' · ' : ''}${crit.length ? `${ok}/${crit.length} criteria covered` : 'no criteria'}</span></li>`;
}

/** Requirements → stories/changes as a layered SVG; the trace table below carries the same data for screen readers. */
function graphSvg(project: Project): string {
  const g = project.graph;
  const reqs = g.byType('requirement');
  const items = [...g.byType('story'), ...g.byType('change')].sort((a, b) => cmpId(a.id, b.id));
  if (!reqs.length && !items.length) return '<p class="muted">No requirements or stories yet.</p>';
  const rowH = 26;
  const h = Math.max(reqs.length, items.length) * rowH + 20;
  const y = (i: number) => 20 + i * rowH;
  const ri = new Map(reqs.map((r, i) => [r.id, i]));
  const edges: string[] = [];
  items.forEach((it, j) => {
    for (const r of g.requirementsOf(it.id)) {
      const i = ri.get(r.id);
      if (i !== undefined) edges.push(`<line x1="230" y1="${y(i) - 5}" x2="420" y2="${y(j) - 5}" class="edge"/>`);
    }
  });
  const left = reqs.map((r, i) => `<text x="10" y="${y(i)}" class="t">${esc(r.id)} ${esc(r.title.slice(0, 24))}</text>`);
  const right = items.map((it, j) => `<text x="430" y="${y(j)}" class="t st-${esc(it.status)}">${esc(it.id)} ${esc(it.title.slice(0, 30))} (${esc(it.status)})</text>`);
  return `<svg viewBox="0 0 720 ${h}" width="100%" role="img" aria-label="Requirements linked to stories and changes; the trace table below lists the same links">${edges.join('')}${left.join('')}${right.join('')}</svg>`;
}

export function renderDashboard(project: Project): string {
  const s: StatusData = computeStatus(project);
  const g = project.graph;
  const cov = computeCoverage(project);
  const cost = summarizeCost(project, 'ref');
  const work = [...g.byType('story'), ...g.byType('change')];
  const board = COLUMNS.map((col) => {
    const cards = work.filter((n) => (col === 'done' ? ['done', 'archived'].includes(n.status) : col === 'draft' ? ['draft', 'rejected'].includes(n.status) : n.status === col));
    return `<section class="col" aria-label="${esc(col)}"><h3>${esc(col.replace('-', ' '))} <span class="muted">(${cards.length})</span></h3><ul>${cards.map((c) => card(c, project, cov)).join('')}</ul></section>`;
  }).join('');
  const trace = g
    .byType('requirement')
    .map((r) => {
      const its = work.filter((w) => g.requirementsOf(w.id).some((x) => x.id === r.id));
      const crit = its.flatMap((w) => g.criteriaOf(w.id));
      return `<tr><th scope="row">${esc(r.id)}</th><td>${esc(r.title)}${r.priority ? ` <span class="muted">[${esc(r.priority)}]</span>` : ''}</td><td>${its.map((i) => `${esc(i.id)} ${badge(i.status)}`).join('<br>') || '<span class="muted">none</span>'}</td><td>${crit.map((c) => `${esc(c.id)}: ${esc(COV_LABEL[cov.byId.get(c.id)?.status ?? 'untested'])}`).join('<br>') || '<span class="muted">none</span>'}</td></tr>`;
    })
    .join('');
  const covRows = cov.criteria
    .map((c) => `<tr><th scope="row">${esc(c.id)}</th><td>${esc(c.title)}</td><td>${esc(c.owner)}</td><td><span class="badge c-${esc(c.status)}">${esc(COV_LABEL[c.status])}</span></td><td>${esc(c.tests[0] ? `${c.tests[0].file ?? ''} “${c.tests[0].name}”` : c.waiver?.message ?? '')}</td></tr>`)
    .join('');
  const artifacts = g
    .topLevel()
    .sort((a, b) => cmpId(a.id, b.id))
    .map((n) => `<tr><th scope="row">${esc(n.id)}</th><td>${esc(n.type)}</td><td>${esc(n.title)}</td><td>${badge(n.status)}${n.fm.needs_review ? ' <span class="badge s-rejected">needs review</span>' : ''}</td><td><code>${esc(n.file)}</code></td></tr>`)
    .join('');
  const costRows = Object.entries(cost.groups)
    .sort((a, b) => b[1].usd - a[1].usd)
    .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>$${v.usd.toFixed(2)}</td><td>${v.tokens.toLocaleString('en-US')}</td></tr>`)
    .join('');
  const steps = s.track.map((t) => `<li class="step p-${esc(t.status)}"><span class="mark">${t.status === 'done' ? '✓' : t.status === 'skipped' ? '–' : t.status === 'not-started' ? '○' : '●'}</span> ${esc(t.name)} <span class="muted">${esc(t.status)}${t.progress ? ` ${t.progress.done}/${t.progress.total}` : ''}</span></li>`).join('');
  const next = s.next.map((n) => `<li><strong>${esc(n.title)}</strong> <span class="muted">(${n.actor === 'human' ? 'you' : 'agent'})</span>${n.command ? `<br><code>${esc(n.command)}</code>` : ''}${n.skill ? ` · skill <code>${esc(n.skill)}</code>` : ''}</li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keel · ${esc(s.project)}</title>
<style>
:root { --bg:#ffffff; --fg:#1b1b1f; --muted:#555b66; --line:#d0d4dc; --card:#f4f6f9; --accent:#1f4fd1;
  --ok:#0b6b2f; --okbg:#e3f4e8; --bad:#a3121c; --badbg:#fbe4e6; --warn:#7a4a00; --warnbg:#fff1d6; }
@media (prefers-color-scheme: dark) { :root { --bg:#14161a; --fg:#e8eaee; --muted:#a9b0bc; --line:#343842; --card:#1e2128; --accent:#8fb0ff;
  --ok:#8fe0a8; --okbg:#173322; --bad:#ffb3b8; --badbg:#3d1a1d; --warn:#ffd28a; --warnbg:#3a2c12; } }
* { box-sizing: border-box; }
body { margin:0; padding:16px; font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
main { max-width:1200px; margin:0 auto; }
h1 { font-size:1.4rem; margin:0 0 4px; } h2 { font-size:1.1rem; margin:28px 0 8px; border-bottom:1px solid var(--line); padding-bottom:4px; }
h3 { font-size:.95rem; margin:0 0 8px; text-transform:capitalize; }
.muted { color:var(--muted); } code { font-size:.85em; }
.kpis { display:flex; flex-wrap:wrap; gap:12px; margin:12px 0; }
.kpi { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px 12px; min-width:140px; }
.kpi b { display:block; font-size:1.3rem; }
.steps { display:flex; flex-wrap:wrap; gap:8px; list-style:none; padding:0; }
.step { background:var(--card); border:1px solid var(--line); border-radius:999px; padding:2px 10px; }
.board { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:10px; }
@media (max-width:800px) { .board { grid-template-columns:1fr; } }
.col { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px; }
.col ul { list-style:none; margin:0; padding:0; }
.card { background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:6px 8px; margin-bottom:6px; font-size:.9rem; }
table { border-collapse:collapse; width:100%; font-size:.9rem; } th, td { text-align:left; vertical-align:top; padding:4px 8px; border-bottom:1px solid var(--line); }
.scroll { overflow-x:auto; }
.badge { display:inline-block; border-radius:4px; padding:0 6px; font-size:.8rem; border:1px solid var(--line); }
.c-passed, .c-waived, .s-done, .s-approved, .s-accepted, .s-archived { background:var(--okbg); color:var(--ok); }
.c-failed, .s-rejected { background:var(--badbg); color:var(--bad); }
.c-untested, .c-not-run, .c-skipped, .s-pending-review { background:var(--warnbg); color:var(--warn); }
svg .edge { stroke:var(--line); stroke-width:1.2; } svg .t { fill:var(--fg); font-size:12px; }
a { color:var(--accent); }
</style>
</head>
<body><main>
<h1>${esc(s.project)}</h1>
<p class="muted">${esc(s.profile)} · ${esc(s.stack)} · ${s.phase ? `Phase: ${esc(s.phase.stage)} › ${esc(s.phase.step)}` : 'Product track complete'} · read-only snapshot, reload to refresh</p>
<div class="kpis">
<div class="kpi"><b>${s.coverage.percent}%</b>criteria covered (${s.coverage.covered}/${s.coverage.total})</div>
<div class="kpi"><b>${s.openGates.length}</b>open gates</div>
<div class="kpi"><b>${s.blocked.length}</b>blocked</div>
<div class="kpi"><b>$${s.cost.usd.toFixed(2)}</b>${s.cost.tokens.toLocaleString('en-US')} tokens</div>
<div class="kpi"><b>${s.checks.errors}</b>check errors, ${s.checks.warnings} warnings</div>
</div>
<h2>Next</h2><ol>${next}</ol>
<h2>Product track</h2><ul class="steps">${steps || '<li class="muted">No project track.</li>'}</ul>
<h2>Board</h2><div class="board">${board}</div>
<h2>Artifact graph</h2>${graphSvg(project)}
<h2>Trace: requirement → work → criteria</h2><div class="scroll"><table><thead><tr><th scope="col">Req</th><th scope="col">Requirement</th><th scope="col">Stories and changes</th><th scope="col">Criteria</th></tr></thead><tbody>${trace || '<tr><td colspan="4" class="muted">No requirements yet.</td></tr>'}</tbody></table></div>
<h2>Verification coverage</h2><div class="scroll"><table><thead><tr><th scope="col">Criterion</th><th scope="col">Title</th><th scope="col">Owner</th><th scope="col">Result</th><th scope="col">Evidence</th></tr></thead><tbody>${covRows || '<tr><td colspan="5" class="muted">No criteria yet.</td></tr>'}</tbody></table></div>
<h2>Cost by item</h2><div class="scroll"><table><thead><tr><th scope="col">Item</th><th scope="col">USD</th><th scope="col">Tokens</th></tr></thead><tbody>${costRows || '<tr><td colspan="3" class="muted">No cost reported yet.</td></tr>'}</tbody></table></div>
<h2>All artifacts</h2><div class="scroll"><table><thead><tr><th scope="col">ID</th><th scope="col">Type</th><th scope="col">Title</th><th scope="col">Status</th><th scope="col">File</th></tr></thead><tbody>${artifacts}</tbody></table></div>
</main></body></html>
`;
}

/** `keel ui` (NV-4): local, read-only, no network calls; binds to 127.0.0.1 only. */
export function serveDashboard(root: string, port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    try {
      const project = new Project(root);
      if (req.url === '/api/status') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(computeStatus(project)));
        return;
      }
      if (req.url !== '/' && req.url !== '/index.html') {
        res.writeHead(404).end('Not found');
        return;
      }
      res
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
          'cache-control': 'no-store',
        })
        .end(renderDashboard(project));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(e instanceof Error ? e.message : String(e));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
