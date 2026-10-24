/** Saved diagnostic fixtures only: no original posing, baker invocation or acceptance. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  createMotionCatalog,
  type MotionAsset,
} from '../../src/assets/motionCatalog';
import { durationMs } from '../../src/contracts';
import { localToWorld } from '../../src/world/math';

const directory = 'tests/assets/fixtures/flipping-slash-whole-hand-v1/';
const candidateHash =
  '677852d9f98461a7c72a4cf43761e76c10cfb8cd4def7435ae82bf0392f0ca6c';
interface Candidate {
  status: string;
  evaluationKind: string;
  asset: MotionAsset;
  scalarYawInterpretation: string;
  maximumPositiveEnvelopeExceedanceM: number;
  acceptance: null;
  gameplayAllowance: null;
  sourceAuthoredAnatomy: null;
  probes: {
    atMs: number;
    envelopeResidualM: number;
    rootInterpolationErrorM: number;
  }[];
}
interface Recipe {
  status: string;
  candidateSha256: string;
  source: { sourceSha256: string; manifestSha256: string };
  model: {
    kind: string;
    joints: number[];
    vertexCount: number;
    forearmIncluded: boolean;
  };
  execution: {
    startupUpdates: number;
    sampleUpdates: number;
    attemptedSourceUpdates: number;
  };
  evidence: {
    availability: string;
    cache: { sha256: string; samples: number };
    contacts: {
      sha256: string;
      passedControls: number;
      coreSteps: number;
      contactQueries: number;
      sourceUpdates: number;
    };
  };
  acceptance: null;
  gameplayAllowance: null;
  sourceAuthoredAnatomy: null;
}
const bytes = () => readFileSync(`${directory}candidate.json.fixture`);
const candidate = () => JSON.parse(bytes().toString()) as Candidate;
const recipe = () =>
  JSON.parse(readFileSync(`${directory}recipe.json.fixture`, 'utf8')) as Recipe;

test('saved candidate bytes remain the actual measured diagnostic, never accepted', () => {
  expect(createHash('sha256').update(bytes()).digest('hex')).toBe(
    candidateHash,
  );
  const value = candidate();
  expect(value.status).toBe(
    'MEASURED_DEVELOPER_WHOLE_HAND_CANDIDATE_NOT_ACCEPTED',
  );
  expect(value.evaluationKind).toBe('original-source-diagnostic');
  expect([
    value.acceptance,
    value.gameplayAllowance,
    value.sourceAuthoredAnatomy,
  ]).toEqual([null, null, null]);
});

test('recipe pins whole hand subtree without anatomical or forearm promotion', () => {
  const value = recipe();
  expect(value.status).toBe('measured-diagnostic-only-not-production-accepted');
  expect(value.candidateSha256).toBe(candidateHash);
  expect(value.source).toEqual({
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
  });
  expect(value.model).toEqual({
    kind: 'developer-whole-right-hand-joint-subtree',
    joints: Array.from({ length: 16 }, (_, i) => 29 + i),
    vertexCount: 4223,
    forearmIncluded: false,
  });
  expect([
    value.acceptance,
    value.gameplayAllowance,
    value.sourceAuthoredAnatomy,
  ]).toEqual([null, null, null]);
});

test('saved native flip geometry and full XYZ root produce actual peak height once', () => {
  const value = candidate(),
    time = 977.7777791023254;
  expect(value.asset.definition.rootCurve).toHaveLength(575);
  const root = value.asset.definition.rootCurve.find(
    (key) => key.atMs === time,
  );
  const volume = value.asset.shapes[0]?.keys.find(
    (key) => key.atMs === time,
  )?.volume;
  if (!root || volume?.kind !== 'sphere')
    throw new Error('Missing pinned native peak sphere');
  const world = {
    x: root.position.x + volume.center.x,
    y: root.position.y + volume.center.y,
    z: root.position.z + volume.center.z,
  };
  expect(world.x).toBeCloseTo(-0.35306129906477735, 12);
  expect(world.y).toBeCloseTo(2.6290788863061625, 12);
  expect(world.z).toBeCloseTo(0.5588811455769891, 12);
  expect(root.visualYawRad).toBe(Math.PI);
  expect(localToWorld(world, { x: 1, y: 0, z: 0 })).toEqual({
    x: world.z,
    y: world.y,
    z: -world.x,
  });
  expect(value.scalarYawInterpretation).toBe(
    'Euler-YXZ observation; not arbitrary-axis heading',
  );
});

test('production catalog preserves one authored window with an exclusive end', async () => {
  const value = candidate(),
    catalog = createMotionCatalog(async () => [value.asset]);
  try {
    await catalog.prepare(new AbortController().signal);
    const definition = value.asset.definition;
    expect(definition.impacts).toHaveLength(1);
    const impact = definition.impacts[0];
    if (!impact) throw new Error('Missing source impact');
    expect([impact.startMs, impact.endMs]).toEqual([
      911.1111164093018, 1044.4444417953491,
    ]);
    expect(
      catalog.sampleMotion(
        definition.clipId,
        durationMs(impact.startMs - 0.25),
        impact.startMs,
      )?.hitVolumeSegments,
    ).toHaveLength(0);
    expect(
      catalog.sampleMotion(
        definition.clipId,
        impact.startMs,
        durationMs(impact.startMs + 0.25),
      )?.hitVolumeSegments.length,
    ).toBeGreaterThan(0);
    expect(
      catalog.sampleMotion(
        definition.clipId,
        impact.endMs,
        durationMs(impact.endMs + 0.25),
      )?.hitVolumeSegments,
    ).toHaveLength(0);
  } finally {
    catalog.dispose();
  }
});

test('external local-only evidence records completed bounded evaluations without promising availability', () => {
  const value = recipe();
  expect(value.execution).toEqual({
    startupUpdates: 1,
    sampleUpdates: 686,
    attemptedSourceUpdates: 687,
  });
  expect(value.evidence.availability).toBe(
    'local-only-not-included-not-publicly-available',
  );
  expect(value.evidence.cache).toEqual({
    sha256: '04b77c836fb4b08efea8c1eae3e14658d0260e0c95ccbcbb1bed4d00cc4e5371',
    samples: 686,
  });
  expect(value.evidence.contacts).toEqual({
    sha256: 'ed4b9a4a806fcf8131da21028f6f76e3d4166077b93cd51723fda07fda2210c1',
    passedControls: 12,
    coreSteps: 93,
    contactQueries: 7,
    sourceUpdates: 0,
  });
});

test('positive finite envelope exceedance remains visible and is not a tolerance grant', () => {
  const value = candidate();
  expect(value.probes).toHaveLength(111);
  let maximum = 0;
  for (const probe of value.probes) {
    expect(
      [
        probe.atMs,
        probe.envelopeResidualM,
        probe.rootInterpolationErrorM,
      ].every(Number.isFinite),
    ).toBe(true);
    maximum = Math.max(maximum, probe.envelopeResidualM);
  }
  expect(maximum).toBe(value.maximumPositiveEnvelopeExceedanceM);
  expect(maximum).toBe(0.0008219884506556474);
  expect(value.probes.some((probe) => probe.envelopeResidualM < 0)).toBe(true);
  expect(value.gameplayAllowance).toBeNull();
});
