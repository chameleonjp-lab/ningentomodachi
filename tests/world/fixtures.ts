import {
  type ActorState,
  activeRealTimeMs,
  actorId,
  durationMs,
  type GameSnapshot,
  gameTimeMs,
  type MotionCatalogPort,
  type MotionIntervalSample,
  presentationTimeMs,
  runId,
  tick,
} from '../../src/contracts';
export const run = runId('world-test');
export const permitted = { allowed: true, reason: null } as const;
export function actor(color: ActorState['color']): ActorState {
  return {
    actorId: actorId(color),
    color,
    hp: 500,
    maxHp: 500,
    heat: { amount: 0, capacity: 7, lockedUntil: null },
    attack: null,
    defeated: false,
    actions: {
      punch: permitted,
      kick: permitted,
      jump: permitted,
      move: permitted,
    },
  };
}
export function state(n = 0, extra: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    contractVersion: 1,
    revision: n,
    runId: run,
    phase: 'running',
    clocks: {
      tick: tick(n),
      gameTimeMs: gameTimeMs(n * 20),
      activeRealTimeMs: activeRealTimeMs(n * 20),
      presentationTimeMs: presentationTimeMs(n * 20),
    },
    seed: 1,
    pauseReasons: [],
    quality: 'standard',
    actors: [actor('white'), actor('blue')],
    currentOpponentId: actorId('blue'),
    result: null,
    presentation: { kind: 'none' },
    world: { vehicles: [], objects: [] },
    ...extra,
  };
}
export const viewport = {
  revision: 0,
  widthCssPx: 400,
  heightCssPx: 800,
  offsetLeftCssPx: 30,
  offsetTopCssPx: 50,
  devicePixelRatio: 3,
  safeAreaCssPx: { top: 20, bottom: 20, left: 0, right: 0 },
};
export function catalog(sample?: MotionIntervalSample): MotionCatalogPort {
  return {
    prepare: async () => {},
    dispose: () => {},
    list: () => [],
    get: () =>
      sample
        ? {
            clipId: sample.clipId,
            category: 'kick',
            durationMs: durationMs(1000),
            effectiveRangeM: 1,
            impacts: [],
            rootCurve: [],
            sampling: {
              version: 1,
              sampleRateHz: 50,
              interpolation: 'piecewise-linear',
            },
          }
        : undefined,
    sampleMotion: () => sample,
  };
}
