import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, linkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { validateReadiness, validateArtifact, packageArtifact, validatePreviewReadiness } from './validate-pages-artifact.mjs';

const sha = 'a'.repeat(40);
const digest = (s) => createHash('sha256').update(s).digest('hex');
const context = { repository: 'chameleonjp-lab/ningentomodachi', event: 'push', ref: 'refs/heads/main', sha, runId: '123', runAttempt: '2', lockfileSha256: digest('lock') };
const ready = { schemaVersion: 1, enabled: true, acceptedCommit: 'b'.repeat(40), acceptanceEvidence: 'docs/deployment/acceptance.md', publicInventorySha256: 'c'.repeat(64) };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pages-test-'));
  const artifact = join(root, `ci-build-${sha}-123-1`);
  mkdirSync(join(artifact, 'reports'), { recursive: true });
  mkdirSync(join(artifact, 'dist'));
  writeFileSync(join(artifact, 'dist/index.html'), '<html>game</html>');
  writeFileSync(join(artifact, 'reports/build.log'), 'build passed');
  const manifest = { schemaVersion: 1, contractVersion: 1, checkName: 'ci-build', result: 'success', checkedSha: sha, prHeadSha: null, prNumber: null, runId: '123', runAttempt: '1', lockfileSha256: context.lockfileSha256, files: [ { path: 'dist/index.html', sha256: digest('<html>game</html>') }, { path: 'reports/build.log', sha256: digest('build passed') } ] };
  const save = () => writeFileSync(join(artifact, 'reports/manifest.json'), JSON.stringify(manifest));
  save();
  return { root, artifact, manifest, save };
}

test('readiness requires both explicit gates and same-repository main push', () => {
  assert.equal(validateReadiness(ready, 'true', context), ready.acceptedCommit);
  for (const value of [undefined, false, 'false', 'TRUE']) assert.throws(() => validateReadiness(ready, value, context));
  for (const value of [undefined, {}, { ...ready, enabled: false }, { ...ready, acceptedCommit: '' }, { ...ready, publicInventorySha256: '' }, { ...ready, acceptanceEvidence: '../secret' }]) assert.throws(() => validateReadiness(value, 'true', context));
  for (const changes of [{ repository: 'fork/ningentomodachi' }, { event: 'pull_request' }, { event: 'workflow_dispatch' }, { ref: 'refs/heads/feature' }]) assert.throws(() => validateReadiness(ready, 'true', { ...context, ...changes }));
});

test('valid exact prior-attempt build is accepted with its identity preserved', () => {
  const f = fixture();
  const result = validateArtifact(f.artifact, context);
  assert.equal(result.manifest.runAttempt, '1');
  assert.equal(result.manifestDigest, digest(readFileSync(join(f.artifact, 'reports/manifest.json'))));
});

for (const [field, value] of [['checkedSha', 'd'.repeat(40)], ['runId', '999'], ['runAttempt', '3'], ['runAttempt', '2'], ['lockfileSha256', 'd'.repeat(64)], ['prHeadSha', sha], ['prNumber', 7], ['result', 'failure'], ['checkName', 'ci-unit'], ['schemaVersion', 2]]) {
  test(`reject mismatched ${field}=${value}`, () => { const f = fixture(); f.manifest[field] = value; f.save(); assert.throws(() => validateArtifact(f.artifact, context)); });
}

test('reject changed bytes, extra files, and empty index', () => {
  for (const [path, bytes] of [['dist/index.html', 'altered'], ['dist/extra.txt', 'extra'], ['dist/index.html', '']]) { const f = fixture(); writeFileSync(join(f.artifact, path), bytes); assert.throws(() => validateArtifact(f.artifact, context)); }
});

test('reject unsafe and duplicate manifest paths', () => {
  for (const path of ['../escape', '/absolute', 'dist/../index.html', 'dist//index.html', 'dist\\index.html', 'dist/index.html']) {
    const f = fixture(); f.manifest.files.push({ path, sha256: digest('') }); f.save(); assert.throws(() => validateArtifact(f.artifact, context));
  }
});

test('reject symbolic and hard links including manifest or ancestor directory', () => {
  for (const make of [symlinkSync, linkSync]) { const f = fixture(); make(join(f.artifact, 'dist/index.html'), join(f.artifact, 'dist/link')); assert.throws(() => validateArtifact(f.artifact, context)); }
  const f = fixture(); const alias = join(f.root, 'alias'); symlinkSync(f.artifact, alias); assert.throws(() => validateArtifact(alias, context));
});

test('package copies only verified dist and generates exact public version identity', () => {
  const f = fixture(); const out = join(f.root, 'site');
  const result = packageArtifact(f.artifact, out, context);
  const version = JSON.parse(readFileSync(join(out, 'version.json'), 'utf8'));
  assert.equal(version.commit, sha); assert.equal(version.buildAttempt, '1'); assert.equal(version.ciAttempt, '2');
  assert.equal(version.buildManifestSha256, result.manifestDigest);
  assert.equal(readFileSync(join(out, 'index.html'), 'utf8'), '<html>game</html>');
  assert.throws(() => readFileSync(join(out, 'reports/build.log')));
  assert.throws(() => packageArtifact(f.artifact, out, context));
});

test('reject reserved public metadata names and secrets/source maps', () => {
  for (const path of ['dist/version.json', 'dist/deployment-manifest.json', 'dist/.env', 'dist/assets/app.js.map']) {
    const f = fixture(); mkdirSync(join(f.artifact, 'dist/assets'), { recursive: true }); writeFileSync(join(f.artifact, path), 'data'); f.manifest.files.push({ path, sha256: digest('data') }); f.save(); assert.throws(() => packageArtifact(f.artifact, join(f.root, 'site'), context));
  }
});

test('workflow keeps publishing default closed and unprivileged until verified main packaging', () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const readiness = JSON.parse(readFileSync('deployment/release-readiness.json', 'utf8'));
  assert.equal(readiness.schemaVersion, 1);
  assert.equal(typeof readiness.enabled, 'boolean');
  if (readiness.enabled) validateReadiness(readiness, 'true', context);
  else assert.throws(() => validateReadiness(readiness, 'true', context));
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.match(workflow.concurrency['cancel-in-progress'], /github.event_name == 'pull_request'/);
  const pkg = workflow.jobs['pages-package'];
  assert.deepEqual(pkg.needs, ['ci-required']);
  for (const expected of ["github.event_name == 'push'", "github.ref == 'refs/heads/main'", "github.repository == 'chameleonjp-lab/ningentomodachi'", "vars.PAGES_DEPLOY_ENABLED == 'true'", "needs.ci-required.result == 'success'"]) assert.ok(pkg.if.includes(expected), expected);
  const deploy = workflow.jobs['pages-deploy'];
  assert.deepEqual(deploy.permissions, { contents: 'read', pages: 'write', 'id-token': 'write' });
  assert.equal(deploy.environment.name, 'github-pages');
  assert.deepEqual(deploy.needs, ['pages-package']);
  assert.equal(deploy.concurrency['cancel-in-progress'], false);
  for (const step of deploy.steps) { assert.ok(!step.run); assert.ok(!String(step.uses).includes('checkout')); assert.ok(!String(step.uses).includes('setup-node')); }
  assert.ok(workflow.jobs['ci-typecheck'].steps.some((s) => String(s.run).includes('node --test deployment/validate-pages-artifact.test.mjs')));
});

test('actual privileged freshness program rejects stale main and accepts exact main', async () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const script = workflow.jobs['pages-deploy'].steps.find((step) => step.name === 'Reject stale main immediately before deployment').with.script;
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction('github', 'context', script);
  const api = (value) => ({ rest: { repos: { getBranch: async () => ({ data: { commit: { sha: value } } }) } } });
  await assert.rejects(() => run(api('b'.repeat(40)), { sha, repo: { owner: 'chameleonjp-lab', repo: 'ningentomodachi' } }), /Stale main/);
  await run(api(sha), { sha, repo: { owner: 'chameleonjp-lab', repo: 'ningentomodachi' } });
});

test('actual public verifier validates exact artifact and rejects stale identity or changed bytes', async () => {
  const { runInNewContext } = await import('node:vm');
  const { createRequire } = await import('node:module');
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const script = workflow.jobs['pages-verify'].steps[0].with.script;
  const f = fixture(); const out = join(f.root, 'site'); const result = packageArtifact(f.artifact, out, context);
  const env = { PUBLICATION_CHANNEL: 'release', PAGE_URL: 'https://chameleonjp-lab.github.io/ningentomodachi/', GITHUB_RUN_ATTEMPT: '3', PACKAGE_ATTEMPT: '2', BUILD_ATTEMPT: '1', BUILD_MANIFEST_SHA256: result.manifestDigest, SITE_MANIFEST_SHA256: digest(readFileSync(join(out, 'deployment-manifest.json'))) };
  const run = (override = {}, altered = '') => {
    const summary = { addHeading: () => summary, addRaw: () => summary, write: async () => {} };
    return runInNewContext(`(async () => { ${script}\n })()`, {
      require: createRequire(import.meta.url), Buffer, URL, AbortSignal,
      process: { env: { ...env, ...override } }, context: { sha, runId: 123 }, core: { info: () => {}, summary },
      setTimeout: (fn) => { fn(); },
      fetch: async (url) => new Response(url.pathname.endsWith(altered) && altered ? 'altered' : readFileSync(join(out, url.pathname.slice('/ningentomodachi/'.length)))),
    });
  };
  await run();
  await assert.rejects(() => run({ PUBLICATION_CHANNEL: 'unknown' }), /Unknown publication channel/);
  await assert.rejects(() => run({ PUBLICATION_CHANNEL: 'device-preview' }), /Preview identity mismatch/);
  await assert.rejects(() => run({ PAGE_URL: 'https://evil.example/' }), /Unexpected public destination/);
  await assert.rejects(() => run({ BUILD_ATTEMPT: '2' }), /Public version mismatch/);
  await assert.rejects(() => run({}, 'index.html'), /Public file mismatch/);
  await assert.rejects(() => run({ SITE_MANIFEST_SHA256: 'f'.repeat(64) }), /Public manifest mismatch/);
});

test('merged-PR provenance program accepts merge/squash/rebase exact merge commit only', async () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const step = workflow.jobs['pages-package'].steps.find((step) => step.name === 'Require exact merged-PR provenance');
  assert.ok(step, 'Direct main pushes must not publish');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction('github', 'context', 'core', 'setTimeout', step.with.script);
  const pr = { number: 7, merged_at: '2026-10-22T00:00:00Z', merge_commit_sha: sha, base: { ref: 'main', repo: { full_name: context.repository } } };
  const api = (list, detail = pr) => ({ rest: { repos: { listPullRequestsAssociatedWithCommit: async () => ({ data: list }) }, pulls: { get: async () => ({ data: detail }) } } });
  const ctx = { sha, repo: { owner: 'chameleonjp-lab', repo: 'ningentomodachi' }, payload: { forced: false } };
  const core = { info: () => {} };
  const immediate = (fn) => fn();
  await run(api([pr]), ctx, core, immediate);
  for (const change of [{ merged_at: null }, { merge_commit_sha: 'f'.repeat(40) }, { base: { ref: 'develop', repo: { full_name: context.repository } } }, { base: { ref: 'main', repo: { full_name: 'fork/repo' } } }]) {
    await assert.rejects(() => run(api([{ ...pr, ...change }], { ...pr, ...change }), ctx, core, immediate), /merged PR/);
  }
  await assert.rejects(() => run(api([]), ctx, core, immediate), /merged PR/);
  let calls = 0;
  const delayed = api([pr]);
  delayed.rest.repos.listPullRequestsAssociatedWithCommit = async () => ({ data: ++calls < 3 ? [] : [pr] });
  await run(delayed, ctx, core, immediate);
  assert.equal(calls, 3);
});

test('deploy and verification reuse the successful packaging attempt on partial reruns', () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  assert.equal(workflow.jobs['pages-package'].outputs['artifact-name'], '${{ steps.package.outputs.artifact-name }}');
  assert.equal(workflow.jobs['pages-package'].outputs['package-attempt'], '${{ steps.package.outputs.package-attempt }}');
  assert.equal(workflow.jobs['pages-deploy'].steps.at(-1).with.artifact_name, '${{ needs.pages-package.outputs.artifact-name }}');
  assert.equal(workflow.jobs['pages-verify'].steps[0].env.PACKAGE_ATTEMPT, '${{ needs.pages-package.outputs.package-attempt }}');
});

test('actual Pages preflight rejects unapproved destination/build mode before publication', async () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const steps = workflow.jobs['pages-deploy'].steps;
  const step = steps.find((step) => step.name === 'Verify approved Pages configuration before deployment');
  assert.ok(step, 'Destination must be checked before deployment, not only afterward');
  assert.ok(steps.indexOf(step) < steps.findIndex((step) => step.id === 'deployment'));
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction('github', 'context', step.with.script);
  const good = { html_url: 'https://chameleonjp-lab.github.io/ningentomodachi/', cname: null, build_type: 'workflow' };
  const api = (data) => ({ request: async (route) => { assert.equal(route, 'GET /repos/{owner}/{repo}/pages'); return { data }; } });
  await run(api(good), { repo: { owner: 'chameleonjp-lab', repo: 'ningentomodachi' } });
  for (const change of [{ html_url: 'https://custom.example/' }, { html_url: 'http://chameleonjp-lab.github.io/ningentomodachi/' }, { cname: 'custom.example' }, { cname: undefined }, { build_type: 'legacy' }, { build_type: undefined }]) {
    await assert.rejects(() => run(api({ ...good, ...change }), { repo: {} }), /Pages configuration/);
  }
  await assert.rejects(() => run({ request: async () => { throw new Error('unsupported'); } }, { repo: {} }), /unsupported/);
});

test('actual PR provenance program rejects forced or absent force state', async () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const step = workflow.jobs['pages-package'].steps.find((step) => step.name === 'Require exact merged-PR provenance');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction('github', 'context', 'core', step.with.script);
  const pr = { number: 7, merged_at: '2026-10-22T00:00:00Z', merge_commit_sha: sha, base: { ref: 'main', repo: { full_name: context.repository } } };
  const github = { rest: { repos: { listPullRequestsAssociatedWithCommit: async () => ({ data: [pr] }) }, pulls: { get: async () => ({ data: pr }) } } };
  for (const payload of [{ forced: true }, {}]) await assert.rejects(() => run(github, { sha, repo: {}, payload }, { info: () => {} }), /force/);
});

function previewFixture() {
  const f = fixture();
  const html = '<html data-release-channel="device-preview"><head><script type="module" src="./assets/index-ABCDEFGH.js"></script></head><body>実機確認用・未受入試験版</body></html>';
  writeFileSync(join(f.artifact, 'dist/index.html'), html);
  f.manifest.files[0].sha256 = digest(html); f.save();
  mkdirSync(join(f.artifact, 'dist/assets'), {recursive:true});
  writeFileSync(join(f.artifact, 'dist/assets/index-ABCDEFGH.js'), 'app');
  f.manifest.files.push({path:'dist/assets/index-ABCDEFGH.js',sha256:digest('app')});
  const publicRoot = join(f.root, 'public');
  const files = ['game-assets/android/derived-pack-v1.glb', 'game-assets/android/runtime-artifact-v1.json', 'game-assets/diagnostic-preview-v1/catalog.json'].map((path) => ({path, sha256:digest(path)}));
  for (const entry of files) {
    for (const root of [join(f.artifact, 'dist'), publicRoot]) {
      mkdirSync(join(root, entry.path, '..'), {recursive:true});
      writeFileSync(join(root, entry.path), entry.path);
    }
    f.manifest.files.push({path:`dist/${entry.path}`,sha256:entry.sha256});
  }
  f.save();
  const readiness = { schemaVersion: 1, enabled: true, channel: 'device-preview', accepted: false,
    externalSubmission: false, baselineCommit: 'b'.repeat(40), evidence: 'docs/deployment/preview.md',
    publicFiles: files, publicInventorySha256: digest(JSON.stringify(files)) };
  return { ...f, readiness, publicRoot };
}
test('preview requires explicit unaccepted channel and complete exact public inventory', () => {
  const f = previewFixture();
  assert.equal(validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot), f.readiness.baselineCommit);
  for (const changes of [{enabled:false}, {accepted:true}, {externalSubmission:true}, {channel:'release'},
    {baselineCommit:null}, {evidence:'../secret'}, {publicFiles:[]}, {publicInventorySha256:'a'.repeat(64)}]) {
    assert.throws(() => validatePreviewReadiness({...f.readiness, ...changes}, 'true', context, f.artifact, f.publicRoot));
  }
  assert.throws(() => validatePreviewReadiness(f.readiness, 'false', context, f.artifact, f.publicRoot));
});
test('preview rejects unlisted or substituted public bytes even if CI manifest is internally valid', () => {
  const f = previewFixture();
  writeFileSync(join(f.artifact, 'dist/extra.json'), '{}');
  f.manifest.files.push({path:'dist/extra.json',sha256:digest('{}')}); f.save();
  assert.throws(() => validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot));
});
test('preview cannot publish a shell without the visible unaccepted marker', () => {
  const f = previewFixture();
  writeFileSync(join(f.artifact, 'dist/index.html'), '<html>game</html>');
  f.manifest.files[0].sha256 = digest('<html>game</html>'); f.save();
  assert.throws(() => validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot));
});
test('preview package records unaccepted identity after validating its inventory', () => {
  const f = previewFixture(); const out = join(f.root, 'preview-site');
  packageArtifact(f.artifact, out, context, f.readiness, f.publicRoot);
  const version = JSON.parse(readFileSync(join(out, 'version.json')));
  assert.equal(version.channel, 'device-preview'); assert.equal(version.accepted, false);
  assert.equal(version.externalSubmission, false);
});
test('preview inventory rejects duplicate paths, unsafe paths, extra fields and changed hashes', () => {
  for (const alter of [
    (files) => files.push({...files[0]}),
    (files) => { files[0].path = '../secret'; },
    (files) => { files[0].sha256 = 'a'.repeat(64); },
    (files) => { files[0].license = 'unverified'; },
  ]) {
    const f = previewFixture(); alter(f.readiness.publicFiles);
    f.readiness.publicInventorySha256 = digest(JSON.stringify(f.readiness.publicFiles));
    assert.throws(() => validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot));
  }
});
test('checked-in preview is explicitly unaccepted while formal release remains disabled', () => {
  const preview = JSON.parse(readFileSync('deployment/preview-readiness.json'));
  const release = JSON.parse(readFileSync('deployment/release-readiness.json'));
  assert.equal(preview.enabled, true); assert.equal(preview.accepted, false);
  assert.match(preview.baselineCommit, /^[0-9a-f]{40}$/);
  assert.equal(preview.publicFiles.length, 3);
  assert.equal(preview.publicInventorySha256, digest(JSON.stringify(preview.publicFiles)));
  for (const entry of preview.publicFiles) assert.equal(entry.sha256, digest(readFileSync(join('public', entry.path))));
  assert.equal(release.enabled, false); assert.equal(release.acceptedCommit, null);
});
test('public verifier receives the actual package channel output', () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  assert.equal(workflow.jobs['pages-verify'].steps[0].env.PUBLICATION_CHANNEL,
    '${{ needs.pages-package.outputs.publication-channel }}');
});

test('actual preview public verifier accepts unaccepted metadata and rejects channel substitution', async () => {
  const { runInNewContext } = await import('node:vm');
  const { createRequire } = await import('node:module');
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const script = workflow.jobs['pages-verify'].steps[0].with.script;
  const f = previewFixture(); const out = join(f.root, 'site'); const result = packageArtifact(f.artifact, out, context, f.readiness, f.publicRoot);
  const env = { PUBLICATION_CHANNEL: 'device-preview', PAGE_URL: 'https://chameleonjp-lab.github.io/ningentomodachi/', GITHUB_RUN_ATTEMPT: '3', PACKAGE_ATTEMPT: '2', BUILD_ATTEMPT: '1', BUILD_MANIFEST_SHA256: result.manifestDigest, SITE_MANIFEST_SHA256: digest(readFileSync(join(out, 'deployment-manifest.json'))) };
  const run = (override = {}, altered = '') => {
    const summary = { addHeading: () => summary, addRaw: () => summary, write: async () => {} };
    return runInNewContext(`(async () => { ${script}\n })()`, {
      require: createRequire(import.meta.url), Buffer, URL, AbortSignal,
      process: { env: { ...env, ...override } }, context: { sha, runId: 123 }, core: { info: () => {}, summary },
      setTimeout: (fn) => { fn(); },
      fetch: async (url) => new Response(url.pathname.endsWith(altered) && altered ? 'altered' : readFileSync(join(out, url.pathname.slice('/ningentomodachi/'.length)))),
    });
  };
  await run();
  await assert.rejects(() => run({ PUBLICATION_CHANNEL: 'unknown' }), /Unknown publication channel/);
  await assert.rejects(() => run({ PUBLICATION_CHANNEL: 'release' }), /Release contains preview identity/);
  await assert.rejects(() => run({ PAGE_URL: 'https://evil.example/' }), /Unexpected public destination/);
  await assert.rejects(() => run({ BUILD_ATTEMPT: '2' }), /Public version mismatch/);
  await assert.rejects(() => run({}, 'index.html'), /Public file mismatch/);
  await assert.rejects(() => run({ SITE_MANIFEST_SHA256: 'f'.repeat(64) }), /Public manifest mismatch/);
});

test('preview allows a new CI-built index bundle hash without changing static asset approval', () => {
  const f = previewFixture();
  writeFileSync(join(f.artifact, 'dist/assets/index-ABCDEFGH.js'), 'changed reviewed app');
  f.manifest.files.find((x) => x.path === 'dist/assets/index-ABCDEFGH.js').sha256 = digest('changed reviewed app'); f.save();
  assert.equal(validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot), f.readiness.baselineCommit);
});
test('preview rejects unknown generated chunks and public source changes', () => {
  for (const path of ['assets/vendor-ABCDEFGH.js', 'assets/index-ABCDEFGH.js.map', 'extra.html', 'source.json']) {
    const f = previewFixture(); writeFileSync(join(f.artifact, 'dist', path), 'unknown');
    f.manifest.files.push({path:`dist/${path}`,sha256:digest('unknown')}); f.save();
    assert.throws(() => validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot));
  }
  const f = previewFixture();
  writeFileSync(join(f.publicRoot, f.readiness.publicFiles[0].path), 'changed source asset');
  assert.throws(() => validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot));
});

test('preview permits the next reviewed index bundle filename and rejects foreign script references', () => {
  const f = previewFixture();
  renameSync(join(f.artifact, 'dist/assets/index-ABCDEFGH.js'), join(f.artifact, 'dist/assets/index-IJKLMNOP.js'));
  f.manifest.files.find((x) => x.path === 'dist/assets/index-ABCDEFGH.js').path = 'dist/assets/index-IJKLMNOP.js';
  const indexPath = join(f.artifact, 'dist/index.html');
  let html = readFileSync(indexPath, 'utf8').replace('index-ABCDEFGH.js', 'index-IJKLMNOP.js');
  writeFileSync(indexPath, html); f.manifest.files[0].sha256 = digest(html); f.save();
  assert.equal(validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot), f.readiness.baselineCommit);
  html = html.replace('./assets/index-IJKLMNOP.js', 'https://external.example/app.js');
  writeFileSync(indexPath, html); f.manifest.files[0].sha256 = digest(html); f.save();
  assert.throws(() => validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot));
});
test('preview permits one matching generated stylesheet and rejects an unrelated link', () => {
  const f = previewFixture();
  writeFileSync(join(f.artifact, 'dist/assets/index-ABCDEFGH.css'), 'body{}');
  f.manifest.files.push({path:'dist/assets/index-ABCDEFGH.css',sha256:digest('body{}')});
  const indexPath = join(f.artifact, 'dist/index.html');
  let html = readFileSync(indexPath, 'utf8').replace('</head>', '<link rel="stylesheet" href="./assets/index-ABCDEFGH.css"></head>');
  writeFileSync(indexPath, html); f.manifest.files[0].sha256 = digest(html); f.save();
  assert.equal(validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot), f.readiness.baselineCommit);
  html = html.replace('./assets/index-ABCDEFGH.css', './private.css');
  writeFileSync(indexPath, html); f.manifest.files[0].sha256 = digest(html); f.save();
  assert.throws(() => validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot));
});
test('preview rejects deceptive HTML attributes, duplicate attributes and base redirects', () => {
  for (const transform of [
    (html) => html.replace('src="./assets/index-ABCDEFGH.js"', 'data-src="./assets/index-ABCDEFGH.js" src="https://evil.example/a.js"'),
    (html) => html.replace('type="module"', 'data-type="module" type="text/javascript"'),
    (html) => html.replace('src="./assets/index-ABCDEFGH.js"', 'title=\'src="./assets/index-ABCDEFGH.js"\' src="https://evil.example/a.js"'),
    (html) => html.replace('src="./assets/index-ABCDEFGH.js"', 'src="./assets/index-ABCDEFGH.js" src="https://evil.example/a.js"'),
    (html) => html.replace('<head>', '<head><base href="https://evil.example/">'),
    (html) => html.replace('src="./assets/index-ABCDEFGH.js"', "src='./assets/index-ABCDEFGH.js'"),
    (html) => html.replace('<script', '<SCRIPT'),
    (html) => html.replace('src=', 'SRC='),
    (html) => html.replace('<head>', '<head><BASE HREF="https://evil.example/">'),
  ]) {
    const f = previewFixture(); const indexPath = join(f.artifact, 'dist/index.html');
    const html = transform(readFileSync(indexPath, 'utf8'));
    writeFileSync(indexPath, html); f.manifest.files[0].sha256 = digest(html); f.save();
    assert.throws(() => validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot));
  }
});
test('release packaging rejects a preview-marked index instead of silently claiming release', () => {
  const f = previewFixture();
  assert.throws(() => packageArtifact(f.artifact, join(f.root, 'release-site'), context), /Preview index/);
});

test('exact CI build enables the explicitly labelled diagnostic runtime', () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const build = workflow.jobs['ci-build'].steps.find((step) => step.name === 'Verify');
  assert.equal(build.env.VITE_DIAGNOSTIC_PREVIEW, '1');
});

test('preview rejects a changed diagnostic catalog even when the other visual assets match', () => {
  const f = previewFixture();
  writeFileSync(join(f.publicRoot, 'game-assets/diagnostic-preview-v1/catalog.json'), 'substituted catalog');
  assert.throws(() => validatePreviewReadiness(f.readiness, 'true', context, f.artifact, f.publicRoot), /Public source tree differs/);
});
