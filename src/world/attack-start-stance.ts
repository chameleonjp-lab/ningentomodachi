import {
  STARTUP_SOURCES,
  type PoseClipBinding,
  type Vector3,
} from '../contracts';
import { finite } from './math';

/** Diagnostic Stage 1 only. Pins include unchanged speed-1.5 source bytes and
 * extraction policy. Neither a clip name nor an arbitrary caller binding grants trust.
 * SideKick: grounded-posture-y; SideThrustKick: in-place-posture-xyz.
 * No source yaw is added here: it already exists inside the sampled local pose.
 */
export const STANCE_BINDINGS = Object.freeze({
  SideKick: STARTUP_SOURCES.SideKick.binding,
  SideThrustKick: STARTUP_SOURCES.SideThrustKick.binding,
});
export function stanceBinding(name: string): PoseClipBinding | undefined {
  return name === 'SideKick'
    ? STANCE_BINDINGS.SideKick
    : name === 'SideThrustKick'
      ? STANCE_BINDINGS.SideThrustKick
      : undefined;
}
export function validateStanceBinding(
  name: string,
  bindings: readonly PoseClipBinding[] | undefined,
): void {
  const expected = stanceBinding(name);
  if (!expected) return;
  const matching = bindings?.filter((b) => b.clipId === name);
  if (
    matching?.length !== 1 ||
    matching[0]!.sourceBindingId !== expected.sourceBindingId ||
    matching[0]!.durationMs !== expected.durationMs
  )
    throw new Error(`invalid-source-binding: ${name}`);
}
export interface StanceResolution {
  readonly disposition:
    | 'aligned'
    | 'unsupported-clip'
    | 'missing-target'
    | 'coincident-bearing';
  readonly facing: Vector3;
}
/** Fresh activation only. Source -X maps to the target by yaw theta + pi/2.
 * No interpolation, tracking, timing change, source pose change, or gaze claim.
 */
export function resolveAttackStartStance(
  name: string,
  self: Vector3,
  previousFacing: Vector3,
  target: Vector3 | undefined,
): StanceResolution {
  if (!stanceBinding(name))
    return { disposition: 'unsupported-clip', facing: previousFacing };
  if (!finite(self) || !finite(previousFacing) || (target && !finite(target)))
    throw new RangeError('Invalid stance activation pose');
  if (!target) return { disposition: 'missing-target', facing: previousFacing };
  const x = target.x - self.x,
    z = target.z - self.z;
  const magnitude = Math.hypot(x, z);
  if (!Number.isFinite(magnitude))
    throw new RangeError('Invalid stance activation displacement');
  if (magnitude <= 1e-12)
    return { disposition: 'coincident-bearing', facing: previousFacing };
  return {
    disposition: 'aligned',
    facing: { x: z / magnitude, y: 0, z: x === 0 ? 0 : -x / magnitude },
  };
}
