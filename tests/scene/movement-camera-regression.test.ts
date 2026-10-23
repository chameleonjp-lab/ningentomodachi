import { type Camera, Vector3 as ThreeVector3 } from 'three';
import { expect, test } from 'vitest';
import { presentationTimeMs } from '../../src/contracts';
import { createSceneAdapter } from '../../src/scene';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { run, state, viewport } from '../world/fixtures';

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
