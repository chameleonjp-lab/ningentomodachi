import type { Vector3 } from '../contracts';
import { add, v } from './math';

/** Provisional melee hurt proxy, intentionally identical to the legacy capsule.
 * Kept independent of navigation/vehicle geometry so future qualified anatomy
 * cannot silently change movement or car collisions. This is not head coverage.
 */
export function combatHurt(position: Vector3) {
  return {
    kind: 'capsule' as const,
    start: add(position, v(0, 0.35, 0)),
    end: add(position, v(0, 1.5, 0)),
    radiusM: 0.35,
  };
}
