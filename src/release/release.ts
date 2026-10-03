import path from 'node:path';
import { readTextIf } from '../util/fs.js';
import { createArtifact } from '../graph/write.js';
import { lastDecision } from '../workflow/gates.js';
import { DONE_STATUSES } from '../model/registry.js';
import { cmpId } from '../graph/graph.js';
import { KeelError } from '../util/errors.js';
import type { ArtifactNode } from '../model/types.js';
import type { Project } from '../project.js';

export interface AppVersion {
  version?: string;
  build?: string;
  file: string;
}

/** Reads the app version and build number from the stack's manifest. */
export function detectVersion(project: Project): AppVersion {
  const root = project.root;
  const read = (f: string) => readTextIf(path.join(root, f));
  switch (project.config.stack) {
    case 'flutter': {
      const m = read('pubspec.yaml')?.match(/^version:\s*([\d.]+)(?:\+(\d+))?/m);
      return { version: m?.[1], build: m?.[2], file: 'pubspec.yaml' };
    }
    case 'expo': {
      const app = read('app.json');
      if (app) {
        try {
          const e = (JSON.parse(app) as { expo?: { version?: string; ios?: { buildNumber?: string }; android?: { versionCode?: number } } }).expo;
          return { version: e?.version, build: e?.ios?.buildNumber ?? (e?.android?.versionCode !== undefined ? String(e.android.versionCode) : undefined), file: 'app.json' };
        } catch {
          // fall through
        }
      }
      return { version: (JSON.parse(read('package.json') ?? '{}') as { version?: string }).version, file: 'app.json / package.json' };
    }
    case 'compose': {
      const g = read('app/build.gradle.kts') ?? read('app/build.gradle') ?? '';
      return {
        version: g.match(/versionName\s*=?\s*"([^"]+)"/)?.[1],
        build: g.match(/versionCode\s*=?\s*(\d+)/)?.[1],
        file: 'app/build.gradle(.kts)',
      };
    }
    case 'swiftui':
      return { file: 'the Xcode target (MARKETING_VERSION, CURRENT_PROJECT_VERSION)' };
    default:
      return { version: (JSON.parse(read('package.json') ?? '{}') as { version?: string }).version, file: 'package.json' };
  }
}

const DATA_KINDS: { re: RegExp; label: string }[] = [
  { re: /\b(e-?mail|account|sign[ -]?(in|up)|log[ -]?in|password)\b/i, label: 'Contact info: email address / account' },
  { re: /\b(name|profile|avatar)\b/i, label: 'Name or profile data' },
  { re: /\b(location|gps|nearby|map)\b/i, label: 'Location' },
  { re: /\b(photo|camera|image|video)\b/i, label: 'Photos or videos' },
  { re: /\b(contacts?|address book)\b/i, label: 'Contacts' },
  { re: /\b(health|fitness|steps|heart|sleep|weight)\b/i, label: 'Health and fitness' },
  { re: /\b(payment|purchase|subscription|billing|in-app)\b/i, label: 'Purchases / financial info' },
  { re: /\b(analytics|tracking|crash|diagnostic|telemetry)\b/i, label: 'Usage data and diagnostics' },
  { re: /\b(notification|push)\b/i, label: 'Push notifications (permission prompt rationale)' },
  { re: /\b(sync|cloud|backup|server|backend)\b/i, label: 'User content stored off-device (sync or backup)' },
];

function itemsDoneSince(project: Project, since?: string): ArtifactNode[] {
  return [...project.graph.byType('story'), ...project.graph.byType('change')]
    .filter((n) => DONE_STATUSES.has(n.status))
    .filter((n) => {
      const d = lastDecision(project.paths, n.id, ['done']);
      return !since || !d || d.at > since;
    })
    .sort((a, b) => cmpId(a.id, b.id));
}

function lastReleaseAt(project: Project): string | undefined {
  return project.graph
    .byType('release')
    .map((r) => lastDecision(project.paths, r.id, ['done'])?.at)
    .filter(Boolean)
    .sort()
    .pop() as string | undefined;
}

/** `keel release [version]` (RC-1): the checklist, generated from the PRD and screens. */
export function createRelease(project: Project, versionArg?: string, buildArg?: string): { id: string; file: string } {
  const g = project.graph;
  const open = g.byType('release').find((r) => !DONE_STATUSES.has(r.status));
  if (open) throw new KeelError(`${open.id} is still open. Finish it (keel done ${open.id}) before starting another release.`);
  const v = detectVersion(project);
  const version = versionArg ?? v.version ?? '1.0.0';
  const build = buildArg ?? v.build ?? '1';
  const kind = project.config.release.kind;
  const stack = project.config.stack;
  const screens = g.byType('screen').slice(0, 10);
  const screenList = screens.length ? screens.map((s) => `${s.id} ${s.title}`).join(', ') : 'your main screens';
  const shots: string[] = [];
  if (kind === 'mobile') {
    if (stack !== 'compose') {
      shots.push(`- [ ] iPhone 6.9" (1320×2868 or 1290×2796), 3–10 shots: ${screenList}`);
      shots.push(`- [ ] iPad 13" (2064×2752), only if the app supports iPad`);
    }
    if (stack !== 'swiftui') {
      shots.push(`- [ ] Android phone (at least 2 shots, 16:9 or 9:16): ${screenList}`);
      shots.push('- [ ] Android 7" and 10" tablet, only if the app supports tablets');
      shots.push('- [ ] Play feature graphic (1024×500)');
    }
    shots.push('- [ ] App icon at store sizes (1024×1024 iOS, 512×512 Play)');
  } else {
    shots.push(`- [ ] Open Graph image and favicon`, `- [ ] Pages checked on mobile and desktop widths: ${screenList}`);
  }
  const reqs = g.byType('requirement');
  const privacy: string[] = [];
  for (const k of DATA_KINDS) {
    const hits = reqs.filter((r) => k.re.test(r.body)).map((r) => r.id);
    if (hits.length) privacy.push(`- [ ] Declare: ${k.label} (${hits.slice(0, 4).join(', ')})`);
  }
  if (!privacy.length) privacy.push('- [ ] No data-collecting requirements found: confirm "Data not collected", or declare what third-party SDKs collect');
  if (kind === 'mobile') {
    if (stack !== 'compose') privacy.push('- [ ] App Store privacy nutrition labels completed', '- [ ] Privacy manifest (PrivacyInfo.xcprivacy) lists required-reason APIs');
    if (stack !== 'swiftui') privacy.push('- [ ] Google Play data safety form completed');
    privacy.push('- [ ] Permission prompts have clear usage strings for each permission the app requests');
  } else {
    privacy.push('- [ ] Cookie or consent banner matches the analytics in use');
  }
  privacy.push('- [ ] Privacy policy URL covers everything declared above');
  const since = lastReleaseAt(project);
  const includes = itemsDoneSince(project, since).map((n) => n.id);
  const prd = g.byType('prd').map((p) => p.id);
  return createArtifact(project, {
    type: 'release',
    title: `Release ${version}`,
    template: kind === 'mobile' ? 'release-mobile.md' : 'release-web.md',
    vars: { version, build, version_file: v.file, screenshots: shots.join('\n'), privacy: privacy.join('\n') },
    links: { ...(includes.length ? { includes } : {}), ...(prd.length ? { derived_from: prd } : {}) },
    extra: { version, build, kind },
  });
}

/** `keel release notes` (RC-2): one line per finished story or change since the last release, with its ID. */
export function releaseNotes(project: Project, opts: { since?: string } = {}): string {
  const since = opts.since ? lastDecision(project.paths, opts.since.toUpperCase(), ['done'])?.at : lastReleaseAt(project);
  const items = itemsDoneSince(project, since);
  const features = items.filter((n) => n.type === 'story' || n.fm.track === 'feature');
  const fixes = items.filter((n) => n.type === 'change' && n.fm.track === 'quick');
  const out: string[] = [];
  if (features.length) out.push('### New', ...features.map((n) => `- ${n.title} (${n.id})`));
  if (fixes.length) out.push(...(out.length ? [''] : []), '### Fixed', ...fixes.map((n) => `- ${n.title} (${n.id})`));
  if (!out.length) out.push('_No finished stories or changes since the last release._');
  return out.join('\n');
}


