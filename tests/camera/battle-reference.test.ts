import { PerspectiveCamera, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { type CameraFrame, createCameraRig } from '../../src/camera/camera-rig';
import { cameraSphereBlocked } from '../../src/camera/sphere-box';
import {
  actorId,
  type SpatialActor,
  type ViewportSnapshot,
  worldObjectId,
} from '../../src/contracts';
import { toBox } from '../../src/world/character-motor';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { viewport } from '../world/fixtures';

const landscape = { ...viewport, widthCssPx: 800, heightCssPx: 400 };
const clearLayout = {
  ...createParisStreetLayout(),
  objects: [],
  bounds: { min: { x: -100, y: 0, z: -100 }, max: { x: 100, y: 12, z: 100 } },
};
const actor = (name: string, z: number, y = 0): SpatialActor => ({
  actorId: actorId(name),
  position: { x: 0, y, z },
  facing: { x: 0, y: 0, z: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: y === 0,
  locomotion: 'idle',
});
const range = (frame: CameraFrame) =>
  Math.hypot(
    frame.position.x - frame.target.x,
    frame.position.y - frame.target.y,
    frame.position.z - frame.target.z,
  );
const pitch = (frame: CameraFrame) =>
  (Math.asin((frame.position.y - frame.target.y) / range(frame)) * 180) /
  Math.PI;
function projected(
  frame: CameraFrame,
  actors: SpatialActor[],
  vp: ViewportSnapshot,
) {
  const camera = new PerspectiveCamera(
    frame.fovDegrees,
    vp.widthCssPx / vp.heightCssPx,
    0.05,
    250,
  );
  camera.position.set(frame.position.x, frame.position.y, frame.position.z);
  camera.lookAt(frame.target.x, frame.target.y, frame.target.z);
  camera.updateMatrixWorld(true);
  const ux = Math.max(
    0.35,
    1 - (vp.safeAreaCssPx.left + vp.safeAreaCssPx.right + 40) / vp.widthCssPx,
  );
  const uy = Math.max(
    0.35,
    1 - (vp.safeAreaCssPx.top + vp.safeAreaCssPx.bottom + 140) / vp.heightCssPx,
  );
  return actors.map((a) => {
    const points: Vector3[] = [];
    for (const x of [-0.35, 0.35])
      for (const y of [0, 1.85])
        for (const z of [-0.35, 0.35]) {
          const p = new Vector3(
            a.position.x + x,
            a.position.y + y,
            a.position.z + z,
          ).project(camera);
          expect(Math.abs(p.x)).toBeLessThanOrEqual(ux + 1e-8);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(uy + 1e-8);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
          points.push(p);
        }
    return (
      (Math.max(...points.map((p) => p.y)) -
        Math.min(...points.map((p) => p.y))) /
      2
    );
  });
}

test('close combat uses a low side view and larger fully framed bodies, without promising final HUD occupancy', () => {
  const a = actor('white', 0),
    b = actor('blue', 1.5);
  const frame = createCameraRig(clearLayout).update(a, b, landscape, 0);
  expect(frame.constrained).toBe(false);
  expect(pitch(frame)).toBeCloseTo(6, 8);
  expect(range(frame)).toBeGreaterThanOrEqual(2.5);
  expect(range(frame)).toBeLessThan(5);
  const heights = projected(frame, [a, b], landscape);
  expect(Math.min(...heights)).toBeGreaterThan(0.4);
  console.info('Combat reference proxy projection', {
    rangeM: range(frame),
    pitchDegrees: pitch(frame),
    heightFractions: heights,
  });
});

test('free-roam keeps its established seven metre range and preferred elevation', () => {
  const frame = createCameraRig(clearLayout).update(
    actor('white', 0),
    undefined,
    landscape,
    0,
  );
  expect(frame.target).toEqual({ x: 0, y: 1, z: 0 });
  expect(range(frame)).toBeCloseTo(7, 10);
  expect(frame.position.x).toBeCloseTo(0, 10);
  expect(frame.position.z).toBeCloseTo(-6.58, 10);
  expect(frame.position.y).toBeCloseTo(1 + Math.sqrt(49 - 6.58 ** 2), 10);
});

test('opponent entry and close-combat exit at zero elapsed preserve the verified eye', () => {
  const a = actor('white', 0),
    b = { ...actor('blue', 0), position: { x: 1.5, y: 0, z: 0 } };
  for (const entering of [true, false]) {
    const rig = createCameraRig(clearLayout);
    const before = rig.update(a, entering ? undefined : b, landscape, 0);
    const after = rig.update(a, entering ? b : undefined, landscape, 0);
    expect(after.constrained).toBe(false);
    expect(after.target).toEqual(before.target);
    expect(
      new Vector3().copy(after.depth).distanceTo(before.depth),
    ).toBeLessThan(1e-10);
    expect(
      new Vector3().copy(after.position).distanceTo(before.position),
    ).toBeLessThan(1e-10);
    expect(range(after)).toBeCloseTo(range(before), 10);
    console.info('Zero-elapsed profile transition', {
      entering,
      eyeMovementM: new Vector3()
        .copy(after.position)
        .distanceTo(before.position),
    });
    projected(after, entering ? [a, b] : [a], landscape);
  }
});

test('profile entry and reversal advance by elapsed time instead of snapping elevation', () => {
  // The 0.5 m limit is for this clear, stationary 16 ms fixture only.
  // Fit/obstruction safety may require larger corrections in other scenes.
  const a = actor('white', 0),
    b = { ...actor('blue', 0), position: { x: 1.5, y: 0, z: 0 } },
    rig = createCameraRig(clearLayout);
  const start = rig.update(a, undefined, landscape, 0);
  const entered = rig.update(a, b, landscape, 16);
  expect(pitch(entered)).toBeGreaterThan(18);
  expect(pitch(entered)).toBeLessThan(pitch(start));
  expect(
    new Vector3().copy(entered.position).distanceTo(start.position),
  ).toBeLessThan(0.5);
  const held = rig.update(a, undefined, landscape, 0);
  expect(
    new Vector3().copy(held.position).distanceTo(entered.position),
  ).toBeLessThan(1e-10);
  const reversed = rig.update(a, undefined, landscape, 16);
  expect(pitch(reversed)).toBeGreaterThan(pitch(entered));
  expect(pitch(reversed)).toBeLessThan(pitch(start));
  expect(
    new Vector3().copy(reversed.position).distanceTo(held.position),
  ).toBeLessThan(0.5);
  projected(entered, [a, b], landscape);
  projected(reversed, [a], landscape);
  console.info('16 ms profile entry/reversal', {
    entryEyeMovementM: new Vector3()
      .copy(entered.position)
      .distanceTo(start.position),
    entryPitchDegrees: pitch(entered),
    reversalEyeMovementM: new Vector3()
      .copy(reversed.position)
      .distanceTo(held.position),
    reversalPitchDegrees: pitch(reversed),
  });
});

test('continuous preference transitions converge to the defined combat and free-roam endpoints', () => {
  const a = actor('white', 0),
    b = { ...actor('blue', 0), position: { x: 1.5, y: 0, z: 0 } },
    rig = createCameraRig(clearLayout);
  let frame = rig.update(a, undefined, landscape, 0);
  for (let i = 0; i < 300; i++) frame = rig.update(a, b, landscape, 16);
  expect(pitch(frame)).toBeCloseTo(6, 7);
  expect(range(frame)).toBeLessThan(5);
  projected(frame, [a, b], landscape);
  const beforeExit = frame;
  frame = rig.update(a, undefined, landscape, 16);
  // Fixture-specific preference continuity, not a universal camera speed cap.
  expect(
    new Vector3().copy(frame.position).distanceTo(beforeExit.position),
  ).toBeLessThan(0.5);
  for (let i = 0; i < 300; i++) frame = rig.update(a, undefined, landscape, 16);
  expect(pitch(frame)).toBeCloseTo((Math.acos(0.94) * 180) / Math.PI, 7);
  expect(range(frame)).toBeCloseTo(7, 7);
  projected(frame, [a], landscape);
});

test('portrait combat pulls back for both full bodies including a jumping opponent', () => {
  const rig = createCameraRig(clearLayout),
    a = actor('white', 0);
  for (const b of [
    actor('blue', 1.5),
    actor('blue', 5, 3),
    actor('blue', 1.5),
  ]) {
    const frame = rig.update(a, b, viewport, 16);
    expect(frame.constrained).toBe(false);
    projected(frame, [a, b], viewport);
  }
});

test('close combat crossing and coincidence do not reverse the held side', () => {
  const rig = createCameraRig(clearLayout),
    a = actor('white', 0);
  let previous: CameraFrame | undefined;
  for (const z of [1.5, 0.05, 0, -0.05, -1.5]) {
    const b = actor('blue', z),
      frame = rig.update(a, b, landscape, 16);
    expect(frame.constrained).toBe(false);
    if (previous)
      expect(
        previous.right.x * frame.right.x + previous.right.z * frame.right.z,
      ).toBeGreaterThan(0);
    projected(frame, [a, b], landscape);
    previous = frame;
  }
});

test('combat wall safety overrides the preferred low pitch without cropping bodies', () => {
  const wall = {
    objectId: worldObjectId('battle-wall'),
    position: { x: 1.5, y: 1, z: 0.75 },
    halfExtents: { x: 0.1, y: 1, z: 4 },
  };
  const a = actor('white', 0),
    b = actor('blue', 1.5);
  const frame = createCameraRig({ ...clearLayout, objects: [wall] }).update(
    a,
    b,
    landscape,
    0,
  );
  expect(frame.constrained).toBe(false);
  expect(pitch(frame)).toBeGreaterThan(6);
  expect(
    cameraSphereBlocked(
      frame.target,
      frame.position,
      toBox(wall.position, wall.halfExtents),
    ),
  ).toBe(false);
  projected(frame, [a, b], landscape);
});
