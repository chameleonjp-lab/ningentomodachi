import { PerspectiveCamera, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { createCameraRig, projectPoint } from '../../src/camera/camera-rig';
import { selectPresentationFrame } from '../../src/camera/presentation-fit';
import {
  actorId,
  type PresentationLayout,
  type SpatialActor,
} from '../../src/contracts';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { run, viewport } from '../world/fixtures';

const vp = {
  ...viewport,
  widthCssPx: 800,
  heightCssPx: 400,
  safeAreaCssPx: { top: 20, bottom: 20, left: 0, right: 0 },
};
const street = {
  ...createParisStreetLayout(),
  objects: [],
  bounds: { min: { x: -100, y: 0, z: -100 }, max: { x: 100, y: 12, z: 100 } },
};
const actor = (id: string, z: number): SpatialActor => ({
  actorId: actorId(id),
  position: { x: 0, y: 0, z },
  facing: { x: 0, y: 0, z: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  locomotion: 'idle',
});
const a = actor('white', 0),
  b = actor('blue', 1.5);
const layout = (
  rects: PresentationLayout['rects'] = [],
): PresentationLayout => ({
  runId: run,
  viewportRevision: vp.revision,
  layoutRevision: 1,
  rects,
});
const distance = (
  frame: ReturnType<ReturnType<typeof createCameraRig>['update']>,
) =>
  Math.hypot(
    frame.position.x - frame.target.x,
    frame.position.y - frame.target.y,
    frame.position.z - frame.target.z,
  );
function update(value: PresentationLayout | undefined, view = vp) {
  return createCameraRig(street).update(a, b, view, 0, [], {
    runId: run,
    layout: value,
  });
}

test('measured empty layout removes only legacy UI padding and certifies supplied bounds', () => {
  const legacy = update(undefined),
    measured = update(layout());
  expect(legacy.presentationFit?.status).toBe('unavailable');
  expect(measured.presentationFit?.status).toBe('bounds-clear');
  expect(distance(measured)).toBeLessThan(distance(legacy));
  expect(measured.presentationFit?.candidateCount).toBeLessThanOrEqual(8);
});

test('seven ordered search candidates reserve the eighth check for distinct same-range damping geometry', () => {
  const frame = (range: number) => ({
    position: { x: 0, y: 1, z: -range },
    target: { x: 0, y: 1, z: 0 },
    right: { x: -1, y: 0, z: 0 },
    depth: { x: 0, y: 0, z: 1 },
    fovDegrees: 50,
    constrained: false,
  });
  const proposals: number[] = [];
  let projections = 0;
  const damped = { ...frame(5), position: { x: 1, y: 1, z: -Math.sqrt(24) } };
  const result = selectPresentationFrame({
    baseline: frame(5),
    layout: layout(),
    viewport: vp,
    bounds: [
      {
        actorId: a.actorId,
        corners: [{ x: 0, y: 1, z: 0 }],
        kind: 'actor-proxy',
      },
    ],
    priorDistance: 1,
    minDistance: 2.5,
    propose: (range) => {
      proposals.push(range);
      return frame(range);
    },
    damp: () => damped,
    project: (point, camera) => {
      projections++;
      return projectPoint(point, camera, vp);
    },
  });
  expect(proposals).toEqual([2.5, 5.25, 5.6000000000000005, 6.25, 7.5, 10]);
  expect(projections).toBe(8);
  expect(result.presentationFit?.candidateCount).toBe(8);
  expect(result.position).toEqual(damped.position);
});

test('a failed damping check retains an already certified candidate without a ninth evaluation', () => {
  const baseline = update(layout());
  let projections = 0;
  const result = selectPresentationFrame({
    baseline,
    layout: layout(),
    viewport: vp,
    bounds: [
      {
        actorId: a.actorId,
        corners: [{ x: 0, y: 1, z: 0 }],
        kind: 'pose-bounds',
      },
    ],
    priorDistance: distance(baseline),
    minDistance: 2.5,
    propose: (range) => ({
      ...baseline,
      position: { x: range, y: 1, z: 0.75 },
    }),
    damp: (selected) => ({ ...selected, constrained: true }),
    project: (point, camera) => {
      projections++;
      return projectPoint(point, camera, vp);
    },
  });
  expect(result.presentationFit?.status).toBe('bounds-clear');
  expect(result.presentationFit?.boundsKind).toBe('mixed-pose-bounds');
  expect(result.constrained).toBe(false);
  expect(result.presentationFit!.candidateCount).toBeLessThanOrEqual(8);
  expect(projections).toBeLessThanOrEqual(8);
});

test('stale or malformed layout retains exact legacy camera geometry', () => {
  const legacy = update(undefined);
  for (const value of [
    { ...layout(), viewportRevision: 99 },
    { ...layout(), layoutRevision: NaN },
    layout([{ id: 'notice', left: 20, top: 0, right: 10, bottom: 30 }]),
  ]) {
    const frame = update(value);
    expect(frame.position).toEqual(legacy.position);
    expect(frame.target).toEqual(legacy.target);
    expect(frame.presentationFit?.status).toBe('unavailable');
  }
});

test('gap between fighters is not treated as their combined occupied rectangle', () => {
  const measured = layout([
    { id: 'notice', left: 395, top: 120, right: 405, bottom: 280 },
  ]);
  const frame = update(measured);
  expect(frame.presentationFit?.status).toBe('bounds-clear');
  expect(frame.presentationFit?.occludedActorIds).toEqual([]);
  const bounds = [a, b].map((actor) => {
    const corners = [];
    for (const x of [-0.35, 0.35])
      for (const y of [0, 1.85])
        for (const z of [-0.35, 0.35])
          corners.push({ x, y, z: actor.position.z + z });
    return { actorId: actor.actorId, corners, kind: 'pose-bounds' as const };
  });
  const posed = createCameraRig(street).update(
    a,
    b,
    vp,
    0,
    bounds.flatMap((group) => group.corners),
    { runId: run, layout: measured, bounds },
  );
  expect(posed.presentationFit?.status).toBe('bounds-clear');
  expect(posed.presentationFit?.boundsKind).toBe('mixed-pose-bounds');
});

test('full-screen UI exhausts a bounded search without suppressing world-hit anchors', () => {
  const frame = update(
    layout([{ id: 'notice', left: 0, top: 0, right: 800, bottom: 400 }]),
  );
  expect(frame.presentationFit?.status).toBe('limited');
  expect(frame.presentationFit?.candidateCount).toBeLessThanOrEqual(8);
  expect(frame.presentationFit?.occludedActorIds).toEqual([
    a.actorId,
    b.actorId,
  ]);
  expect(frame.constrained).toBe(false);
  expect(projectPoint({ x: 0, y: 1, z: 0 }, frame, vp).visibility).toBe(
    'visible',
  );
});

test('disjoint asymmetric HUD and individual buttons cause a verified UI-driven pullback', () => {
  const view = {
    ...vp,
    safeAreaCssPx: { top: 24, bottom: 12, left: 32, right: 8 },
  };
  const measured = layout([
    { id: 'player-status', left: 44, top: 32, right: 340, bottom: 110 },
    { id: 'opponent-status', left: 460, top: 32, right: 780, bottom: 90 },
    { id: 'settings', left: 350, top: 32, right: 394, bottom: 76 },
    { id: 'pause', left: 406, top: 32, right: 450, bottom: 76 },
    { id: 'punch', left: 720, top: 244, right: 784, bottom: 308 },
    { id: 'kick', left: 720, top: 316, right: 784, bottom: 380 },
    { id: 'jump', left: 648, top: 316, right: 712, bottom: 380 },
  ]);
  const unchanged = JSON.stringify(measured);
  const baseline = update(layout(), view),
    selected = update(measured, view);
  const rectangles = (frame: typeof baseline) => {
    const camera = new PerspectiveCamera(
      frame.fovDegrees,
      view.widthCssPx / view.heightCssPx,
      0.05,
      250,
    );
    camera.position.copy(frame.position);
    camera.lookAt(frame.target.x, frame.target.y, frame.target.z);
    camera.updateMatrixWorld(true);
    return [a, b].map((actor) => {
      const points: Vector3[] = [];
      for (const x of [-0.35, 0.35])
        for (const y of [0, 1.85])
          for (const z of [-0.35, 0.35]) {
            const p = new Vector3(x, y, actor.position.z + z).project(camera);
            expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
            points.push(new Vector3((p.x + 1) * 400, (1 - p.y) * 200, p.z));
          }
      return {
        left: Math.min(...points.map((p) => p.x)),
        right: Math.max(...points.map((p) => p.x)),
        top: Math.min(...points.map((p) => p.y)),
        bottom: Math.max(...points.map((p) => p.y)),
      };
    });
  };
  const intersects = (
    body: ReturnType<typeof rectangles>[number],
    rect: PresentationLayout['rects'][number],
  ) =>
    body.left < rect.right + 4 &&
    body.right > rect.left - 4 &&
    body.top < rect.bottom + 4 &&
    body.bottom > rect.top - 4;
  expect(
    rectangles(baseline).some((body) =>
      measured.rects.some((rect) => intersects(body, rect)),
    ),
  ).toBe(true);
  expect(selected.presentationFit?.status).toBe('bounds-clear');
  expect(distance(selected)).toBeGreaterThan(distance(baseline));
  expect(selected.presentationFit!.candidateCount).toBeGreaterThan(1);
  expect(selected.presentationFit!.candidateCount).toBeLessThanOrEqual(8);
  for (const body of rectangles(selected)) {
    expect(body.left).toBeGreaterThanOrEqual(32);
    expect(body.right).toBeLessThanOrEqual(792);
    expect(body.top).toBeGreaterThanOrEqual(24);
    expect(body.bottom).toBeLessThanOrEqual(388);
    for (const rect of measured.rects)
      expect(intersects(body, rect)).toBe(false);
  }
  expect(JSON.stringify(measured)).toBe(unchanged);
});

test('valid layout certification checks actual asymmetric safe edges', () => {
  const view = {
    ...vp,
    safeAreaCssPx: { top: 80, bottom: 0, left: 140, right: 0 },
  };
  const frame = update(layout(), view);
  expect(frame.presentationFit?.status).toBe('bounds-clear');
  for (const actor of [a, b])
    for (const x of [-0.35, 0.35])
      for (const y of [0, 1.85])
        for (const z of [-0.35, 0.35]) {
          const result = projectPoint(
            { x: actor.position.x + x, y, z: actor.position.z + z },
            frame,
            view,
          );
          expect(result.visibility).toBe('visible');
          expect(result.cssPoint!.x).toBeGreaterThanOrEqual(140);
          expect(result.cssPoint!.x).toBeLessThanOrEqual(800);
          expect(result.cssPoint!.y).toBeGreaterThanOrEqual(80);
          expect(result.cssPoint!.y).toBeLessThanOrEqual(400);
        }
});

test('nonpositive safe viewport cannot receive a clear-bounds certificate', () => {
  const frame = update(layout(), {
    ...vp,
    safeAreaCssPx: { top: 200, bottom: 200, left: 0, right: 0 },
  });
  expect(frame.presentationFit?.status).toBe('unprojectable');
});

test('geometry-constrained baseline has priority over UI-limited status', () => {
  const solid = {
    ...createParisStreetLayout().objects[0]!,
    position: { x: 0, y: 1, z: 0.75 },
    halfExtents: { x: 1, y: 2, z: 2 },
  };
  const frame = createCameraRig({ ...street, objects: [solid] }).update(
    a,
    b,
    vp,
    0,
    [],
    { runId: run, layout: layout() },
  );
  expect(frame.constrained).toBe(true);
  expect(frame.presentationFit?.status).toBe('unprojectable');
});
