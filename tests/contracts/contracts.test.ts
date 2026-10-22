import { expect, test } from 'vitest';

test('contract v1 exposes validated identity and clock factories', async () => {
  const path = '../../src/contracts/index.ts';
  const contract = await import(path).catch(() => undefined);
  expect(contract, 'P0 public contract must exist').toBeDefined();
  expect(contract?.CONTRACT_VERSION).toBe(1);
  expect(contract?.actorId('white')).toBe('white');
  expect(() => contract?.actorId('')).toThrow();
  expect(contract?.tick(1)).toBe(1);
  expect(() => contract?.tick(0.5)).toThrow();
});

test('clock units reject invalid values and explicitly convert seconds', async () => {
  const path = '../../src/contracts/index.ts';
  const c = await import(path).catch(() => undefined);
  expect(c, 'clock contract must exist').toBeDefined();
  for (const invalid of [-1, NaN, Infinity]) {
    expect(() => c?.gameTimeMs(invalid)).toThrow();
    expect(() => c?.activeRealTimeMs(invalid)).toThrow();
    expect(() => c?.presentationTimeMs(invalid)).toThrow();
  }
  expect(c?.secondsToMilliseconds(1.5)).toBe(1500);
});

test('motion validation refuses unmeasured range, invalid windows and unbalanced shares', async () => {
  const path = '../../src/contracts/index.ts';
  const c = await import(path).catch(() => undefined);
  expect(c, 'motion contract must exist').toBeDefined();
  const motion = {
    clipId: 'fixture',
    category: 'kick',
    durationMs: 1000,
    effectiveRangeM: 1,
    impacts: [
      {
        impactIndex: 0,
        startMs: 100,
        endMs: 300,
        damageShare: 1,
        shapeId: 'foot',
      },
    ],
    sampling: {
      version: 1,
      sampleRateHz: 1,
      interpolation: 'piecewise-linear',
    },
    rootCurve: [
      { atMs: 0, position: { x: 0, y: 0, z: 0 }, visualYawRad: 0 },
      { atMs: 1000, position: { x: 0, y: 0, z: 1 }, visualYawRad: 0 },
    ],
  };
  expect(c?.validateMotionDefinition(motion)).toEqual({
    valid: true,
    errors: [],
  });
  expect(
    c?.validateMotionDefinition({ ...motion, effectiveRangeM: NaN }).valid,
  ).toBe(false);
  expect(
    c?.validateMotionDefinition({
      ...motion,
      impacts: [{ ...motion.impacts[0], endMs: 1100, damageShare: 0.5 }],
    }).valid,
  ).toBe(false);
});
