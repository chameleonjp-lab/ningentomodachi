import { Group } from 'three';
import { expect, test } from 'vitest';
import {
  actorId,
  attackActivationId,
  clipId,
  commandId,
  gameTimeMs,
  type GameplayCommand,
  type MotionCatalogPort,
  durationMs,
  presentationTimeMs,
  type CommittedFrame,
} from '../../src/contracts';
import { createSceneAdapter, createParisStreetLayout } from '../../src/scene';
import { actor, catalog, run, state, viewport } from '../world/fixtures';
import { createSpatialEngine } from '../../src/world/spatial-engine';
import { createParisBattleLayout } from '../../src/world/street-layout';
test('retirement hides excluded nodes, rejects obsolete replay and never recreates detached nodes', () => {
  let draws = 0;
  const scene = createSceneAdapter(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
    },
    {
      onInterruption() {},
      createRenderer: () => ({
        domElement: new EventTarget() as HTMLCanvasElement,
        render() {
          draws++;
        },
        dispose() {},
        setSize() {},
        setPixelRatio() {},
      }),
    },
  );
  const blue = new Group();
  let frees = 0;
  blue.addEventListener('removed', () => frees++);
  const detach = scene.renderHost.mountActor({
    runId: run,
    actorId: actorId('blue'),
    node: blue,
  });
  let revision = 0;
  const frame = (ids: string[]): CommittedFrame => {
    const snapshot = state(0, {
      revision: revision++,
      actors: [actor('white'), actor('blue'), actor('green')],
      residentActorIds: ids.map(actorId),
      currentOpponentId: actorId(ids[1] ?? 'blue'),
    });
    return {
      snapshot,
      spatial: scene.commit({ snapshot, events: [] }, viewport),
      events: [],
      viewport,
    };
  };
  try {
    const old = frame(['white', 'blue']);
    expect(() =>
      scene.renderHost.mountActor({
        runId: run,
        actorId: actorId('green'),
        node: new Group(),
      }),
    ).toThrow();
    scene.render(old);
    scene.render(old);
    expect(draws).toBe(2);
    const next = frame(['white', 'green']);
    expect(blue.parent!.parent!.visible).toBe(false);
    expect(() => scene.render(old)).toThrow();
    expect(draws).toBe(2);
    detach();
    detach();
    expect(frees).toBe(1);
    expect(blue.parent).toBeNull();
    expect(() =>
      scene.renderHost.mountActor({
        runId: run,
        actorId: actorId('blue'),
        node: blue,
      }),
    ).toThrow();
    scene.render(next);
    expect(draws).toBe(3);
    expect(blue.parent).toBeNull();
  } finally {
    scene.dispose();
  }
});

test('enemy finishing stage retains the original support clock and side-on camera until retirement', () => {
  const layout = createParisStreetLayout();
  const scene = createSceneAdapter(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
    },
    {
      layout: {
        ...layout,
        objects: [],
        vehicles: [],
        actorSpawns: {
          ...layout.actorSpawns,
          white: { x: 0, y: 0, z: 0 },
          blue: { x: 0, y: 2.3, z: 8 },
        },
      },
      onInterruption() {},
      createRenderer: () => ({
        domElement: new EventTarget() as HTMLCanvasElement,
        render() {},
        dispose() {},
        setSize() {},
        setPixelRatio() {},
      }),
    },
  );
  const node = new Group(),
    id = actorId('blue'),
    start = presentationTimeMs(100);
  const detach = scene.renderHost.mountActor({
    runId: run,
    actorId: id,
    node,
    defeatPoseSupport: 'bounds-v1',
  });
  try {
    for (const [elapsed, progress] of [
      [1500, 0.75],
      [1562.5, 0.875],
      [1625, 1],
    ]) {
      const base = state(0, {
        actors: [
          actor('white'),
          {
            ...actor('blue'),
            defeated: true,
            defeatPresentation: {
              category: 'kick',
              startedAt: start,
              slowDurationMs: durationMs(1500),
              playbackRate: 0.25,
            },
          },
        ],
        residentActorIds: [actorId('white'), id],
        currentOpponentId: null,
        presentation: {
          kind: 'opponent-defeat-finish',
          actorId: id,
          startedAt: start,
          endsAt: presentationTimeMs(1725),
        },
      });
      const snapshot = {
        ...base,
        clocks: {
          ...base.clocks,
          presentationTimeMs: presentationTimeMs(100 + elapsed!),
        },
      };
      const frame = {
        snapshot,
        spatial: scene.commit({ snapshot, events: [] }, viewport),
        events: [],
        viewport,
      };
      expect(
        scene.renderHost.publishDefeatPoseSupport?.({
          runId: run,
          actorId: id,
          defeatStartedAt: start,
          tick: snapshot.clocks.tick,
          presentationTimeMs: snapshot.clocks.presentationTimeMs,
          entryLocalMinY: -2.25,
          currentLocalBounds: {
            min: { x: -0.5, y: 0.002, z: -0.5 },
            max: { x: 0.5, y: 1, z: 0.5 },
          },
        }),
      ).toBe(true);
      scene.render(frame);
      expect(node.parent!.position.y + 2.3 + 0.002).toBeCloseTo(
        0.05 + (0.002 - 0.05) * progress!,
        9,
      );
      const basis = scene.beginMovementSession(`finish-${elapsed}`);
      expect(Math.abs(basis.right.z)).toBeGreaterThan(0.9);
      scene.endMovementSession(`finish-${elapsed}`, 'released');
    }
    const retired = state(0, {
      revision: 1,
      actors: [actor('white'), { ...actor('blue'), defeated: true }],
      residentActorIds: [actorId('white')],
      currentOpponentId: null,
    });
    scene.commit({ snapshot: retired, events: [] }, viewport);
    detach();
    expect(node.parent).toBeNull();
  } finally {
    scene.dispose();
  }
});

// Synthetic catalog fault is deliberately downstream of the reset/motor work.
// This checks rollback through the actual C engine, with no source evaluation.
test.each(['legacy', 'stamped'] as const)(
  'failed reset step restores marker and pose state (%s)',
  (mode) => {
    const layout = {
      ...createParisStreetLayout(),
      objects: [],
      vehicles: [],
      actorSpawns: {
        white: { x: 0, y: 0, z: -1.4 },
        blue: { x: 0, y: 0, z: 1.4 },
        green: { x: 0, y: 0, z: 1.4 },
        yellow: { x: 0, y: 0, z: 1.4 },
        black: { x: 0, y: 0, z: 1.4 },
      },
      battleStage: {
        mode: 'four-battle' as const,
        viewDepth: { x: 0.9781476007338057, y: 0, z: -0.20791169081775931 },
        framingHeightM: 2.1,
        backdropMinX: 7,
      },
    };
    const engine = createSpatialEngine(
      run,
      layout,
      mode === 'stamped'
        ? { version: 1, mode: 'deterministic-pose-v1' }
        : undefined,
    );
    engine.poseProtocol?.bindPreparedCatalog({
      version: 1,
      bindingSetId: 'reset-rollback-synthetic',
      clips: ['idle', 'walk', 'run', 'jump', 'kick'].map((name) => ({
        clipId: clipId(name),
        durationMs: durationMs(100),
        sourceBindingId: `synthetic:${name}`,
      })),
      locomotion: {
        idle: clipId('idle'),
        walk: clipId('walk'),
        run: clipId('run'),
        jump: clipId('jump'),
      },
    });
    const roster = [actor('white'), actor('blue'), actor('green')];
    const pair = [actorId('white'), actorId('blue')];
    const initial = state(0, { actors: roster, residentActorIds: pair });
    const previous = state(1, { actors: roster, residentActorIds: pair });
    const jump: GameplayCommand = {
      type: 'JumpRequested',
      runId: run,
      actorId: actorId('white'),
      input: { commandId: commandId('rollback-jump'), sequence: 1 },
    };
    try {
      engine.commit({ snapshot: initial, events: [] });
      const before = engine.step(
        {
          snapshot: previous,
          step: { durationMs: durationMs(20) },
          intents: [jump],
        },
        catalog(),
      ).snapshot;
      expect(before.actors[0]?.grounded).toBe(false);
      let fail = true;
      const syntheticCatalog: MotionCatalogPort = {
        ...catalog(),
        get: () => ({
          clipId: clipId('kick'),
          category: 'kick',
          durationMs: durationMs(100),
          effectiveRangeM: 1,
          impacts: [],
          rootCurve: [],
          sampling: {
            version: 1,
            sampleRateHz: 50,
            interpolation: 'piecewise-linear',
          },
        }),
        sampleMotion: () => {
          if (fail) throw new Error('synthetic reset-step fault');
          return undefined;
        },
      };
      const next = state(2, {
        actors: [
          actor('white'),
          actor('blue'),
          {
            ...actor('green'),
            attack: {
              activationId: attackActivationId('green-kick'),
              clipId: clipId('kick'),
              category: 'kick',
              startedAt: gameTimeMs(20),
              consumedImpacts: [],
              impactBindings: [],
            },
          },
        ],
        residentActorIds: [actorId('white'), actorId('green')],
        currentOpponentId: actorId('green'),
      });
      const request = {
        snapshot: next,
        step: { durationMs: durationMs(20) },
        intents: [],
      };
      expect(() => engine.step(request, syntheticCatalog)).toThrow(
        'synthetic reset-step fault',
      );
      expect(engine.isRetired(actorId('blue'))).toBe(false);
      expect(engine.commit({ snapshot: previous, events: [] })).toEqual(before);
      fail = false;
      const retried = engine.step(request, syntheticCatalog).snapshot;
      expect(retried.actors.map((a) => a.actorId)).toEqual([
        actorId('white'),
        actorId('green'),
      ]);
      expect(retried.actors[0]).toMatchObject({
        position: { x: 0, y: 0, z: -1.4 },
        velocity: { x: 0, y: 0, z: 0 },
        grounded: true,
        locomotion: 'idle',
      });
      if (mode === 'stamped')
        expect(retried.actors[0]?.pose).toMatchObject({
          kind: 'living',
          living: { mode: 'idle' },
        });
      expect(engine.isRetired(actorId('blue'))).toBe(true);
      expect(() => engine.commit({ snapshot: previous, events: [] })).toThrow(
        /Retired|Invalid pose residency/,
      );
      expect(engine.commit({ snapshot: next, events: [] })).toEqual(retried);
    } finally {
      engine.dispose();
    }
  },
);

// The once-only marker must survive a temporary null opponent. Resetting it
// on that null transition would silently snap both airborne actors to spawn.
test.each(['legacy', 'stamped'] as const)(
  'same opponent reactivation preserves a moving airborne pair after null transition (%s)',
  (mode) => {
    const engine = createSpatialEngine(
      run,
      createParisBattleLayout(),
      mode === 'stamped'
        ? { version: 1, mode: 'deterministic-pose-v1' }
        : undefined,
    );
    engine.poseProtocol?.bindPreparedCatalog({
      version: 1,
      bindingSetId: 'same-opponent-synthetic',
      clips: ['idle', 'walk', 'run', 'jump'].map((name) => ({
        clipId: clipId(name),
        durationMs: durationMs(100),
        sourceBindingId: `synthetic:${name}`,
      })),
      locomotion: {
        idle: clipId('idle'),
        walk: clipId('walk'),
        run: clipId('run'),
        jump: clipId('jump'),
      },
    });
    const roster = [actor('white'), actor('blue')];
    const residents = [actorId('white'), actorId('blue')];
    const basis = engine.begin(
      'airborne-pair',
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    );
    const commands: GameplayCommand[] = roster.flatMap((a, index) => [
      {
        type: 'MoveRequested',
        runId: run,
        actorId: a.actorId,
        x: index === 0 ? 1 : -1,
        z: 0,
        movementSessionId: basis.sessionId,
        basisRevision: basis.revision,
        input: {
          commandId: commandId(`${a.color}:move`),
          sequence: index * 2 + 1,
        },
      },
      {
        type: 'JumpRequested',
        runId: run,
        actorId: a.actorId,
        input: {
          commandId: commandId(`${a.color}:jump`),
          sequence: index * 2 + 2,
        },
      },
    ]);
    try {
      engine.commit({
        snapshot: state(0, { actors: roster, residentActorIds: residents }),
        events: [],
      });
      const airborne = engine.step(
        {
          snapshot: state(1, { actors: roster, residentActorIds: residents }),
          step: { durationMs: durationMs(20) },
          intents: commands,
        },
        catalog(),
      ).snapshot;
      for (const [index, physical] of airborne.actors.entries()) {
        expect(physical.grounded).toBe(false);
        expect(physical.locomotion).toBe('jump');
        expect(physical.position.x).toBeCloseTo(index === 0 ? 0.08 : -0.08);
        expect(physical.position.y).toBeGreaterThan(0);
      }
      const inactive = engine.step(
        {
          snapshot: state(2, {
            actors: roster,
            residentActorIds: residents,
            currentOpponentId: null,
          }),
          step: { durationMs: durationMs(20) },
          intents: commands,
        },
        catalog(),
      ).snapshot;
      const reactivated = engine.commit({
        snapshot: state(2, {
          revision: 3,
          actors: roster,
          residentActorIds: residents,
        }),
        events: [],
      });
      for (const [index, physical] of reactivated.actors.entries()) {
        expect(physical.position).toEqual(airborne.actors[index]?.position);
        expect(physical.position).toEqual(inactive.actors[index]?.position);
        expect(physical.grounded).toBe(false);
        expect(physical.locomotion).toBe('jump');
        if (mode === 'stamped')
          expect(physical.pose).toEqual(airborne.actors[index]?.pose);
      }
      expect(engine.isRetired(actorId('blue'))).toBe(false);
      const continued = engine.step(
        {
          snapshot: state(3, {
            revision: 4,
            actors: roster,
            residentActorIds: residents,
          }),
          step: { durationMs: durationMs(20) },
          intents: commands.filter((c) => c.type === 'MoveRequested'),
        },
        catalog(),
      ).snapshot;
      expect(continued.actors[0]?.position.x).toBeCloseTo(0.16);
      expect(continued.actors[0]?.position.y).toBeGreaterThan(
        reactivated.actors[0]?.position.y ?? Infinity,
      );
    } finally {
      engine.dispose();
    }
  },
);
