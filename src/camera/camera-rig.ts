import type { SpatialActor, Vector3, ViewportSnapshot } from '../contracts';
import { toBox } from '../world/character-motor';
import {
  add,
  clamp,
  dot,
  finite,
  length,
  lerp,
  mul,
  sub,
  unit,
  v,
} from '../world/math';
import type { StreetLayout } from '../world/street-layout';
import type { Box } from '../world/swept-shapes';
import { cameraSphereBlocked } from './sphere-box';
import { refineVerifiedRange } from './refine-fit';
export interface CameraFrame {
  readonly position: Vector3;
  readonly target: Vector3;
  readonly right: Vector3;
  readonly depth: Vector3;
  readonly fovDegrees: number;
  /** No clear full-distance composition exists: suppress projected HUD anchors. */
  readonly constrained?: boolean;
}
export const initialCamera: CameraFrame = {
  position: v(0, 5, -8),
  target: v(0, 1, 0),
  right: v(-1, 0, 0),
  depth: v(0, 0, 1),
  fovDegrees: 50,
};
// Shared with the actual Three renderer, not independent HUD assumptions.
export const CAMERA_NEAR = 0.05;
export const CAMERA_FAR = 250;
const MAX_DISTANCE = 180;
const MIN_HORIZONTAL = 0.05;

function eyeIsClear(focus: Vector3, eye: Vector3, boxes: readonly Box[]) {
  return !boxes.some((box) => cameraSphereBlocked(focus, eye, box));
}

/** Search only the intended side, at a fixed bounded framing distance. Pulling
 * horizontally inward produces an overhead fallback without an unbounded roof
 * lift. No eye-coordinate clamp may cross the focus and reverse the view.
 * If no corridor exists (including an embedded focus), retain a bounded view
 * but explicitly mark the composition unavailable instead of claiming visibility. */
function unobstructedEye(
  focus: Vector3,
  depth: Vector3,
  distance: number,
  horizontal: number,
  boxes: readonly Box[],
): { eye: Vector3; constrained: boolean } {
  const eyeAt = (h: number) =>
    add(sub(focus, mul(depth, h)), v(0, Math.sqrt(distance ** 2 - h ** 2), 0));
  const clear = (eye: Vector3) => eyeIsClear(focus, eye, boxes);
  let h = horizontal;
  let blocked = horizontal;
  while (true) {
    const eye = eyeAt(h);
    if (clear(eye)) {
      // Refine a clear/blocked bracket, never accept an unchecked endpoint.
      // The 1cm bracket is search precision, never collision clearance.
      // This avoids a repeated halving sawtooth as the focus moves along a wall.
      for (let i = 0; i < 16 && blocked - h > 0.01; i++) {
        const mid = (h + blocked) / 2;
        if (clear(eyeAt(mid))) h = mid;
        else blocked = mid;
      }
      return { eye: eyeAt(h), constrained: false };
    }
    if (h <= MIN_HORIZONTAL) break;
    blocked = h;
    h = Math.max(MIN_HORIZONTAL, h / 2);
  }
  return { eye: eyeAt(MIN_HORIZONTAL), constrained: true };
}

/** Preferred street bounds constrain distance along the signed ray, not each
 * eye coordinate independently. A tiny positive separation remains even at a
 * boundary; camera clearance is then checked against actual solid geometry. */
function horizontalBudget(
  focus: Vector3,
  depth: Vector3,
  layout: StreetLayout,
  distance: number,
) {
  let h = distance * 0.94;
  for (const axis of ['x', 'z'] as const) {
    const direction = -depth[axis];
    if (Math.abs(direction) > 1e-8) {
      const boundary =
        direction > 0 ? layout.bounds.max[axis] : layout.bounds.min[axis];
      h = Math.min(h, Math.max(0, (boundary - focus[axis]) / direction));
    }
  }
  return Math.max(MIN_HORIZONTAL, h);
}
/** Exact view-axis inequalities, not an enclosing sphere that charges vertical
 * focus lag against the narrower horizontal frustum. Every accepted eye is still
 * checked after the obstruction solver changes its elevation. */
function cornerConstraints(
  eye: Vector3,
  focus: Vector3,
  points: readonly Vector3[],
  aspect: number,
  usableX: number,
  usableY: number,
) {
  const forward = unit(sub(focus, eye)),
    right = unit(v(-forward.z, 0, forward.x));
  const up = v(
    right.y * forward.z - right.z * forward.y,
    right.z * forward.x - right.x * forward.z,
    right.x * forward.y - right.y * forward.x,
  );
  const tx = Math.tan((25 * Math.PI) / 180) * aspect * usableX,
    ty = Math.tan((25 * Math.PI) / 180) * usableY;
  const distance = length(sub(eye, focus));
  let required = 7,
    contained = true;
  for (const point of points) {
    const delta = sub(point, focus),
      depth = dot(delta, forward),
      z = distance + depth;
    const x = Math.abs(dot(delta, right)),
      y = Math.abs(dot(delta, up));
    required = Math.max(
      required,
      x / tx - depth,
      y / ty - depth,
      CAMERA_NEAR - depth,
    );
    if (
      z < CAMERA_NEAR ||
      z > CAMERA_FAR ||
      x > z * tx + 1e-10 ||
      y > z * ty + 1e-10
    )
      contained = false;
  }
  return { required, contained };
}
function bodyCorners(actor: SpatialActor): Vector3[] {
  const result: Vector3[] = [];
  for (const x of [-0.35, 0.35])
    for (const y of [0, 1.85])
      for (const z of [-0.35, 0.35])
        result.push(add(actor.position, v(x, y, z)));
  return result;
}
export function createCameraRig(layout: StreetLayout) {
  let current: CameraFrame | undefined,
    duelAxis = v(0, 0, 1);
  const opaqueBoxes = layout.objects.map((o) =>
    toBox(o.position, o.halfExtents),
  );
  return {
    update(
      a: SpatialActor,
      b: SpatialActor | undefined,
      viewport: ViewportSnapshot,
      elapsedMs: number,
      framingPoints: readonly Vector3[] = [],
    ): CameraFrame {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
        throw new RangeError('Invalid presentation elapsed');
      let right = v(1, 0, 0),
        target = add(a.position, v(0, 1, 0));
      if (b) {
        const delta = sub(b.position, a.position);
        if (Math.hypot(delta.x, delta.z) > 0.1) {
          let axis = unit(v(delta.x, 0, delta.z));
          if (dot(axis, duelAxis) < 0) axis = mul(axis, -1);
          duelAxis = axis;
        }
        right = duelAxis;
        target = add(mul(add(a.position, b.position), 0.5), v(0, 1, 0));
      }
      const depth = v(-right.z, 0, right.x);
      const desiredDepth = b ? depth : v(0, 0, 1);
      const aspect = Math.max(
        0.2,
        viewport.widthCssPx / Math.max(1, viewport.heightCssPx),
      );
      const usableY = Math.max(
        0.35,
        1 -
          (viewport.safeAreaCssPx.top + viewport.safeAreaCssPx.bottom + 140) /
            Math.max(1, viewport.heightCssPx),
      );
      const usableX = Math.max(
        0.35,
        1 -
          (viewport.safeAreaCssPx.left + viewport.safeAreaCssPx.right + 40) /
            Math.max(1, viewport.widthCssPx),
      );
      let radius = b ? length(sub(a.position, b.position)) * 0.5 + 1.9 : 2.5;
      if (framingPoints.length) {
        if (!framingPoints.every(finite))
          throw new RangeError('Nonfinite display bounds');
        const min = { x: Infinity, y: Infinity, z: Infinity },
          max = { x: -Infinity, y: -Infinity, z: -Infinity };
        for (const p of framingPoints) {
          for (const axis of ['x', 'y', 'z'] as const) {
            min[axis] = Math.min(min[axis], p[axis]);
            max[axis] = Math.max(max[axis], p[axis]);
          }
        }
        target = mul(add(min, max), 0.5);
        radius = Math.max(
          ...framingPoints.map((p) => length(sub(p, target))),
          0.1,
        );
      }
      const framingScale =
        Math.sin((25 * Math.PI) / 180) * Math.min(usableY, aspect * usableX);
      const alpha = current
        ? 1 - Math.exp(-Math.min(elapsedMs, 1000) / 180)
        : 1;
      const focus = lerp(current?.target ?? target, target, alpha);
      // Smooth the intended signed view direction, independently from safety
      // corrections. Angular interpolation has no zero-length midpoint, even
      // when transitioning between opposing views.
      let yaw = Math.atan2(desiredDepth.x, desiredDepth.z);
      if (current) {
        const priorYaw = Math.atan2(current.depth.x, current.depth.z);
        const delta = Math.atan2(
          Math.sin(yaw - priorYaw),
          Math.cos(yaw - priorYaw),
        );
        const maxTurn = (6 * elapsedMs) / 1000;
        yaw = priorYaw + clamp(delta * alpha, -maxTurn, maxTurn);
      }
      const actualDepth = v(Math.sin(yaw), 0, Math.cos(yaw));
      // Include focus lag in the enclosing sphere, so damping does not quietly
      // crop the actual actors while merely keeping the old focus on screen.
      const distance = Math.max(
        7,
        (radius + length(sub(target, focus))) / framingScale,
      );
      const fallbackDistance = Math.min(MAX_DISTANCE, distance * 1.06);
      const points = framingPoints.length
        ? framingPoints
        : [...bodyCorners(a), ...(b ? bodyCorners(b) : [])];
      // Each trial is immutable within this update. Reuse exact solved eyes,
      // especially the accepted range when damping requests that same range.
      const solvedRanges = new Map<
        number,
        ReturnType<typeof unobstructedEye>
      >();
      const solve = (d: number) => {
        const prior = solvedRanges.get(d);
        if (prior) return prior;
        const result = unobstructedEye(
          focus,
          actualDepth,
          d,
          horizontalBudget(focus, actualDepth, layout, d),
          opaqueBoxes,
        );
        solvedRanges.set(d, result);
        return result;
      };
      const check = (eye: Vector3) =>
        cornerConstraints(
          eye,
          focus,
          points,
          Math.max(
            1e-6,
            viewport.widthCssPx / Math.max(1, viewport.heightCssPx),
          ),
          usableX,
          usableY,
        );
      const priorDistance = current
        ? length(sub(current.position, current.target))
        : 7;
      let trial = Math.min(MAX_DISTANCE, Math.max(7, priorDistance));
      let best: { distance: number; eye: Vector3 } | undefined;
      let failedRange: number | undefined;
      // Rear bounds and obstacles can change the view basis, so an analytic
      // suggestion is never accepted without re-solving and checking its eye.
      for (let attempt = 0; attempt < 6; attempt++) {
        const candidate = solve(trial),
          constraints = check(candidate.eye);
        if (
          !candidate.constrained &&
          constraints.contained &&
          (!best || trial < best.distance)
        )
          best = { distance: trial, eye: candidate.eye };
        else if (candidate.constrained || !constraints.contained)
          failedRange = trial;
        const next = Math.min(
          MAX_DISTANCE,
          // An absolute 1mm reserve avoids discontinuous 6% range purchases
          // when a previously valid eye first crosses the framing boundary.
          // The candidate still needs every unchanged fit/obstruction check.
          Math.max(7, constraints.required + 0.001),
        );
        // Stop analytic angle updates at a verified fit. Outward corrections
        // get a separately bounded checked refinement below.
        if (
          (attempt > 0 && best?.distance === trial) ||
          Math.abs(next - trial) < 1e-4 ||
          (best && next >= best.distance)
        )
          break;
        trial = next;
      }
      if (
        best &&
        best.distance > priorDistance &&
        failedRange !== undefined &&
        failedRange < best.distance
      ) {
        const refined = refineVerifiedRange(
          failedRange,
          { distance: best.distance, value: best.eye },
          (range) => {
            const candidate = solve(range);
            return !candidate.constrained && check(candidate.eye).contained
              ? candidate.eye
              : undefined;
          },
        );
        best = { distance: refined.distance, eye: refined.value };
      }
      let eye: Vector3, constrained: boolean;
      if (best) {
        // Preserve inward damping when safe. Obstacle-adjusted intermediate
        // angles are checked too; otherwise keep the verified fit, never clip.
        const damped = Math.min(
          MAX_DISTANCE,
          Math.max(
            best.distance,
            priorDistance + (best.distance - priorDistance) * alpha,
          ),
        );
        if (damped - best.distance <= 1e-10) eye = best.eye;
        else {
          // Preserve the certified angle rather than running another wall
          // search. Extending its ray still needs a fresh complete sweep: a
          // farther obstacle may block it, in which case use the verified fit.
          const horizontal = Math.min(
            horizontalBudget(focus, actualDepth, layout, damped),
            (Math.hypot(best.eye.x - focus.x, best.eye.z - focus.z) * damped) /
              best.distance,
          );
          const candidate = add(
            sub(focus, mul(actualDepth, horizontal)),
            v(0, Math.sqrt(damped ** 2 - horizontal ** 2), 0),
          );
          eye =
            check(candidate).contained &&
            eyeIsClear(focus, candidate, opaqueBoxes)
              ? candidate
              : best.eye;
        }
        constrained = false;
      } else {
        const fallback = solve(fallbackDistance);
        eye = fallback.eye;
        constrained = fallback.constrained || !check(eye).contained;
      }
      current = {
        position: eye,
        target: focus,
        right: v(-actualDepth.z, 0, actualDepth.x),
        depth: actualDepth,
        fovDegrees: 50,
        constrained,
      };
      return current;
    },
  };
}
export function projectPoint(
  point: Vector3,
  frame: CameraFrame,
  viewport: ViewportSnapshot,
): {
  visibility: 'visible' | 'offscreen' | 'unprojectable';
  cssPoint: { x: number; y: number } | null;
} {
  if (
    frame.constrained ||
    !finite(point) ||
    viewport.widthCssPx <= 0 ||
    viewport.heightCssPx <= 0
  )
    return { visibility: 'unprojectable', cssPoint: null };
  const forward = unit(sub(frame.target, frame.position)),
    right = unit(v(-forward.z, 0, forward.x), frame.right);
  const up = v(
    right.y * forward.z - right.z * forward.y,
    right.z * forward.x - right.x * forward.z,
    right.x * forward.y - right.y * forward.x,
  );
  const delta = sub(point, frame.position),
    z = dot(delta, forward);
  if (z < CAMERA_NEAR) return { visibility: 'unprojectable', cssPoint: null };
  const f = 1 / Math.tan((frame.fovDegrees * Math.PI) / 360),
    aspect = viewport.widthCssPx / viewport.heightCssPx;
  const x = (dot(delta, right) * f) / (z * aspect),
    y = (dot(delta, up) * f) / z;
  const cssPoint = {
    x: ((x + 1) * viewport.widthCssPx) / 2,
    y: ((1 - y) * viewport.heightCssPx) / 2,
  };
  return {
    visibility:
      z <= CAMERA_FAR && Math.abs(x) <= 1 && Math.abs(y) <= 1
        ? 'visible'
        : 'offscreen',
    cssPoint,
  };
}
