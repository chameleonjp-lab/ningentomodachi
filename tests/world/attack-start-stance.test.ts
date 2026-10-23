import { expect, test } from 'vitest';
import {
  resolveAttackStartStance,
  STANCE_BINDINGS,
  validateStanceBinding,
} from '../../src/world/attack-start-stance';
import { localToWorld, v } from '../../src/world/math';
test('startup stance maps authored minus-X to bearing for both pinned motions', () => {
  for (const clip of ['SideKick', 'SideThrustKick'])
    for (const [x, z] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
      [2, 3],
    ]) {
      const r = resolveAttackStartStance(clip, v(), v(0, 0, 1), v(x, 0, z));
      const world = localToWorld(v(-1, 0, 0), r.facing);
      expect(r.disposition).toBe('aligned');
      expect(world.x).toBeCloseTo(x! / Math.hypot(x!, z!), 14);
      expect(world.z).toBeCloseTo(z! / Math.hypot(x!, z!), 14);
    }
});
test('startup stance rejects wrong detached binding and preserves explicit missing/coincident domains', () => {
  const pin = STANCE_BINDINGS.SideKick,
    old = v(0, 0, 1);
  expect(() =>
    validateStanceBinding('SideKick', [{ ...pin, sourceBindingId: 'wrong' }]),
  ).toThrow();
  expect(() => validateStanceBinding('SideKick', [pin, pin])).toThrow();
  expect(resolveAttackStartStance('SideKick', v(), old, undefined)).toEqual({
    disposition: 'missing-target',
    facing: old,
  });
  expect(resolveAttackStartStance('SideKick', v(), old, v())).toEqual({
    disposition: 'coincident-bearing',
    facing: old,
  });
});
