import { requireValue } from '../../../src/core/invariant';
import {
  clipId,
  durationMs,
  runId,
  tick,
  commandId,
  contactId,
  gameTimeMs,
  type ActorColor,
  type MotionDefinition,
  type MoveSet,
  type SpatialCandidate,
  type CorePort,
  type ImpactReference,
} from '../../../src/contracts';
import { createCore } from '../../../src/core/createCore';
export const run = runId('fixture-run');
export function fixtureCatalog(damage = 100) {
  const definitions: MotionDefinition[] = [];
  for (const category of ['punch', 'kick'] as const)
    for (let i = 0; i < (category === 'punch' ? 12 : 19); i++)
      definitions.push({
        clipId: clipId(`${category}:${i}`),
        category,
        durationMs: durationMs(10),
        effectiveRangeM: 180 / damage - 1,
        impacts: [
          {
            impactIndex: 0,
            startMs: durationMs(0),
            endMs: durationMs(10),
            damageShare: 1,
            shapeId: 'synthetic',
          },
        ],
        rootCurve: [
          {
            atMs: durationMs(0),
            position: { x: 0, y: 0, z: 0 },
            visualYawRad: 0,
          },
          {
            atMs: durationMs(10),
            position: { x: 0, y: 0, z: 0 },
            visualYawRad: 0,
          },
        ],
        sampling: {
          version: 1,
          sampleRateHz: 100,
          interpolation: 'piecewise-linear',
        },
      });
  const punches = definitions
      .filter((d) => d.category === 'punch')
      .map((d) => d.clipId),
    kicks = definitions
      .filter((d) => d.category === 'kick')
      .map((d) => d.clipId);
  const moves: Record<ActorColor, MoveSet> = {
    white: { punches, kicks },
    black: { punches: [], kicks },
    blue: { punches: punches.slice(0, 4), kicks: kicks.slice(0, 4) },
    green: { punches: punches.slice(4, 8), kicks: kicks.slice(4, 8) },
    yellow: { punches: punches.slice(8, 12), kicks: kicks.slice(8, 12) },
  };
  return {
    catalog: {
      get: (id: (typeof definitions)[number]['clipId']) =>
        definitions.find((d) => d.clipId === id),
      list: () => definitions,
    },
    moves,
  };
}
export function setup(damage = 100) {
  const core = createCore(
    { runId: run, seed: 42 },
    { ...fixtureCatalog(damage), enemyAi: false },
  );
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  core.drain();
  return core;
}
const commandSequences = new WeakMap<CorePort, number>();
export function attack(
  core: CorePort,
  color: ActorColor = 'white',
  category: 'punch' | 'kick' = 'punch',
) {
  const actor = requireValue(core.read().actors.find((a) => a.color === color));
  const sequence = (commandSequences.get(core) ?? 0) + 1;
  commandSequences.set(core, sequence);
  core.handleInputBatch({
    runId: run,
    tick: tick(core.read().clocks.tick + 1),
    commands: [
      {
        type: 'AttackRequested',
        runId: run,
        actorId: actor.actorId,
        category,
        input: {
          commandId: commandId(`cmd:${sequence}:${color}`),
          sequence,
        },
      },
    ],
  });
  return actor.actorId;
}
export function reference(
  core: CorePort,
  color: ActorColor = 'white',
): ImpactReference {
  const a = requireValue(core.read().actors.find((a) => a.color === color));
  return {
    actorId: a.actorId,
    activationId: requireValue(a.attack).activationId,
    impactId: requireValue(requireValue(a.attack).impactBindings[0]).impactId,
  };
}
const processedReal = new WeakMap<CorePort, number>();
export function step(
  core: CorePort,
  make: (at: number) => readonly SpatialCandidate[] = () => [],
) {
  const from = core.read().clocks.gameTimeMs;
  processedReal.set(
    core,
    Math.min(
      core.read().clocks.activeRealTimeMs,
      (processedReal.get(core) ?? 0) + 10,
    ),
  );
  core.beginStep({ durationMs: durationMs(10) });
  return core.completeStep({
    snapshot: {
      runId: run,
      tick: core.read().clocks.tick,
      actors: [],
      vehicles: [],
    },
    candidates: make(from),
  });
}
export function envelope(at: number, id = 'contact') {
  return {
    runId: run,
    contactId: contactId(id),
    at: gameTimeMs(at),
    interval: { from: gameTimeMs(at), to: gameTimeMs(at + 10) },
    point: { x: 1, y: 1, z: 0 },
    evidence: 'swept-shape' as const,
  };
}
export function hitOpponent(core: CorePort) {
  advanceCore(core, 500);
  attack(core);
  const source = reference(core);
  const targetActorId = requireValue(core.read().currentOpponentId);
  return step(core, (at) => [
    { ...envelope(at, `hit:${at}`), kind: 'body-hit', source, targetActorId },
  ]);
}
/** Drive accepted elapsed through the public fixed-step boundary, not a render-only fake clock. */
export function advanceCore(core: CorePort, elapsed: number) {
  core.present(durationMs(elapsed));
  while (
    core.read().phase === 'running' &&
    (processedReal.get(core) ?? 0) < core.read().clocks.activeRealTimeMs - 1e-7
  )
    step(core);
}
