/** TEST ONLY: actual source rigs/motor with explicit synthetic authority, not a combat catalog. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type Camera, type Object3D, SkinnedMesh, Vector3 } from 'three';
import {
  type ActorRig,
  authorDeathClips,
  bakeMotion,
  createActorAnimator,
  createMotionCatalog,
  createSourceEvaluator,
  createThreeAssetPack,
  inspectGlb,
  SOURCE_PALETTES,
  type ThreeAssetPack,
} from '../../../src/assets';
import {
  type ActorColor,
  actorId,
  attackActivationId,
  type CommittedFrame,
  clipId,
  commandId,
  durationMs,
  type GameplayCommand,
  type GameSnapshot,
  gameTimeMs,
  impactId,
  presentationTimeMs,
  tick,
  type ViewportSnapshot,
} from '../../../src/contracts';
import { calculateScore } from '../../../src/core';
import {
  createParisStreetLayout,
  createSceneAdapter,
} from '../../../src/scene';
import { actor, run, state } from '../../world/fixtures';

export async function loadDuelAssets() {
  const sources = new Map<string, Uint8Array>();
  const lock = JSON.parse(
    readFileSync('tools/assets/source-lock.json', 'utf8'),
  );
  for (const category of ['movement', 'jump', 'punch', 'kick']) {
    const path = `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`;
    const bytes = new Uint8Array(readFileSync(path));
    const receipt = lock.sources.find((s: { path: string }) => s.path === path);
    if (
      !receipt ||
      receipt.bytes !== bytes.length ||
      receipt.sha256 !== createHash('sha256').update(bytes).digest('hex')
    )
      throw Error('Original source lock mismatch');
    sources.set(category, bytes);
  }
  const original = await createThreeAssetPack([...sources.values()]);
  const seed = original.create('white');
  try {
    seed.seek(clipId('Idle'), 0);
    const pack = await createThreeAssetPack(
      [...sources.values()],
      SOURCE_PALETTES,
      authorDeathClips(seed.node),
    );
    return { sources, pack };
  } finally {
    seed.dispose();
    original.dispose();
  }
}
export function worldSurface(node: Object3D) {
  node.updateWorldMatrix(true, true);
  const min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity),
    p = new Vector3();
  let vertices = 0;
  node.traverse((mesh) => {
    if (!(mesh instanceof SkinnedMesh)) return;
    mesh.skeleton.update();
    for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
      min.min(p);
      max.max(p);
      vertices++;
    }
  });
  return { min, max, vertices };
}
export function projectedWorldBounds(
  bounds: ReturnType<typeof worldSurface>,
  camera: Camera,
) {
  const points = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z])
        points.push(new Vector3(x, y, z).project(camera));
  return {
    maxXY: Math.max(...points.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)])),
    minDepth: Math.min(...points.map((p) => p.z)),
    maxDepth: Math.max(...points.map((p) => p.z)),
  };
}
export async function createDuelWorld(
  pack: ThreeAssetPack,
  bytes: Uint8Array,
  name: string,
  victim: 'white' | 'blue',
  viewport: ViewportSnapshot,
) {
  const source = inspectGlb(bytes).clips.find((c) => c.name === name);
  if (!source) throw Error('Missing source clip');
  const evaluator = await createSourceEvaluator(bytes, name, []);
  const category = name === 'DivingLunge' ? 'punch' : 'kick';
  const total = durationMs(source.durationSeconds * 1000);
  // Only source transport is under qualification. No valid combat target/window is claimed.
  const motion = bakeMotion(
    {
      clipId: clipId(name),
      category,
      durationMs: total,
      sampleRateHz: 120,
      sourceTimesMs: source.sampleTimes.map((t) => t * 1000),
      impacts: [
        {
          impactIndex: 0,
          startMs: durationMs(total - 0.001),
          endMs: total,
          damageShare: 1,
          shapeId: 'TEST-ONLY:inactive',
        },
      ],
      ownership: [
        {
          atMs: durationMs(0),
          horizontalOwner: 'authored-root',
          verticalOwner: 'authored-root',
        },
      ],
    },
    (time) => ({
      root: evaluator.sample(time).root,
      shapes: [
        {
          shapeId: 'TEST-ONLY:inactive',
          volume: {
            kind: 'sphere',
            center: { x: 0, y: 1, z: 0 },
            radiusM: 0.001,
          },
        },
      ],
    }),
  );
  const catalog = createMotionCatalog(async () => [motion]);
  await catalog.prepare(new AbortController().signal);
  const layout = createParisStreetLayout();
  let snapshot = state(0, {
    actors: (['white', 'blue', 'green', 'yellow', 'black'] as const).map(actor),
    residentActorIds: [actorId('white'), actorId('blue')],
    world: {
      vehicles: layout.vehicles.map((v) => ({
        vehicleId: v.vehicleId,
        hp: 100,
        maxHp: 100,
        broken: false,
        canLaunch: true,
        activeLaunchId: null,
      })),
      objects: layout.objects.map((o) => ({
        objectId: o.objectId,
        durability: 100,
        maxDurability: 100,
        destroyed: false,
      })),
    },
  });
  const context = {
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
  };
  let camera: Camera | undefined,
    renderedScene: Object3D | undefined,
    draws = 0,
    n = 0,
    simulationTick = 0,
    game = 0,
    real = 0;
  const rigs = new Map<ActorColor, ActorRig<Object3D>>(),
    events: string[] = [];
  const scene = createSceneAdapter(context, {
    layout,
    onInterruption() {},
    createRenderer: () => ({
      domElement: new EventTarget() as HTMLCanvasElement,
      render(s, c) {
        draws++;
        s.updateMatrixWorld(true);
        c.updateMatrixWorld(true);
        camera = c;
        renderedScene = s;
      },
      dispose() {},
      setPixelRatio() {},
      setSize() {},
    }),
  });
  const animation = createActorAnimator(
    { ...context, renderHost: scene.renderHost },
    {
      create(color) {
        const rig = pack.create(color);
        rigs.set(color, rig);
        events.push(`create:${color}`);
        return {
          ...rig,
          dispose() {
            events.push(
              `dispose:${color}:${rig.node.parent === null ? 'detached' : 'mounted'}`,
            );
            rig.dispose();
            rigs.delete(color);
          },
        };
      },
      clipDuration: (id) => pack.clipDuration(id),
      locomotionClips: {
        idle: clipId('Idle'),
        walk: clipId('Walk'),
        run: clipId('Run'),
        jump: clipId('Jump'),
      },
    },
  );
  function render() {
    const spatial = scene.commit({ snapshot, events: [] }, viewport);
    const frame: CommittedFrame = { snapshot, spatial, events: [], viewport };
    animation.render(frame);
    scene.render(frame);
    return frame;
  }
  function update(extra: Partial<GameSnapshot> = {}) {
    snapshot = {
      ...snapshot,
      ...extra,
      revision: ++n,
      clocks: {
        ...snapshot.clocks,
        tick: tick(simulationTick),
        gameTimeMs: gameTimeMs(game),
        presentationTimeMs: presentationTimeMs(real),
      },
    };
  }
  function step(delta: number, intents: readonly GameplayCommand[] = []) {
    simulationTick++;
    game += delta;
    real += delta;
    update();
    scene.step(
      { snapshot, step: { durationMs: durationMs(delta) }, intents },
      catalog,
    );
    return render();
  }
  let frame = render();
  // Walk the future victim from the unmodified production spawn to encounter range.
  const basis = scene.beginMovementSession('duel-approach');
  const sign = victim === 'white' ? 1 : -1;
  let iterations = 0;
  while (true) {
    const w = frame.spatial.actors.find((a) => a.actorId === actorId('white'))!,
      b = frame.spatial.actors.find((a) => a.actorId === actorId('blue'))!;
    if (Math.abs(b.position.z - w.position.z) <= 1.8) break;
    if (++iterations > 300)
      throw Error('Production motor did not reach duel distance');
    frame = step(20, [
      {
        type: 'MoveRequested',
        runId: run,
        actorId: actorId(victim),
        input: {
          sequence: iterations,
          commandId: commandId(`approach:${iterations}`),
        },
        movementSessionId: basis.sessionId,
        basisRevision: basis.revision,
        x: sign * basis.right.z,
        z: sign * basis.depth.z,
      },
    ]);
  }
  scene.endMovementSession(basis.sessionId, 'released');
  frame = step(20);
  const attackStart = game;
  update({
    actors: snapshot.actors.map((a) =>
      a.color !== victim
        ? a
        : {
            ...a,
            attack: {
              activationId: attackActivationId('duel-source'),
              clipId: clipId(name),
              category,
              startedAt: gameTimeMs(attackStart),
              consumedImpacts: [],
              impactBindings: [
                { impactIndex: 0, impactId: impactId('duel-source-impact') },
              ],
            },
          },
    ),
  });
  frame = render();
  return {
    rigs,
    events,
    scene,
    layout,
    source,
    get frame() {
      return frame;
    },
    get snapshot() {
      return snapshot;
    },
    get camera() {
      if (!camera) throw Error('No actual camera draw');
      return camera;
    },
    get renderedScene() {
      if (!renderedScene) throw Error('No actual scene draw');
      return renderedScene;
    },
    get draws() {
      return draws;
    },
    advanceTo(seconds: number) {
      const target = seconds * 1000,
        keys = new Set([
          target,
          ...source.sampleTimes
            .map((t) => t * 1000)
            .filter((t) => t > 0 && t < target),
        ]);
      for (let t = 1000 / 120; t < target; t += 1000 / 120) keys.add(t);
      for (const t of [...keys].sort((a, b) => a - b))
        frame = step(attackStart + t - game);
      return frame;
    },
    beginDeath(deathCategory: 'punch' | 'kick') {
      const death = {
        category: deathCategory,
        startedAt: presentationTimeMs(real),
        slowDurationMs: durationMs(victim === 'white' ? 2000 : 1500),
        playbackRate: 0.25 as const,
      };
      update({
        phase: victim === 'white' ? 'terminal' : 'running',
        result:
          victim === 'white'
            ? {
                outcome: 'defeat',
                finalizedAt: gameTimeMs(game),
                score: calculateScore({
                  defeatedEnemies: 0,
                  remainingHp: 0,
                  survivalMs: gameTimeMs(game),
                  streetRate: 0,
                  vehicleRate: 0,
                  clear: false,
                }),
              }
            : null,
        actors: snapshot.actors.map((a) =>
          a.color !== victim
            ? a
            : {
                ...a,
                hp: 0,
                defeated: true,
                attack: null,
                defeatPresentation: death,
              },
        ),
        currentOpponentId: victim === 'blue' ? null : actorId('blue'),
        presentation: {
          kind: victim === 'blue' ? 'opponent-defeat' : 'defeat-slow',
          actorId: actorId(victim),
          startedAt: death.startedAt,
          endsAt: presentationTimeMs(real + death.slowDurationMs),
        },
      });
      frame = render();
      return death;
    },
    presentDeath(elapsed: number) {
      const dead = snapshot.actors.find((a) => a.color === victim)!
        .defeatPresentation!;
      real = dead.startedAt + elapsed;
      update({
        presentation: {
          kind:
            victim === 'blue' && elapsed >= 1500
              ? 'opponent-defeat-finish'
              : victim === 'blue'
                ? 'opponent-defeat'
                : 'defeat-slow',
          actorId: actorId(victim),
          startedAt: dead.startedAt,
          endsAt: presentationTimeMs(
            dead.startedAt +
              (victim === 'blue' ? (elapsed >= 1500 ? 1625 : 1500) : 2000),
          ),
        },
      });
      frame = render();
      return frame;
    },
    tailStep(delta: number, jump = false) {
      const basis = scene.beginMovementSession(`tail:${n}`);
      const intents: GameplayCommand[] = [
        {
          type: 'MoveRequested',
          runId: run,
          actorId: actorId('white'),
          input: { sequence: n, commandId: commandId(`tail-move:${n}`) },
          movementSessionId: basis.sessionId,
          basisRevision: basis.revision,
          x: 0.5,
          z: 0,
        },
      ];
      if (jump)
        intents.push({
          type: 'JumpRequested',
          runId: run,
          actorId: actorId('white'),
          input: { sequence: n + 1, commandId: commandId(`tail-jump:${n}`) },
        });
      frame = step(delta, intents);
      scene.endMovementSession(basis.sessionId, 'released');
      return frame;
    },
    retireBlue() {
      update({
        residentActorIds: [actorId('white'), actorId('green')],
        currentOpponentId: actorId('green'),
        presentation: { kind: 'none' },
      });
      frame = render();
      return frame;
    },
    dispose() {
      animation.dispose();
      scene.dispose();
      catalog.dispose();
      evaluator.dispose();
    },
  };
}
