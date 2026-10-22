import { describe, expect, test } from 'vitest';
import type { HitVolume } from '../../src/contracts';
import { sweepBox, sweepVolumes } from '../../src/world/swept-shapes';

const sphere = (x: number, y = 1, radiusM = 0.1): HitVolume => ({
  kind: 'sphere',
  center: { x, y, z: 0 },
  radiusM,
});
describe('continuous geometry', () => {
  test('crosses a thin target without endpoint overlap', () => {
    const hit = sweepVolumes(sphere(-10), sphere(10), sphere(0), sphere(0));
    expect(hit?.fraction).toBeCloseTo(0.49, 5);
  });
  test('does not invent a hit across parallel separated paths', () => {
    expect(
      sweepVolumes(sphere(-10), sphere(10), sphere(0, 2), sphere(0, 2)),
    ).toBeNull();
  });
  test('sweeps rotating capsule endpoints rather than just its center', () => {
    const a: HitVolume = {
      kind: 'capsule',
      start: { x: 0, y: 0, z: 0 },
      end: { x: 0, y: 4, z: 0 },
      radiusM: 0.1,
    };
    const b: HitVolume = { ...a, end: { x: 4, y: 0, z: 0 } };
    expect(sweepVolumes(a, b, sphere(2, 2), sphere(2, 2))).not.toBeNull();
  });
  test('initial overlap belongs to interval but its exact end does not', () => {
    expect(
      sweepVolumes(sphere(0), sphere(1), sphere(0), sphere(0))?.fraction,
    ).toBe(0);
    expect(
      sweepVolumes(
        sphere(-1, 1, 0),
        sphere(0, 1, 0),
        sphere(0, 1, 0),
        sphere(0, 1, 0),
      ),
    ).toBeNull();
  });
  test('handles changing radius and rejects malformed geometry', () => {
    expect(
      sweepVolumes(sphere(0, 1, 0.1), sphere(0, 1, 3), sphere(2), sphere(2)),
    ).not.toBeNull();
    expect(() =>
      sweepVolumes(sphere(NaN), sphere(1), sphere(2), sphere(2)),
    ).toThrow();
  });
  test('fast sphere contacts a thin box with world point and normal', () => {
    const hit = sweepBox(sphere(-10), sphere(10), {
      min: { x: 0, y: 0, z: -1 },
      max: { x: 0.01, y: 2, z: 1 },
    });
    expect(hit?.fraction).toBeCloseTo(0.495, 5);
    expect(hit?.normal.x).toBeLessThan(-0.99);
  });
});
