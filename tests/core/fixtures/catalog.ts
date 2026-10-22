import {
  clipId,
  durationMs,
  MOTION_SPACE,
  type DurationMs,
  type MotionCatalogPort,
  type MotionDefinition,
  type MotionIntervalSample,
} from '../../../src/contracts';
export const fixtureMotion: MotionDefinition = {
  clipId: clipId('fixture-kick'),
  category: 'kick',
  durationMs: durationMs(1000),
  effectiveRangeM: 1,
  impacts: [
    {
      impactIndex: 0,
      startMs: durationMs(100),
      endMs: durationMs(300),
      damageShare: 1,
      shapeId: 'foot',
    },
  ],
  rootCurve: [
    { atMs: durationMs(0), position: { x: 0, y: 0, z: 0 }, visualYawRad: 0 },
    {
      atMs: durationMs(1000),
      position: { x: 0, y: 0, z: 1 },
      visualYawRad: 2 * Math.PI,
    },
  ],
  sampling: { version: 1, sampleRateHz: 1, interpolation: 'piecewise-linear' },
};
/** Synthetic boundary fixture, not GLB sampling or a B/C product adapter. */
function sampleFixture(
  fromMs: DurationMs,
  toMs: DurationMs,
): MotionIntervalSample {
  if (
    ![fromMs, toMs].every(Number.isFinite) ||
    fromMs < 0 ||
    fromMs > toMs ||
    toMs > fixtureMotion.durationMs
  )
    throw new RangeError('Invalid clip interval');
  const rootAt = (atMs: DurationMs) =>
    Object.freeze({
      atMs,
      position: Object.freeze({ x: 0, y: 0, z: atMs / 1000 }),
      visualYawRad: (atMs / 1000) * 2 * Math.PI,
    });
  const volumeAt = (atMs: DurationMs) =>
    Object.freeze({
      kind: 'sphere' as const,
      center: Object.freeze({ x: atMs / 1000, y: 1, z: 0 }),
      radiusM: 0.1,
    });
  const activeFrom = durationMs(Math.max(fromMs, 100));
  const activeTo = durationMs(Math.min(toMs, 300));
  return Object.freeze({
    clipId: fixtureMotion.clipId,
    fromMs,
    toMs,
    space: MOTION_SPACE,
    rootSegments: Object.freeze(
      fromMs === toMs
        ? []
        : [
            Object.freeze({
              from: rootAt(fromMs),
              to: rootAt(toMs),
              deltaTranslation: Object.freeze({
                x: 0,
                y: 0,
                z: (toMs - fromMs) / 1000,
              }),
              horizontalOwner: 'authored-root' as const,
              verticalOwner: 'spatial-jump' as const,
              yawOwner: 'visual-only' as const,
            }),
          ],
    ),
    hitVolumeSegments: Object.freeze(
      activeFrom >= activeTo
        ? []
        : [
            Object.freeze({
              impactIndex: 0,
              shapeId: 'foot',
              fromMs: activeFrom,
              toMs: activeTo,
              activeWindow: Object.freeze({
                startMs: durationMs(100),
                endMs: durationMs(300),
              }),
              from: volumeAt(activeFrom),
              to: volumeAt(activeTo),
            }),
          ],
    ),
  });
}
export function createFixtureCatalog(trace: string[]): MotionCatalogPort {
  return {
    prepare: async () => {
      trace.push('catalog.prepare');
    },
    get: (id) => (id === fixtureMotion.clipId ? fixtureMotion : undefined),
    list: () => [fixtureMotion],
    sampleMotion: (id, fromMs, toMs) =>
      id === fixtureMotion.clipId ? sampleFixture(fromMs, toMs) : undefined,
    dispose: () => {
      trace.push('catalog.dispose');
    },
  };
}
