import { requireValue } from '../../src/core/invariant';
import { describe, expect, test } from 'vitest';
import {
  damageForRange,
  distributeDamage,
  advanceHeat,
  startHeat,
  finishHeat,
  initialHeat,
  calculateScore,
  createRandom,
} from '../../src/core/rules';
describe('v6 pure rules with explicitly provisional numeric tuning', () => {
  test('inverse reach and total combo damage are finite and conserved', () => {
    expect([0.8, 1.5, 2].map(damageForRange)).toEqual([100, 72, 60]);
    const shares = distributeDamage(100, [0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(shares).toEqual([20, 20, 20, 20, 20]);
    expect(
      distributeDamage(72, [1 / 3, 1 / 3, 1 / 3]).reduce((a, b) => a + b, 0),
    ).toBe(72);
    for (const invalid of [0, -1, NaN, Infinity])
      expect(() => damageForRange(invalid)).toThrow();
    expect(() => distributeDamage(100, [0.5])).toThrow();
  });
  test('all actors share seven starts, full seventh attack, and three seconds lock', () => {
    let heat = initialHeat();
    for (let i = 0; i < 7; i++) {
      heat = startHeat(heat, 0);
      expect(heat.amount).toBe(i + 1);
      heat = finishHeat(heat, 0);
    }
    expect(heat.lockedUntil).toBe(3000);
    expect(() => startHeat(advanceHeat(heat, 2999, false), 2999)).toThrow();
    heat = advanceHeat(heat, 3000, false);
    expect(heat.amount).toBe(0);
    expect(startHeat(heat, 3000).amount).toBe(1);
  });
  test('fractional heat, same cooling rate, attack exclusion and no premature lock', () => {
    let heat = initialHeat();
    for (let i = 0; i < 6; i++) heat = finishHeat(startHeat(heat, 0), 0);
    heat = advanceHeat(heat, 600, false);
    expect(heat.amount).toBeCloseTo(4.6);
    heat = startHeat(heat, 600);
    expect(heat.amount).toBeCloseTo(5.6);
    expect(advanceHeat(heat, 2000, true).amount).toBeCloseTo(5.6);
    for (const [amount, expected] of [
      [5.9, 6.9],
      [6, 7],
      [6.5, 7],
    ]) {
      const next = startHeat(
        { ...initialHeat(), amount: requireValue(amount) },
        0,
      );
      expect(next.amount).toBe(expected);
      expect(next.lockedUntil).toBeNull();
      expect(finishHeat(next, 100).lockedUntil).toBe(
        expected === 7 ? 3100 : null,
      );
    }
  });
  test('both worked score examples, capped bounds, and unattained clear time', () => {
    const score = {
      survivalMs: 180000,
      defeatedEnemies: 4,
      remainingHp: 300,
      streetRate: 0.2,
      vehicleRate: 0.2,
      clear: true,
    };
    expect(calculateScore(score).total).toBe(10560);
    const contributions = requireValue(calculateScore(score).contributions);
    expect(contributions).toEqual({
      survival: 360,
      defeats: 4000,
      remainingHp: 600,
      clear: 2000,
      speed: 4200,
      destruction: -600,
      adjustment: 0,
    });
    expect(Object.values(contributions).reduce((a, b) => a + b, 0)).toBe(10560);
    expect(
      calculateScore({
        ...score,
        clear: false,
        defeatedEnemies: 2,
        remainingHp: 0,
      }).total,
    ).toBe(1760);
    expect(calculateScore({ ...score, clear: false }).clearTime).toBeNull();
    expect(
      calculateScore({
        ...score,
        survivalMs: 0,
        remainingHp: 500,
        streetRate: 0,
        vehicleRate: 0,
      }).total,
    ).toBe(13000);
    expect(() => calculateScore({ ...score, survivalMs: NaN })).toThrow();
  });
  test('seeded selection reproducibility and rejected bounds never consume random state', () => {
    const a = createRandom(42),
      b = createRandom(42);
    expect(() => a.pick([])).toThrow();
    expect(Array.from({ length: 50 }, () => a.pick([0, 1, 2, 3]))).toEqual(
      Array.from({ length: 50 }, () => b.pick([0, 1, 2, 3])),
    );
  });
});

test('invalid authoritative heat cannot silently propagate non-finite results', () => {
  for (const amount of [NaN, Infinity, -1, 8])
    expect(() => advanceHeat({ ...initialHeat(), amount }, 0, false)).toThrow();
});
