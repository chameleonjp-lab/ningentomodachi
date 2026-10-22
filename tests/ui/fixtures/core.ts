import {
  activeRealTimeMs,
  actorId,
  gameTimeMs,
  presentationTimeMs,
  runId,
  tick,
  type ActorState,
  type CommittedFrame,
  type GameSnapshot,
  type ViewportSnapshot,
} from '../../../src/contracts';
export const run = runId('fixture-run');
export const player = actorId('white');
export const opponent = actorId('black');
export const viewport: ViewportSnapshot = {
  revision: 1,
  widthCssPx: 390,
  heightCssPx: 844,
  offsetLeftCssPx: 12,
  offsetTopCssPx: 20,
  devicePixelRatio: 3,
  safeAreaCssPx: { top: 47, bottom: 34, left: 0, right: 0 },
};
export function actor(id = player, hp = 500, maxHp = 500): ActorState {
  const permission = { allowed: true, reason: null } as const;
  return {
    actorId: id,
    color: id === player ? 'white' : 'black',
    hp,
    maxHp,
    heat: { amount: 0, capacity: 7, lockedUntil: null },
    attack: null,
    defeated: false,
    actions: {
      punch: permission,
      kick: permission,
      jump: permission,
      move: permission,
    },
  };
}
export function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    revision: 1,
    contractVersion: 1,
    runId: run,
    phase: 'running',
    clocks: {
      tick: tick(1),
      gameTimeMs: gameTimeMs(0),
      activeRealTimeMs: activeRealTimeMs(0),
      presentationTimeMs: presentationTimeMs(0),
    },
    seed: 1,
    pauseReasons: [],
    quality: 'standard',
    actors: [actor(), actor(opponent, 700, 700)],
    currentOpponentId: opponent,
    result: null,
    presentation: { kind: 'none' },
    world: { vehicles: [], objects: [] },
    ...overrides,
  };
}
export function frame(overrides: Partial<CommittedFrame> = {}): CommittedFrame {
  const state = snapshot();
  return {
    snapshot: state,
    events: [],
    spatial: { runId: run, tick: state.clocks.tick, actors: [], vehicles: [] },
    viewport,
    ...overrides,
  };
}
