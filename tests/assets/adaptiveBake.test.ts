import { expect, test } from 'vitest';
import type { BakeInput, EvaluatedPose } from '../../src/assets/bakeMotion';
import { clipId, durationMs } from '../../src/contracts';
import { refineActiveEnvelopes } from '../../tools/assets/adaptiveBake';

const input: BakeInput = {
  clipId: clipId('measured'),
  category: 'punch',
  durationMs: durationMs(100),
  sampleRateHz: 10,
  sourceTimesMs: [0, 23.456789, 100],
  impacts: [
    {
      impactIndex: 0,
      startMs: durationMs(40),
      endMs: durationMs(60),
      damageShare: 1,
      shapeId: 'hand',
    },
  ],
  ownership: [
    {
      atMs: durationMs(0),
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ],
};
const pose = (x: number, y: number): EvaluatedPose => ({
  root: { position: { x: 0, y: 0, z: 0 }, visualYawRad: 0 },
  shapes: [
    {
      shapeId: 'hand',
      volume: { kind: 'sphere', center: { x, y, z: 0 }, radiusM: 0.1 },
    },
  ],
});
test('adaptive active-window keys preserve actual radii/source times rather than silently padding geometry', async () => {
  let opened = 0,
    closed = 0;
  const result = await refineActiveEnvelopes(input, async () => {
    opened++;
    return {
      sample: (atMs) =>
        pose(
          Math.cos((atMs / 100) * Math.PI),
          Math.sin((atMs / 100) * Math.PI),
        ),
      dispose: () => {
        closed++;
      },
    };
  });
  expect(opened).toBe(closed);
  expect(result.diagnostics.addedKeyCount).toBeGreaterThan(0);
  expect(result.diagnostics.maximumMeasuredResidualM).toBeLessThanOrEqual(1e-7);
  expect(
    result.asset.definition.rootCurve.some((key) => key.atMs === 23.456789),
  ).toBe(true);
  for (const key of result.asset.shapes[0]?.keys ?? [])
    expect(key.volume.radiusM).toBe(0.1);
  for (const time of result.diagnostics.addedKeysMs) {
    expect(time).toBeGreaterThan(40);
    expect(time).toBeLessThan(60);
  }
});
test('non-convergent discontinuities fail closed and release every evaluator', async () => {
  let opened = 0,
    closed = 0;
  await expect(
    refineActiveEnvelopes(input, async () => {
      opened++;
      return {
        sample: (atMs) => pose(atMs < 50 ? 0 : 1, 0),
        dispose: () => {
          closed++;
        },
      };
    }),
  ).rejects.toThrow('converge');
  expect(opened).toBe(closed);
});

const capsulePose = (at: number, curved = false): EvaluatedPose => ({
  root: { position: { x: at / 100, y: 0, z: 0 }, visualYawRad: at / 100 },
  shapes: [
    {
      shapeId: 'hand',
      volume: {
        kind: 'capsule',
        start: { x: at / 100, y: curved ? Math.sin(at / 100) : 0, z: 0 },
        end: { x: at / 100, y: curved ? 1 + Math.sin(at / 100) : 1, z: 0 },
        radiusM: 0.1 + at / 10000,
      },
    },
  ],
});
const factory = (sample: (at: number) => EvaluatedPose) => async () => ({
  sample,
  dispose: () => {},
});
const failure = async (run: Promise<unknown>) => {
  try {
    await run;
    throw new Error('Expected rejection');
  } catch (e) {
    return e as Error & {
      diagnostic: {
        reason: string;
        round: number;
        pendingKeyCount: number;
        accounting: Record<string, number>;
        cleanupErrors: readonly unknown[];
      };
    };
  }
};

test('linear capsules preserve exact measured endpoints radii roots and supplied boundaries', async () => {
  const r = await refineActiveEnvelopes(input, factory(capsulePose));
  expect(r.diagnostics.addedKeysMs).toEqual([]);
  expect(r.asset.definition.impacts).toEqual(input.impacts);
  expect(r.asset.ownership).toEqual(input.ownership);
  expect(r.asset.definition.rootCurve.map((k) => k.atMs)).toEqual([
    0, 23.456789, 40, 60, 100,
  ]);
  for (const k of r.asset.shapes[0]?.keys ?? [])
    expect(k.volume).toEqual(capsulePose(k.atMs).shapes[0]?.volume);
});
test('curved capsules refine only interior supplied-window keys without radius inflation', async () => {
  const r = await refineActiveEnvelopes(
    input,
    factory((at) => capsulePose(at, true)),
  );
  expect(r.diagnostics.addedKeyCount).toBeGreaterThan(0);
  expect(r.diagnostics.maximumMeasuredResidualM).toBeLessThanOrEqual(1e-7);
  expect(r.diagnostics.addedKeysMs.every((t) => t > 40 && t < 60)).toBe(true);
  for (const k of r.asset.shapes[0]?.keys ?? [])
    expect(k.volume).toEqual(capsulePose(k.atMs, true).shapes[0]?.volume);
});
test('degenerate and reversed capsule endpoints retain their measured labeling', async () => {
  for (const degenerate of [false, true]) {
    const sample = (at: number): EvaluatedPose => {
      const p = capsulePose(at);
      const v = p.shapes[0]?.volume;
      if (!v || v.kind !== 'capsule') throw new Error('fixture');
      return {
        ...p,
        shapes: [
          {
            shapeId: 'hand',
            volume: { ...v, start: v.end, end: degenerate ? v.end : v.start },
          },
        ],
      };
    };
    const r = await refineActiveEnvelopes(input, factory(sample));
    expect(r.diagnostics.addedKeyCount).toBe(0);
    for (const k of r.asset.shapes[0]?.keys ?? [])
      expect(k.volume).toEqual(sample(k.atMs).shapes[0]?.volume);
  }
});
test('sphere existing asset and diagnostic golden remains exact with additive accounting', async () => {
  const r = await refineActiveEnvelopes(
    input,
    factory((at) => pose(at / 100, 0)),
  );
  expect(r.asset).toEqual({
    definition: {
      clipId: input.clipId,
      category: input.category,
      durationMs: 100,
      effectiveRangeM: 0.7,
      impacts: input.impacts,
      rootCurve: [0, 23.456789, 40, 60, 100].map((atMs) => ({
        atMs,
        position: { x: 0, y: 0, z: 0 },
        visualYawRad: 0,
      })),
      sampling: {
        version: 1,
        sampleRateHz: 10,
        interpolation: 'piecewise-linear',
      },
    },
    ownership: input.ownership,
    shapes: [
      {
        shapeId: 'hand',
        keys: [0, 23.456789, 40, 60, 100].map((atMs) => ({
          atMs,
          volume: pose(atMs / 100, 0).shapes[0]?.volume,
        })),
      },
    ],
  });
  const { accounting, ...legacy } = r.diagnostics;
  expect(legacy).toEqual({
    toleranceM: 1e-7,
    rounds: 0,
    addedKeyCount: 0,
    addedKeysMs: [],
    maximumMeasuredResidualM: 0,
    limitation:
      'Quarter/mid/three-quarter samples only; no analytic continuous-containment or device-performance acceptance',
  });
  expect(accounting).toMatchObject({
    bakeSampleAttempts: 5,
    bakeSampleCompletions: 5,
    verificationSampleAttempts: 3,
    verificationSampleCompletions: 3,
    factoryAttempts: 2,
    evaluatorAcquisitions: 2,
    disposalAttempts: 2,
    disposalCompletions: 2,
    blockedSampleCalls: 0,
    sphereComparisons: 3,
    capsuleComparisons: 0,
  });
});
test('unrepresentable strict-interior probes reject before a verification sample', async () => {
  const a = 1,
    b = 1 + Number.EPSILON;
  let n = 0;
  const r = await failure(
    refineActiveEnvelopes(
      {
        ...input,
        durationMs: durationMs(2),
        sourceTimesMs: [0, 2],
        impacts: [
          {
            ...input.impacts[0]!,
            startMs: durationMs(a),
            endMs: durationMs(b),
          },
        ],
      },
      factory((at) => {
        n++;
        return pose(at, 0);
      }),
    ),
  );
  expect(r.message).toContain('interior');
  expect(r.diagnostic.accounting.verificationSampleAttempts).toBe(0);
  expect(n).toBe(r.diagnostic.accounting.bakeSampleAttempts);
});
test('key budget blocks call20001 rather than admitting unbounded bake samples', async () => {
  let calls = 0;
  const r = await failure(
    refineActiveEnvelopes(
      {
        ...input,
        sourceTimesMs: Array.from({ length: 20001 }, (_, i) => i / 200),
      },
      factory((at) => {
        calls++;
        return pose(at, 0);
      }),
    ),
  );
  expect(calls).toBe(20000);
  expect(r.diagnostic.accounting).toMatchObject({
    bakeSampleAttempts: 20000,
    blockedSampleCalls: 1,
    disposalAttempts: 1,
    disposalCompletions: 1,
  });
});
test('invalid measured verification shape rejects rather than false numeric success', async () => {
  for (const kind of ['missing', 'duplicate', 'mixed', 'nan', 'overflow']) {
    let created = 0;
    const r = await failure(
      refineActiveEnvelopes(input, async () => {
        const verification = ++created === 2;
        return {
          sample: (at: number) => {
            const p = capsulePose(at);
            if (!verification) return p;
            if (kind === 'missing') return { ...p, shapes: [] };
            if (kind === 'duplicate')
              return { ...p, shapes: [...p.shapes, ...p.shapes] };
            if (kind === 'mixed') return pose(0, 0);
            const v = p.shapes[0]?.volume;
            if (!v || v.kind !== 'capsule') throw new Error('fixture');
            return {
              ...p,
              shapes: [
                {
                  shapeId: 'hand',
                  volume: {
                    ...v,
                    start: {
                      x: kind === 'nan' ? NaN : 1.7e308,
                      y: 1.7e308,
                      z: 1.7e308,
                    },
                  },
                },
              ],
            };
          },
          dispose: () => {},
        };
      }),
    );
    expect(r.diagnostic).toBeDefined();
    expect(r.diagnostic.accounting.disposalCompletions).toBe(2);
  }
});
test('sample throw and cleanup throw preserve primary cause and completed accounting', async () => {
  const primary = new Error('sample primary'),
    cleanup = new Error('cleanup secondary');
  const r = await failure(
    refineActiveEnvelopes(input, async () => ({
      sample: () => {
        throw primary;
      },
      dispose: () => {
        throw cleanup;
      },
    })),
  );
  expect(r.cause).toBe(primary);
  expect(r.diagnostic.cleanupErrors).toEqual([cleanup]);
  expect(r.diagnostic.accounting).toMatchObject({
    bakeSampleAttempts: 1,
    bakeSampleCompletions: 0,
    disposalAttempts: 1,
    disposalCompletions: 0,
  });
});
test('factory rejection is counted separately without disposing an unacquired evaluator', async () => {
  const primary = new Error('factory');
  const r = await failure(
    refineActiveEnvelopes(input, async () => {
      throw primary;
    }),
  );
  expect(r.cause).toBe(primary);
  expect(r.diagnostic.accounting).toMatchObject({
    factoryAttempts: 1,
    evaluatorAcquisitions: 0,
    disposalAttempts: 0,
    bakeSampleAttempts: 0,
  });
});
test('nonconvergence exposes unresolved final round and pending keys', async () => {
  const r = await failure(
    refineActiveEnvelopes(
      input,
      factory((at) => pose(at < 50 ? 0 : 1, 0)),
    ),
  );
  expect(r.diagnostic.round).toBe(8);
  expect(r.diagnostic.pendingKeyCount).toBeGreaterThan(0);
  expect(r.diagnostic.accounting.factoryAttempts).toBe(18);
});

test('multiple active shapes share verification samples without crossing supplied windows', async () => {
  let phase = 0;
  const probes: number[] = [];
  const dual = {
    ...input,
    impacts: [
      ...input.impacts,
      {
        ...input.impacts[0]!,
        impactIndex: 1,
        shapeId: 'other',
        startMs: durationMs(40),
        endMs: durationMs(80),
      },
    ],
  };
  const r = await refineActiveEnvelopes(dual, async () => {
    const verify = ++phase === 2;
    return {
      sample: (at: number) => {
        if (verify) probes.push(at);
        const p = capsulePose(at);
        return {
          ...p,
          shapes: [
            ...p.shapes,
            { shapeId: 'other', volume: pose(at / 100, 0).shapes[0]!.volume },
          ],
        };
      },
      dispose: () => {},
    };
  });
  expect(probes).toEqual([45, 50, 55, 65, 70, 75]);
  expect(r.diagnostics.accounting.verificationSampleAttempts).toBe(6);
  expect(r.diagnostics.accounting.capsuleComparisons).toBe(3);
  expect(r.diagnostics.accounting.sphereComparisons).toBe(6);
  expect(r.asset.definition.impacts).toEqual(dual.impacts);
});
test('exact20000 bake keys remain admitted while caps do not count hidden factory work', async () => {
  let hidden = 0;
  const r = await refineActiveEnvelopes(
    {
      ...input,
      sourceTimesMs: Array.from({ length: 19999 }, (_, i) => i / 200),
    },
    async () => {
      hidden++;
      return { sample: (at: number) => pose(at, 0), dispose: () => {} };
    },
  );
  expect(r.asset.definition.rootCurve).toHaveLength(20000);
  expect(r.diagnostics.accounting.bakeSampleAttempts).toBe(20000);
  expect(r.diagnostics.accounting.blockedSampleCalls).toBe(0);
  expect(hidden).toBe(2);
  expect(r.diagnostics.accounting.factoryAttempts).toBe(2);
});

test('cleanup failure alone rejects a completed bake without acquiring verification', async () => {
  const cleanup = new Error('cleanup only');
  const error = await failure(
    refineActiveEnvelopes(input, async () => ({
      sample: (at: number) => pose(at, 0),
      dispose: () => {
        throw cleanup;
      },
    })),
  );
  expect(error.cause).toBe(cleanup);
  expect(error.diagnostic.accounting).toMatchObject({
    factoryAttempts: 1,
    bakeSampleAttempts: 5,
    bakeSampleCompletions: 5,
    disposalAttempts: 1,
    disposalCompletions: 0,
  });
});

test('capsule interpolation uses represented-time catalog alpha on irregular ULP intervals', async () => {
  const a = 1,
    b = 1 + 5 * Number.EPSILON;
  const p = {
    ...input,
    durationMs: durationMs(2),
    sourceTimesMs: [0, 2],
    impacts: [
      { ...input.impacts[0]!, startMs: durationMs(a), endMs: durationMs(b) },
    ],
  };
  const sample = (at: number): EvaluatedPose => {
    const x =
      at <= a
        ? 0
        : at >= b
          ? 1
          : at === a + Number.EPSILON
            ? 0.25
            : at === a + 2 * Number.EPSILON
              ? 0.5
              : 0.75;
    return {
      root: { position: { x: 0, y: 0, z: 0 }, visualYawRad: 0 },
      shapes: [
        {
          shapeId: 'hand',
          volume: {
            kind: 'capsule',
            start: { x, y: 0, z: 0 },
            end: { x, y: 0, z: 0 },
            radiusM: 0.1,
          },
        },
      ],
    };
  };
  // Nominal q=.25 falsely matches .25; public catalog alpha is .2 here.
  await expect(refineActiveEnvelopes(p, factory(sample))).rejects.toThrow(
    'interior',
  );
});
