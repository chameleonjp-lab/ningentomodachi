import { FIGHTING_READY_REALIZATION as readyRecipe } from '../../src/assets/fightingMotionRecipes';
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

// Real source archive points: independent expected output, never runtime sampler input.
const readyExpectedSoles = [
  {
    side: 'L',
    surfaceId: 'r2.source.sole36.L',
    normal: [-1.7919725952441274e-8, -0.999999999999838, 6.948567933892107e-11],
    points: [
      {
        primitive: 1,
        vertexIndex: 1787,
        local: [
          0.11802952735350261, -3.2913385640542803e-7, 0.08399965680486783,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1788,
        local: [
          0.11802952735350261, -3.2913385640542803e-7, 0.08399965680486783,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1789,
        local: [
          0.11802952735350261, -3.2913385640542803e-7, 0.08399965680486783,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1790,
        local: [
          0.11802952735350261, -3.2913385640542803e-7, 0.08399965680486783,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1791,
        local: [
          0.11802952735350261, -3.2913385640542803e-7, 0.08399965680486783,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1796,
        local: [
          0.12033123015157783, -1.6439403653645268e-7, 0.31999953660437014,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1797,
        local: [
          0.12033123015157783, -1.6439403653645268e-7, 0.31999953660437014,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1798,
        local: [
          0.12033123015157783, -1.6439403653645268e-7, 0.31999953660437014,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1799,
        local: [
          0.12033123015157783, -1.6439403653645268e-7, 0.31999953660437014,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1866,
        local: [
          0.22997071731311525, -3.3343838212393506e-7, 0.08399975131235585,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1867,
        local: [
          0.22997071731311525, -3.3343838212393506e-7, 0.08399975131235585,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1868,
        local: [
          0.22997071731311525, -3.3343838212393506e-7, 0.08399975131235585,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1869,
        local: [
          0.22997071731311525, -3.3343838212393506e-7, 0.08399975131235585,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1870,
        local: [
          0.22997071731311525, -3.3343838212393506e-7, 0.08399975131235585,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1877,
        local: [0.22766942962241804, -1.685215613549118e-7, 0.3199996272257366],
      },
      {
        primitive: 1,
        vertexIndex: 1878,
        local: [0.22766942962241804, -1.685215613549118e-7, 0.3199996272257366],
      },
      {
        primitive: 1,
        vertexIndex: 1879,
        local: [0.22766942962241804, -1.685215613549118e-7, 0.3199996272257366],
      },
      {
        primitive: 1,
        vertexIndex: 1880,
        local: [0.22766942962241804, -1.685215613549118e-7, 0.3199996272257366],
      },
      {
        primitive: 1,
        vertexIndex: 1957,
        local: [
          0.11879345634856989, -1.6956001777299057e-7, 0.3239995535372535,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1958,
        local: [
          0.11879345634856989, -1.6956001777299057e-7, 0.3239995535372535,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1959,
        local: [
          0.11879345634856989, -1.6956001777299057e-7, 0.3239995535372535,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1960,
        local: [
          0.11879345634856989, -1.6956001777299057e-7, 0.3239995535372535,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 1966,
        local: [0.1284945019256268, -1.108501008935392e-7, 0.41099950629740145],
      },
      {
        primitive: 1,
        vertexIndex: 1967,
        local: [0.1284945019256268, -1.108501008935392e-7, 0.41099950629740145],
      },
      {
        primitive: 1,
        vertexIndex: 1968,
        local: [0.1284945019256268, -1.108501008935392e-7, 0.41099950629740145],
      },
      {
        primitive: 1,
        vertexIndex: 1969,
        local: [0.1284945019256268, -1.108501008935392e-7, 0.41099950629740145],
      },
      {
        primitive: 1,
        vertexIndex: 1970,
        local: [0.1284945019256268, -1.108501008935392e-7, 0.41099950629740145],
      },
      {
        primitive: 1,
        vertexIndex: 2025,
        local: [
          0.22920720296442487, -1.7380580167800086e-7, 0.3239996467551637,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2026,
        local: [
          0.22920720296442487, -1.7380580167800086e-7, 0.3239996467551637,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2027,
        local: [
          0.22920720296442487, -1.7380580167800086e-7, 0.3239996467551637,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2028,
        local: [
          0.22920720296442487, -1.7380580167800086e-7, 0.3239996467551637,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2035,
        local: [
          0.21950631316084357, -1.1434981442640102e-7, 0.4109995831350336,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2036,
        local: [
          0.21950631316084357, -1.1434981442640102e-7, 0.4109995831350336,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2037,
        local: [
          0.21950631316084357, -1.1434981442640102e-7, 0.4109995831350336,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2038,
        local: [
          0.21950631316084357, -1.1434981442640102e-7, 0.4109995831350336,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2039,
        local: [
          0.21950631316084357, -1.1434981442640102e-7, 0.4109995831350336,
        ],
      },
    ],
  },
  {
    side: 'R',
    surfaceId: 'r2.source.sole36.R',
    normal: [1.161126754730793e-8, -0.9999999999997379, 7.251015140838661e-11],
    points: [
      {
        primitive: 1,
        vertexIndex: 2656,
        local: [
          -0.22997041502139004, -1.6007761382760832e-7, -0.2660002845949279,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2657,
        local: [
          -0.22997041502139004, -1.6007761382760832e-7, -0.2660002845949279,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2658,
        local: [
          -0.22997041502139004, -1.6007761382760832e-7, -0.2660002845949279,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2659,
        local: [
          -0.22997041502139004, -1.6007761382760832e-7, -0.2660002845949279,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2660,
        local: [
          -0.22997041502139004, -1.6007761382760832e-7, -0.2660002845949279,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2665,
        local: [
          -0.2276691331998868, -5.022655881134486e-8, -0.030000324658434607,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2666,
        local: [
          -0.2276691331998868, -5.022655881134486e-8, -0.030000324658434607,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2667,
        local: [
          -0.2276691331998868, -5.022655881134486e-8, -0.030000324658434607,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2668,
        local: [
          -0.2276691331998868, -5.022655881134486e-8, -0.030000324658434607,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2735,
        local: [
          -0.11802922506177245, -1.5647115497036124e-7, -0.26600037945905936,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2736,
        local: [
          -0.11802922506177245, -1.5647115497036124e-7, -0.26600037945905936,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2737,
        local: [
          -0.11802922506177245, -1.5647115497036124e-7, -0.26600037945905936,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2738,
        local: [
          -0.11802922506177245, -1.5647115497036124e-7, -0.26600037945905936,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2739,
        local: [
          -0.11802922506177245, -1.5647115497036124e-7, -0.26600037945905936,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2746,
        local: [
          -0.12033093372904187, -4.676839653397491e-8, -0.030000415621779464,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2747,
        local: [
          -0.12033093372904187, -4.676839653397491e-8, -0.030000415621779464,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2748,
        local: [
          -0.12033093372904187, -4.676839653397491e-8, -0.030000415621779464,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2749,
        local: [
          -0.12033093372904187, -4.676839653397491e-8, -0.030000415621779464,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2826,
        local: [
          -0.22920690664137197, -5.6434286251072496e-8, -0.02600030369985426,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2827,
        local: [
          -0.22920690664137197, -5.6434286251072496e-8, -0.02600030369985426,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2828,
        local: [
          -0.22920690664137197, -5.6434286251072496e-8, -0.02600030369985426,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2829,
        local: [
          -0.22920690664137197, -5.6434286251072496e-8, -0.02600030369985426,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2835,
        local: [
          -0.21950601900143352, -1.7333168372823948e-8, 0.06099966362643022,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2836,
        local: [
          -0.21950601900143352, -1.7333168372823948e-8, 0.06099966362643022,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2837,
        local: [
          -0.21950601900143352, -1.7333168372823948e-8, 0.06099966362643022,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2838,
        local: [
          -0.21950601900143352, -1.7333168372823948e-8, 0.06099966362643022,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2839,
        local: [
          -0.21950601900143352, -1.7333168372823948e-8, 0.06099966362643022,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2894,
        local: [
          -0.11879316002551213, -5.287704404194349e-8, -0.02600039726954148,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2895,
        local: [
          -0.11879316002551213, -5.287704404194349e-8, -0.02600039726954148,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2896,
        local: [
          -0.11879316002551213, -5.287704404194349e-8, -0.02600039726954148,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2897,
        local: [
          -0.11879316002551213, -5.287704404194349e-8, -0.02600039726954148,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2904,
        local: [
          -0.12849420776621276, -1.4401005790642962e-8, 0.06099958649883541,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2905,
        local: [
          -0.12849420776621276, -1.4401005790642962e-8, 0.06099958649883541,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2906,
        local: [
          -0.12849420776621276, -1.4401005790642962e-8, 0.06099958649883541,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2907,
        local: [
          -0.12849420776621276, -1.4401005790642962e-8, 0.06099958649883541,
        ],
      },
      {
        primitive: 1,
        vertexIndex: 2908,
        local: [
          -0.12849420776621276, -1.4401005790642962e-8, 0.06099958649883541,
        ],
      },
    ],
  },
];

async function sourceBytes() {
  const { readFile } = await import('node:fs/promises');
  return new Uint8Array(
    await readFile(
      new URL(
        '../../public/game-assets/android/derived-pack-v1.glb',
        import.meta.url,
      ),
    ),
  );
}
test('real source Ready0 recomputes 72 skinned vertices from 53TRS without material copies', async () => {
  expect(hold.prepareFightingReadySource).toBeTypeOf('function');
  const bytes = await sourceBytes();
  const before = bytes.slice();
  const source = await hold.prepareFightingReadySource(bytes);
  expect(source.status).toBe('actual-ready0-fixed-unqualified');
  const one = source.createLease(),
    two = source.createLease();
  const a = one.sample();
  const b = two.sample();
  expect(a.pose).toHaveLength(53);
  expect(a.soles.map((s) => s.points.length)).toEqual([36, 36]);
  expect(a).toEqual(b);
  expect(a.soles).toEqual(readyExpectedSoles);
  expect(a.completeGeometry).toBe(false);
  expect(a.productionQualified).toBe(false);
  one.dispose();
  expect(() => one.sample()).toThrow();
  expect(two.sample()).toEqual(b);
  expect(source.stats.materialClones).toBe(0);
  expect(source.stats.geometryClones).toBe(0);
  source.dispose();
  expect(() => two.sample()).toThrow();
  expect(() => source.createLease()).toThrow();
  expect(Buffer.compare(bytes, before)).toBe(0);
});
test('real source rejects changed source bytes before parsing', async () => {
  const bytes = await sourceBytes();
  bytes[100] = requireValue(bytes[100]) ^ 1;
  await expect(hold.prepareFightingReadySource(bytes)).rejects.toThrow(
    /source/i,
  );
});

function actualReadyContext() {
  const f = fixture();
  const source = structuredClone(requireValue(f.context.manifest.sources[0]));
  const pin = {
    ...source,
    clipId: clipId('FightV3_Ready'),
    durationMs: 0,
    rootPolicy: 'in-place-posture-xyz' as const,
    provenance: {
      ...source.provenance,
      sourceSha256: readyRecipe.sourceSha256,
      mappingSha256: readyRecipe.mappingSha256,
      calibrationSha256: readyRecipe.calibrationSha256,
    },
    poseNames: readyRecipe.pose.map((p) => p.name),
    primitives: readyRecipe.primitives.map((p) => ({
      primitive: p.primitive,
      vertexCount: p.vertexCount,
    })),
    soles: readyRecipe.soles.map((s) => ({
      side: s.side,
      surfaceId: s.surfaceId,
      sourceBindingId: source.sourceBindingId,
      members: s.members,
    })),
  };
  return {
    ...f.context,
    query: { ...f.context.query, clipId: pin.clipId },
    manifest: {
      ...f.context.manifest,
      sources: [pin],
      variants: [
        {
          geometryBindingId: f.context.selectedGeometryBindingId,
          sourceBindingId: pin.sourceBindingId,
          clipId: pin.clipId,
          phase: 'neutral' as const,
          posture: 'standing' as const,
          coverage: { kind: 'finite' as const, fromMs: 0 as const, toMs: 0 },
        },
      ],
    },
    manifestContext: {
      ...f.context.manifestContext,
      sourcePins: [pin],
      limits: {
        ...f.context.manifestContext.limits,
        maxPrimitivesPerSource: 5,
        maxSolePoints: 36,
      },
    },
  };
}
test('actual Ready source supplies A point and captured hold without granting production readiness', async () => {
  const source = await hold.prepareFightingReadySource(await sourceBytes());
  const lease = source.createLease();
  const context = actualReadyContext();
  expect(lease.sampleActual).toBeTypeOf('function');
  const sample = lease.sampleActual(context);
  expect(sample.pose.map((p) => p.name)).toEqual(
    readyRecipe.pose.map((p) => p.name),
  );
  const fixed = hold.captureFightingReadyHold(sample, context, identity());
  const result = fixed.interval(request());
  expect(result.kind).toBe('covered');
  if (result.kind === 'covered') {
    expect(result.productionQualified).toBe(false);
    expect(result.sample.soles.flatMap((s) => s.points).length).toBe(72);
  }
  expect(() =>
    lease.sampleActual({ ...context, query: { ...context.query, atMs: 1 } }),
  ).toThrow();
  const swapped = {
    ...context,
    manifest: {
      ...context.manifest,
      sources: [
        {
          ...requireValue(context.manifest.sources[0]),
          provenance: {
            ...requireValue(context.manifest.sources[0]).provenance,
            sourceSha256: 'a'.repeat(64),
          },
        },
      ],
    },
  };
  expect(() => lease.sampleActual(swapped)).toThrow();
  source.dispose();
});

test('source copies bytes before async hash and releases shared geometry/material exactly once', async () => {
  const { vi } = await import('vitest');
  const { BufferGeometry, Material } = await import('three');
  const geometry = vi.spyOn(BufferGeometry.prototype, 'dispose'),
    material = vi.spyOn(Material.prototype, 'dispose');
  try {
    const bytes = await sourceBytes();
    const promise = hold.prepareFightingReadySource(bytes);
    bytes[100] = requireValue(bytes[100]) ^ 1;
    const source = await promise,
      a = source.createLease(),
      b = source.createLease();
    expect(a.sample().pose).toEqual(readyRecipe.pose);
    a.dispose();
    expect(geometry).not.toHaveBeenCalled();
    expect(material).not.toHaveBeenCalled();
    expect(b.sample().soles).toEqual(readyExpectedSoles);
    source.dispose();
    expect(geometry).toHaveBeenCalledTimes(5);
    expect(material).toHaveBeenCalledTimes(5);
    b.dispose();
    source.dispose();
    expect(geometry).toHaveBeenCalledTimes(5);
    expect(material).toHaveBeenCalledTimes(5);
  } finally {
    geometry.mockRestore();
    material.mockRestore();
  }
});
test('actual source rejects wrong source membership, role, policy and coverage', async () => {
  const source = await hold.prepareFightingReadySource(await sourceBytes());
  const lease = source.createLease();
  for (const change of [
    'mapping',
    'calibration',
    'poseOrder',
    'member',
    'rootPolicy',
    'coverage',
  ] as const) {
    const c = structuredClone(actualReadyContext()),
      pin = requireValue(c.manifest.sources[0]);
    if (change === 'mapping') pin.provenance.mappingSha256 = 'a'.repeat(64);
    if (change === 'calibration')
      pin.provenance.calibrationSha256 = 'b'.repeat(64);
    if (change === 'poseOrder') pin.poseNames.reverse();
    if (change === 'member')
      Object.assign(requireValue(requireValue(pin.soles[0]).members[0]), {
        vertexIndex: 1,
      });
    if (change === 'rootPolicy')
      Object.assign(pin, { rootPolicy: 'grounded-posture-y' });
    if (change === 'coverage')
      Object.assign(requireValue(c.manifest.variants[0]).coverage, { toMs: 1 });
    expect(() => lease.sampleActual(c)).toThrow();
  }
  expect(lease.sampleActual(actualReadyContext()).soles).toHaveLength(2);
  source.dispose();
});
