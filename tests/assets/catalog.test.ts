import { expect, test } from 'vitest';
import { clipId, durationMs, type MotionDefinition } from '../../src/contracts';
import {
  createMotionCatalog,
  type MotionAsset,
} from '../../src/assets/motionCatalog';
const ms = durationMs;
const id = clipId('synthetic-three-strikes');
const definition: MotionDefinition = {
  clipId: id,
  category: 'kick',
  durationMs: ms(100),
  effectiveRangeM: 4,
  sampling: {
    version: 1,
    sampleRateHz: 100,
    interpolation: 'piecewise-linear',
  },
  impacts: [0, 1, 2].map((impactIndex) => ({
    impactIndex,
    startMs: ms(10 + impactIndex * 20),
    endMs: ms(30 + impactIndex * 20),
    damageShare: 1 / 3,
    shapeId: 'fist',
  })),
  rootCurve: [
    { atMs: ms(0), position: { x: 0, y: 0, z: 0 }, visualYawRad: 0 },
    { atMs: ms(50), position: { x: 0, y: 1, z: 2 }, visualYawRad: Math.PI * 2 },
    {
      atMs: ms(100),
      position: { x: 0, y: 0, z: 4 },
      visualYawRad: Math.PI * 4,
    },
  ],
};
function asset(): MotionAsset {
  return {
    definition: structuredClone(definition),
    ownership: [
      {
        atMs: ms(0),
        horizontalOwner: 'authored-root',
        verticalOwner: 'spatial-jump',
      },
      {
        atMs: ms(25),
        horizontalOwner: 'authored-root',
        verticalOwner: 'authored-root',
      },
    ],
    shapes: [
      {
        shapeId: 'fist',
        keys: [
          {
            atMs: ms(0),
            volume: {
              kind: 'sphere',
              center: { x: 0, y: 1, z: 0 },
              radiusM: 0.2,
            },
          },
          {
            atMs: ms(40),
            volume: {
              kind: 'sphere',
              center: { x: 0, y: 1, z: 2 },
              radiusM: 0.2,
            },
          },
          {
            atMs: ms(100),
            volume: {
              kind: 'sphere',
              center: { x: 0, y: 1, z: 0 },
              radiusM: 0.2,
            },
          },
        ],
      },
    ],
  };
}
test('catalog splits root ownership and hit curve/windows exactly and retains unwrapped turns', async () => {
  const catalog = createMotionCatalog(async () => [asset()]);
  expect(catalog.list()).toEqual([]);
  await catalog.prepare(new AbortController().signal);
  const sampled = catalog.sampleMotion(id, ms(20), ms(60));
  expect(sampled?.rootSegments.map((s) => [s.from.atMs, s.to.atMs])).toEqual([
    [20, 25],
    [25, 50],
    [50, 60],
  ]);
  expect(sampled?.rootSegments[0]?.verticalOwner).toBe('spatial-jump');
  expect(sampled?.rootSegments[1]?.verticalOwner).toBe('authored-root');
  expect(sampled?.rootSegments[1]?.to.visualYawRad).toBe(Math.PI * 2);
  expect(
    sampled?.hitVolumeSegments.map((s) => [s.impactIndex, s.fromMs, s.toMs]),
  ).toEqual([
    [0, 20, 30],
    [1, 30, 40],
    [1, 40, 50],
    [2, 50, 60],
  ]);
  expect(catalog.sampleMotion(id, ms(30), ms(30))?.hitVolumeSegments).toEqual(
    [],
  );
  expect(
    catalog
      .sampleMotion(id, ms(30), ms(31))
      ?.hitVolumeSegments.map((s) => s.impactIndex),
  ).toEqual([1]);
  expect(catalog.sampleMotion(clipId('absent'), ms(0), ms(1))).toBeUndefined();
  expect(() => catalog.sampleMotion(id, ms(99), ms(101))).toThrow(RangeError);
  expect(() => catalog.sampleMotion(id, ms(20), ms(10))).toThrow(RangeError);
  expect(catalog.sampleMotion(id, ms(20), ms(60))).toEqual(sampled);
});
test('catalog copies validated data and rejects incomplete, duplicate, nonfinite or uncovered shapes', async () => {
  const source = asset();
  const catalog = createMotionCatalog(async () => [source]);
  await catalog.prepare(new AbortController().signal);
  expect(Object.isFrozen(catalog.get(id))).toBe(true);
  for (const items of [
    [asset(), asset()],
    [{ ...asset(), shapes: [] }],
    [{ ...asset(), ownership: [] }],
    [
      {
        ...asset(),
        shapes: [
          {
            shapeId: 'fist',
            keys: [
              {
                atMs: ms(0),
                volume: {
                  kind: 'sphere' as const,
                  center: { x: NaN, y: 0, z: 0 },
                  radiusM: 0.2,
                },
              },
            ],
          },
        ],
      },
    ],
  ]) {
    const bad = createMotionCatalog(async () => items);
    await expect(bad.prepare(new AbortController().signal)).rejects.toThrow();
    expect(bad.list()).toEqual([]);
  }
});
test('abort/dispose/timeout never publishes stale packs and retry only publishes latest generation', async () => {
  let resolve: ((value: readonly MotionAsset[]) => void) | undefined;
  let count = 0;
  const catalog = createMotionCatalog(
    () =>
      ++count === 1
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve([asset()]),
    { timeoutMs: 1000 },
  );
  const abort = new AbortController();
  const pending = catalog.prepare(abort.signal);
  abort.abort();
  await expect(pending).rejects.toThrow();
  await catalog.prepare(new AbortController().signal);
  resolve?.([]);
  await Promise.resolve();
  expect(catalog.list()).toHaveLength(1);
  catalog.dispose();
  expect(catalog.list()).toEqual([]);
  await expect(catalog.prepare(new AbortController().signal)).rejects.toThrow();
  const timeout = createMotionCatalog(() => new Promise(() => {}), {
    timeoutMs: 1,
  });
  await expect(timeout.prepare(new AbortController().signal)).rejects.toThrow(
    'timeout',
  );
});

test('deserialized unknown shape kind fails prepare before publishing any catalog entries', async () => {
  const malformed = JSON.parse(
    JSON.stringify({
      ...asset(),
      shapes: [
        {
          shapeId: 'fist',
          keys: [0, 100].map((atMs) => ({
            atMs,
            volume: {
              kind: 'bogus',
              start: { x: 0, y: 0, z: 0 },
              end: { x: 0, y: 0, z: 1 },
              radiusM: 0.1,
            },
          })),
        },
      ],
    }),
  );
  const catalog = createMotionCatalog(async () => [malformed]);
  await expect(catalog.prepare(new AbortController().signal)).rejects.toThrow(
    'shape',
  );
  expect(catalog.list()).toEqual([]);
  expect(catalog.get(id)).toBeUndefined();
  expect(catalog.sampleMotion(id, ms(10), ms(20))).toBeUndefined();
});
