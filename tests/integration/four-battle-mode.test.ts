// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { Group, Vector3, type Camera } from 'three';
import { createGame } from '../../src/app/createGame';
import { createIntegratedGame } from '../../src/app/integratedGame';
import { prepareGameAssetBundle } from '../../src/app/prepareGameAssetBundle';
import { buildPoseBindings } from '../../src/assets/poseBindings';
import type { ClipRootPolicy } from '../../src/assets/rootPolicy';
import {
  createActorAnimator,
  createMotionCatalog,
  type MotionAsset,
} from '../../src/assets';
import { createCore } from '../../src/core';
import { createInterface } from '../../src/ui';
import { createSceneAdapter } from '../../src/scene';
import {
  type ActorColor,
  type CommittedFrame,
  type DomainEvent,
  type InputModuleContext,
  type MoveSet,
  type MotionCatalogPort,
  type RunId,
  actorId,
  clipId,
  commandId,
  durationMs,
  type GameplayCommand,
  type PoseCatalogBindings,
  type GameCommand,
  type StampedDefeatSeek,
  type SpatialActor,
} from '../../src/contracts';
import { requireValue } from '../../src/core/invariant';
import { createSpatialEngine } from '../../src/world/spatial-engine';
import * as layouts from '../../src/world/street-layout';
import { actor, catalog, run, state, viewport } from '../world/fixtures';

// Independent geometry fixture lets reset regressions fail on actual engine
// behavior before the production layout factory exists. No source clips load.
function stageLayout() {
  return {
    ...layouts.createParisStreetLayout(),
    actorSpawns: {
      white: { x: 0, y: 0, z: -1.4 },
      blue: { x: 0, y: 0, z: 1.4 },
      green: { x: 0, y: 0, z: 1.4 },
      yellow: { x: 0, y: 0, z: 1.4 },
      black: { x: 0, y: 0, z: 1.4 },
    },
    objects: [],
    vehicles: [],
    bounds: { min: { x: -2, y: 0, z: -5 }, max: { x: 2, y: 12, z: 5 } },
    battleStage: {
      mode: 'four-battle' as const,
      viewDepth: { x: 0.9781476007338057, y: 0, z: -0.20791169081775931 },
      framingHeightM: 2.1,
      backdropMinX: 7,
    },
  };
}
function bindings(): PoseCatalogBindings {
  return {
    version: 1,
    bindingSetId: 'four-battle-synthetic',
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
  };
}
function white(actors: readonly SpatialActor[]) {
  return requireValue(actors.find((a) => a.actorId === actorId('white')));
}

test('four-battle stage shares enemy position and has no destruction targets', () => {
  const legacy = layouts.createParisStreetLayout();
  const layout = layouts.createParisBattleLayout();
  expect(layout.objects).toEqual([]);
  expect(layout.vehicles).toEqual([]);
  expect(layout.actorSpawns.white).toEqual({ x: 0, y: 0, z: -1.4 });
  for (const color of ['blue', 'green', 'yellow', 'black'] as const)
    expect(layout.actorSpawns[color]).toEqual({ x: 0, y: 0, z: 1.4 });
  expect(layout.bounds).toEqual({
    min: { x: -2, y: 0, z: -5 },
    max: { x: 2, y: 12, z: 5 },
  });
  expect(layout).toMatchObject({
    battleStage: { mode: 'four-battle', framingHeightM: 2.1, backdropMinX: 7 },
  });
  const stage = requireValue(layout.battleStage);
  expect(stage.viewDepth.x).toBeCloseTo(0.9781476007338057, 12);
  expect(stage.viewDepth.y).toBe(0);
  expect(stage.viewDepth.z).toBeCloseTo(-0.20791169081775931, 12);
  expect(layouts.createParisStreetLayout()).toEqual(legacy);
  expect(legacy.actorSpawns).toEqual({
    white: { x: 0, y: 0, z: 0 },
    blue: { x: 0, y: 0, z: 8 },
    green: { x: 0, y: 0, z: 24 },
    yellow: { x: 0, y: 0, z: 40 },
    black: { x: 0, y: 0, z: 56 },
  });
  expect(legacy.objects).toHaveLength(8);
  expect(legacy.vehicles).toHaveLength(4);
});

test.each(['legacy', 'stamped'] as const)(
  'opponent activation resets the pair once with matching idle pose (%s)',
  (mode) => {
    const engine = createSpatialEngine(
      run,
      stageLayout(),
      mode === 'stamped'
        ? { version: 1, mode: 'deterministic-pose-v1' }
        : undefined,
    );
    engine.poseProtocol?.bindPreparedCatalog(bindings());
    const roster = [
      {
        ...actor('white'),
        hp: 237,
        heat: { amount: 3, capacity: 7, lockedUntil: null },
      },
      actor('blue'),
      actor('green'),
    ];
    const pair = [actorId('white'), actorId('blue')];
    const initial = state(0, {
      actors: roster,
      residentActorIds: pair,
      currentOpponentId: null,
    });
    const session = engine.begin(
      'held',
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    );
    const move: GameplayCommand = {
      type: 'MoveRequested',
      runId: run,
      actorId: actorId('white'),
      x: 1,
      z: 0,
      movementSessionId: session.sessionId,
      basisRevision: session.revision,
      input: { commandId: commandId('move'), sequence: 1 },
    };
    const jump: GameplayCommand = {
      type: 'JumpRequested',
      runId: run,
      actorId: actorId('white'),
      input: { commandId: commandId('jump'), sequence: 2 },
    };
    try {
      expect(
        white(engine.commit({ snapshot: initial, events: [] }).actors).position,
      ).toEqual({ x: 0, y: 0, z: -1.4 });
      engine.commit({
        snapshot: {
          ...initial,
          revision: 1,
          currentOpponentId: actorId('blue'),
        },
        events: [],
      });
      const running = state(1, {
        revision: 2,
        actors: roster,
        residentActorIds: pair,
      });
      engine.step(
        {
          snapshot: running,
          step: { durationMs: durationMs(20) },
          intents: [move],
        },
        catalog(),
      );
      const airborne = state(2, {
        revision: 3,
        actors: roster,
        residentActorIds: pair,
      });
      const moving = engine.step(
        {
          snapshot: airborne,
          step: { durationMs: durationMs(20) },
          intents: [move, jump],
        },
        catalog(),
      ).snapshot;
      expect(white(moving.actors)).toMatchObject({
        grounded: false,
        locomotion: 'jump',
      });
      expect(white(moving.actors).position.x).toBeCloseTo(0.16);
      expect(Math.abs(white(moving.actors).facing.x)).toBeGreaterThan(0.01);
      const next = state(2, {
        revision: 4,
        actors: roster,
        residentActorIds: [actorId('white'), actorId('green')],
        currentOpponentId: actorId('green'),
      });
      const unchangedAuthority = structuredClone(next);
      const reset = engine.commit({ snapshot: next, events: [] });
      expect(reset.actors.map((a) => a.actorId)).toEqual([
        actorId('white'),
        actorId('green'),
      ]);
      for (const [color, z, facingZ] of [
        ['white', -1.4, 1],
        ['green', 1.4, -1],
      ] as const) {
        const physical = requireValue(
          reset.actors.find((a) => a.actorId === actorId(color)),
        );
        expect(physical).toMatchObject({
          position: { x: 0, y: 0, z },
          facing: { x: 0, y: 0, z: facingZ },
          velocity: { x: 0, y: 0, z: 0 },
          grounded: true,
          locomotion: 'idle',
        });
        if (mode === 'stamped')
          expect(physical.pose).toMatchObject({
            kind: 'living',
            living: { mode: 'idle', startedAt: 40 },
          });
        else expect(physical.pose).toBeUndefined();
      }
      expect(next).toEqual(unchangedAuthority);
      expect(engine.isRetired(actorId('blue'))).toBe(true);
      const advanced = state(3, {
        ...next,
        revision: 5,
        clocks: state(3).clocks,
      });
      const afterMove = engine.step(
        {
          snapshot: advanced,
          step: { durationMs: durationMs(20) },
          intents: [move],
        },
        catalog(),
      ).snapshot;
      expect(white(afterMove.actors).position.x).toBeCloseTo(0.08);
      expect(engine.commit({ snapshot: advanced, events: [] })).toEqual(
        afterMove,
      );
      expect(() => engine.commit({ snapshot: running, events: [] })).toThrow(
        /Retired|Invalid pose residency/,
      );
    } finally {
      engine.dispose();
    }
  },
);

test.each(['legacy', 'stamped'] as const)(
  'stage ignores move and jump while no opponent is active (%s)',
  (mode) => {
    const engine = createSpatialEngine(
      run,
      stageLayout(),
      mode === 'stamped'
        ? { version: 1, mode: 'deterministic-pose-v1' }
        : undefined,
    );
    engine.poseProtocol?.bindPreparedCatalog(bindings());
    const session = engine.begin(
      'transition',
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    );
    const snapshot = state(0, {
      currentOpponentId: null,
      residentActorIds: [actorId('white'), actorId('blue')],
    });
    try {
      const before = engine.commit({ snapshot, events: [] });
      const after = engine.step(
        {
          snapshot: state(1, {
            currentOpponentId: null,
            residentActorIds: [actorId('white'), actorId('blue')],
          }),
          step: { durationMs: durationMs(20) },
          intents: [
            {
              type: 'MoveRequested',
              runId: run,
              actorId: actorId('white'),
              x: 1,
              z: 0,
              movementSessionId: session.sessionId,
              basisRevision: session.revision,
              input: { commandId: commandId('transition-move'), sequence: 1 },
            },
            {
              type: 'JumpRequested',
              runId: run,
              actorId: actorId('white'),
              input: { commandId: commandId('transition-jump'), sequence: 2 },
            },
          ],
        },
        catalog(),
      );
      expect(after.snapshot.actors).toEqual(before.actors);
      expect(after.candidates).toEqual([]);
    } finally {
      engine.dispose();
    }
  },
);

test.each(['legacy', 'stamped'] as const)(
  'paused encounter activation keeps reset physics and pose atomic (%s)',
  (mode) => {
    const engine = createSpatialEngine(
      run,
      stageLayout(),
      mode === 'stamped'
        ? { version: 1, mode: 'deterministic-pose-v1' }
        : undefined,
    );
    engine.poseProtocol?.bindPreparedCatalog(bindings());
    const roster = [actor('white'), actor('blue'), actor('green')];
    const pair = [actorId('white'), actorId('blue')];
    try {
      engine.commit({
        snapshot: state(0, { actors: roster, residentActorIds: pair }),
        events: [],
      });
      engine.step(
        {
          snapshot: state(1, { actors: roster, residentActorIds: pair }),
          step: { durationMs: durationMs(20) },
          intents: [
            {
              type: 'JumpRequested',
              runId: run,
              actorId: actorId('white'),
              input: { commandId: commandId('pause-jump'), sequence: 1 },
            },
          ],
        },
        catalog(),
      );
      const snapshot = state(2, {
        actors: roster,
        residentActorIds: [actorId('white'), actorId('green')],
        currentOpponentId: actorId('green'),
        pauseReasons: ['manual'],
      });
      const paused = engine.step(
        { snapshot, step: { durationMs: durationMs(20) }, intents: [] },
        catalog(),
      ).snapshot;
      expect(white(paused.actors)).toMatchObject({
        position: { x: 0, y: 0, z: -1.4 },
        velocity: { x: 0, y: 0, z: 0 },
        grounded: true,
        locomotion: 'idle',
      });
      if (mode === 'stamped') {
        for (const physical of paused.actors)
          expect(physical.pose).toMatchObject({
            kind: 'living',
            living: { mode: 'idle', startedAt: 40 },
          });
      }
      expect(engine.commit({ snapshot, events: [] })).toEqual(paused);
    } finally {
      engine.dispose();
    }
  },
);

/** Source-free integration: real controller, Core, sampler, animator and scene.
 * Rig geometry, renderer and inert UI/input edges are doubles. Broad synthetic
 * strikes make contact independent of artwork, not source/anatomy acceptance. */
function fourBattleGame(mode: 'legacy' | 'stamped', controls = false) {
  const root = controls ? document.createElement('main') : undefined;
  if (root) document.body.append(root);
  const interfaceFactories = root
    ? createInterface(root, {
        storage: {
          getItem: () => null,
          setItem() {
            throw new Error('Unexpected settings write');
          },
        },
      })
    : undefined;
  const inputCommands: GameCommand[] = [];
  const seeks: { color: ActorColor; clip: string; timeMs: number }[] = [];
  const defeats: { color: ActorColor; input: StampedDefeatSeek }[] = [];
  const motions: MotionAsset[] = ['punch', 'kick'].flatMap((category) =>
    Array.from({ length: category === 'kick' ? 19 : 12 }, (_, i) => ({
      definition: {
        clipId: clipId(`TEST-ONLY:${category}:${i}`),
        category: category as 'punch' | 'kick',
        durationMs: durationMs(20),
        effectiveRangeM: 0.8,
        impacts: [
          {
            impactIndex: 0,
            startMs: durationMs(5),
            endMs: durationMs(15),
            damageShare: 1,
            shapeId: 'TEST-ONLY:broad-strike',
          },
        ],
        rootCurve: [0, 20].map((atMs) => ({
          atMs: durationMs(atMs),
          position: { x: 0, y: 0, z: 0 },
          visualYawRad: 0,
        })),
        sampling: {
          version: 1,
          sampleRateHz: 100,
          interpolation: 'piecewise-linear',
        },
      },
      shapes: [
        {
          shapeId: 'TEST-ONLY:broad-strike',
          keys: [0, 20].map((atMs) => ({
            atMs: durationMs(atMs),
            volume: {
              kind: 'sphere' as const,
              center: {
                x: 0,
                y: controls ? (category === 'punch' ? 1.65 : 0.65) : 1,
                z: controls ? 2.8 : 1.4,
              },
              radiusM: controls ? 0.1 : 2.5,
            },
          })),
        },
      ],
      ownership: [
        {
          atMs: durationMs(0),
          horizontalOwner: 'authored-root' as const,
          verticalOwner: 'spatial-jump' as const,
        },
      ],
    })),
  );
  const punches = motions
    .filter((a) => a.definition.category === 'punch')
    .map((a) => a.definition.clipId);
  const kicks = motions
    .filter((a) => a.definition.category === 'kick')
    .map((a) => a.definition.clipId);
  const moves: Record<ActorColor, MoveSet> = {
    white: { punches, kicks },
    blue: { punches: punches.slice(0, 4), kicks: kicks.slice(0, 4) },
    green: { punches: punches.slice(4, 8), kicks: kicks.slice(4, 8) },
    yellow: { punches: punches.slice(8, 12), kicks: kicks.slice(8, 12) },
    black: { punches: [], kicks },
  };
  const descriptor: PoseCatalogBindings = {
    ...bindings(),
    locomotion: { ...bindings().locomotion, crouch: clipId('crouch') },
    clips: [
      ...bindings().clips,
      {
        clipId: clipId('crouch'),
        durationMs: durationMs(100),
        sourceBindingId: 'synthetic:crouch',
      },
      ...motions.map(({ definition }) => ({
        clipId: definition.clipId,
        durationMs: definition.durationMs,
        sourceBindingId: `synthetic:${definition.clipId}`,
      })),
    ],
  };
  const nodes: Array<{ runId: RunId; color: ActorColor; node: Group }> = [];
  const lifecycle: string[] = [];
  const frames: CommittedFrame[] = [];
  const events: DomainEvent[] = [];
  const inputs = new Map<RunId, InputModuleContext>();
  const scenes = new Map<RunId, ReturnType<typeof createSceneAdapter>>();
  const catalogs = new Map<RunId, MotionCatalogPort>();
  function preparedCatalog(id: RunId) {
    let selected = catalogs.get(id);
    if (!selected) {
      selected = createMotionCatalog(
        async () => motions,
        mode === 'stamped' || controls
          ? { poseBindings: () => descriptor }
          : {},
      );
      catalogs.set(id, selected);
    }
    return selected;
  }
  let camera: Camera | undefined;
  let sequence = 0;
  const game = createGame<Group>(
    {
      ...(interfaceFactories ? { host: interfaceFactories.host } : {}),
      core(context) {
        // Core receives the same run-owned prepared catalog used by C.
        return createCore(context, {
          catalog: preparedCatalog(context.runId),
          moves,
          world: { vehicles: [], objects: [] },
          enemyAi: false,
        });
      },
      catalog: (context) => preparedCatalog(context.runId),
      spatial(context) {
        const scene = createSceneAdapter(context, {
          layout: layouts.createParisBattleLayout(),
          onInterruption() {},
          createRenderer: () => ({
            domElement: controls
              ? document.createElement('canvas')
              : (new EventTarget() as HTMLCanvasElement),
            render(world, drawnCamera) {
              world.updateMatrixWorld(true);
              drawnCamera.updateMatrixWorld(true);
              camera = drawnCamera;
            },
            dispose() {},
            setSize() {},
            setPixelRatio() {},
          }),
        });
        scenes.set(context.runId, scene);
        return scene;
      },
      animation(context) {
        const animation = createActorAnimator(context, {
          poseBindings: descriptor,
          locomotionClips: descriptor.locomotion,
          clipDuration: (id) =>
            id.startsWith('Defeat')
              ? durationMs(500)
              : descriptor.clips.find((b) => b.clipId === id)?.durationMs,
          create(color) {
            const node = new Group();
            nodes.push({ runId: context.runId, color, node });
            lifecycle.push(`create:${context.runId}:${color}`);
            return {
              node,
              seek(clip, seconds) {
                seeks.push({ color, clip, timeMs: seconds * 1000 });
              },
              seekPose(binding, timeMs) {
                seeks.push({ color, clip: binding.clipId, timeMs });
              },
              seekDefeat(input) {
                defeats.push({ color, input });
              },
              setEmissiveEnabled() {},
              dispose() {
                lifecycle.push(
                  `dispose:${context.runId}:${color}:${node.parent === null ? 'detached' : 'mounted'}`,
                );
              },
            };
          },
        });
        // Same loading boundary as the production integrated adapter: C has no
        // qualified stamps before createGame binds its prepared pose catalog.
        return {
          ...animation,
          render(frame) {
            if (frame.snapshot.phase !== 'loading') animation.render(frame);
          },
        };
      },
      ui: (context) => {
        const hud = interfaceFactories?.ui(context);
        return {
          ...(hud ? { prepareLayout: hud.prepareLayout } : {}),
          render(frame, projection) {
            hud?.render(frame, projection);
            frames.push(frame);
            events.push(...frame.events);
            const mounted = nodes.filter(({ node }) => node.parent !== null);
            // Real B/C mount lifecycle, not a double-maintained live counter.
            expect(mounted.length).toBeLessThanOrEqual(2);
            if (frame.snapshot.phase !== 'loading') {
              expect(
                mounted
                  .map(({ runId, color }) => `${runId}:actor:${color}`)
                  .sort(),
              ).toEqual(
                [...requireValue(frame.snapshot.residentActorIds)].sort(),
              );
              expect(frame.spatial.actors.map((a) => a.actorId).sort()).toEqual(
                [...requireValue(frame.snapshot.residentActorIds)].sort(),
              );
              for (const { node } of mounted)
                for (let parent = node.parent; parent; parent = parent.parent)
                  expect(parent.visible).toBe(true);
            }
          },
          dispose() {
            hud?.dispose();
          },
        };
      },
      input(context) {
        inputs.set(context.runId, context);
        if (interfaceFactories) {
          const input = interfaceFactories.input(context);
          return {
            ...input,
            subscribe(listener) {
              return input.subscribe((original) => {
                // Test-only hostile commands share this transport. Re-sequence the
                // merged stream without replacing real PointerInput semantics.
                const command =
                  'input' in original
                    ? {
                        ...original,
                        input: { ...original.input, sequence: ++sequence },
                      }
                    : original;
                inputCommands.push(command);
                listener(command);
              });
            },
          };
        }
        return {
          subscribe: () => () => {},
          setGate() {},
          releaseAll() {},
          dispose() {},
        };
      },
    },
    {
      sessionId: `four-battle-${mode}`,
      seed: 42,
      stepMs: 20,
      viewport,
      ...(mode === 'stamped'
        ? {
            posePolicy: {
              version: 1 as const,
              mode: 'deterministic-pose-v1' as const,
            },
          }
        : {}),
      yieldBeforePreparation: async () => {},
    },
  );
  const read = () => requireValue(game.read());
  const frame = () => requireValue(frames.at(-1));
  const logical = (color: ActorColor) =>
    requireValue(read().actors.find((a) => a.color === color));
  const physical = (color: ActorColor) =>
    requireValue(
      frame().spatial.actors.find((a) => a.actorId === logical(color).actorId),
    );
  function strike(color: ActorColor, category: 'punch' | 'kick') {
    game.dispatch({
      type: 'AttackRequested',
      runId: read().runId,
      actorId: logical(color).actorId,
      category,
      input: {
        commandId: commandId(`hostile-or-fixture:${++sequence}`),
        sequence,
      },
    });
  }
  function pointer(
    action: 'move' | 'punch' | 'kick' | 'jump',
    type: string,
    pointerId: number,
    x = 100,
    y = 100,
  ) {
    const element = requireValue(
      action === 'move'
        ? root?.querySelector<HTMLElement>('.nt-swipe')
        : [
            ...requireValue(root).querySelectorAll<HTMLButtonElement>('button'),
          ].find(
            (b) =>
              b.textContent ===
              { punch: 'パンチ', kick: 'キック', jump: 'ジャンプ' }[action],
          ),
    );
    const target =
      type === 'pointerdown' || type === 'lostpointercapture'
        ? element
        : document;
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    target.dispatchEvent(event);
  }
  function hit(color: ActorColor = 'white') {
    game.advance(500);
    const target =
      color === 'white'
        ? requireValue(
            read().actors.find((a) => a.actorId === read().currentOpponentId),
          )
        : logical('white');
    const before = target.hp;
    game.dispatch({
      type: 'AttackRequested',
      runId: read().runId,
      actorId: logical(color).actorId,
      category: color === 'black' ? 'kick' : 'punch',
      input: { commandId: commandId(`integration:${++sequence}`), sequence },
    });
    game.advance(20);
    expect(logical(target.color).hp).toBe(before - 100);
  }
  function move() {
    const input = requireValue(inputs.get(read().runId));
    const basis = input.movement.begin(`move:${++sequence}`);
    game.dispatch({
      type: 'MoveRequested',
      runId: read().runId,
      actorId: logical('white').actorId,
      x: 1,
      z: 0,
      movementSessionId: basis.sessionId,
      basisRevision: basis.revision,
      input: { commandId: commandId(`integration:${++sequence}`), sequence },
    });
    game.advance(20);
    input.movement.end(basis.sessionId, 'released');
  }
  function assertReset(color: ActorColor) {
    expect(read().currentOpponentId).toBe(logical(color).actorId);
    for (const [name, z, facingZ] of [
      ['white', -1.4, 1],
      [color, 1.4, -1],
    ] as const) {
      const body = physical(name);
      expect(body).toMatchObject({
        position: { x: 0, y: 0, z },
        velocity: { x: 0, y: 0, z: 0 },
        grounded: true,
        locomotion: 'idle',
      });
      expect(body.facing.x).toBeCloseTo(0, 12);
      expect(body.facing.y).toBe(0);
      expect(body.facing.z).toBeCloseTo(facingZ, 12);
      if (mode === 'stamped')
        expect(body.pose).toMatchObject({
          kind: 'living',
          living: { mode: 'idle' },
        });
      const drawn = requireValue(camera);
      for (const x of [-0.5, 0.5])
        for (const y of [0, 2.1])
          for (const dz of [-0.5, 0.5]) {
            const point = new Vector3(x, y, z + dz).project(drawn);
            expect(
              Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)),
            ).toBeLessThanOrEqual(1);
          }
    }
    const drawn = requireValue(camera);
    expect(
      new Vector3().copy(physical('white').position).project(drawn).x,
    ).toBeLessThan(
      new Vector3().copy(physical(color).position).project(drawn).x,
    );
    expect(drawn.position.x).toBeLessThan(0);
  }
  return {
    game,
    motions,
    moves,
    descriptor,
    root,
    seeks,
    defeats,
    inputCommands,
    pointer,
    strike,
    read,
    frame,
    logical,
    physical,
    hit,
    move,
    assertReset,
    nodes,
    lifecycle,
    frames,
    events,
    scenes,
  };
}

// Catches missing/extra encounter activation, HP healing/cap changes, spatial
// resets omitted or repeated, old rig overlap, and altered score inputs/formula.
test.each(['legacy', 'stamped'] as const)(
  'four battles reset and clear with retained health rules (%s)',
  async (mode) => {
    const h = fourBattleGame(mode);
    try {
      await h.game.start();
      expect(h.read().phase).toBe('ready');
      expect(h.read().currentOpponentId).toBeNull();
      expect(h.read().actors.map((a) => [a.color, a.hp, a.maxHp])).toEqual([
        ['white', 500, 500],
        ['blue', 500, 500],
        ['green', 500, 500],
        ['yellow', 500, 500],
        ['black', 700, 700],
      ]);
      h.game.dispatch({ type: 'StartRequested', runId: h.read().runId });
      h.assertReset('blue');
      h.hit('blue');
      h.hit('blue');
      expect(h.logical('white').hp).toBe(300);
      const colors = ['blue', 'green', 'yellow', 'black'] as const;
      for (const [index, color] of colors.entries()) {
        h.assertReset(color);
        h.move();
        const moved = { ...h.physical('white').position };
        expect(moved).not.toEqual({ x: 0, y: 0, z: -1.4 });
        for (let hit = 0; hit < (color === 'black' ? 7 : 5); hit++) h.hit();
        expect(h.logical('white').hp).toBe([400, 500, 500, 500][index]);
        expect(h.logical(color).defeated).toBe(true);
        expect(h.physical('white').position).toEqual(moved);
        if (index < 3) {
          const dying = h.frame();
          expect(h.read().currentOpponentId).toBeNull();
          expect(h.read().residentActorIds).toEqual([
            h.logical('white').actorId,
            h.logical(color).actorId,
          ]);
          for (let n = 0; h.read().currentOpponentId === null && n < 90; n++)
            h.game.advance(20);
          const next = requireValue(colors[index + 1]);
          h.assertReset(next);
          const oldNode = requireValue(
            h.nodes.find((n) => n.color === color),
          ).node;
          expect(oldNode.parent).toBeNull();
          expect(
            h.lifecycle.indexOf(`dispose:${h.read().runId}:${color}:detached`),
          ).toBeLessThan(
            h.lifecycle.indexOf(`create:${h.read().runId}:${next}`),
          );
          expect(() =>
            requireValue(h.scenes.get(h.read().runId)).render(dying),
          ).toThrow(/Retired/);
        }
      }
      expect(h.read().actors).toHaveLength(5);
      expect(
        h.events
          .filter(
            (e) => e.type === 'OpponentChanged' && e.currentActorId !== null,
          )
          .map((e) => (e.type === 'OpponentChanged' ? e.currentActorId : null)),
      ).toEqual(colors.map((color) => h.logical(color).actorId));
      expect(
        h.events
          .filter((e) => e.type === 'Healed')
          .map((e) =>
            e.type === 'Healed'
              ? [e.beforeHp, e.afterHp, e.actualHpGained, e.maxHp]
              : [],
          ),
      ).toEqual([
        [300, 400, 100, 500],
        [400, 500, 100, 500],
      ]);
      const result = requireValue(h.read().result);
      const seconds = result.finalizedAt / 1000;
      expect(result).toMatchObject({
        outcome: 'clear',
        score: {
          defeatedEnemies: 4,
          remainingHp: 500,
          clearTime: result.finalizedAt,
          survivalTime: result.finalizedAt,
          streetDestructionRate: 0,
          vehicleDestructionRate: 0,
          playerCausedDestructionRate: 0,
          destructionPenalty: 0,
        },
      });
      // Independent hand-derived score: defeats4000 + HP1000 + clear2000
      // + speed(6000-10t) + survival2t; no production score helper reused.
      expect(result.score.total).toBe(Math.round(13000 - 8 * seconds));
      expect(result.score.contributions).toMatchObject({
        survival: seconds * 2,
        defeats: 4000,
        remainingHp: 1000,
        clear: 2000,
        speed: 6000 - seconds * 10,
      });
      expect(requireValue(result.score.contributions).destruction).toBeCloseTo(
        0,
      );
      expect(h.read().world).toEqual({ vehicles: [], objects: [] });
      const terminal = h.read();
      h.game.advance(5000);
      expect(h.read().result).toEqual(result);
      expect(h.read().clocks.gameTimeMs).toBe(terminal.clocks.gameTimeMs);
      expect(h.read().actors.map((a) => a.heat)).toEqual(
        terminal.actors.map((a) => a.heat),
      );
      expect(h.read().presentation.kind).toBe('results');
      expect(h.game.lastError()).toBeNull();
    } finally {
      h.game.dispose();
    }
    expect(h.nodes.every(({ node }) => node.parent === null)).toBe(true);
    expect(
      h.lifecycle.filter((event) => event.startsWith('dispose:')),
    ).toHaveLength(h.nodes.length);
  },
);

// Catches presentation advancing while paused, a retry retaining old actors or
// clocks, and old-run commands/frames mutating a newly allocated pair.
test.each(['legacy', 'stamped'] as const)(
  'defeat retry and pause during opponent transition do not leak a pair (%s)',
  async (mode) => {
    const h = fourBattleGame(mode);
    try {
      await h.game.start();
      h.game.dispatch({ type: 'StartRequested', runId: h.read().runId });
      for (let i = 0; i < 5; i++) h.hit();
      h.game.advance(1500);
      expect(h.read().presentation.kind).toBe('opponent-defeat-finish');
      const oldRun = h.read().runId;
      h.game.dispatch({
        type: 'PauseRequested',
        runId: oldRun,
        reason: 'manual',
      });
      const paused = h.read(),
        pausedBodies = h.frame().spatial.actors;
      h.game.advance(10000);
      expect(h.read()).toEqual(paused);
      expect(h.frame().spatial.actors).toEqual(pausedBodies);
      h.game.dispatch({
        type: 'ResumeRequested',
        runId: oldRun,
        reason: 'manual',
      });
      h.game.advance(120);
      h.assertReset('green');
      for (let i = 0; i < 5; i++) h.hit('green');
      expect(h.read().result).toMatchObject({
        outcome: 'defeat',
        score: { defeatedEnemies: 1, remainingHp: 0 },
      });
      const oldFrame = h.frame();
      h.game.advance(2400);
      expect(h.read().presentation.kind).toBe('results');
      const oldScene = requireValue(h.scenes.get(oldRun));
      h.game.dispatch({ type: 'RetryRequested', runId: oldRun });
      await expect
        .poll(() => h.game.hostState().startup?.requiredAssetsReady)
        .toBe(true);
      const ready = h.read();
      expect(ready.runId).not.toBe(oldRun);
      expect(ready.phase).toBe('ready');
      expect(ready.clocks).toEqual({
        tick: 0,
        gameTimeMs: 0,
        activeRealTimeMs: 0,
        presentationTimeMs: 0,
      });
      expect(ready.result).toBeNull();
      expect(ready.actors.map((a) => a.hp)).toEqual([500, 500, 500, 500, 700]);
      expect(
        h.nodes
          .filter((n) => n.runId === oldRun)
          .every(({ node }) => node.parent === null),
      ).toBe(true);
      const oldDisposals = h.lifecycle
        .map((event, i) => ({ event, i }))
        .filter(({ event }) => event.startsWith(`dispose:${oldRun}:`));
      const newAllocation = h.lifecycle.findIndex((event) =>
        event.startsWith(`create:${ready.runId}:`),
      );
      expect(oldDisposals).toHaveLength(
        h.nodes.filter((node) => node.runId === oldRun).length,
      );
      expect(oldDisposals.every(({ i }) => i < newAllocation)).toBe(true);
      h.game.dispatch({ type: 'RetryRequested', runId: oldRun });
      h.game.dispatch({
        type: 'ResumeRequested',
        runId: oldRun,
        reason: 'manual',
      });
      h.game.dispatch({
        type: 'AttackRequested',
        runId: oldRun,
        actorId: requireValue(paused.actors[0]).actorId,
        category: 'punch',
        input: { commandId: commandId('late-old-run'), sequence: 9999 },
      });
      expect(h.read()).toEqual(ready);
      expect(() => oldScene.render(oldFrame)).toThrow(/disposed/i);
      expect(() =>
        requireValue(h.scenes.get(ready.runId)).commit(
          { snapshot: oldFrame.snapshot, events: [] },
          viewport,
        ),
      ).toThrow(/Stale (spatial|pose) run|Invalid pose frame run/);
      expect(h.read()).toEqual(ready);
      h.game.advance(3000);
      expect(h.read().phase).toBe('running');
      h.assertReset('blue');
      expect(h.read().clocks.gameTimeMs).toBe(0);
      h.hit();
      expect(h.logical('blue').hp).toBe(400);
      expect(h.game.lastError()).toBeNull();
    } finally {
      h.game.dispose();
    }
    expect(h.nodes.every(({ node }) => node.parent === null)).toBe(true);
    expect(
      h.lifecycle.filter((event) => event.startsWith('dispose:')),
    ).toHaveLength(h.nodes.length);
  },
);

// Full Stage A+B composition through actual DOM binding, PointerInput, controller,
// Core, scene/spatial/hurt/timeline, animator and Japanese shell/HUD. Synthetic
// point strikes and recording rigs are contract evidence, not WebGL play QA.
test.each(['stamped', 'legacy'] as const)(
  'composed controls keep hold, hurt, two-finger ownership and all four battles coherent (%s)',
  async (mode) => {
    const h = fourBattleGame(mode, true);
    try {
      await h.game.start();
      h.game.dispatch({ type: 'StartRequested', runId: h.read().runId });
      h.assertReset('blue');
      const root = requireValue(h.root);
      expect(root.textContent).toContain(
        '左右：移動　上：ジャンプ　下：しゃがみ',
      );
      const attacks = [
        ...root.querySelectorAll<HTMLButtonElement>('button'),
      ].filter((b) => ['パンチ', 'キック'].includes(b.textContent ?? ''));
      expect(attacks.map((b) => b.style.width)).toEqual(['80px', '80px']);
      const start = h.physical('white').position;
      h.pointer('move', 'pointerdown', 1);
      h.pointer('move', 'pointermove', 1, 100, 68);
      h.game.advance(20);
      expect(h.physical('white').grounded).toBe(false);
      h.game.advance(1200);
      expect(h.physical('white').grounded).toBe(true);
      h.pointer('move', 'pointermove', 1, 100, 20);
      h.game.advance(20);
      expect(h.physical('white').grounded).toBe(true);
      expect(
        h.inputCommands.filter((c) => c.type === 'JumpRequested'),
      ).toHaveLength(1);
      expect(h.physical('white').position).toEqual(start);
      h.pointer('move', 'pointerup', 1);
      h.pointer('move', 'pointerdown', 2);
      h.pointer('move', 'pointermove', 2, 100, 132);
      h.game.advance(20);
      expect(h.logical('white').crouching).toBe(true);
      expect(h.physical('white').locomotion).toBe('crouch');
      const firstHold = h.physical('white').pose;
      h.game.advance(200);
      if (mode === 'stamped') {
        expect(h.physical('white').pose).toEqual(firstHold);
        expect(firstHold).toMatchObject({
          kind: 'living',
          living: { mode: 'crouch', playback: 'hold' },
        });
      }
      expect(
        h.seeks.filter((s) => s.color === 'white' && s.clip === 'crouch')
          .length,
      ).toBeGreaterThan(1);
      expect(
        h.seeks
          .filter((s) => s.color === 'white' && s.clip === 'crouch')
          .every((s) => s.timeMs === 0),
      ).toBe(true);
      expect(h.physical('white').position).toEqual(start);
      h.strike('blue', 'punch');
      h.game.advance(20);
      expect(h.logical('white').hp).toBe(500); // high point strike misses low capsule
      h.game.advance(500);
      h.strike('blue', 'kick');
      h.game.advance(20);
      expect(h.logical('white')).toMatchObject({ hp: 400, crouching: true });
      expect(
        root
          .querySelector('[aria-label="プレイヤー HP"]')
          ?.getAttribute('aria-valuenow'),
      ).toBe('400');
      h.pointer('move', 'pointermove', 2, 100, 100);
      h.game.advance(20);
      expect(h.logical('white').crouching).toBe(false);
      h.game.advance(500);
      h.strike('blue', 'punch');
      h.game.advance(20);
      expect(h.logical('white').hp).toBe(300); // identical high point strikes standing
      h.pointer('move', 'pointermove', 2, 100, 132);
      h.game.advance(20);
      h.pointer('punch', 'pointerdown', 3);
      h.game.advance(20);
      expect(h.logical('white').crouching).toBe(false);
      expect(h.logical('blue').hp).toBe(400);
      h.pointer('punch', 'pointerup', 3);
      attacks[0]?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 1 }),
      );
      h.game.advance(20);
      expect(h.logical('blue').hp).toBe(400); // pointer synthetic click is not a second strike
      h.pointer('move', 'pointermove', 2, 164, 100);
      const beforeMove = h.physical('white').position;
      h.game.advance(20);
      expect(h.physical('white').position).not.toEqual(beforeMove); // lifting attack did not steal swipe
      h.pointer('move', 'pointermove', 2, 100, 132);
      h.game.advance(20);
      expect(h.logical('white').crouching).toBe(true);
      h.pointer('move', 'lostpointercapture', 2);
      expect(h.logical('white').crouching).toBe(false);
      for (const reason of ['pointercancel', 'blur', 'pause'] as const) {
        h.pointer('move', 'pointerdown', 4);
        h.pointer('move', 'pointermove', 4, 100, 132);
        h.game.advance(20);
        expect(h.logical('white').crouching).toBe(true);
        if (reason === 'pointercancel') h.pointer('move', 'pointercancel', 4);
        else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
        else
          h.game.dispatch({
            type: 'PauseRequested',
            runId: h.read().runId,
            reason: 'manual',
          });
        expect(h.logical('white').crouching).toBe(false);
        if (reason === 'pause')
          h.game.dispatch({
            type: 'ResumeRequested',
            runId: h.read().runId,
            reason: 'manual',
          });
      }
      for (const color of ['blue', 'green', 'yellow', 'black'] as const) {
        expect(h.read().currentOpponentId).toBe(h.logical(color).actorId);
        while (!h.logical(color).defeated) {
          h.game.advance(500);
          h.pointer('kick', 'pointerdown', 5);
          h.pointer('kick', 'pointerup', 5);
          h.game.advance(20);
        }
        if (color !== 'black') expect(h.read().currentOpponentId).toBeNull();
        else
          expect(h.read().currentOpponentId).toBe(h.logical('black').actorId);
        expect(h.logical('white').crouching).toBe(false);
        h.game.advance(1700);
        h.game.advance(0);
        if (color !== 'black')
          h.assertReset(
            ({ blue: 'green', green: 'yellow', yellow: 'black' } as const)[
              color
            ],
          );
      }
      expect(h.read().result).toMatchObject({
        outcome: 'clear',
        score: { defeatedEnemies: 4, remainingHp: 500, destructionPenalty: 0 },
      });
      h.game.advance(1000);
      expect(h.read().presentation.kind).toBe('results');
      expect(root.textContent).toContain('クリア');
      expect(
        h.events
          .filter((e) => e.type === 'Healed')
          .map((e) => (e.type === 'Healed' ? [e.beforeHp, e.afterHp] : [])),
      ).toEqual([
        [300, 400],
        [400, 500],
      ]);
      expect(h.game.lastError()).toBeNull();
    } finally {
      h.game.dispose();
      h.root?.remove();
    }
  },
);

test.each(['stamped', 'legacy'] as const)(
  'composed low-strike death and Japanese retry clear old hold and resident rigs (%s)',
  async (mode) => {
    const h = fourBattleGame(mode, true);
    try {
      await h.game.start();
      h.game.dispatch({ type: 'StartRequested', runId: h.read().runId });
      h.pointer('move', 'pointerdown', 10);
      h.pointer('move', 'pointermove', 10, 100, 132);
      h.game.advance(20);
      const oldRun = h.read().runId;
      expect(h.logical('white').crouching).toBe(true);
      for (let n = 0; n < 5; n++) {
        h.game.advance(500);
        h.strike('blue', 'kick');
        h.game.advance(20);
      }
      expect(h.logical('white')).toMatchObject({
        hp: 0,
        defeated: true,
        crouching: false,
      });
      expect(h.read().phase).toBe('terminal');
      if (mode === 'stamped') {
        expect(h.physical('white').pose).toMatchObject({
          kind: 'defeat',
          entry: { mode: 'crouch', playback: 'hold' },
        });
        expect(
          h.defeats.find((s) => s.color === 'white')?.input.entry,
        ).toMatchObject({
          binding: { clipId: 'crouch' },
          clipTime: 0,
          sampleSide: 'left',
        });
      } else {
        expect(
          h.seeks.some((s) => s.color === 'white' && s.clip === 'crouch'),
        ).toBe(true);
        expect(
          h.seeks
            .filter((s) => s.color === 'white' && s.clip === 'crouch')
            .every((s) => s.timeMs === 0),
        ).toBe(true);
        expect(
          h.seeks.some((s) => s.color === 'white' && s.clip === 'DefeatKick'),
        ).toBe(true);
      }
      h.game.advance(2400);
      const retry = requireValue(
        [
          ...requireValue(h.root).querySelectorAll<HTMLButtonElement>('button'),
        ].find((b) => b.textContent === '再挑戦'),
      );
      retry.click();
      await expect
        .poll(() => h.game.hostState().startup?.requiredAssetsReady)
        .toBe(true);
      expect(h.read().runId).not.toBe(oldRun);
      expect(h.read().actors.map((a) => a.hp)).toEqual([
        500, 500, 500, 500, 700,
      ]);
      expect(h.read().actors.every((a) => !a.crouching)).toBe(true);
      expect(
        h.nodes
          .filter((n) => n.runId === oldRun)
          .every((n) => n.node.parent === null),
      ).toBe(true);
      h.game.advance(3000);
      h.assertReset('blue');
      // The old captured pointer does not transfer across the run lifetime.
      h.pointer('move', 'pointermove', 10, 100, 200);
      h.game.advance(20);
      expect(h.logical('white').crouching).toBe(false);
      expect(h.physical('white').locomotion).toBe('idle');
      expect(h.game.lastError()).toBeNull();
    } finally {
      h.game.dispose();
      h.root?.remove();
    }
  },
);

// Uses the unchanged production composition, not the test's injectable catalog.
// Both modes must preserve the prepared optional crouch capability for real Core.
test.each([
  { mode: 'stamped', crouch: true, unselected: false },
  { mode: 'legacy', crouch: true, unselected: false },
  { mode: 'legacy', crouch: false, unselected: false },
  { mode: 'stamped', crouch: false, unselected: true },
  { mode: 'legacy', crouch: false, unselected: true },
] as const)(
  'production composition preserves optional Core crouch capability ($mode, crouch=$crouch, unselected=$unselected)',
  async ({ mode, crouch, unselected }) => {
    const fixture = fourBattleGame(mode);
    fixture.game.dispose();
    const root = document.createElement('main');
    document.body.append(root);
    const game = createIntegratedGame(root, {
      sessionId: `production-crouch-${mode}`,
      seed: 42,
      stepMs: 20,
      viewport,
      ...(mode === 'stamped'
        ? { posePolicy: { version: 1, mode: 'deterministic-pose-v1' } as const }
        : {}),
      configuration: {
        moves: fixture.moves,
        layout: layouts.createParisBattleLayout(),
        world: { vehicles: [], objects: [] },
        loadAssets: async (_context, signal) => {
          if (unselected) {
            const motions = fixture.motions.map((asset, index) => ({
              asset,
              rootPolicy: {
                version: 1,
                clipId: asset.definition.clipId,
                sourceSha256: 'a'.repeat(64),
                mode: 'full-translation',
                provenance: {
                  manifestSha256: 'b'.repeat(64),
                  clipPointer: `/clips/${index}`,
                  supportPointer: `/clips/${index}/support_contacts`,
                },
              } satisfies ClipRootPolicy,
            }));
            const clips = [
              ...['Idle', 'Walk', 'Run', 'Jump', 'CrouchMove'].map((name) => ({
                clipId: clipId(name),
                durationMs: durationMs(100),
              })),
              ...['DefeatPunch', 'DefeatKick'].map((name) => ({
                clipId: clipId(name),
                durationMs: durationMs(500),
              })),
              ...fixture.motions.map((a) => ({
                clipId: a.definition.clipId,
                durationMs: a.definition.durationMs,
              })),
            ];
            const descriptor = await buildPoseBindings(
              clips.map((clip, index) => ({
                ...clip,
                sourceSha256: 'a'.repeat(64),
                sourceClipIndex: index,
              })),
            );
            expect(descriptor.locomotion.crouch).toBe('CrouchMove');
            return prepareGameAssetBundle({
              motions,
              signal,
              locomotionClips: {
                idle: clipId('Idle'),
                walk: clipId('Walk'),
                run: clipId('Run'),
                jump: clipId('Jump'),
              },
              loadVisuals: async () => ({
                poseBindings: descriptor,
                clipDuration: (id) =>
                  clips.find((c) => c.clipId === id)?.durationMs,
                clipNames: () => clips.map((c) => c.clipId),
                rootPolicy: (id) =>
                  motions.find((m) => m.rootPolicy.clipId === id)?.rootPolicy,
                create: () => ({
                  node: new Group(),
                  seek() {},
                  seekPose() {},
                  seekDefeat() {},
                  setEmissiveEnabled() {},
                  dispose() {},
                }),
                dispose() {},
              }),
            });
          }
          return {
            motions: fixture.motions,
            animator: {
              ...(crouch ? { poseBindings: fixture.descriptor } : {}),
              locomotionClips: crouch
                ? fixture.descriptor.locomotion
                : bindings().locomotion,
              clipDuration: (id) =>
                id.startsWith('Defeat')
                  ? durationMs(500)
                  : fixture.descriptor.clips.find((b) => b.clipId === id)
                      ?.durationMs,
              create: () => ({
                node: new Group(),
                seek() {},
                seekPose() {},
                seekDefeat() {},
                setEmissiveEnabled() {},
                dispose() {},
              }),
              dispose() {},
            },
          };
        },
      },
      createRenderer: () => ({
        domElement: document.createElement('canvas'),
        render() {},
        dispose() {},
        setSize() {},
        setPixelRatio() {},
      }),
    });
    try {
      await game.start();
      game.dispatch({
        type: 'StartRequested',
        runId: requireValue(game.read()).runId,
      });
      const event = (type: string, y: number) => {
        const e = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 100,
          clientY: y,
        });
        Object.defineProperty(e, 'pointerId', { value: 41 });
        return e;
      };
      requireValue(root.querySelector('.nt-swipe')).dispatchEvent(
        event('pointerdown', 100),
      );
      document.dispatchEvent(event('pointermove', 132));
      game.advance(20);
      expect(game.lastError()).toBeNull();
      expect(requireValue(game.read()).actors[0]?.crouching).toBe(crouch);
      expect(requireValue(game.read()).phase).toBe('running');
    } finally {
      game.dispose();
      root.remove();
    }
  },
);
