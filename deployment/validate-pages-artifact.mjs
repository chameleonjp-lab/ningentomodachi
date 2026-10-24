import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const shaPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const positive = /^[1-9][0-9]*$/;
function safePath(path) {
  assert.equal(typeof path, 'string');
  assert(path.length > 0 && !path.includes('\\') && !path.includes('\0'));
  assert(path.split('/').every((part) => part && part !== '.' && part !== '..'));
}
function regular(path) {
  const stat = lstatSync(path);
  assert(stat.isFile() && stat.nlink === 1, `Not a regular single-link file: ${path}`);
}
function contextValid(context) {
  assert.equal(context.repository, 'chameleonjp-lab/ningentomodachi');
  assert.equal(context.event, 'push');
  assert.equal(context.ref, 'refs/heads/main');
  assert.match(context.sha, shaPattern);
  assert.match(context.runId, positive);
  assert.match(context.runAttempt, positive);
  assert(Number.isSafeInteger(Number(context.runAttempt)));
  assert.match(context.lockfileSha256, digestPattern);
}
export function validateReadiness(readiness, enabled, context) {
  contextValid(context);
  assert.equal(enabled, 'true');
  assert.equal(readiness?.schemaVersion, 1);
  assert.equal(readiness.enabled, true, 'Usable-game acceptance is not complete');
  assert.match(readiness.acceptedCommit, shaPattern);
  safePath(readiness.acceptanceEvidence);
  assert(readiness.acceptanceEvidence.startsWith('docs/deployment/'));
  assert.match(readiness.publicInventorySha256, digestPattern);
  return readiness.acceptedCommit;
}
export function validateArtifact(root, context) {
  contextValid(context);
  const absolute = resolve(root);
  // Check every ancestor: a symlink directory must not hide artifact traversal.
  for (let path = absolute; ; path = dirname(path)) {
    assert(lstatSync(path).isDirectory(), `Not a real directory: ${path}`);
    if (dirname(path) === path) break;
  }
  const manifestPath = join(root, 'reports/manifest.json');
  // Walk before reading the manifest, including the reports directory itself.
  const actual = [];
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory)) {
      const path = prefix ? `${prefix}/${name}` : name;
      safePath(path);
      const file = join(directory, name);
      const stat = lstatSync(file);
      if (stat.isDirectory()) walk(file, path);
      else { regular(file); actual.push(path); }
    }
  }
  walk(root);
  regular(manifestPath);
  const bytes = readFileSync(manifestPath);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.contractVersion, 1);
  assert.equal(manifest.checkName, 'ci-build');
  assert.equal(manifest.result, 'success');
  assert.equal(manifest.checkedSha, context.sha);
  assert.equal(manifest.runId, context.runId);
  assert.match(manifest.runAttempt, positive);
  assert(Number.isSafeInteger(Number(manifest.runAttempt)) && Number(manifest.runAttempt) <= Number(context.runAttempt));
  assert.equal(basename(root), `ci-build-${context.sha}-${context.runId}-${manifest.runAttempt}`);
  assert.equal(manifest.lockfileSha256, context.lockfileSha256);
  assert.equal(manifest.prHeadSha, null);
  assert.equal(manifest.prNumber, null);
  assert(Array.isArray(manifest.files) && manifest.files.length > 0);
  const paths = manifest.files.map((entry) => entry.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual([...paths].sort(), actual.filter((path) => path !== 'reports/manifest.json').sort());
  for (const entry of manifest.files) {
    safePath(entry.path);
    assert.match(entry.sha256, digestPattern);
    assert.equal(hash(readFileSync(join(root, entry.path))), entry.sha256, `Hash mismatch: ${entry.path}`);
  }
  for (const required of ['dist/index.html', 'reports/build.log']) {
    assert(paths.includes(required));
    assert(readFileSync(join(root, required)).length > 0);
  }
  return { manifest, manifestDigest: hash(bytes) };
}
export function validatePreviewReadiness(readiness, enabled, context, root, publicRoot = 'public') {
  contextValid(context);
  assert.equal(enabled, 'true');
  assert.equal(readiness?.schemaVersion, 1);
  assert.equal(readiness.enabled, true, 'Device preview is not configured');
  assert.equal(readiness.channel, 'device-preview');
  assert.equal(readiness.accepted, false);
  assert.equal(readiness.externalSubmission, false);
  assert.match(readiness.baselineCommit, shaPattern);
  safePath(readiness.evidence);
  assert(readiness.evidence.startsWith('docs/deployment/'));
  assert.match(readiness.publicInventorySha256, digestPattern);
  assert(Array.isArray(readiness.publicFiles) && readiness.publicFiles.length > 0);
  const files = readiness.publicFiles;
  for (const entry of files) {
    assert.deepEqual(Object.keys(entry).sort(), ['path', 'sha256']);
    safePath(entry.path);
    assert.match(entry.sha256, digestPattern);
  }
  assert.equal(new Set(files.map((entry) => entry.path)).size, files.length);
  assert.deepEqual(files.map((entry) => entry.path), files.map((entry) => entry.path).sort());
  assert.equal(hash(JSON.stringify(files)), readiness.publicInventorySha256);
  const verified = validateArtifact(root, context);
  const actual = verified.manifest.files.filter((entry) => entry.path.startsWith('dist/'))
    .map((entry) => ({ path: entry.path.slice(5), sha256: entry.sha256 }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const approvedPaths = ['game-assets/android/derived-pack-v1.glb', 'game-assets/android/runtime-artifact-v1.json', 'game-assets/diagnostic-preview-v1/catalog.json'];
  assert.deepEqual(files.map((entry) => entry.path), approvedPaths, 'Unreviewed static asset path');
  assert.deepEqual(actual.filter((entry) => approvedPaths.includes(entry.path)), files, 'Preview static asset bytes differ');
  const sourceFiles = [];
  function collect(directory, prefix = '') {
    assert(lstatSync(directory).isDirectory(), 'Public source directory is not regular');
    for (const name of readdirSync(directory)) {
      const path = prefix ? `${prefix}/${name}` : name;
      safePath(path);
      const source = join(directory, name);
      if (lstatSync(source).isDirectory()) collect(source, path);
      else { regular(source); sourceFiles.push({ path, sha256: hash(readFileSync(source)) }); }
    }
  }
  collect(publicRoot);
  sourceFiles.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assert.deepEqual(sourceFiles, files, 'Public source tree differs from approved static assets');
  const generated = actual.filter((entry) => !approvedPaths.includes(entry.path));
  const scripts = generated.filter((entry) => /^assets\/index-[A-Za-z0-9_-]{8}\.js$/.test(entry.path));
  const styles = generated.filter((entry) => /^assets\/index-[A-Za-z0-9_-]{8}\.css$/.test(entry.path));
  assert.equal(scripts.length, 1, 'Exactly one known index bundle is required');
  assert(styles.length <= 1);
  assert.equal(generated.length, 1 + scripts.length + styles.length, 'Unreviewed generated file');
  assert(generated.some((entry) => entry.path === 'index.html'));

  const index = readFileSync(join(root, 'dist/index.html'), 'utf8');
  const scriptTags = [...index.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
  assert.equal(scriptTags.length, 1);
  assert(!/<base\b/i.test(index), 'Base URLs are not allowed');
  // Accept only Vite's known tag shape, not arbitrary HTML attribute parsing.
  const expectedScript = `<script type="module" src="./${scripts[0].path}">`;
  const expectedCrossoriginScript = `<script type="module" crossorigin src="./${scripts[0].path}">`;
  assert([expectedScript, expectedCrossoriginScript].includes(scriptTags[0]));
  const linkTags = [...index.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  assert.equal(linkTags.length, styles.length);
  for (const tag of linkTags) {
    const expectedStyle = `<link rel="stylesheet" href="./${styles[0].path}">`;
    const expectedCrossoriginStyle = `<link rel="stylesheet" crossorigin href="./${styles[0].path}">`;
    assert([expectedStyle, expectedCrossoriginStyle].includes(tag));
  }
  assert(index.includes('data-release-channel="device-preview"'));
  assert(index.includes('実機確認用・未受入試験版'));
  return readiness.baselineCommit;
}
export function packageArtifact(root, output, context, previewReadiness, publicRoot = 'public') {
  if (previewReadiness !== undefined) validatePreviewReadiness(previewReadiness, 'true', context, root, publicRoot);
  const verified = validateArtifact(root, context);
  if (previewReadiness === undefined) {
    const index = readFileSync(join(root, 'dist/index.html'), 'utf8');
    assert(!index.includes('data-release-channel="device-preview"') && !index.includes('実機確認用・未受入試験版'), 'Preview index cannot be published as an accepted release');
  }
  const distFiles = verified.manifest.files.filter((entry) => entry.path.startsWith('dist/'));
  for (const entry of distFiles) {
    const path = entry.path.slice(5);
    assert(!path.split('/').some((part) => part.startsWith('.')), `Hidden public file: ${path}`);
    assert(!['version.json', 'deployment-manifest.json'].includes(path), `Reserved metadata path: ${path}`);
    assert(/\.(?:html|js|css|json|glb|gltf|bin|png|jpg|jpeg|webp|ktx2|svg|ico|woff2?|wasm|ogg|mp3|wav|txt)$/i.test(path), `Unreviewed public file type: ${path}`);
  }
  // Never overwrite an existing staging directory or follow its link.
  mkdirSync(output);
  const packaged = [];
  for (const entry of distFiles) {
    const path = entry.path.slice(5);
    const destination = join(output, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, entry.path), destination);
    assert.equal(hash(readFileSync(destination)), entry.sha256);
    packaged.push({ path, sha256: entry.sha256 });
  }
  const version = { schemaVersion: 1, repository: context.repository, commit: context.sha, ciRun: context.runId, ciAttempt: context.runAttempt, buildAttempt: verified.manifest.runAttempt, buildManifestSha256: verified.manifestDigest };
  if (previewReadiness !== undefined) Object.assign(version, { channel: 'device-preview', accepted: false, externalSubmission: false });
  const versionBytes = `${JSON.stringify(version, null, 2)}\n`;
  writeFileSync(join(output, 'version.json'), versionBytes, { flag: 'wx' });
  packaged.push({ path: 'version.json', sha256: hash(versionBytes) });
  writeFileSync(join(output, 'deployment-manifest.json'), `${JSON.stringify({ ...version, files: packaged.sort((a, b) => a.path.localeCompare(b.path)) }, null, 2)}\n`, { flag: 'wx' });
  return verified;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const context = { repository: process.env.GITHUB_REPOSITORY, event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, lockfileSha256: hash(readFileSync('package-lock.json')) };
  const readiness = JSON.parse(readFileSync('deployment/release-readiness.json', 'utf8'));
  const preview = JSON.parse(readFileSync('deployment/preview-readiness.json', 'utf8'));
  assert(!(readiness.enabled === true && preview.enabled === true), 'Select only one publication channel');
  const isPreview = preview.enabled === true;
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), context.sha);
  const prefix = `ci-build-${context.sha}-${context.runId}-`;
  const candidates = readdirSync('pages-evidence').filter((name) => name.startsWith(prefix) && positive.test(name.slice(prefix.length))).sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));
  assert(candidates.length > 0, 'No exact-run build artifact');
  const root = join('pages-evidence', candidates[0]);
  const baseline = isPreview
    ? validatePreviewReadiness(preview, process.env.PAGES_DEPLOY_ENABLED, context, root)
    : validateReadiness(readiness, process.env.PAGES_DEPLOY_ENABLED, context);
  execFileSync('git', ['merge-base', '--is-ancestor', baseline, context.sha]);
  const evidence = isPreview ? preview.evidence : readiness.acceptanceEvidence;
  regular(evidence);
  assert(readFileSync(evidence).length > 0);
  const result = packageArtifact(root, 'pages-site', context, isPreview ? preview : undefined);
  appendFileSync(process.env.GITHUB_OUTPUT, `publication-channel=${isPreview ? 'device-preview' : 'release'}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `artifact-name=pages-${context.sha}-${context.runId}-${context.runAttempt}\npackage-attempt=${context.runAttempt}\nbuild-attempt=${result.manifest.runAttempt}\nmanifest-sha256=${result.manifestDigest}\nsite-manifest-sha256=${hash(readFileSync('pages-site/deployment-manifest.json'))}\n`);
}
