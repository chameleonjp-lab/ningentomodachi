import { requireValue } from '../../src/core/invariant';
import { expect, test } from 'vitest';
import { clipId } from '../../src/contracts';
import type {
  FightingActualRecipeGeometrySample,
  FightingGeometryManifestContext,
  FightingGeometrySourcePin,
} from '../../src/contracts/fighting';
import * as hold from '../../src/assets/fightingAssetPack';
// Structural fixtures only: these do not authenticate real source geometry.
function fixture() {
  const clip = clipId('structural-ready');
  const source: FightingGeometrySourcePin = {
    sourceBindingId: 'structural-source',
    clipId: clip,
    durationMs: 1000,
    rootPolicy: 'grounded-posture-y',
    provenance: {
      sourceSha256: '1'.repeat(64),
      evaluatorSha256: '2'.repeat(64),
      calibrationSha256: '3'.repeat(64),
      mappingSha256: '4'.repeat(64),
      sourceClosureSha256: '5'.repeat(64),
      qualificationEvidenceSha256: '6'.repeat(64),
    },
    poseNames: Array.from({ length: 53 }, (_, i) => `structural-bone:${i}`),
    primitives: [{ primitive: 0, vertexCount: 2 }],
    soles: (
      [
        { side: 'L', vertex: 0 },
        { side: 'R', vertex: 1 },
      ] as const
    ).map((s) => ({
      side: s.side,
      surfaceId: `structural-sole:${s.side}`,
      sourceBindingId: 'structural-source',
      members: [{ primitive: 0, vertexIndex: s.vertex }],
    })),
    shapeIds: [],
  };
  const manifestContext: FightingGeometryManifestContext = {
    bindingSetId: 'structural-preparation',
    sourcePins: [structuredClone(source)],
    limits: {
      maxSources: 1,
      maxVariants: 1,
      maxPrimitivesPerSource: 1,
      maxSolePoints: 1,
      maxShapes: 0,
      maxImpacts: 0,
    },
  };
  const geometryManifest = {
    schema: 'actual-geometry-manifest-v1' as const,
    bindingSetId: manifestContext.bindingSetId,
    sources: [source],
    variants: [
      {
        geometryBindingId: 'structural-ready-variant',
        sourceBindingId: source.sourceBindingId,
        clipId: clip,
        phase: 'neutral' as const,
        posture: 'standing' as const,
        coverage: { kind: 'finite' as const, fromMs: 0 as const, toMs: 1000 },
      },
    ],
  };
  const query = {
    clipId: clip,
    phase: 'neutral' as const,
    posture: 'standing' as const,
    atMs: 0,
    acceptedRoot: { x: 0, z: 0 },
    groundClearanceM: 0,
  };
  const expectation = {
    selectedGeometryBindingId: 'structural-ready-variant',
    impacts: [],
    expectedHurtProxy: {
      kind: 'posture-capsule-proxy-v1' as const,
      posture: 'standing' as const,
      volume: {
        kind: 'capsule' as const,
        start: { x: 0, y: 0.35, z: 0 },
        end: { x: 0, y: 1.5, z: 0 },
        radiusM: 0.35,
      },
    },
  };
  const sample: FightingActualRecipeGeometrySample = {
    recipeVersion: 'actual53-ik-surface-v1',
    clipId: clip,
    atMs: 0,
    pose: source.poseNames.map((name) => ({
      name,
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    })),
    support: (['L', 'R'] as const).map((side) => ({
      side,
      planted: true,
      local: [0, 0, 0],
      worldRotation: [0, 0, 0, 1],
      desiredWorld: [0, 0, 0],
      errorM: 0,
      world: [0, 0, 0],
    })),
    durationMs: 1000,
    active: false,
    intendedRoot: { x: 0, y: 0, z: 0 },
    acceptedRoot: { x: 0, y: 0, z: 0 },
    shape: null,
    geometryProtocol: 'actual-geometry-v1',
    geometryBindingId: expectation.selectedGeometryBindingId,
    soles: source.soles.map((s) => ({
      side: s.side,
      surfaceId: s.surfaceId,
      points: s.members.map((m) => ({ ...m, local: { x: 0, y: 0, z: 0 } })),
      normal: { x: 0, y: -1, z: 0 },
    })),
    hurt: structuredClone(expectation.expectedHurtProxy),
    hitShapes: [],
  };
  return {
    sample,
    context: {
      query,
      manifest: geometryManifest,
      manifestContext,
      ...expectation,
      normalLengthTolerance: 0.000001,
    },
  };
}

const identity = () => ({
  runId: 'run',
  actorId: 'actor',
  epochId: 'epoch',
  holdId: 'hold',
  facingBasis: { x: 0, y: 0, z: 1 },
  maxQueries: 3,
  maxDataNodes: 20000,
});
const request = () => ({
  runId: 'run',
  actorId: 'actor',
  epochId: 'epoch',
  holdId: 'hold',
  geometryBindingId: 'structural-ready-variant',
  fromU: 0,
  toU: 1,
  motionMs: 0,
  acceptedRoot: { x: 0, z: 0 },
  groundClearanceM: 0,
  facingBasis: { x: 0, y: 0, z: 1 },
});
test('exports captured constant hold without production qualification', () => {
  expect(hold.captureFightingReadyHold).toBeTypeOf('function');
  const f = fixture();
  const resource = hold.captureFightingReadyHold(
    f.sample,
    f.context,
    identity(),
  );
  const result = resource.interval(request());
  expect(result.kind).toBe('covered');
  if (result.kind !== 'covered') throw Error('expected coverage');
  expect(result.sample).toEqual(f.sample);
  expect(result.derivative).toBe(0);
  expect(result.completeGeometry).toBe(false);
  expect(result.productionQualified).toBe(false);
  expect(result.request).toEqual(request());
  expect(result.query).toEqual(f.context.query);
  expect(Reflect.set(requireValue(f.sample.pose[0]).position, '0', 99)).toBe(
    true,
  );
  expect(requireValue(f.sample.pose[0]).position[0]).toBe(99);
  expect(requireValue(result.sample.pose[0]).position[0]).toBe(0);
  expect(Object.isFrozen(result.sample.pose)).toBe(true);
});
test.each([
  'motionMs',
  'groundClearanceM',
  'holdId',
  'epochId',
  'actorId',
  'runId',
  'geometryBindingId',
  'toU',
])('rejects foreign or unsupported %s', (key) => {
  const f = fixture();
  const r = hold.captureFightingReadyHold(f.sample, f.context, identity());
  const q = {
    ...request(),
    [key]:
      typeof request()[key as keyof ReturnType<typeof request>] === 'number'
        ? 2
        : 'foreign',
  };
  expect(r.interval(q).kind).toBe('unqualified');
  expect(r.interval(request()).kind).toBe('covered');
});
test('rejects changing root, facing, accessors and fields without evaluating getters', () => {
  const f = fixture(),
    r = hold.captureFightingReadyHold(f.sample, f.context, {
      ...identity(),
      maxQueries: 8,
    });
  for (const q of [
    { ...request(), acceptedRoot: { x: 1, z: 0 } },
    { ...request(), facingBasis: { x: 1, y: 0, z: 0 } },
    { ...request(), extra: 1 },
  ])
    expect(r.interval(q).kind).toBe('unqualified');
  let calls = 0;
  const q = { ...request() };
  Object.defineProperty(q, 'motionMs', {
    get() {
      calls++;
      return 0;
    },
  });
  expect(r.interval(q).kind).toBe('unqualified');
  expect(calls).toBe(0);
});
test('budget and disposal cannot mutate captured result', () => {
  const f = fixture(),
    r = hold.captureFightingReadyHold(f.sample, f.context, {
      ...identity(),
      maxQueries: 1,
    });
  const first = r.interval(request());
  expect(first.kind).toBe('covered');
  expect(r.interval(request())).toEqual({
    kind: 'unqualified',
    reason: 'work-budget',
  });
  r.dispose();
  expect(r.interval(request())).toEqual({
    kind: 'unqualified',
    reason: 'disposed',
  });
  expect(first.kind).toBe('covered');
});
test('rejects attack/incoming and malformed source before creating a hold', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      Object.assign(f.sample, { active: true });
    },
    (f: ReturnType<typeof fixture>) => {
      (requireValue(f.sample.soles[0]).points as unknown[]).pop();
    },
    (f: ReturnType<typeof fixture>) => {
      f.context.query.phase = 'attack' as never;
    },
  ]) {
    const f = fixture();
    mutate(f);
    expect(() =>
      hold.captureFightingReadyHold(f.sample, f.context, identity()),
    ).toThrow();
  }
});

test('deep plain input fails closed rather than overflowing the JS stack', () => {
  const f = fixture();
  const r = hold.captureFightingReadyHold(f.sample, f.context, identity());
  let deep: object = {};
  for (let i = 0; i < 10000; i++) deep = { nested: deep };
  expect(r.interval({ ...request(), acceptedRoot: deep })).toEqual({
    kind: 'unqualified',
    reason: 'invalid-input',
  });
  expect(r.interval(request()).kind).toBe('covered');
});
