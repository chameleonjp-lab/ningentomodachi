/** TEST-ONLY source annotations and node provider. No production GLB/asset acceptance.
 * Real public B sampler/animator, A Core, and C scene execute these deterministic inputs. */
import { Group, type Camera, type Scene } from 'three';
import {
  createMotionCatalog,
  createActorAnimator,
  type MotionAsset,
} from '../../../src/assets';
import { createCore } from '../../../src/core';
import { createSceneAdapter } from '../../../src/scene';
import {
  createParisStreetLayout,
  type StreetLayout,
} from '../../../src/world/street-layout';
import {
  type ActorColor,
  type MoveSet,
  type GameplayCommand,
  type CommittedFrame,
  clipId,
  durationMs,
  runId,
  tick,
  commandId,
} from '../../../src/contracts';
import { viewport } from '../../world/fixtures';
export async function publicStack(
  layout: StreetLayout = {
    ...createParisStreetLayout(),
    vehicles: [],
    objects: [],
    actorSpawns: {
      ...createParisStreetLayout().actorSpawns,
      blue: { x: 0, y: 0, z: 1.7 },
    },
  },
  rootDistance = 0.4,
  deferredMountColor?: ActorColor,
) {
  const assets: MotionAsset[] = [];
  for (const category of ['punch', 'kick'] as const)
    for (let i = 0; i < (category === 'punch' ? 12 : 19); i++)
      assets.push({
        definition: {
          clipId: clipId(`TEST-ONLY:${category}:${i}`),
          category,
          durationMs: durationMs(20),
          effectiveRangeM: 0.8,
          impacts: [
            {
              impactIndex: 0,
              startMs: durationMs(0),
              endMs: durationMs(20),
              damageShare: 1,
              shapeId: 'TEST-ONLY:limb',
            },
          ],
          rootCurve: [
            {
              atMs: durationMs(0),
              position: { x: 0, y: 0, z: 0 },
              visualYawRad: 0,
            },
            {
              atMs: durationMs(20),
              position: { x: 0, y: 0, z: rootDistance },
              visualYawRad: Math.PI,
            },
          ],
          sampling: {
            version: 1,
            sampleRateHz: 50,
            interpolation: 'piecewise-linear',
          },
        },
        shapes: [
          {
            shapeId: 'TEST-ONLY:limb',
            keys: [0, 20].map((at) => ({
              atMs: durationMs(at),
              volume: {
                kind: 'sphere',
                center: { x: 0, y: 1, z: 1 },
                radiusM: 0.2,
              },
            })),
          },
        ],
        ownership: [
          {
            atMs: durationMs(0),
            horizontalOwner: 'authored-root',
            verticalOwner: 'spatial-jump',
          },
        ],
      });
  const catalog = createMotionCatalog(async () => assets);
  await catalog.prepare(new AbortController().signal);
  const punches = assets
      .filter((a) => a.definition.category === 'punch')
      .map((a) => a.definition.clipId),
    kicks = assets
      .filter((a) => a.definition.category === 'kick')
      .map((a) => a.definition.clipId);
  const moves: Record<ActorColor, MoveSet> = {
    white: { punches, kicks },
    blue: { punches: punches.slice(0, 4), kicks: kicks.slice(0, 4) },
    green: { punches: punches.slice(4, 8), kicks: kicks.slice(4, 8) },
    yellow: { punches: punches.slice(8, 12), kicks: kicks.slice(8, 12) },
    black: { punches: [], kicks },
  };
  const context = {
    runId: runId('C7-test-source'),
    seed: 42,
    viewport: { read: () => viewport, subscribe: () => () => {} },
  };
  const core = createCore(
    { runId: context.runId, seed: context.seed },
    {
      catalog,
      moves,
      enemyAi: false,
      world: {
        vehicles: layout.vehicles.map((v) => ({
          vehicleId: v.vehicleId,
          hp: 100,
        })),
        objects: layout.objects.map((o) => ({
          objectId: o.objectId,
          durability: 100,
        })),
      },
    },
  );
  let draws = 0;
  const seeks = new Map<ActorColor, number>();
  let drawn: { scene: Scene; camera: Camera } | undefined;
  const nodes = new Map<ActorColor, Group>();
  const scene = createSceneAdapter(context, {
    layout,
    onInterruption() {},
    createRenderer: () => ({
      domElement: new EventTarget() as HTMLCanvasElement,
      render(s, c) {
        draws++;
        s.updateMatrixWorld();
        c.updateMatrixWorld();
        drawn = { scene: s, camera: c };
      },
      dispose() {},
      setPixelRatio() {},
      setSize() {},
    }),
  });
  // Test-only unmounted resident: B still evaluates its source-fixture pose,
  // while isolation tests explicitly exercise the real C host mount lifecycle.
  const deferredActorId = core
    .read()
    .actors.find((a) => a.color === deferredMountColor)?.actorId;
  const animation = createActorAnimator<Group>(
    {
      ...context,
      renderHost: {
        ...scene.renderHost,
        mountActor(request) {
          if (request.actorId === deferredActorId) return () => {};
          return scene.renderHost.mountActor(request);
        },
      },
    },
    {
      create(color) {
        const node = new Group();
        nodes.set(color, node);
        return {
          node,
          seek(_id, seconds) {
            seeks.set(color, seconds);
            node.rotation.y = 0.7;
          },
          setEmissiveEnabled() {},
          dispose() {},
        };
      },
      clipDuration(id) {
        return durationMs(String(id).startsWith('Defeat') ? 500 : 1000);
      },
      locomotionClips: {
        idle: clipId('TEST-ONLY:idle'),
        walk: clipId('TEST-ONLY:walk'),
        run: clipId('TEST-ONLY:run'),
        jump: clipId('TEST-ONLY:jump'),
      },
    },
  );
  core.handle({ type: 'AssetsReady', runId: context.runId });
  core.handle({ type: 'StartRequested', runId: context.runId });
  let sequence = 0;
  function render(output = core.drain()) {
    const spatial = scene.commit(output, viewport),
      frame: CommittedFrame = { ...output, spatial, viewport };
    animation.render(frame);
    scene.render(frame);
    return frame;
  }
  render();
  function input(
    command: Omit<
      Extract<GameplayCommand, { type: 'AttackRequested' }>,
      'runId' | 'input'
    >,
  ) {
    core.handleInputBatch({
      runId: context.runId,
      tick: tick(core.read().clocks.tick + 1),
      commands: [
        {
          ...command,
          runId: context.runId,
          input: {
            sequence: ++sequence,
            commandId: commandId(`input:${sequence}`),
          },
        },
      ],
    });
  }
  return {
    core,
    catalog,
    scene,
    nodes,
    seeks,
    draws: () => draws,
    context,
    render,
    drawn: () => drawn,
    attack(color: ActorColor = 'white', category: 'punch' | 'kick' = 'punch') {
      const actor = core.read().actors.find((a) => a.color === color);
      if (!actor) throw Error('Missing test actor');
      input({ type: 'AttackRequested', actorId: actor.actorId, category });
    },
    step() {
      core.present(durationMs(20));
      const request = core.beginStep({ durationMs: durationMs(20) }),
        result = scene.step(request, catalog),
        output = core.completeStep(result),
        frame = render(output);
      return { request, result, output, frame };
    },
    dispose() {
      animation.dispose();
      scene.dispose();
      core.dispose();
      catalog.dispose();
    },
  };
}
