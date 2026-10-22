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
export function packageArtifact(root, output, context) {
  const verified = validateArtifact(root, context);
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
  const versionBytes = `${JSON.stringify(version, null, 2)}\n`;
  writeFileSync(join(output, 'version.json'), versionBytes, { flag: 'wx' });
  packaged.push({ path: 'version.json', sha256: hash(versionBytes) });
  writeFileSync(join(output, 'deployment-manifest.json'), `${JSON.stringify({ ...version, files: packaged.sort((a, b) => a.path.localeCompare(b.path)) }, null, 2)}\n`, { flag: 'wx' });
  return verified;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const context = { repository: process.env.GITHUB_REPOSITORY, event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, lockfileSha256: hash(readFileSync('package-lock.json')) };
  const readiness = JSON.parse(readFileSync('deployment/release-readiness.json', 'utf8'));
  const baseline = validateReadiness(readiness, process.env.PAGES_DEPLOY_ENABLED, context);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), context.sha);
  execFileSync('git', ['merge-base', '--is-ancestor', baseline, context.sha]);
  regular(readiness.acceptanceEvidence);
  assert(readFileSync(readiness.acceptanceEvidence).length > 0);
  const prefix = `ci-build-${context.sha}-${context.runId}-`;
  const candidates = readdirSync('pages-evidence').filter((name) => name.startsWith(prefix) && positive.test(name.slice(prefix.length))).sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));
  assert(candidates.length > 0, 'No exact-run build artifact');
  const result = packageArtifact(join('pages-evidence', candidates[0]), 'pages-site', context);
  appendFileSync(process.env.GITHUB_OUTPUT, `artifact-name=pages-${context.sha}-${context.runId}-${context.runAttempt}\npackage-attempt=${context.runAttempt}\nbuild-attempt=${result.manifest.runAttempt}\nmanifest-sha256=${result.manifestDigest}\nsite-manifest-sha256=${hash(readFileSync('pages-site/deployment-manifest.json'))}\n`);
}
