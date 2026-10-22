import { expect, test } from 'vitest';
import { cameraSphereBlocked } from '../../src/camera/sphere-box';
import { refineVerifiedRange } from '../../src/camera/refine-fit';
test('nonmonotone obstruction branches only return a freshly verified endpoint', () => {
  const checked: number[] = [];
  // Two disjoint clear islands. A failed midpoint cannot prove either half clear.
  const valid = (d: number) => d >= 9.75 || (d >= 8.125 && d <= 8.25);
  const result = refineVerifiedRange(
    7,
    { distance: 10, value: 'original' },
    (d) => {
      checked.push(d);
      return valid(d) ? `checked:${d}` : undefined;
    },
  );
  expect(checked.length).toBeLessThanOrEqual(8);
  expect(valid(result.distance)).toBe(true);
  expect(result.value).toBe(`checked:${result.distance}`);
  expect(checked).toContain(result.distance);
});
test('no safe midpoint retains exactly the already verified endpoint', () => {
  const endpoint = { distance: 10, value: { eye: 'certified' } };
  let count = 0;
  const result = refineVerifiedRange(7, endpoint, () => {
    count++;
    return undefined;
  });
  expect(result).toBe(endpoint);
  expect(count).toBe(8);
});
test('1mm precision never promotes the failing or untested side of a bracket', () => {
  const boundary = 9.234567,
    checked: number[] = [];
  const result = refineVerifiedRange(
    9.2,
    { distance: 9.3, value: 9.3 },
    (d) => {
      checked.push(d);
      return d >= boundary ? d : undefined;
    },
  );
  expect(result.distance).toBeGreaterThanOrEqual(boundary);
  expect(result.distance - boundary).toBeLessThanOrEqual(0.001);
  expect(result.value).toBe(result.distance);
  expect(checked).toContain(result.distance);
  expect(checked.length).toBeLessThanOrEqual(8);
  const endpoint = { distance: 9.3005, value: 'original' };
  expect(
    refineVerifiedRange(9.3, endpoint, () => {
      throw Error('Already within precision');
    }),
  ).toBe(endpoint);
});

test('two thin obstacles create disjoint clear ranges without an unchecked return', () => {
  const focus = { x: 0, y: 0, z: 0 };
  const boxes = [1.2, 2.8].map((y) => ({
    min: { x: 2.99, y: y - 0.05, z: -0.5 },
    max: { x: 3.01, y: y + 0.05, z: 0.5 },
  }));
  const eye = (distance: number) => ({
    x: 6.5,
    y: Math.sqrt(distance ** 2 - 6.5 ** 2),
    z: 0,
  });
  const clear = (d: number) =>
    !boxes.some((box) => cameraSphereBlocked(focus, eye(d), box));
  expect([7, 7.8, 8.9, 10].map(clear)).toEqual([false, true, false, true]);
  const checked: number[] = [];
  const result = refineVerifiedRange(
    7,
    { distance: 10, value: eye(10) },
    (d) => {
      checked.push(d);
      return clear(d) ? eye(d) : undefined;
    },
  );
  expect(clear(result.distance)).toBe(true);
  expect(result.value).toEqual(eye(result.distance));
  expect(checked).toContain(result.distance);
  expect(checked.length).toBeLessThanOrEqual(8);
});
