import { requireValue } from './invariant';
import {
  activeRealTimeMs,
  gameTimeMs,
  type HeatState,
  type ScoreBreakdown,
} from '../contracts';
/** v6 proposal defaults, not newly confirmed user requirements. */
export const PROVISIONAL_TUNING = Object.freeze({
  damageNumerator: 180,
  heatCapacity: 7,
  coolingMs: 3000,
  slowRate: 0.25 as const,
  opponentSlowMs: 1500,
  defeatSlowMs: 2000,
  fadeMs: 400,
  vehicleLaunchLoss: 20,
  collisionObjectLoss: 20,
  groundedAttacksOnly: true,
  bufferActions: false,
});
export function finite(value: number, name: string, minimum = 0): number {
  if (!Number.isFinite(value) || value < minimum)
    throw new RangeError(`${name} must be finite and >= ${minimum}`);
  return value;
}
export function damageForRange(range: number): number {
  finite(range, 'range', Number.MIN_VALUE);
  return PROVISIONAL_TUNING.damageNumerator / (1 + range);
}
export function distributeDamage(
  total: number,
  shares: readonly number[],
): readonly number[] {
  finite(total, 'damage');
  if (
    !shares.length ||
    shares.some((s) => !Number.isFinite(s) || s <= 0 || s > 1) ||
    Math.abs(shares.reduce((a, b) => a + b, 0) - 1) > 1e-9
  )
    throw new RangeError('Damage shares must be positive and sum to one');
  let used = 0;
  return Object.freeze(
    shares.map((share, index) => {
      const value = index === shares.length - 1 ? total - used : total * share;
      used += value;
      return value;
    }),
  );
}
export interface InternalHeat extends HeatState {
  readonly observedAt: number;
  readonly pendingLock: boolean;
}
export function initialHeat(): InternalHeat {
  return Object.freeze({
    amount: 0,
    capacity: 7,
    lockedUntil: null,
    observedAt: 0,
    pendingLock: false,
  });
}
export function advanceHeat(
  heat: InternalHeat,
  now: number,
  attacking: boolean,
): InternalHeat {
  finite(now, 'active real time');
  finite(heat.amount, 'heat');
  finite(heat.observedAt, 'heat observation');
  if (heat.amount > 7 || heat.capacity !== 7)
    throw new RangeError('Heat outside capacity');
  if (heat.lockedUntil !== null) finite(heat.lockedUntil, 'heat deadline');
  if (now < heat.observedAt)
    throw new RangeError('Heat clock must be monotonic');
  return Object.freeze({
    ...heat,
    amount: attacking
      ? heat.amount
      : heat.lockedUntil !== null && now + 1e-7 >= heat.lockedUntil
        ? 0
        : Math.max(0, heat.amount - ((now - heat.observedAt) * 7) / 3000),
    observedAt: now,
    lockedUntil:
      heat.lockedUntil !== null && now + 1e-7 >= heat.lockedUntil
        ? null
        : heat.lockedUntil,
  });
}
export function startHeat(heat: InternalHeat, now: number): InternalHeat {
  const next = advanceHeat(heat, now, false);
  if (next.amount >= 7 || next.lockedUntil !== null || next.pendingLock)
    throw new Error('Attack cooling lock');
  const amount = Math.min(7, next.amount + 1);
  return Object.freeze({ ...next, amount, pendingLock: amount === 7 });
}
export function finishHeat(heat: InternalHeat, now: number): InternalHeat {
  const next = advanceHeat(heat, now, true);
  return Object.freeze({
    ...next,
    lockedUntil: next.pendingLock
      ? activeRealTimeMs(now + 3000)
      : next.lockedUntil,
    pendingLock: false,
  });
}
export interface ScoreInput {
  readonly survivalMs: number;
  readonly defeatedEnemies: number;
  readonly remainingHp: number;
  readonly streetRate: number;
  readonly vehicleRate: number;
  readonly clear: boolean;
  readonly playerCausedDestructionRate?: number;
}
export function calculateScore(input: ScoreInput): ScoreBreakdown {
  for (const [key, value] of Object.entries(input))
    if (typeof value === 'number') finite(value, key);
  if (
    !Number.isInteger(input.defeatedEnemies) ||
    input.defeatedEnemies > 4 ||
    input.remainingHp > 500 ||
    input.streetRate > 1 ||
    (input.playerCausedDestructionRate ?? 0) > 1 ||
    input.vehicleRate > 1
  )
    throw new RangeError('Score values outside game bounds');
  if (input.clear && input.defeatedEnemies !== 4)
    throw new RangeError('Clear requires all four enemies');
  const seconds = input.survivalMs / 1000;
  const destructionPenalty =
    ((input.streetRate + input.vehicleRate) / 2) * 3000;
  const contributions = {
    survival: Math.min(600, seconds * 2),
    defeats: input.defeatedEnemies * 1000,
    remainingHp: input.remainingHp * 2,
    clear: input.clear ? 2000 : 0,
    speed: input.clear ? Math.max(0, 6000 - seconds * 10) : 0,
    destruction: -destructionPenalty,
    adjustment: 0,
  };
  const raw = Object.values(contributions).reduce((a, b) => a + b, 0);
  const total = Math.round(Math.max(0, raw));
  contributions.adjustment = total - raw;
  return Object.freeze({
    playerCausedDestructionRate: input.playerCausedDestructionRate ?? 0,
    contributions: Object.freeze(contributions),
    defeatedEnemies: input.defeatedEnemies,
    remainingHp: input.remainingHp,
    survivalTime: gameTimeMs(input.survivalMs),
    clearTime: input.clear ? gameTimeMs(input.survivalMs) : null,
    destructionPenalty,
    streetDestructionRate: input.streetRate,
    vehicleDestructionRate: input.vehicleRate,
    total,
  });
}
export function createRandom(seed: number) {
  if (!Number.isSafeInteger(seed))
    throw new RangeError('Seed must be a safe integer');
  let state = seed >>> 0;
  return {
    pick<T>(items: readonly T[]): T {
      if (!items.length) throw new RangeError('Cannot select an empty set');
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return requireValue(items[Math.floor(r * items.length)]);
    },
    read: () => state,
  };
}
