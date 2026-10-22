import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
const ciPath = '.github/workflows/ci.yml';
const expected = [
  'ci-typecheck',
  'ci-contracts',
  'ci-unit',
  'ci-integration',
  'ci-build',
];
test('CI has stable fail-closed checks, isolated concurrency, evidence and no deployment', () => {
  expect(existsSync(ciPath), 'P0 CI workflow must exist').toBe(true);
  const source = readFileSync(ciPath, 'utf8');
  const workflow = parse(source);
  expect(workflow.on).toHaveProperty('pull_request');
  expect(workflow.on.push.branches).toEqual(['main']);
  expect(workflow.on.pull_request?.paths).toBeUndefined();
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(workflow.concurrency.group).toContain(
    'github.event.pull_request.number',
  );
  expect(workflow.concurrency.group).toContain('github.ref');
  expect(workflow.concurrency['cancel-in-progress']).toBe(true);
  for (const name of expected) {
    expect(workflow.jobs[name].name).toBe(name);
    expect(
      workflow.jobs[name].steps.some((step: { uses?: string }) =>
        step.uses?.startsWith('actions/upload-artifact@'),
      ),
    ).toBe(true);
    const upload = workflow.jobs[name].steps.find((step: { uses?: string }) =>
      step.uses?.startsWith('actions/upload-artifact@'),
    );
    expect(upload.with.name).toContain('github.sha');
    expect(upload.with.name).toContain('github.run_id');
    expect(upload.with.name).toContain('github.run_attempt');
  }
  expect(workflow.jobs['ci-required'].name).toBe('ci-required');
  expect(workflow.jobs['ci-required'].needs).toEqual(expected);
  expect(workflow.jobs['ci-required'].if).toContain('always()');
  expect(source).not.toMatch(
    /secrets\.|deploy-pages|upload-pages-artifact|pages: write|id-token: write/,
  );
});
test('publish boundary cannot deploy or run from push, PR, or CI completion', () => {
  const path = '.github/workflows/publish.yml';
  expect(existsSync(path), 'Disabled publish boundary must exist').toBe(true);
  const workflow = parse(readFileSync(path, 'utf8'));
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  expect(workflow.permissions).toEqual({});
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression.
  expect(workflow.jobs['publish-disabled'].if).toBe('${{ false }}');
  expect(workflow.jobs['publish-disabled'].steps).toEqual([
    {
      run: 'echo "Publishing is disabled. Separate destination and scope approval is required."',
    },
  ]);
});

test('actual workflow programs require complete meaningful reports and exact artifact bytes', async () => {
  const { createHash } = await import('node:crypto');
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { cpSync, mkdtempSync, mkdirSync, writeFileSync } = await import(
    'node:fs'
  );
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const workflow = parse(readFileSync(ciPath, 'utf8'));
  const root = process.cwd();
  const checkedSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const directory = mkdtempSync(join(tmpdir(), 'p0-evidence-'));
  const lock = readFileSync('package-lock.json');
  const environment = {
    ...process.env,
    GITHUB_WORKSPACE: root,
    PR_HEAD_SHA: 'fixture-head',
    BASE_SHA: 'fixture-base',
    PR_NUMBER: '3',
    CI_RUN_ID: '123',
    CI_RUN_ATTEMPT: '1',
  };
  const execute = (
    script: string,
    cwd: string,
    extra: Record<string, string>,
  ) =>
    spawnSync('bash', ['-e', '-c', script], {
      cwd,
      env: { ...environment, ...extra },
      encoding: 'utf8',
    });
  // Real Vitest reporters, never hand-fabricated successful JSON/XML fixtures.
  function reportSuite(mode: 'passed' | 'skipped' | 'todo') {
    const suite = join(directory, `suite-${mode}`);
    mkdirSync(join(suite, 'tests'), { recursive: true });
    writeFileSync(
      join(suite, 'vitest.config.mjs'),
      "export default { test: { include: ['tests/*.test.ts'], passWithNoTests: false } };\n",
    );
    const body =
      mode === 'passed'
        ? "test('reporter fixture', () => expect(1).toBe(1));"
        : mode === 'skipped'
          ? "test.skip('reporter fixture', () => expect(1).toBe(1));"
          : "test.todo('reporter fixture');";
    writeFileSync(
      join(suite, 'tests', 'reporter.test.ts'),
      `import { test, expect } from '${root}/node_modules/vitest/dist/index.js';\n${body}\n`,
    );
    const args = [
      'run',
      'test:unit',
      '--',
      '--root',
      suite,
      '--config',
      join(suite, 'vitest.config.mjs'),
      '--reporter=json',
      '--reporter=junit',
      `--outputFile.json=${join(suite, 'report.json')}`,
      `--outputFile.junit=${join(suite, 'report.xml')}`,
    ];
    const result = spawnSync('npm', args, {
      cwd: root,
      env: environment,
      encoding: 'utf8',
    });
    console.info(
      `$ npm ${args.join(' ')}\n${result.stdout}${result.stderr}\nEXIT CODE: ${result.status}`,
    );
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(join(suite, 'report.json'), 'utf8'));
    if (mode === 'passed') expect(report.numPassedTests).toBe(1);
    else {
      expect(report.numPassedTests).toBe(0);
      expect(
        mode === 'todo' ? report.numTodoTests : report.numPendingTests,
      ).toBeGreaterThan(0);
    }
    return suite;
  }
  const passed = reportSuite('passed');
  const skipped = reportSuite('skipped');
  const todo = reportSuite('todo');
  const verifyScript = workflow.jobs['ci-required'].steps.at(-1).run;
  const needs = Object.fromEntries(
    expected.map((name) => [name, { result: 'success' }]),
  );
  function createEvidence(
    label: string,
    variant: 'normal' | 'omitted' | 'skipped' | 'todo' = 'normal',
  ) {
    const destination = join(directory, label);
    mkdirSync(destination);
    writeFileSync(join(destination, 'package-lock.json'), lock);
    for (const name of expected) {
      const kind = name.slice(3);
      const producer = join(destination, 'producer', name);
      mkdirSync(join(producer, 'reports'), { recursive: true });
      writeFileSync(join(producer, 'package-lock.json'), lock);
      writeFileSync(
        join(producer, 'reports', `${kind}.log`),
        'synthetic pipeline check log\n',
      );
      if (
        ['contracts', 'unit', 'integration'].includes(kind) &&
        !(name === 'ci-contracts' && variant === 'omitted')
      ) {
        const source =
          name === 'ci-unit' && variant === 'skipped'
            ? skipped
            : name === 'ci-unit' && variant === 'todo'
              ? todo
              : passed;
        cpSync(
          join(source, 'report.json'),
          join(producer, 'reports', `${kind}.json`),
        );
        cpSync(
          join(source, 'report.xml'),
          join(producer, 'reports', `${kind}.xml`),
        );
      }
      if (name === 'ci-build') {
        mkdirSync(join(producer, 'dist'));
        writeFileSync(
          join(producer, 'dist', 'index.html'),
          '<html lang="ja"></html>',
        );
      }
      const script = workflow.jobs[name].steps.find(
        (step: { name?: string }) => step.name === 'Record exact-SHA evidence',
      ).run;
      const result = execute(script, producer, {
        CHECK_NAME: name,
        CHECK_RESULT: 'success',
      });
      expect(result.status, result.stderr).toBe(0);
      const upload = workflow.jobs[name].steps.find((step: { uses?: string }) =>
        step.uses?.startsWith('actions/upload-artifact@'),
      );
      const uploadPaths = String(upload.with.path).trim().split(/\s+/);
      expect(uploadPaths).toEqual(['ci-evidence/']);
      const uploadPath = uploadPaths[0];
      if (!uploadPath) throw new Error('Expected exactly one upload root');
      const target = join(
        destination,
        'evidence',
        `${name}-${checkedSha}-123-1`,
      );
      cpSync(join(producer, uploadPath), target, { recursive: true });
      const manifest = JSON.parse(
        readFileSync(join(target, 'reports', 'manifest.json'), 'utf8'),
      );
      expect(manifest.prNumber).toBe(3);
      expect(manifest.checkedSha).toBe(checkedSha);
      expect(manifest.prHeadSha).toBe('fixture-head');
      expect(manifest.lockfileSha256).toBe(
        createHash('sha256').update(lock).digest('hex'),
      );
      expect(manifest.p1BaseMainSha).toBeNull();
    }
    return destination;
  }
  const normal = createEvidence('normal');
  const check = (destination: string, changes: Record<string, string> = {}) =>
    execute(verifyScript, destination, {
      NEEDS_JSON: JSON.stringify(needs),
      ...changes,
    });
  expect(check(normal).status).toBe(0);
  expect(check(normal, { CI_RUN_ATTEMPT: '2' }).status).toBe(0);
  for (const result of ['failure', 'skipped', 'cancelled'])
    expect(
      check(normal, {
        NEEDS_JSON: JSON.stringify({ ...needs, 'ci-contracts': { result } }),
      }).status,
    ).not.toBe(0);
  expect(check(normal, { PR_HEAD_SHA: 'stale-head' }).status).not.toBe(0);
  for (const variant of ['omitted', 'skipped', 'todo'] as const)
    expect(
      check(createEvidence(variant, variant)).status,
      `${variant} reports must not be accepted`,
    ).not.toBe(0);
  // Hash consistency alone cannot excuse an empty required file or an omitted manifest entry.
  const unit = join(normal, 'evidence', `ci-unit-${checkedSha}-123-1`);
  const manifestPath = join(unit, 'reports', 'manifest.json');
  const original = readFileSync(manifestPath, 'utf8');
  const omission = JSON.parse(original);
  omission.files = omission.files.filter(
    (file: { path: string }) => file.path !== 'reports/unit.xml',
  );
  writeFileSync(manifestPath, JSON.stringify(omission));
  expect(check(normal).status).not.toBe(0);
  writeFileSync(manifestPath, original);
  const xmlPath = join(unit, 'reports', 'unit.xml');
  const xml = readFileSync(xmlPath);
  writeFileSync(xmlPath, '');
  const empty = JSON.parse(original);
  const entry = empty.files.find(
    (file: { path: string }) => file.path === 'reports/unit.xml',
  );
  if (!entry) throw new Error('Missing XML entry');
  entry.sha256 = createHash('sha256').update('').digest('hex');
  writeFileSync(manifestPath, JSON.stringify(empty));
  expect(check(normal).status).not.toBe(0);
  writeFileSync(xmlPath, xml);
  writeFileSync(manifestPath, original);
  const buildPath = join(
    normal,
    'evidence',
    `ci-build-${checkedSha}-123-1`,
    'dist',
    'index.html',
  );
  const build = readFileSync(buildPath);
  writeFileSync(buildPath, 'tampered build');
  expect(check(normal).status).not.toBe(0);
  writeFileSync(buildPath, build);
  expect(check(normal).status).toBe(0);
  writeFileSync(join(unit, 'reports', 'unlisted.log'), 'not in manifest');
  expect(check(normal).status).not.toBe(0);
}, 30_000);
