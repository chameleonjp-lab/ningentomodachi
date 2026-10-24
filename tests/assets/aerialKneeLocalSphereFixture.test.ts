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

const directory = 'tests/assets/fixtures/aerial-knee-local-sphere-v1/';
const candidateHash =
  'a79e96b51a7795782fbd0eee074ee42c088a2aa418e4335706fa72d162c84fd5';
interface Candidate {
  status: string;
  evaluationKind: string;
  asset: MotionAsset;
  surfaceSelections: unknown[];
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
    origin: string;
    bone: string;
    radiusM: number;
    addedPaddingM: number;
    evidence: { vertexIds: number[]; skinJoint: number };
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
  rootTransformRequirement: {
    translationAxes: string[];
    rootQuaternionEndpoints: number[][];
    pelvisLocalRotation: string;
    preserveAllAnimationChannels: boolean;
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
  expect(bytes()).toHaveLength(365073);
  const value = candidate();
  expect(value.surfaceSelections).toEqual([]);
  expect(value.asset.shapes).toHaveLength(1);
  for (const key of value.asset.shapes[0]?.keys ?? []) {
    expect(key.volume.kind).toBe('sphere');
    expect(key.volume.radiusM).toBe(0.08590102228100256);
  }
  expect(value.status).toBe(
    'MEASURED_DEVELOPER_KNEE_LOCAL_SPHERE_CANDIDATE_NOT_ACCEPTED',
  );
  expect(value.evaluationKind).toBe('original-source-diagnostic');
  expect([
    value.acceptance,
    value.gameplayAllowance,
    value.sourceAuthoredAnatomy,
  ]).toEqual([null, null, null]);
});

test('recipe pins knee-origin approximation without whole-shin or foot substitution', () => {
  const value = recipe();
  expect(value.status).toBe('measured-diagnostic-only-not-production-accepted');
  expect(value.candidateSha256).toBe(candidateHash);
  expect(value.source).toEqual({
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
  });
  expect(value.model.origin).toBe('developer-selected-collision-model');
  expect(value.model.bone).toBe('shin.R');
  expect(value.model.radiusM).toBe(0.08590102228100256);
  expect(value.model.addedPaddingM).toBe(0);
  expect(value.model.evidence.vertexIds).toEqual([10926, 11012, 11008]);
  expect(value.model.evidence.skinJoint).toBe(50);
  expect([
    value.acceptance,
    value.gameplayAllowance,
    value.sourceAuthoredAnatomy,
  ]).toEqual([null, null, null]);
});

test('saved native AerialKnee geometry and full XYZ root produce actual peak height once', () => {
  const value = candidate(),
    time = 644.4444060325623;
  expect(value.asset.definition.rootCurve).toHaveLength(418);
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
  expect(world.x).toBeCloseTo(-0.16383218951472517, 12);
  expect(world.y).toBeCloseTo(1.4375736581588328, 12);
  expect(world.z).toBeCloseTo(0.8647865152000997, 12);
  expect(root.visualYawRad).toBe(0);
  const requirement = recipe().rootTransformRequirement;
  expect(requirement.translationAxes).toEqual(['x', 'y', 'z']);
  expect(requirement.rootQuaternionEndpoints).toEqual([
    [0, 0, 0, 1],
    [0, 0, 0, 1],
  ]);
  expect(requirement.pelvisLocalRotation).toBe(
    'authored-identity-STEP-two-endpoints-accessor-198',
  );
  expect(requirement.preserveAllAnimationChannels).toBe(true);
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
      577.7778029441833, 711.1111283302307,
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
    sampleUpdates: 532,
    attemptedSourceUpdates: 533,
  });
  expect(value.evidence.availability).toBe(
    'local-only-not-included-not-publicly-available',
  );
  expect(value.evidence.cache).toEqual({
    sha256: '47569e6a78b7a153d9304227035ea3fa6c9393773488bf3c977cf2c0fa64ef24',
    samples: 532,
  });
  expect(value.evidence.contacts).toEqual({
    sha256: '2b84ef8014bb94dda674a5ec84b1f9a8af0379caa1989f0ba00115fd1de7e0b2',
    passedControls: 12,
    coreSteps: 59,
    contactQueries: 7,
    sourceUpdates: 0,
  });
});

test('positive finite envelope exceedance remains visible and is not a tolerance grant', () => {
  const value = candidate();
  expect(value.probes).toHaveLength(114);
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
  expect(maximum).toBe(6.077060893255881e-7);
  expect(value.probes.some((probe) => probe.envelopeResidualM > 0)).toBe(true);
  expect(value.gameplayAllowance).toBeNull();
});
