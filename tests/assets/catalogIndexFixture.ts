import { clipId, durationMs } from '../../src/contracts';
import type { MotionAsset } from '../../src/assets/motionCatalog';
export function indexedFixture(): MotionAsset {
  const times = Array.from(
    { length: 513 },
    (_, i) => i * 0.5 + (i % 7) * 0.001,
  );
  const duration = durationMs(times.at(-1) ?? 0);
  return {
    definition: {
      clipId: clipId('index-equivalence'),
      category: 'punch',
      durationMs: duration,
      effectiveRangeM: 50,
      sampling: {
        version: 1,
        sampleRateHz: 2000,
        interpolation: 'piecewise-linear',
      },
      impacts: [
        {
          impactIndex: 0,
          startMs: durationMs(10.25),
          endMs: durationMs(173.5),
          damageShare: 0.4,
          shapeId: 'sphere',
        },
        {
          impactIndex: 1,
          startMs: durationMs(160),
          endMs: durationMs(240.4),
          damageShare: 0.6,
          shapeId: 'capsule',
        },
      ],
      rootCurve: times.map((atMs, i) => ({
        atMs: durationMs(atMs),
        position: { x: i / 16, y: (i % 13) / 8, z: -i / 32 },
        visualYawRad: (i / 512) * Math.PI * 8,
      })),
    },
    ownership: [0, 64.125, 129.375, 200].map((atMs, i) => ({
      atMs: durationMs(atMs),
      horizontalOwner: i % 2 ? 'spatial-movement' : 'authored-root',
      verticalOwner: i % 2 ? 'spatial-jump' : 'authored-root',
    })),
    shapes: [
      {
        shapeId: 'sphere',
        keys: times.map((atMs, i) => ({
          atMs: durationMs(atMs),
          volume: {
            kind: 'sphere',
            center: { x: (i % 19) / 8, y: (i % 7) / 4, z: -i / 16 },
            radiusM: 0.125 + (i % 5) / 64,
          },
        })),
      },
      {
        shapeId: 'capsule',
        keys: times.map((atMs, i) => ({
          atMs: durationMs(atMs),
          volume: {
            kind: 'capsule',
            start: { x: i / 32, y: 1, z: (i % 9) / 4 },
            end: { x: i / 32, y: 1.5, z: (i % 9) / 4 },
            radiusM: 0.2,
          },
        })),
      },
    ],
  };
}
export const indexedQueries = [
  [0, 0],
  [0, 1],
  [10.25, 10.25001],
  [11, 20],
  [160, 174],
  [173.5, 175],
  [239, 240.4],
  [240.4, 241],
  [64, 65],
  [129, 130],
  [200, 200.001],
  [0, 256.001],
  [256.001, 256.001],
] as const;
