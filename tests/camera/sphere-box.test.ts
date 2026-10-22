import { expect, test } from 'vitest';
import type { Vector3 } from '../../src/contracts';
import { cameraSphereBlocked } from '../../src/camera/sphere-box';
import type { Box } from '../../src/world/swept-shapes';
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const box = { min: v(-1, -1, -1), max: v(1, 1, 1) };
test('closed camera sweep includes exact final contact, unlike half-open gameplay TOI', () => {
  expect(cameraSphereBlocked(v(3), v(1.25), box, 0.25)).toBe(true);
});
// Independent convex-distance oracle uses interval minimization rather than
// face-crossing partitions or quadratic coefficients from the implementation.
function oracle(a: Vector3, b: Vector3, box: Box) {
  const sq = (t: number) =>
    (['x', 'y', 'z'] as const).reduce((s, k) => {
      const p = a[k] + (b[k] - a[k]) * t;
      const d = Math.max(box.min[k] - p, 0, p - box.max[k]);
      return s + d * d;
    }, 0);
  let l = 0,
    h = 1;
  for (let i = 0; i < 160; i++) {
    const p = (2 * l + h) / 3,
      q = (l + 2 * h) / 3;
    if (sq(p) < sq(q)) h = q;
    else l = p;
  }
  return Math.min(sq(0), sq(1), sq((l + h) / 2));
}
test('zero length, parallel, interior, exact tangent and thin-wall predicates', () => {
  expect(cameraSphereBlocked(v(), v(), box)).toBe(true);
  expect(cameraSphereBlocked(v(2), v(2), box)).toBe(false);
  expect(cameraSphereBlocked(v(-2, 1.25), v(2, 1.25), box, 0.25)).toBe(true);
  expect(cameraSphereBlocked(v(-2, 1.25001), v(2, 1.25001), box, 0.25)).toBe(
    false,
  );
  expect(
    cameraSphereBlocked(v(0, 0, -2), v(0, 0, 2), {
      min: v(-1, -1, -0.0005),
      max: v(1, 1, 0.0005),
    }),
  ).toBe(true);
});
test('independent oracle matches deterministic varied scale and direction cases', () => {
  let seed = 917;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const scale of [1e-6, 1, 1e6])
    for (let i = 0; i < 100; i++) {
      const a = v(
        (rand() - 0.5) * 8 * scale,
        (rand() - 0.5) * 8 * scale,
        (rand() - 0.5) * 8 * scale,
      );
      const b = v(
        (rand() - 0.5) * 8 * scale,
        (rand() - 0.5) * 8 * scale,
        (rand() - 0.5) * 8 * scale,
      );
      const bounds = {
          min: v(-scale, -scale, -scale),
          max: v(scale, scale, scale),
        },
        radius = 0.2 * scale;
      const expected = oracle(a, b, bounds) <= (radius + 1e-8) ** 2;
      expect(cameraSphereBlocked(a, b, bounds, radius)).toBe(expected);
    }
  for (const offset of [-1e12, 1e12]) {
    const bounds = { min: v(offset - 1, -1, -1), max: v(offset + 1, 1, 1) };
    expect(
      cameraSphereBlocked(
        v(offset - 2, 1.25),
        v(offset + 2, 1.25),
        bounds,
        0.25,
      ),
    ).toBe(true);
    expect(
      cameraSphereBlocked(v(offset - 2, 1.3), v(offset + 2, 1.3), bounds, 0.25),
    ).toBe(false);
  }
});
test('invalid and overflow geometry never reports clear', () => {
  for (const a of [v(NaN), v(Infinity)])
    expect(cameraSphereBlocked(a, v(), box)).toBe(true);
  expect(cameraSphereBlocked(v(), v(), { min: v(2), max: v(1) })).toBe(true);
  expect(cameraSphereBlocked(v(), v(), box, NaN)).toBe(true);
  expect(cameraSphereBlocked(v(), v(), box, -1)).toBe(true);
  expect(cameraSphereBlocked(v(-1e308), v(1e308), box)).toBe(true);
});

test('near-tangent thin-wall camera sequence stays bounded without generic advancement', async () => {
  const { createCameraRig } = await import('../../src/camera/camera-rig');
  const { createParisStreetLayout } = await import(
    '../../src/world/street-layout'
  );
  const { viewport } = await import('../world/fixtures');
  const { actorId, worldObjectId } = await import('../../src/contracts');
  const wall = {
    objectId: worldObjectId('near-tangent'),
    position: v(0, 4, -0.201),
    halfExtents: v(4, 4, 0.0005),
  };
  const layout = { ...createParisStreetLayout(), objects: [wall] };
  const first = createCameraRig(layout),
    second = createCameraRig(layout);
  const start = performance.now();
  const times: number[] = [];
  for (const [i, z] of [0, 0.005, 0.03, 0.01, 0, 0.1, 2, 0].entries()) {
    const actor = {
      actorId: actorId('white'),
      position: v(0, 0, z),
      facing: v(0, 0, 1),
      velocity: v(),
      grounded: true,
      locomotion: 'idle' as const,
    };
    const points = [-0.35, 0.35].flatMap((x) =>
      [0, i === 0 ? 12 : 1.85].flatMap((y) =>
        [z - 0.35, z + 0.35].map((z) => v(x, y, z)),
      ),
    );
    const before = performance.now(),
      f = first.update(actor, undefined, viewport, 16, points);
    times.push(performance.now() - before);
    expect(second.update(actor, undefined, viewport, 16, points)).toEqual(f);
    expect(Number.isFinite(f.position.y)).toBe(true);
    if (!f.constrained)
      expect(
        oracle(f.target, f.position, {
          min: v(-4, 0, -0.2015),
          max: v(4, 8, -0.2005),
        }),
      ).toBeGreaterThan(0.2 ** 2);
  }
  const elapsed = performance.now() - start;
  console.info('NEAR_TANGENT_CAMERA', {
    elapsedMs: elapsed,
    maxFrameMs: Math.max(...times),
    frames: 16,
  });
  // A broad regression ceiling, not a device performance/FPS qualification.
  expect(elapsed).toBeLessThan(1000);
});
