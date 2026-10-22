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
import { type Box, sweepBox } from '../world/swept-shapes';
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
  const clear = (eye: Vector3) =>
    !boxes.some((box) =>
      sweepBox(
        { kind: 'sphere', center: focus, radiusM: 0.2 },
        { kind: 'sphere', center: eye, radiusM: 0.2 },
        box,
      ),
    );
  let h = horizontal;
  let blocked = horizontal;
  while (true) {
    const eye = eyeAt(h);
    if (clear(eye)) {
      // Refine a clear/blocked bracket, never accept an unchecked endpoint.
      // This avoids a repeated halving sawtooth as the focus moves along a wall.
      for (let i = 0; i < 16 && blocked - h > 1e-5; i++) {
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
      const radius = b ? length(sub(a.position, b.position)) * 0.5 + 1.9 : 2.5;
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
      const requestedDistance = Math.min(MAX_DISTANCE, distance * 1.06);
      // Moving outward must immediately preserve framing. Inward relaxation is
      // damped; neither branch can exceed the shared far-plane safety budget.
      const priorDistance = current
        ? length(sub(current.position, current.target))
        : requestedDistance;
      const safeDistance = Math.max(
        requestedDistance,
        priorDistance + (requestedDistance - priorDistance) * alpha,
      );
      const solved = unobstructedEye(
        focus,
        actualDepth,
        safeDistance,
        horizontalBudget(focus, actualDepth, layout, safeDistance),
        opaqueBoxes,
      );
      const eye = solved.eye;
      current = {
        position: eye,
        target: focus,
        right: v(-actualDepth.z, 0, actualDepth.x),
        depth: actualDepth,
        fovDegrees: 50,
        constrained: solved.constrained || distance * 1.06 > MAX_DISTANCE,
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
