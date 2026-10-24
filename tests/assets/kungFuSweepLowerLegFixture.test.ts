/** Saved diagnostic data only: no source posing or contact rerun. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  createMotionCatalog,
  type MotionAsset,
} from '../../src/assets/motionCatalog';
import { durationMs } from '../../src/contracts';
import { localToWorld } from '../../src/world/math';
import type { readKungFuSweepLowerLegCandidate } from '../../tools/assets/kungFuSweepLowerLegCandidate';
const directory = 'tests/assets/fixtures/kungfu-sweep-lowerleg-capsule-v1/';
const hash = '65e9159f2c2977e75f56e41e8b5af23ff7f002df2cfc9955e9df9e8122d212be';
interface Candidate {
  asset: MotionAsset;
  candidate: ReturnType<typeof readKungFuSweepLowerLegCandidate>;
  surfaceSelections: unknown[];
  evaluationKind: string;
  acceptance: null;
  gameplayAllowance: null;
}
interface Recipe {
  status: string;
  candidateSha256: string;
  source: { sourceSha256: string; manifestSha256: string };
  model: Candidate['candidate']['model'];
  rootPolicy: string;
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
  residual: {
    probeCount: number;
    sourceCalls: number;
    maximumWorld: { worldContainmentResidualM: number };
    paddingAppliedM: number;
    acceptance: null;
    probes: unknown[];
  };
  acceptance: null;
  gameplayAllowance: null;
  sourceAuthoredAnatomy: null;
}
const bytes = () => readFileSync(`${directory}candidate.json.fixture`);
const candidate = () => JSON.parse(bytes().toString()) as Candidate;
const recipe = () =>
  JSON.parse(readFileSync(`${directory}recipe.json.fixture`, 'utf8')) as Recipe;
test('saved bytes and genuine lowerleg capsule remain unaccepted', () => {
  expect(createHash('sha256').update(bytes()).digest('hex')).toBe(hash);
  expect(bytes()).toHaveLength(433529);
  const c = candidate();
  expect(c.asset.shapes).toHaveLength(1);
  expect(c.asset.shapes[0]?.keys).toHaveLength(493);
  for (const k of c.asset.shapes[0]?.keys ?? []) {
    if (k.volume.kind !== 'capsule') throw Error('Expected capsule');
    expect(
      Math.hypot(
        k.volume.start.x - k.volume.end.x,
        k.volume.start.y - k.volume.end.y,
        k.volume.start.z - k.volume.end.z,
      ),
    ).toBeGreaterThan(0.4);
    expect(k.volume.radiusM).toBe(0.08922894361606443);
  }
  expect(c.surfaceSelections).toEqual([]);
  expect([c.acceptance, c.gameplayAllowance]).toEqual([null, null]);
  expect(c.evaluationKind).toBe('original-source-diagnostic');
});
test('recipe pins nine-pose lowerleg approximation without foot or toe admission', () => {
  const r = recipe();
  expect(r.candidateSha256).toBe(hash);
  expect(r.status).toBe('measured-diagnostic-only-not-production-accepted');
  expect(r.source).toEqual({
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
  });
  expect(r.model).toEqual(candidate().candidate.model);
  expect([r.model.startBone, r.model.endBone]).toEqual(['shin.R', 'foot.R']);
  expect(r.model.observedPoseCount).toBe(9);
  expect([r.model.includesFoot, r.model.includesToe]).toEqual([false, false]);
  expect(r.model.paddingM).toBe(0);
  expect([
    r.acceptance,
    r.gameplayAllowance,
    r.sourceAuthoredAnatomy,
    r.model.allNativeGeometryCoverage,
  ]).toEqual([null, null, null, null]);
});
test('native peak endpoints retain translated root and visual rotation only once', () => {
  const c = candidate(),
    at = 777.7777314186096,
    root = c.asset.definition.rootCurve.find((k) => k.atMs === at),
    v = c.asset.shapes[0]?.keys.find((k) => k.atMs === at)?.volume;
  if (!root || v?.kind !== 'capsule') throw Error('Missing native peak');
  expect(root.position).toEqual({
    x: 0.25059372186660767,
    y: -0.49500010162591934,
    z: -0.060768723487854004,
  });
  const world = [v.start, v.end].map((p) => ({
    x: p.x + root.position.x,
    y: p.y + root.position.y,
    z: p.z + root.position.z,
  }));
  expect(world[0]).toEqual({
    x: -0.16837596425329826,
    y: 0.37142276474026203,
    z: 0.3981280693504323,
  });
  expect(world[1]).toEqual({
    x: -0.5210474006259453,
    y: 0.22299954111030496,
    z: 0.6297069039500598,
  });
  for (const p of world)
    expect(localToWorld(p, { x: 1, y: 0, z: 0 })).toEqual({
      x: p.z,
      y: p.y,
      z: -p.x,
    });
  expect(root.visualYawRad).toBe(0.700000307930195);
  expect(c.asset.definition.rootCurve.at(-1)?.visualYawRad).toBe(
    2.4000001773407424,
  );
});
test('catalog preserves the single start-inclusive end-exclusive window', async () => {
  const c = candidate(),
    catalog = createMotionCatalog(async () => [c.asset]);
  try {
    await catalog.prepare(new AbortController().signal);
    const d = c.asset.definition;
    expect(d.impacts).toHaveLength(1);
    const i = d.impacts[0];
    if (!i) throw Error('Missing impact');
    expect([i.startMs, i.endMs]).toEqual([577.7778029441833, 1000]);
    expect(
      catalog.sampleMotion(d.clipId, durationMs(i.startMs - 0.25), i.startMs)
        ?.hitVolumeSegments,
    ).toHaveLength(0);
    expect(
      catalog.sampleMotion(d.clipId, i.startMs, durationMs(i.startMs + 0.25))
        ?.hitVolumeSegments.length,
    ).toBeGreaterThan(0);
    expect(
      catalog.sampleMotion(d.clipId, i.endMs, durationMs(i.endMs + 0.25))
        ?.hitVolumeSegments,
    ).toHaveLength(0);
  } finally {
    catalog.dispose();
  }
});
test('finite native and 240Hz schedule and local evidence are explicit', () => {
  const c = candidate(),
    s = c.candidate.schedule,
    r = recipe();
  expect(c.candidate.sourceTimesSeconds).toHaveLength(78);
  expect(s.sampleRateHz).toBe(240);
  expect(s.baseKeysMs).toHaveLength(493);
  expect(s.probeKeysMs).toHaveLength(360);
  expect(s.sampleKeysMs).toHaveLength(853);
  expect(s.maximumSourceUpdates).toBe(854);
  expect(r.execution).toEqual({
    startupUpdates: 1,
    sampleUpdates: 853,
    attemptedSourceUpdates: 854,
  });
  expect(r.evidence.availability).toBe(
    'local-only-not-included-not-publicly-available',
  );
  expect(r.evidence.cache.samples).toBe(853);
  expect(r.evidence.contacts).toEqual({
    sha256: '5f9557189ab5a8a4a5f5d2250e5dc44b82694777592357c716d2748d1d73dee3',
    passedControls: 12,
    coreSteps: 59,
    contactQueries: 7,
    sourceUpdates: 0,
  });
});
test('positive residual is preserved and is not a tolerance grant', () => {
  const r = recipe();
  expect(r.residual.probeCount).toBe(360);
  expect(r.residual.probes).toHaveLength(360);
  expect(r.residual.sourceCalls).toBe(0);
  expect(r.residual.paddingAppliedM).toBe(0);
  expect(r.residual.acceptance).toBeNull();
  expect(r.residual.maximumWorld.worldContainmentResidualM).toBe(
    0.00021062882054900714,
  );
  expect(r.gameplayAllowance).toBeNull();
});
