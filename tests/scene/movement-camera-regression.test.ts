import { type Camera, Vector3 as ThreeVector3 } from 'three';
import { expect, test } from 'vitest';
import {
  actorId,
  commandId,
  durationMs,
  presentationTimeMs,
} from '../../src/contracts';
import { createSceneAdapter } from '../../src/scene';
import {
  createParisBattleLayout,
  createParisStreetLayout,
} from '../../src/world/street-layout';
import { catalog, run, state, viewport } from '../world/fixtures';

test('public gesture sessions capture the actual draw camera and keep older gestures immutable', () => {
  let drawnCamera: Camera | undefined;
  const canvas = new EventTarget();
  const scene = createSceneAdapter(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
    },
    {
      onInterruption() {},
      createRenderer: () => ({
        domElement: canvas as HTMLCanvasElement,
        render(_scene, camera) {
          camera.updateMatrixWorld();
          drawnCamera = camera;
        },
        dispose() {},
        setPixelRatio() {},
        setSize() {},
      }),
    },
  );
  const held = scene.beginMovementSession('held');
  const saved = JSON.stringify(held);
  let time = 0;
  for (const currentOpponentId of [null, state().currentOpponentId, null])
    for (let i = 0; i < 6; i++) {
      time += 16;
      const snapshot = state(0, {
        revision: time,
        currentOpponentId,
        clocks: {
          ...state().clocks,
          presentationTimeMs: presentationTimeMs(time),
        },
      });
      const spatial = scene.commit({ snapshot, events: [] }, viewport);
      scene.render({ snapshot, spatial, events: [], viewport });
      if (!drawnCamera) throw new Error('No scene draw');
      const basis = scene.beginMovementSession(`new-${time}`);
      const point = new ThreeVector3(0, 1, 0);
      const original = point.clone().project(drawnCamera),
        moved = point
          .clone()
          .add(new ThreeVector3(basis.right.x, 0, basis.right.z))
          .project(drawnCamera);
      expect(moved.x).toBeGreaterThan(original.x);
      expect(moved.y).toBeCloseTo(original.y, 8);
      expect(
        new ThreeVector3(basis.depth.x, 0, basis.depth.z).dot(
          drawnCamera.getWorldDirection(new ThreeVector3()),
        ),
      ).toBeGreaterThan(0);
      expect(JSON.stringify(held)).toBe(saved);
      scene.endMovementSession(basis.sessionId, 'released');
    }
  scene.dispose();
});

test('scene forwards the captured measured layout to its real draw camera', () => {
  const view = { ...viewport, widthCssPx: 800, heightCssPx: 400 };
  const street = createParisStreetLayout();
  const positions: ThreeVector3[] = [];
  for (const measured of ['legacy', 'empty', 'header']) {
    const scene = createSceneAdapter(
      {
        runId: run,
        seed: 1,
        viewport: { read: () => view, subscribe: () => () => {} },
      },
      {
        layout: {
          ...street,
          objects: [],
          actorSpawns: { ...street.actorSpawns, blue: { x: 0, y: 0, z: 1.5 } },
        },
        onInterruption() {},
        createRenderer: () => ({
          domElement: new EventTarget() as HTMLCanvasElement,
          render(_scene, camera) {
            positions.push(camera.position.clone());
          },
          dispose() {},
          setPixelRatio() {},
          setSize() {},
        }),
      },
    );
    const snapshot = state(),
      spatial = scene.commit({ snapshot, events: [] }, view);
    scene.render({
      snapshot,
      spatial,
      events: [],
      viewport: view,
      ...(measured !== 'legacy'
        ? {
            presentationLayout: {
              runId: run,
              viewportRevision: view.revision,
              layoutRevision: 1,
              rects:
                measured === 'header'
                  ? [
                      {
                        id: 'player-status' as const,
                        left: 12,
                        top: 28,
                        right: 340,
                        bottom: 110,
                      },
                      {
                        id: 'opponent-status' as const,
                        left: 460,
                        top: 28,
                        right: 788,
                        bottom: 90,
                      },
                      {
                        id: 'punch' as const,
                        left: 728,
                        top: 236,
                        right: 792,
                        bottom: 300,
                      },
                      {
                        id: 'kick' as const,
                        left: 728,
                        top: 308,
                        right: 792,
                        bottom: 372,
                      },
                      {
                        id: 'jump' as const,
                        left: 656,
                        top: 308,
                        right: 720,
                        bottom: 372,
                      },
                    ]
                  : [],
            },
          }
        : {}),
    });
    scene.dispose();
  }
  const focus = new ThreeVector3(0, 1, 0.75);
  expect(positions[1]!.distanceTo(focus)).toBeLessThan(
    positions[0]!.distanceTo(focus),
  );
  expect(positions[2]!.distanceTo(focus)).toBeGreaterThan(
    positions[1]!.distanceTo(focus),
  );
});

test('stage starts player-left and input-right matches rendered screen-right', () => {
  let drawn: Camera | undefined;
  const scene = createSceneAdapter(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
    },
    {
      layout: createParisBattleLayout(),
      onInterruption() {},
      createRenderer: () => ({
        domElement: new EventTarget() as HTMLCanvasElement,
        render(_scene, camera) {
          camera.updateMatrixWorld();
          drawn = camera;
        },
        dispose() {},
        setPixelRatio() {},
        setSize() {},
      }),
    },
  );
  const residentActorIds = [actorId('white'), actorId('blue')];
  const snapshot = state(0, { residentActorIds });
  const spatial = scene.commit({ snapshot, events: [] }, viewport);
  scene.render({ snapshot, spatial, events: [], viewport });
  const player = spatial.actors.find((a) => a.actorId === actorId('white')),
    enemy = spatial.actors.find((a) => a.actorId === actorId('blue'));
  if (!player || !enemy || !drawn)
    throw new Error('Missing rendered battle pair');
  const camera = drawn;
  const screen = (position: { x: number; y: number; z: number }) =>
    new ThreeVector3().copy(position).project(camera);
  expect(screen(player.position).x).toBeLessThan(screen(enemy.position).x);
  const basis = scene.beginMovementSession('right');
  const result = scene.step(
    {
      snapshot: state(1, { residentActorIds }),
      step: { durationMs: durationMs(20) },
      intents: [
        {
          type: 'MoveRequested',
          runId: run,
          actorId: player.actorId,
          input: { commandId: commandId('right'), sequence: 1 },
          x: 1,
          z: 0,
          movementSessionId: basis.sessionId,
          basisRevision: basis.revision,
        },
      ],
    },
    catalog(),
  );
  const moved = result.snapshot.actors.find(
    (a) => a.actorId === player.actorId,
  );
  if (!moved) throw new Error('Missing moved player');
  expect(screen(moved.position).x).toBeGreaterThan(screen(player.position).x);
  scene.dispose();
});

test('countdown pair stays in low battle view before opponent activation', () => {
  let drawn: Camera | undefined;
  const scene = createSceneAdapter(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
    },
    {
      layout: createParisBattleLayout(),
      onInterruption() {},
      createRenderer: () => ({
        domElement: new EventTarget() as HTMLCanvasElement,
        render(_scene, camera) {
          camera.updateMatrixWorld();
          drawn = camera;
        },
        dispose() {},
        setPixelRatio() {},
        setSize() {},
      }),
    },
  );
  const snapshot = state(0, {
    phase: 'ready',
    currentOpponentId: null,
    residentActorIds: [actorId('white'), actorId('blue')],
  });
  const unchanged = JSON.stringify(snapshot),
    spatial = scene.commit({ snapshot, events: [] }, viewport);
  scene.render({ snapshot, spatial, events: [], viewport });
  expect(JSON.stringify(snapshot)).toBe(unchanged);
  const [a, b] = spatial.actors;
  if (!a || !b || !drawn) throw new Error('Missing rendered countdown pair');
  const direction = drawn.getWorldDirection(new ThreeVector3());
  expect((Math.asin(-direction.y) * 180) / Math.PI).toBeCloseTo(6, 8);
  // Equal-magnitude horizontal coordinates prove the countdown camera frames the pair, not only white.
  const left = new ThreeVector3()
    .copy(a.position)
    .add(new ThreeVector3(0, 1.05, 0))
    .project(drawn);
  const right = new ThreeVector3()
    .copy(b.position)
    .add(new ThreeVector3(0, 1.05, 0))
    .project(drawn);
  expect(left.x).toBeLessThan(0);
  expect(right.x).toBeGreaterThan(0);
  expect((left.x + right.x) / 2).toBeCloseTo(0, 1);
  expect(snapshot.currentOpponentId).toBeNull();
  scene.dispose();
});

test('stage scene protects the full 2.1 metre living proxy from measured header exclusions', () => {
  for (const bottom of [80, 100, 120]) {
    const view = { ...viewport, widthCssPx: 844, heightCssPx: 390 };
    let drawn: Camera | undefined;
    const scene = createSceneAdapter(
      {
        runId: run,
        seed: 1,
        viewport: { read: () => view, subscribe: () => () => {} },
      },
      {
        layout: createParisBattleLayout(),
        onInterruption() {},
        createRenderer: () => ({
          domElement: new EventTarget() as HTMLCanvasElement,
          render(_scene, camera) {
            camera.updateMatrixWorld();
            drawn = camera;
          },
          dispose() {},
          setPixelRatio() {},
          setSize() {},
        }),
      },
    );
    const snapshot = state(),
      spatial = scene.commit({ snapshot, events: [] }, view);
    scene.render({
      snapshot,
      spatial,
      events: [],
      viewport: view,
      presentationLayout: {
        runId: run,
        viewportRevision: view.revision,
        layoutRevision: 1,
        rects: [{ id: 'player-status', left: 12, top: 28, right: 832, bottom }],
      },
    });
    if (!drawn) throw new Error('Missing stage draw');
    for (const actor of spatial.actors) {
      for (const x of [-0.5, 0.5])
        for (const z of [-0.5, 0.5]) {
          const head = new ThreeVector3(
            actor.position.x + x,
            actor.position.y + 2.1,
            actor.position.z + z,
          ).project(drawn);
          expect(
            ((1 - head.y) * view.heightCssPx) / 2,
            `header bottom ${bottom}`,
          ).toBeGreaterThanOrEqual(bottom + 4);
        }
    }
    scene.dispose();
  }
});
