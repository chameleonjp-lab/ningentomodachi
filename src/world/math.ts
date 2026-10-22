import type { Vector3 } from '../contracts';
export const v = (x = 0, y = 0, z = 0): Vector3 => ({ x, y, z });
export const add = (a: Vector3, b: Vector3): Vector3 =>
  v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vector3, b: Vector3): Vector3 =>
  v(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a: Vector3, s: number): Vector3 =>
  v(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vector3, b: Vector3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vector3): number => Math.hypot(a.x, a.y, a.z);
export const unit = (a: Vector3, fallback: Vector3 = v(0, 0, 1)): Vector3 =>
  length(a) > 1e-12 ? mul(a, 1 / length(a)) : fallback;
export const lerp = (a: Vector3, b: Vector3, t: number): Vector3 =>
  add(a, mul(sub(b, a), t));
export const clamp = (x: number, min = 0, max = 1): number =>
  Math.max(min, Math.min(max, x));
export const finite = (a: Vector3): boolean =>
  [a.x, a.y, a.z].every(Number.isFinite);
/** +Z forward and +X right. Authored visual yaw is deliberately absent. */
export const localToWorld = (a: Vector3, facing: Vector3): Vector3 =>
  v(a.x * facing.z + a.z * facing.x, a.y, -a.x * facing.x + a.z * facing.z);
