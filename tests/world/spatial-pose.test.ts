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
import { actor, run, state, catalog } from './fixtures';
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

// Real Core clocks/outcomes, synthetic contact candidates: no anatomical collision claim.
import {
  setup as coreSetup,
  fixtureCatalog,
  attack as requestAttack,
  reference,
  envelope,
  run as coreRun,
} from '../core/fixtures/scenarios';
import {
  commandId,
  gameTimeMs,
  type SpatialCandidate,
} from '../../src/contracts';
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
