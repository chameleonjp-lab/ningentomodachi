import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { type CameraFrame, createCameraRig } from '../../src/camera/camera-rig';
import type { Vector3 as Point } from '../../src/contracts';
import { createParisStreetLayout } from '../../src/world/street-layout';

type Input = Parameters<ReturnType<typeof createCameraRig>['update']>;
type Recorded = { label: string; args: Input; originalPosition: Point };
const layout = createParisStreetLayout();
const vector = (p: Point) => new Vector3(p.x, p.y, p.z);
// Independent Three frustum oracle; these are the unchanged portrait HUD margins.
function contains(frame: CameraFrame, points: readonly Point[]) {
  const camera = new PerspectiveCamera(50, 0.5, 0.05, 250);
  camera.position.copy(frame.position);
  camera.lookAt(frame.target.x, frame.target.y, frame.target.z);
  camera.updateMatrixWorld();
  return points.every((p) => {
    const q = vector(p).project(camera);
    return (
      Math.abs(q.x) <= 0.9 + 1e-10 &&
      Math.abs(q.y) <= 0.775 + 1e-10 &&
      Math.abs(q.z) <= 1
    );
  });
}
// Independent convex minimum oracle, not the product's segment/AABB polynomial.
function clear(frame: CameraFrame) {
  return layout.objects.every((o) => {
    const sq = (t: number) =>
      (['x', 'y', 'z'] as const).reduce((sum, k) => {
        const p = frame.target[k] + t * (frame.position[k] - frame.target[k]);
        const d = Math.max(
          o.position[k] - o.halfExtents[k] - p,
          0,
          p - o.position[k] - o.halfExtents[k],
        );
        return sum + d * d;
      }, 0);
    let l = 0,
      h = 1;
    for (let i = 0; i < 90; i++) {
      const a = (2 * l + h) / 3,
        b = (l + 2 * h) / 3;
      if (sq(a) < sq(b)) h = b;
      else l = a;
    }
    return Math.min(sq(0), sq(1), sq((l + h) / 2)) > (0.2 + 1e-8) ** 2;
  });
}
function witness(
  frame: CameraFrame,
  points: readonly Point[],
  upper: number,
  combat: boolean,
) {
  const at = (d: number): CameraFrame => {
    // Compare achievable motion within the selected preferred profile, not a
    // different 20-degree exploration composition. Safety oracles are unchanged.
    let h = (combat ? Math.cos(Math.PI / 30) : 0.94) * d;
    for (const k of ['x', 'z'] as const) {
      const direction = -frame.depth[k];
      if (Math.abs(direction) > 1e-12)
        h = Math.min(
          h,
          ((direction > 0 ? layout.bounds.max[k] : layout.bounds.min[k]) -
            frame.target[k]) /
            direction,
        );
    }
    return {
      ...frame,
      position: {
        x: frame.target.x - frame.depth.x * h,
        y: frame.target.y + Math.sqrt(d * d - h * h),
        z: frame.target.z - frame.depth.z * h,
      },
    };
  };
  let low = combat ? 2.5 : 7,
    high = upper;
  expect(contains(at(high), points)).toBe(true);
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    if (contains(at(mid), points)) high = mid;
    else low = mid;
  }
  const result = at(high + 1e-6);
  expect(contains(result, points)).toBe(true);
  expect(clear(result)).toBe(true);
  return result;
}
for (const [name, culprit] of [
  ['ChineseCartwheelKick', 70],
  ['DivingLunge', 77],
] as const) {
  test(`${name}: actual two-resident correction stays near a certified achievable movement`, () => {
    const rows = readFileSync(
      new URL(`./fixtures/${name}-blue-portrait.jsonl`, import.meta.url),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s) as Recorded);
    const rig = createCameraRig(layout);
    let previous: CameraFrame | undefined;
    for (const row of rows) {
      const frame = rig.update(...row.args),
        points = row.args[4] ?? [];
      expect(frame.constrained).toBe(false);
      expect(contains(frame, points)).toBe(true);
      expect(clear(frame)).toBe(true);
      expect(frame.position.x).toBeGreaterThanOrEqual(
        layout.bounds.min.x - 1e-10,
      );
      expect(frame.position.x).toBeLessThanOrEqual(layout.bounds.max.x + 1e-10);
      expect(frame.position.z).toBeGreaterThanOrEqual(
        layout.bounds.min.z - 1e-10,
      );
      expect(frame.position.z).toBeLessThanOrEqual(layout.bounds.max.z + 1e-10);
      const range = vector(frame.position).distanceTo(frame.target);
      // Preserve the exploration floor; combat may use the closer profile.
      expect(range).toBeGreaterThanOrEqual((row.args[1] ? 2.5 : 7) - 1e-10);
      expect(range).toBeLessThanOrEqual(180 + 1e-10);
      if (row.label.startsWith('death:') && previous) {
        if (!previous) throw Error('Missing preceding frame');
        const alternative = witness(
          frame,
          points,
          vector(row.originalPosition).distanceTo(frame.target),
          Boolean(row.args[1]),
        );
        const achievable = vector(previous.position).distanceTo(
            alternative.position,
          ),
          actual = vector(previous.position).distanceTo(frame.position);
        if (row.label === `death:${culprit}`)
          console.info(
            JSON.stringify({
              name,
              actual,
              achievable,
              position: frame.position,
              witness: alternative.position,
            }),
          );
        // 1cm is selection overhead against a separately certified candidate, not
        // relaxed clipping, a speed cap, or permission to ignore required movement.
        expect(actual).toBeLessThanOrEqual(achievable + 0.01);
      }
      previous = frame;
    }
  });
}
