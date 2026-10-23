import { expect, test } from 'vitest';
import {
  actorId,
  clipId,
  durationMs,
  type PoseCatalogBindings,
  type PoseRunPolicy,
} from '../../src/contracts';
import { createSpatialEngine } from '../../src/world/spatial-engine';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { actor, catalog, run, state } from './fixtures';

const policy: PoseRunPolicy = { version: 1, mode: 'deterministic-pose-v1' };
const descriptor = (): PoseCatalogBindings => ({
  version: 1,
  bindingSetId: 'set',
  clips: ['idle', 'walk', 'run', 'jump'].map((n) => ({
    clipId: clipId(n),
    durationMs: durationMs(100),
    sourceBindingId: n,
  })),
  locomotion: {
    idle: clipId('idle'),
    walk: clipId('walk'),
    run: clipId('run'),
    jump: clipId('jump'),
  },
});
function engine() {
  return createSpatialEngine(run, createParisStreetLayout(), policy);
}
test('actual engine capability binds pending loading epochs before ready; legacy is unstamped', () => {
  const e = engine(),
    legacy = createSpatialEngine(run, createParisStreetLayout());
  try {
    expect(e.poseProtocol?.protocol).toBe('deterministic-pose-v1');
    expect(legacy.poseProtocol).toBeUndefined();
    const loading = state(0, { phase: 'loading' });
    expect(
      e.commit({ snapshot: loading, events: [] }).actors[0]!.pose,
    ).toBeUndefined();
    e.poseProtocol!.bindPreparedCatalog(descriptor());
    expect(
      e.commit({ snapshot: state(), events: [] }).actors[0]!.pose,
    ).toMatchObject({ kind: 'living', living: { startedAt: 0, mode: 'idle' } });
    expect(
      legacy.commit({ snapshot: state(), events: [] }).actors[0]!.pose,
    ).toBeUndefined();
  } finally {
    e.dispose();
    legacy.dispose();
  }
});
test('first step resident starts at interval start and physical output matches legacy', () => {
  const e = engine(),
    legacy = createSpatialEngine(run, createParisStreetLayout());
  e.poseProtocol!.bindPreparedCatalog(descriptor());
  try {
    for (const x of [e, legacy])
      x.commit({
        snapshot: state(0, { residentActorIds: [actorId('white')] }),
        events: [],
      });
    const request = {
      snapshot: state(1, {
        actors: [actor('white'), actor('green')],
        currentOpponentId: actorId('green'),
        residentActorIds: [actorId('white'), actorId('green')],
      }),
      step: { durationMs: durationMs(20) },
      intents: [],
    };
    const a = e.step(request, catalog()),
      b = legacy.step(request, catalog());
    expect(
      a.snapshot.actors.find((x) => x.actorId === actorId('green'))!.pose,
    ).toMatchObject({ living: { startedAt: 0 } });
    expect({
      ...a,
      snapshot: {
        ...a.snapshot,
        actors: a.snapshot.actors.map(({ pose, ...p }) => p),
      },
    }).toEqual(b);
  } finally {
    e.dispose();
    legacy.dispose();
  }
});
test('unbound rejection leaves physical tick and residency unchanged for valid retry', () => {
  const e = engine(),
    control = engine();
  try {
    const loading = { snapshot: state(0, { phase: 'loading' }), events: [] };
    e.commit(loading);
    control.commit(loading);
    const request = {
      snapshot: state(1),
      step: { durationMs: durationMs(20) },
      intents: [],
    };
    expect(() => e.step(request, catalog())).toThrow();
    e.poseProtocol!.bindPreparedCatalog(descriptor());
    control.poseProtocol!.bindPreparedCatalog(descriptor());
    expect(e.step(request, catalog())).toEqual(
      control.step(request, catalog()),
    );
  } finally {
    e.dispose();
    control.dispose();
  }
});

test('captured binding duration mismatch rejects before physical advancement and allows valid retry', () => {
  const e = engine(),
    control = engine();
  const initial = state();
  const a = {
    ...actor('white'),
    attack: {
      activationId:
        'activation' as import('../../src/contracts').AttackActivationId,
      clipId: clipId('kick'),
      category: 'kick' as const,
      startedAt: 0 as import('../../src/contracts').GameTimeMs,
      consumedImpacts: [],
      impactBindings: [],
    },
  };
  const desc = {
    ...descriptor(),
    clips: [
      ...descriptor().clips,
      {
        clipId: clipId('kick'),
        durationMs: durationMs(100),
        sourceBindingId: 'kick-source',
      },
    ],
  };
  for (const x of [e, control]) {
    x.poseProtocol!.bindPreparedCatalog(desc);
    x.commit({ snapshot: initial, events: [] });
  }
  const request = {
    snapshot: state(1, { actors: [a, actor('blue')] }),
    step: { durationMs: durationMs(20) },
    intents: [],
  };
  const definition = {
    clipId: clipId('kick'),
    category: 'kick' as const,
    durationMs: durationMs(200),
    effectiveRangeM: 1,
    impacts: [],
    rootCurve: [],
    sampling: {
      version: 1 as const,
      sampleRateHz: 50,
      interpolation: 'piecewise-linear' as const,
    },
  };
  const bad = { ...catalog(), get: () => definition };
  const good = {
    ...bad,
    get: () => ({ ...definition, durationMs: durationMs(100) }),
  };
  try {
    expect(() => e.step(request, bad)).toThrow();
    expect(e.step(request, good)).toEqual(control.step(request, good));
  } finally {
    e.dispose();
    control.dispose();
  }
});

import {
  commandId,
  gameTimeMs,
  type SpatialCandidate,
} from '../../src/contracts';
// Real Core clocks/outcomes, synthetic contact candidates: no anatomical collision claim.
import {
  run as coreRun,
  setup as coreSetup,
  envelope,
  fixtureCatalog,
  reference,
  attack as requestAttack,
} from '../core/fixtures/scenarios';

function coreTrace(drawEvery: number) {
  const core = coreSetup();
  const config = fixtureCatalog();
  const base = descriptor();
  const prepared = {
    ...base,
    clips: [
      ...base.clips,
      ...config.catalog.list().map((d) => ({
        clipId: d.clipId,
        durationMs: d.durationMs,
        sourceBindingId: `fixture:${d.clipId}`,
      })),
    ],
  };
  const motions = { ...catalog(), ...config.catalog };
  const layout = { ...createParisStreetLayout(), vehicles: [], objects: [] };
  const e = createSpatialEngine(coreRun, layout, policy);
  e.poseProtocol!.bindPreparedCatalog(prepared);
  let committed = e.commit(core.drain()),
    processed = 0,
    ordinal = 0;
  const trace: unknown[] = [];
  const saved: (typeof committed)[] = [];
  const white = core.read().actors[0]!.actorId;
  const basis = e.begin('move', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  const perform = (
    dt: number,
    contacts: readonly SpatialCandidate[] = [],
    move = false,
  ) => {
    const request = core.beginStep({ durationMs: durationMs(dt) });
    const intents = move
      ? [
          ...request.intents,
          {
            type: 'MoveRequested' as const,
            runId: coreRun,
            actorId: white,
            input: { commandId: commandId('move'), sequence: 1 },
            movementSessionId: 'move',
            basisRevision: basis.revision,
            x: 1,
            z: 0,
          },
        ]
      : request.intents;
    const result = e.step({ ...request, intents }, motions);
    const output = core.completeStep({ ...result, candidates: contacts });
    processed += dt;
    committed = e.commit(output);
    trace.push(committed);
    ordinal++;
    if (drawEvery && ordinal % drawEvery === 0) {
      saved.push(committed);
      JSON.stringify(committed);
      for (const old of saved.slice(-3)) JSON.stringify(old);
    }
  };
  const advance = (elapsed: number, move = false) => {
    core.present(durationMs(elapsed));
    e.commit(core.drain());
    while (processed < core.read().clocks.activeRealTimeMs - 1e-7)
      perform(
        Math.min(10, core.read().clocks.activeRealTimeMs - processed),
        [],
        move,
      );
  };
  try {
    for (let hit = 0; hit < 5; hit++) {
      advance(500);
      requestAttack(core);
      e.commit(core.drain());
      const source = reference(core),
        targetActorId = core.read().currentOpponentId!;
      const at = core.read().clocks.gameTimeMs + 1;
      core.present(durationMs(10));
      perform(10, [
        {
          ...envelope(at, `hit:${hit}`),
          interval: { from: gameTimeMs(at - 1), to: gameTimeMs(at + 9) },
          kind: 'body-hit',
          source,
          targetActorId,
        },
      ]);
    }
    const victim = core.read().actors[1]!;
    const death = committed.actors.find(
      (a) => a.actorId === victim.actorId,
    )!.pose;
    expect(death).toMatchObject({
      kind: 'defeat',
      defeatStartedAt: victim.defeatPresentation!.startedAt,
    });
    advance(1491);
    expect(core.read().presentation.kind).toBe('opponent-defeat-finish');
    const before = committed.actors.find((a) => a.actorId === white)!.position
      .x;
    core.handle({ type: 'PauseRequested', runId: coreRun, reason: 'settings' });
    const paused = e.commit(core.drain());
    core.present(durationMs(10000));
    expect(e.commit(core.drain())).toEqual(paused);
    core.handle({
      type: 'ResumeRequested',
      runId: coreRun,
      reason: 'settings',
    });
    e.commit(core.drain());
    // Accept the remaining125ms at once: presentation advances but admitted backlog still gates retirement.
    core.present(durationMs(125));
    const waiting = e.commit(core.drain());
    expect(
      waiting.actors.find((a) => a.actorId === victim.actorId)?.pose,
    ).toEqual(death);
    while (processed < core.read().clocks.activeRealTimeMs - 1e-7)
      perform(
        Math.min(5, core.read().clocks.activeRealTimeMs - processed),
        [],
        true,
      );
    expect(
      committed.actors.find((a) => a.actorId === white)!.position.x,
    ).toBeGreaterThan(before);
    expect(e.isRetired(victim.actorId)).toBe(true);
    expect(core.read().actors[1]!.defeatPresentation).toEqual(
      victim.defeatPresentation,
    );
    return trace;
  } finally {
    core.dispose();
    e.dispose();
  }
}
test('Core slow/pause/backlog/125ms finish retains movement and stamped history independent of observation cadence', () => {
  const noDraw = coreTrace(0);
  for (const cadence of [4, 2, 1]) expect(coreTrace(cadence)).toEqual(noDraw);
});

test('contradictory death commit cannot retire or change physical state before valid retry', () => {
  const e = engine(),
    control = engine();
  for (const x of [e, control]) {
    x.poseProtocol!.bindPreparedCatalog(descriptor());
    x.commit({ snapshot: state(0), events: [] });
  }
  const corrupt = state(1, {
    residentActorIds: [actorId('white')],
    actors: [{ ...actor('white'), defeated: true }],
  });
  try {
    expect(() => e.commit({ snapshot: corrupt, events: [] })).toThrow();
    expect(e.isRetired(actorId('blue'))).toBe(false);
    const request = {
      snapshot: state(1),
      step: { durationMs: durationMs(20) },
      intents: [],
    };
    expect(e.step(request, catalog())).toEqual(
      control.step(request, catalog()),
    );
  } finally {
    e.dispose();
    control.dispose();
  }
});

test('motor-end stamp rejection rolls back physical poses, facing, tick and residency', () => {
  const e = engine(),
    control = engine();
  const epoch = 1e16;
  const source = {
    ...descriptor(),
    clips: descriptor().clips.map((b) => ({
      ...b,
      durationMs: durationMs(b.clipId === 'jump' ? 1 : 100),
    })),
  };
  const initial = {
    ...state(0),
    clocks: { ...state(0).clocks, gameTimeMs: gameTimeMs(epoch) },
  };
  for (const x of [e, control]) {
    x.poseProtocol!.bindPreparedCatalog(source);
    x.commit({ snapshot: initial, events: [] });
  }
  const snapshot = {
    ...state(1),
    clocks: { ...state(1).clocks, gameTimeMs: gameTimeMs(epoch + 4) },
  };
  const request = {
    snapshot,
    step: { durationMs: durationMs(4) },
    intents: [],
  };
  try {
    expect(() =>
      e.step(
        {
          ...request,
          intents: [
            {
              type: 'JumpRequested',
              runId: run,
              actorId: actorId('white'),
              input: { commandId: commandId('jump'), sequence: 1 },
            },
          ],
        },
        catalog(),
      ),
    ).toThrow('Pose clamp endpoint is not representable');
    expect(e.step(request, catalog())).toEqual(
      control.step(request, catalog()),
    );
  } finally {
    e.dispose();
    control.dispose();
  }
});

import {
  MOTION_SPACE,
  type MotionCatalogPort,
  type SpatialSnapshot,
} from '../../src/contracts';

test('real Core terminal death inside step truncates survivor timing without rewriting motor result', () => {
  const core = coreSetup();
  const config = fixtureCatalog();
  const base = descriptor();
  const motions: MotionCatalogPort = {
    ...catalog(),
    ...config.catalog,
    sampleMotion: (clipId, fromMs, toMs) => ({
      clipId,
      fromMs,
      toMs,
      space: MOTION_SPACE,
      rootSegments:
        fromMs === toMs
          ? []
          : [
              {
                from: {
                  atMs: fromMs,
                  position: { x: 0, y: 0, z: fromMs * 0.008 },
                  visualYawRad: 0,
                },
                to: {
                  atMs: toMs,
                  position: { x: 0, y: 0, z: toMs * 0.008 },
                  visualYawRad: 0,
                },
                deltaTranslation: { x: 0, y: 0, z: (toMs - fromMs) * 0.008 },
                horizontalOwner: 'authored-root',
                verticalOwner: 'spatial-jump',
                yawOwner: 'visual-only',
              },
            ],
      hitVolumeSegments: [],
    }),
  };
  const e = createSpatialEngine(
    coreRun,
    { ...createParisStreetLayout(), vehicles: [], objects: [] },
    policy,
  );
  e.poseProtocol!.bindPreparedCatalog({
    ...base,
    clips: [
      ...base.clips,
      ...config.catalog.list().map((d) => ({
        clipId: d.clipId,
        durationMs: d.durationMs,
        sourceBindingId: `fixture:${d.clipId}`,
      })),
    ],
  });
  e.commit(core.drain());
  let provisional: SpatialSnapshot | undefined,
    committed: SpatialSnapshot | undefined;
  const perform = (contacts: readonly SpatialCandidate[] = []) => {
    core.present(durationMs(20));
    const request = core.beginStep({ durationMs: durationMs(20) });
    const result = e.step(request, motions);
    provisional = result.snapshot;
    const output = core.completeStep({ ...result, candidates: contacts });
    committed = e.commit(output);
    return output;
  };
  try {
    for (let hit = 0; hit < 5; hit++) {
      for (let n = 0; n < 25; n++) perform();
      requestAttack(core, 'blue');
      e.commit(core.drain());
      const source = reference(core, 'blue');
      const at = core.read().clocks.gameTimeMs + 5;
      perform([
        {
          ...envelope(at, `fatal:${hit}`),
          interval: { from: gameTimeMs(at - 5), to: gameTimeMs(at + 15) },
          kind: 'body-hit',
          source,
          targetActorId: core.read().actors[0]!.actorId,
        },
      ]);
    }
    expect(core.read().phase).toBe('terminal');
    const blue = core.read().actors[1]!.actorId;
    const before = provisional!.actors.find((a) => a.actorId === blue)!;
    const after = committed!.actors.find((a) => a.actorId === blue)!;
    expect(before.locomotion).toBe('run');
    expect(after.position).toEqual(before.position);
    expect(after.velocity).toEqual(before.velocity);
    expect(after.facing).toEqual(before.facing);
    expect(after.pose).toMatchObject({
      kind: 'living',
      living: { mode: 'idle', startedAt: core.read().clocks.gameTimeMs },
    });
    expect(e.commit(core.drain())).toEqual(committed);
  } finally {
    core.dispose();
    e.dispose();
  }
});

test('recovery is a separately explicit constructor capability, never inferred from v1', () => {
  const diagnostic = {
    version: 1,
    protocol: 'kungfu-recovery-epoch-diagnostic-v1',
    durationMs: durationMs(150),
    fixedLiftSign: 1,
  } as const;
  const ordinary = engine(),
    enabled = createSpatialEngine(
      run,
      createParisStreetLayout(),
      policy,
      diagnostic,
    );
  try {
    expect(ordinary.poseProtocol?.recovery).toBeUndefined();
    expect(enabled.poseProtocol?.recovery).toEqual(diagnostic);
    expect(() =>
      createSpatialEngine(
        run,
        createParisStreetLayout(),
        undefined,
        diagnostic,
      ),
    ).toThrow('explicit');
  } finally {
    ordinary.dispose();
    enabled.dispose();
  }
});

// Source-free integration: actual Core commands and C engine selections. Catalog,
// geometry absence, and explicitly injected contact candidates are synthetic.
import { createCore } from '../../src/core';
import {
  type ActorColor,
  type CoreOutput,
  type ImpactReference,
  vehicleId,
  tick,
} from '../../src/contracts';

const lifecycleRecovery = {
  version: 1,
  protocol: 'kungfu-recovery-epoch-diagnostic-v1',
  durationMs: durationMs(150),
  fixedLiftSign: 1,
} as const;
function lifecycleHarness(enabled: boolean) {
  const fixture = fixtureCatalog(150);
  const definitions = fixture.catalog.list().map((motion) => {
    const selected = motion.clipId === 'punch:0';
    const end = selected ? 125 : motion.category === 'punch' ? 300 : 10;
    return {
      ...motion,
      clipId: selected ? clipId('KungFuStraight') : motion.clipId,
      durationMs: durationMs(end),
      impacts: motion.impacts.map((impact) => ({
        ...impact,
        endMs: durationMs(end),
      })),
      rootCurve: motion.rootCurve.map((key, index) => ({
        ...key,
        atMs: durationMs(index === 0 ? 0 : end),
      })),
    };
  });
  const rename = (id: ReturnType<typeof clipId>) =>
    id === 'punch:0' ? clipId('KungFuStraight') : id;
  const moves = { ...fixture.moves };
  for (const color of ['white', 'blue', 'green', 'yellow', 'black'] as const) {
    const set = fixture.moves[color];
    moves[color] = {
      ...set,
      punches:
        color === 'white'
          ? [clipId('KungFuStraight')]
          : set.punches.map(rename),
    };
  }
  // Blue must use a longer ordinary punch so a valid impact can arrive after
  // White's125ms completion. Its four-punch roster remains valid and unique.
  moves.blue = {
    ...moves.blue,
    punches: ['punch:1', 'punch:2', 'punch:3', 'punch:4'].map(clipId),
  };
  const motions: MotionCatalogPort = {
    ...catalog(),
    list: () => definitions,
    get: (id) => definitions.find((motion) => motion.clipId === id),
    sampleMotion: () => undefined,
  };
  const car = vehicleId('lifecycle-car');
  const layout = createParisStreetLayout();
  const parked = layout.vehicles[0]!;
  const isolatedLayout = {
    ...layout,
    objects: [],
    vehicles: [
      {
        ...parked,
        vehicleId: car,
        position: { x: 1000, y: 0, z: 1000 },
      },
    ],
  };
  const core = createCore(
    { runId: coreRun, seed: 1 },
    {
      catalog: motions,
      moves,
      enemyAi: false,
      world: { vehicles: [{ vehicleId: car, hp: 100 }], objects: [] },
    },
  );
  const e = createSpatialEngine(coreRun, isolatedLayout, {
    ...policy,
    ...(enabled ? { recovery: lifecycleRecovery } : {}),
  });
  const idleBindings = descriptor();
  const bindings: PoseCatalogBindings = {
    ...idleBindings,
    bindingSetId: 'synthetic-lifecycle125',
    clips: [
      ...idleBindings.clips.map((b) =>
        b.clipId === 'idle' ? { ...b, clipId: clipId('Idle') } : b,
      ),
      ...definitions.map((m) => ({
        clipId: m.clipId,
        durationMs: m.durationMs,
        sourceBindingId: `synthetic:${m.clipId}`,
      })),
    ],
    locomotion: { ...idleBindings.locomotion, idle: clipId('Idle') },
  };
  const trace: { output: CoreOutput; spatial: unknown }[] = [];
  let committed: SpatialSnapshot;
  let provisional: SpatialSnapshot | undefined;
  const commit = (output = core.drain()) => {
    committed = e.commit(output);
    trace.push({
      output,
      spatial: {
        ...committed,
        actors: committed.actors.map(
          ({ pose: _pose, ...physical }) => physical,
        ),
      },
    });
    return committed;
  };
  commit();
  e.poseProtocol!.bindPreparedCatalog(bindings);
  core.handle({ type: 'AssetsReady', runId: coreRun });
  commit();
  core.handle({ type: 'StartRequested', runId: coreRun });
  commit();
  const actorFor = (color: ActorColor) =>
    core.read().actors.find((a) => a.color === color)!;
  const attack = (
    color: ActorColor = 'white',
    category: 'punch' | 'kick' = 'punch',
  ) => {
    requestAttack(core, color, category);
    commit();
    expect(actorFor(color).attack).not.toBeNull();
    return reference(core, color);
  };
  const perform = (dt = 20, contacts: readonly SpatialCandidate[] = []) => {
    core.present(durationMs(dt));
    const request = core.beginStep({ durationMs: durationMs(dt) });
    const result = e.step(request, motions);
    expect(result.candidates).toEqual([]);
    provisional = result.snapshot;
    const output = core.completeStep({ ...result, candidates: contacts });
    commit(output);
    return output;
  };
  const advance = (real: number) => {
    let remaining = real;
    while (remaining > 0) {
      const dt = Math.min(20, remaining);
      perform(dt);
      remaining -= dt;
    }
  };
  const bodyHit = (
    source: ImpactReference,
    target: ActorColor,
    at: number,
    id: string,
  ): SpatialCandidate => ({
    ...envelope(at, id),
    interval: {
      from: core.read().clocks.gameTimeMs,
      to: gameTimeMs(core.read().clocks.gameTimeMs + 20),
    },
    kind: 'body-hit',
    source,
    targetActorId: actorFor(target).actorId,
  });
  return {
    core,
    e,
    car,
    trace,
    attack,
    perform,
    advance,
    commit,
    actorFor,
    bodyHit,
    read: () => committed,
    provisional: () => provisional,
    pose: (color: ActorColor = 'white') =>
      committed.actors.find((a) => a.actorId === actorFor(color).actorId)!
        .pose!,
    prime: (victim: ActorColor) => {
      const sourceColor = victim === 'white' ? 'blue' : 'white';
      for (let i = 0; i < 3; i++) {
        advance(500);
        const source = attack(
          sourceColor,
          victim === 'white' ? 'punch' : 'kick',
        );
        const at = core.read().clocks.gameTimeMs + 1;
        perform(20, [bodyHit(source, victim, at, `prime:${victim}:${i}`)]);
      }
      expect(actorFor(victim).hp).toBe(50);
      advance(500);
    },
    dispose() {
      core.dispose();
      e.dispose();
    },
  };
}
type LifecycleHarness = ReturnType<typeof lifecycleHarness>;
function lifecyclePair(exercise: (h: LifecycleHarness) => void) {
  const off = lifecycleHarness(false),
    on = lifecycleHarness(true);
  try {
    exercise(off);
    exercise(on);
    // Complete Core events/clocks/HP/heat and every physical C field, not only root position.
    expect(on.trace).toEqual(off.trace);
    return on.pose();
  } finally {
    off.dispose();
    on.dispose();
  }
}
test('actual Core recovery natural completion is125ms inside a120-to140 step', () => {
  const pose = lifecyclePair((h) => {
    h.attack();
    h.advance(120);
    expect(h.actorFor('white').attack?.startedAt).toBe(0);
    h.perform();
    expect(h.core.read().clocks.gameTimeMs).toBe(140);
    expect(h.actorFor('white').attack).toBeNull();
  });
  expect(pose).toMatchObject({
    kind: 'recovery',
    epoch: {
      startMs: 125,
      endMs: 275,
      outgoing: { startedAt: 0 },
      destination: { startedAt: 125, binding: { clipId: 'Idle' } },
    },
  });
});
test('actual Core recovery skipped observations end without restarting destination Idle', () => {
  const pose = lifecyclePair((h) => {
    h.attack();
    h.advance(280);
  });
  expect(pose).toMatchObject({
    kind: 'living',
    living: { mode: 'idle', startedAt: 125 },
  });
});
test('actual Core recovery pause preserves clocks and captured epochs', () => {
  lifecyclePair((h) => {
    h.attack();
    h.advance(140);
    h.core.handle({
      type: 'PauseRequested',
      runId: coreRun,
      reason: 'settings',
    });
    h.commit();
    const paused = h.core.read(),
      pose = h.pose();
    h.core.present(durationMs(1000));
    h.commit();
    expect(h.core.read().clocks).toEqual(paused.clocks);
    expect(h.pose()).toEqual(pose);
    h.core.handle({
      type: 'ResumeRequested',
      runId: coreRun,
      reason: 'settings',
    });
    h.commit();
    h.perform();
    expect(h.core.read().clocks.gameTimeMs).toBe(160);
  });
});
test('actual Core new attack interrupts recovery with its real activation epoch', () => {
  const pose = lifecyclePair((h) => {
    h.attack();
    const first = h.actorFor('white').attack!.activationId;
    h.advance(140);
    h.attack();
    expect(h.actorFor('white').attack?.startedAt).toBe(140);
    expect(h.actorFor('white').attack!.activationId).not.toBe(first);
    h.perform();
  });
  expect(pose).toMatchObject({
    kind: 'living',
    living: { mode: 'attack', startedAt: 140 },
  });
});
test('actual Core jump interrupts recovery without altering paired physical results', () => {
  const pose = lifecyclePair((h) => {
    h.attack();
    h.advance(140);
    h.core.handleInputBatch({
      runId: coreRun,
      tick: tick(h.core.read().clocks.tick + 1),
      commands: [
        {
          type: 'JumpRequested',
          runId: coreRun,
          actorId: h.actorFor('white').actorId,
          input: { commandId: commandId('lifecycle-jump'), sequence: 2 },
        },
      ],
    });
    h.commit();
    h.perform();
  });
  expect(pose).toMatchObject({
    kind: 'living',
    living: { mode: 'jump', startedAt: 160 },
  });
});
for (const offset of [120, 125, 150] as const)
  test(`actual Core fatal contact at${offset} preserves exact strict-left recovery authority`, () => {
    let origin = 0;
    const pose = lifecyclePair((h) => {
      h.prime('white');
      origin = h.core.read().clocks.gameTimeMs;
      h.attack();
      const source = h.attack('blue');
      h.advance(offset === 150 ? 140 : 100);
      const from = h.core.read().clocks.gameTimeMs,
        at = origin + offset;
      // Proposed step crosses natural completion for120/125 and advances past150.
      const dt = at - from + 10;
      const candidate = {
        ...h.bodyHit(source, 'white', at, 'fatal'),
        interval: { from: gameTimeMs(from), to: gameTimeMs(from + dt) },
      };
      const out = h.perform(dt, [candidate]);
      expect(out.snapshot.phase).toBe('terminal');
      expect(out.snapshot.clocks.gameTimeMs).toBe(at);
      expect(
        out.events.find((event) => event.type === 'ActorDefeated')?.at,
      ).toBe(at);
      const provisionalPose = h
        .provisional()!
        .actors.find(
          (actor) => actor.actorId === h.actorFor('white').actorId,
        )?.pose;
      expect(provisionalPose).toMatchObject({
        kind: h.e.poseProtocol?.recovery ? 'recovery' : 'living',
      });
      const captured = h.read();
      expect(h.commit()).toEqual(captured);
    });
    expect(pose).toMatchObject({ kind: 'defeat', entryAt: origin + offset });
    if (pose.kind !== 'defeat') throw Error('Expected actual Core defeat');
    expect(pose.entry).toMatchObject(
      offset <= 125
        ? { mode: 'attack', startedAt: origin }
        : { kind: 'recovery', startMs: origin + 125, endMs: origin + 275 },
    );
  });
test('actual Core endpoint encounter cancellation and1500-plus125 retirement preserve paired authority', () => {
  lifecyclePair((h) => {
    h.prime('blue');
    const source = h.attack('white', 'kick'),
      launchAt = h.core.read().clocks.gameTimeMs + 1;
    const launch = h
      .perform(20, [
        {
          ...envelope(launchAt, 'launch'),
          interval: {
            from: h.core.read().clocks.gameTimeMs,
            to: gameTimeMs(h.core.read().clocks.gameTimeMs + 20),
          },
          kind: 'vehicle-launch',
          source,
          vehicleId: h.car,
        },
      ])
      .events.find((event) => event.type === 'VehicleLaunchApproved');
    if (!launch || launch.type !== 'VehicleLaunchApproved')
      throw Error('Real Core launch missing');
    h.advance(500);
    h.attack();
    const origin = h.actorFor('white').attack!.startedAt;
    h.advance(120);
    const at = origin + 125,
      retired = h.actorFor('blue').actorId;
    const output = h.perform(20, [
      {
        ...envelope(at, 'vehicle-kill'),
        interval: {
          from: gameTimeMs(origin + 120),
          to: gameTimeMs(origin + 140),
        },
        kind: 'vehicle-contact',
        vehicleId: h.car,
        launchId: launch.launchId,
        targetActorId: retired,
      },
    ]);
    expect(
      output.events.some(
        (event) => event.type === 'ActorDefeated' && event.at === at,
      ),
    ).toBe(true);
    expect(h.pose()).toMatchObject({
      kind: 'living',
      living: { mode: 'idle', startedAt: at },
    });
    const old = output;
    h.advance(1500);
    expect(h.core.read().presentation.kind).toBe('opponent-defeat-finish');
    h.advance(125);
    expect(h.core.read().presentation.kind).toBe('none');
    expect(h.core.read().residentActorIds).not.toContain(retired);
    expect(h.e.isRetired(retired)).toBe(true);
    expect(() => h.e.commit(old)).toThrow('Invalid pose residency');
  });
});
test('actual Core recovery engine disposal rejects further committed work', () => {
  const h = lifecycleHarness(true);
  h.attack();
  h.advance(140);
  const output = h.core.drain();
  h.dispose();
  expect(() => h.e.commit(output)).toThrow(/disposed/);
});

import { STARTUP_SOURCES, attackActivationId } from '../../src/contracts';
const startupRunPolicy: PoseRunPolicy = {
  ...policy,
  attackStartStance: 'selected-side-kicks-v1',
  startup: {
    version: 1,
    protocol: 'side-kick-startup-matrix-v1',
    durationMs: durationMs(100),
    fixedLiftSign: 1,
  },
};
function startupDescriptor(): PoseCatalogBindings {
  const b = descriptor();
  return {
    ...b,
    clips: [
      ...b.clips.filter((x) => x.clipId !== 'idle'),
      {
        clipId: clipId('Idle'),
        durationMs: durationMs(100),
        sourceBindingId: 'idle',
      },
      STARTUP_SOURCES.SideKick.binding,
    ],
    locomotion: { ...b.locomotion, idle: clipId('Idle') },
  };
}
function startupCatalog() {
  const c = catalog();
  return {
    ...c,
    get: () => ({
      clipId: clipId('SideKick'),
      category: 'kick' as const,
      durationMs: STARTUP_SOURCES.SideKick.binding.durationMs,
      effectiveRangeM: 1,
      impacts: [
        {
          impactIndex: 0,
          startMs: STARTUP_SOURCES.SideKick.firstActiveMs,
          endMs: durationMs(622.2222447395325),
          damageShare: 1,
          shapeId: 'diagnostic',
        },
      ],
      rootCurve: [],
      sampling: {
        version: 1 as const,
        sampleRateHz: 45,
        interpolation: 'piecewise-linear' as const,
      },
    }),
  };
}
function startupRequest() {
  const a = {
    ...actor('white'),
    attack: {
      activationId: attackActivationId('startup'),
      clipId: clipId('SideKick'),
      category: 'kick' as const,
      startedAt: gameTimeMs(20),
      consumedImpacts: [],
      impactBindings: [],
    },
  };
  return {
    snapshot: state(2, { actors: [a, actor('blue')] }),
    step: { durationMs: durationMs(20) },
    intents: [],
  };
}
test('startup engine admits one shared basis without changing stance-on physical simulation', () => {
  const on = createSpatialEngine(
    run,
    createParisStreetLayout(),
    startupRunPolicy,
  );
  const stance = createSpatialEngine(run, createParisStreetLayout(), {
    ...policy,
    attackStartStance: 'selected-side-kicks-v1',
  });
  try {
    for (const e of [on, stance]) {
      e.poseProtocol!.bindPreparedCatalog(startupDescriptor());
      e.commit({ snapshot: state(), events: [] });
      e.step(
        {
          snapshot: state(1),
          step: { durationMs: durationMs(20) },
          intents: [],
        },
        catalog(),
      );
    }
    const a = on.step(startupRequest(), startupCatalog()),
      b = stance.step(startupRequest(), startupCatalog());
    expect(a.snapshot.actors[0]!.pose).toMatchObject({
      kind: 'startup',
      epoch: { basis: { authority: 'activation-stance-v1' } },
    });
    const physical = (x: typeof a) => ({
      ...x,
      snapshot: {
        ...x.snapshot,
        actors: x.snapshot.actors.map(({ pose, ...p }) => p),
      },
    });
    expect(physical(a)).toEqual(physical(b));
    expect(on.poseProtocol?.startup).toEqual(startupRunPolicy.startup);
    expect(stance.poseProtocol?.startup).toBeUndefined();
  } finally {
    on.dispose();
    stance.dispose();
  }
});
test('startup engine validates pinned window before physical mutation', () => {
  const e = createSpatialEngine(
    run,
    createParisStreetLayout(),
    startupRunPolicy,
  );
  try {
    e.poseProtocol!.bindPreparedCatalog(startupDescriptor());
    e.commit({ snapshot: state(), events: [] });
    e.step(
      { snapshot: state(1), step: { durationMs: durationMs(20) }, intents: [] },
      catalog(),
    );
    const c = startupCatalog();
    expect(() =>
      e.step(startupRequest(), {
        ...c,
        get: () => ({
          ...c.get(),
          impacts: [{ ...c.get().impacts[0]!, startMs: durationMs(1) }],
        }),
      }),
    ).toThrow('window');
    expect(e.step(startupRequest(), c).snapshot.actors[0]!.pose?.kind).toBe(
      'startup',
    );
  } finally {
    e.dispose();
  }
});
test('startup late second actor binding rejection leaves both actors available for unchanged valid retry', () => {
  const e = createSpatialEngine(
    run,
    createParisStreetLayout(),
    startupRunPolicy,
  );
  try {
    e.poseProtocol!.bindPreparedCatalog(startupDescriptor());
    e.commit({ snapshot: state(), events: [] });
    e.step(
      { snapshot: state(1), step: { durationMs: durationMs(20) }, intents: [] },
      catalog(),
    );
    const request = startupRequest(),
      white = request.snapshot.actors[0]!;
    const blue = {
      ...actor('blue'),
      attack: {
        ...white.attack!,
        activationId: attackActivationId('bad-blue'),
        clipId: clipId('SideThrustKick'),
      },
    };
    expect(() =>
      e.step(
        {
          ...request,
          snapshot: { ...request.snapshot, actors: [white, blue] },
        },
        startupCatalog(),
      ),
    ).toThrow();
    const result = e.step(request, startupCatalog());
    expect(result.snapshot.actors[0]!.pose?.kind).toBe('startup');
    expect(result.snapshot.actors[1]!.pose?.kind).toBe('living');
  } finally {
    e.dispose();
  }
});
