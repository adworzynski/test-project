import { describe, it, expect } from 'vitest';
import { parseNpm, parsePubspec, parsePodfile, parsePackageSwift, parseGradle, checkDependencies, newDependencies, type Fetcher } from '../src/verify/deps.js';
import { tmpDir, write, git } from './helpers.js';

const NOW = new Date('2026-10-03T00:00:00Z');
const fake: Fetcher = async (url) => {
  if (url.includes('registry.npmjs.org/left-pad')) return { status: 200, body: JSON.stringify({ time: { created: '2016-03-01T00:00:00Z' } }) };
  if (url.includes('registry.npmjs.org/brand-new-pkg')) return { status: 200, body: JSON.stringify({ time: { created: '2026-09-25T00:00:00Z' } }) };
  if (url.includes('registry.npmjs.org/flaky')) throw new Error('ETIMEDOUT');
  if (url.includes('pub.dev/api/packages/riverpod')) return { status: 200, body: JSON.stringify({ versions: [{ published: '2020-06-01T00:00:00Z' }, { published: '2026-01-01T00:00:00Z' }] }) };
  if (url.includes('api.github.com/repos/pointfreeco/swift-composable-architecture')) return { status: 200, body: JSON.stringify({ created_at: '2020-05-01T00:00:00Z' }) };
  if (url.includes('dl.google.com/android/maven2/androidx/room')) return { status: 200, body: '<androidx.room><room-runtime versions="2.6.1"/></androidx.room>' };
  if (url.includes('search.maven.org')) return { status: 200, body: JSON.stringify({ response: { docs: [{ timestamp: Date.parse('2019-01-01') }] } }) };
  return { status: 404 };
};

describe('manifest parsing', () => {
  it('npm skips local and git deps', () => {
    const d = parseNpm(JSON.stringify({ dependencies: { react: '19', local: 'file:../x', gh: 'github:a/b' }, devDependencies: { jest: '30' } }), 'package.json');
    expect(d.map((x) => x.name)).toEqual(['react', 'jest']);
  });
  it('pubspec skips sdk, path and git deps', () => {
    const d = parsePubspec('dependencies:\n  flutter:\n    sdk: flutter\n  riverpod: ^2.5.0\n  mine:\n    path: ../mine\ndev_dependencies:\n  mocktail: ^1.0.0\n', 'pubspec.yaml');
    expect(d.map((x) => x.name)).toEqual(['riverpod', 'mocktail']);
  });
  it('Podfile, Package.swift and Gradle', () => {
    expect(parsePodfile("pod 'Alamofire', '~> 5.0'\npod 'Local', :path => '../x'\n", 'Podfile').map((x) => x.name)).toEqual(['Alamofire']);
    expect(parsePackageSwift('.package(url: "https://github.com/pointfreeco/swift-composable-architecture.git", from: "1.0.0")', 'Package.swift')[0]!.name).toBe('pointfreeco/swift-composable-architecture');
    expect(parseGradle('implementation("androidx.room:room-runtime:2.6.1")\ntestImplementation("junit:junit:4.13.2")', 'app/build.gradle.kts').map((x) => x.name)).toEqual(['androidx.room:room-runtime', 'junit:junit']);
    expect(parseGradle('[libraries]\nroom = { module = "androidx.room:room-runtime", version.ref = "room" }\n', 'gradle/libs.versions.toml')[0]!.name).toBe('androidx.room:room-runtime');
  });
});

describe('dependency gate (VG-6)', () => {
  it('blocks missing and brand-new packages, passes old ones, never blocks on network errors', async () => {
    const r = await checkDependencies(
      [
        { ecosystem: 'npm', name: 'left-pad', manifest: 'package.json' },
        { ecosystem: 'npm', name: 'brand-new-pkg', manifest: 'package.json' },
        { ecosystem: 'npm', name: 'reakt-utils-pro', manifest: 'package.json' },
        { ecosystem: 'npm', name: 'flaky', manifest: 'package.json' },
        { ecosystem: 'npm', name: '@acme/internal', manifest: 'package.json' },
        { ecosystem: 'pub', name: 'riverpod', manifest: 'pubspec.yaml' },
        { ecosystem: 'spm', name: 'pointfreeco/swift-composable-architecture', manifest: 'Package.swift' },
        { ecosystem: 'maven', name: 'androidx.room:room-runtime', manifest: 'build.gradle' },
        { ecosystem: 'maven', name: 'junit:junit', manifest: 'build.gradle' },
        { ecosystem: 'cocoapods', name: 'NoSuchPod', manifest: 'Podfile' },
      ],
      { minAgeDays: 30, allow: ['@acme/*'], fetcher: fake, now: NOW },
    );
    const by = Object.fromEntries(r.map((x) => [x.name, x.status]));
    expect(by).toEqual({
      'left-pad': 'ok',
      'brand-new-pkg': 'too-new',
      'reakt-utils-pro': 'missing',
      flaky: 'unknown',
      '@acme/internal': 'allowed',
      riverpod: 'ok',
      'pointfreeco/swift-composable-architecture': 'ok',
      'androidx.room:room-runtime': 'ok',
      'junit:junit': 'ok',
      NoSuchPod: 'missing',
    });
  });

  it('only checks dependencies added since the base commit', () => {
    const root = tmpDir();
    git(root, 'init', '-q', '-b', 'main');
    write(root, 'pubspec.yaml', 'name: a\ndependencies:\n  riverpod: ^2.0.0\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'base');
    write(root, 'pubspec.yaml', 'name: a\ndependencies:\n  riverpod: ^2.0.0\n  hallucinated_pkg: ^1.0.0\n');
    expect(newDependencies(root, ['pubspec.yaml'], 'HEAD').map((d) => d.name)).toEqual(['hallucinated_pkg']);
  });
});
