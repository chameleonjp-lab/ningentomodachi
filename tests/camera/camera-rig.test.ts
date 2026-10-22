import { expect, test } from 'vitest';
import { createCameraRig, projectPoint } from '../../src/camera/camera-rig';
import { actorId, type SpatialActor } from '../../src/contracts';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { viewport } from '../world/fixtures';

const actor = (
  name: string,
  x: number,
  y: number,
  z: number,
): SpatialActor => ({
  actorId: actorId(name),
  position: { x, y, z },
  facing: { x: 0, y: 0, z: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: y === 0,
  locomotion: 'idle',
});
test('side camera never reverses on crossing or coincidence and keeps finite axes', () => {
  const rig = createCameraRig(createParisStreetLayout());
  const a = actor('white', 0, 0, 0),
    b = actor('blue', 0, 0, 3);
  const first = rig.update(a, b, viewport, 1000);
  const crossed = rig.update(b, a, viewport, 20);
  const same = rig.update(a, a, viewport, 20);
  expect(
    first.right.x * crossed.right.x + first.right.z * crossed.right.z,
  ).toBeGreaterThan(0);
  expect(same.right.x * same.depth.x + same.right.z * same.depth.z).toBeCloseTo(
    0,
  );
  expect(Math.hypot(same.right.x, same.right.z)).toBeCloseTo(1);
});
test('jump framing, viewport CSS projection and offscreen classification', () => {
  const rig = createCameraRig(createParisStreetLayout());
  const a = actor('white', 0, 0, 0),
    b = actor('blue', 0, 3, 5);
  const frame = rig.update(a, b, viewport, 1000);
  for (const p of [a.position, b.position]) {
    const projected = projectPoint({ ...p, y: p.y + 1 }, frame, viewport);
    expect(projected.visibility).toBe('visible');
    expect(projected.cssPoint?.x).toBeLessThan(400);
    expect(projected.cssPoint?.y).toBeLessThan(800);
  }
  expect(
    projectPoint({ x: 10000, y: 0, z: 0 }, frame, viewport).visibility,
  ).not.toBe('visible');
  expect(Math.abs(frame.position.x)).toBeLessThan(7);
});
