import { describe, expect, test } from 'vitest';
import {
  activeRealTimeMs,
  durationMs,
  gameTimeMs,
  tick,
} from '../../src/contracts/clock';
import { actorId, attackActivationId, clipId } from '../../src/contracts/ids';
import {
  captureFightingClock,
  type FightingClock,
} from '../../src/contracts/fighting';
import {
  createFightingClockSlice,
  fightingTicksToMs,
  freezeFightingClock,
  isFightingTrueCombo,
  projectFightingHeatTime,
  sampleFightingMotion,
} from '../../src/core/fightingClock';

import {
  advanceHeat,
  finishHeat,
  initialHeat,
  startHeat,
} from '../../src/core/rules';

function moving(): FightingClock {
  return captureFightingClock({
    stepTick: tick(8),
    activeEpochId: 'attack-1',
    slices: [
      createFightingClockSlice({
        actorId: actorId('player'),
        epochId: 'attack-1',
        clipId: clipId('actual-binding'),
        activationId: attackActivationId('activation-1'),
        fromGameMs: gameTimeMs(100.25),
        toGameMs: gameTimeMs(300.25),
        fromMotionMs: durationMs(3.5),
        frozen: false,
      }),
    ],
  });
}

describe('exact actor clock durations and fractional global game-time slices', () => {
  test('sixty integer actor ticks are one second without integrating floating frame deltas', () => {
    expect(fightingTicksToMs(0)).toBe(0);
    expect(fightingTicksToMs(60)).toBe(1000);
    expect(fightingTicksToMs(6)).toBe(100);
    expect(fightingTicksToMs(7)).toBe(350 / 3);
    expect(fightingTicksToMs(1)).toBe(1000 / 60);
    for (const invalid of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => fightingTicksToMs(invalid)).toThrow(RangeError);
  });
  test('slice construction has explicit caller identity and preserves all sub-tick fractions', () => {
    const clock = moving();
    expect(clock.slices[0]).toMatchObject({
      fromGameMs: 100.25,
      toGameMs: 300.25,
      fromMotionMs: 3.5,
      toMotionMs: 203.5,
    });
    expect(sampleFightingMotion(clock, gameTimeMs(100.25))).toBe(3.5);
    expect(sampleFightingMotion(clock, gameTimeMs(110.375))).toBe(13.625);
    expect(sampleFightingMotion(clock, gameTimeMs(300.25))).toBeNull();
    expect(sampleFightingMotion(clock, gameTimeMs(100))).toBeNull();
    const first = clock.slices[0];
    if (!first) throw new Error('No slice');
    expect(
      createFightingClockSlice({ ...first, frozen: true }).toMotionMs,
    ).toBe(3.5);
  });
  test('an accepted fractional contact partitions motion/freeze/resume without rounding or counting stop twice', () => {
    const original = moving();
    const stopped = freezeFightingClock(
      original,
      gameTimeMs(110.375),
      gameTimeMs(210.375),
    );
    expect(
      stopped.slices.map((slice) => [
        slice.fromGameMs,
        slice.toGameMs,
        slice.fromMotionMs,
        slice.toMotionMs,
        slice.frozen,
      ]),
    ).toEqual([
      [100.25, 110.375, 3.5, 13.625, false],
      [110.375, 210.375, 13.625, 13.625, true],
      [210.375, 300.25, 13.625, 103.5, false],
    ]);
    expect(sampleFightingMotion(stopped, gameTimeMs(210.374))).toBe(13.625);
    expect(sampleFightingMotion(stopped, gameTimeMs(210.375))).toBe(13.625);
    expect(sampleFightingMotion(stopped, gameTimeMs(210.5))).toBe(13.75);
    expect(
      freezeFightingClock(stopped, gameTimeMs(110.375), gameTimeMs(210.375)),
    ).toEqual(stopped);
    expect(original.slices[0]?.toMotionMs).toBe(203.5);
    expect(Object.isFrozen(stopped.slices)).toBe(true);
  });
  test('overlapping freezes form a union and never subtract existing stop a second time', () => {
    const a = freezeFightingClock(
      moving(),
      gameTimeMs(120.25),
      gameTimeMs(160.25),
    );
    const b = freezeFightingClock(a, gameTimeMs(140.25), gameTimeMs(180.25));
    expect(sampleFightingMotion(b, gameTimeMs(200.25))).toBe(43.5);
    expect(b.slices.at(-1)?.toMotionMs).toBe(143.5);
  });
  test('epoch cuts belong only to the new clip and old stop offsets cannot contaminate its zero', () => {
    const first = moving().slices[0];
    if (!first) throw new Error('No slice');
    const clock = captureFightingClock({
      stepTick: tick(8),
      activeEpochId: 'hurt-2',
      slices: [
        createFightingClockSlice({ ...first, toGameMs: gameTimeMs(150.25) }),
        createFightingClockSlice({
          ...first,
          epochId: 'hurt-2',
          clipId: clipId('actual-hurt-binding'),
          activationId: null,
          fromGameMs: gameTimeMs(150.25),
          toGameMs: gameTimeMs(300.25),
          fromMotionMs: durationMs(0),
        }),
      ],
    });
    const stopped = freezeFightingClock(
      clock,
      gameTimeMs(140.25),
      gameTimeMs(180.25),
    );
    expect(sampleFightingMotion(stopped, gameTimeMs(150.25))).toBe(0);
    expect(sampleFightingMotion(stopped, gameTimeMs(190.25))).toBe(10);
    expect(stopped.activeEpochId).toBe('hurt-2');
    expect(stopped.slices.at(-1)?.toMotionMs).toBe(120);
  });
  test('freeze bounds must be finite, ordered, positive and covered by the supplied step clock', () => {
    for (const [from, to] of [
      [99, 120],
      [120, 301],
      [120, 120],
      [200, 120],
      [300.25, 300.25],
    ])
      expect(() =>
        freezeFightingClock(
          moving(),
          gameTimeMs(from as number),
          gameTimeMs(to as number),
        ),
      ).toThrow(RangeError);
  });
  test('true combo is strict in the same absolute clock: stun release equality is never a combo', () => {
    const contactAt = gameTimeMs(100.25),
      stoppedMs = fightingTicksToMs(6),
      stunMs = fightingTicksToMs(18);
    const actionableAt = gameTimeMs(contactAt + stoppedMs + stunMs);
    expect(actionableAt).toBe(500.25);
    expect(isFightingTrueCombo(gameTimeMs(500.249), actionableAt)).toBe(true);
    expect(isFightingTrueCombo(actionableAt, actionableAt)).toBe(false);
    expect(isFightingTrueCombo(gameTimeMs(500.251), actionableAt)).toBe(false);
    expect(
      isFightingTrueCombo(gameTimeMs(1000 / 60), gameTimeMs(1000 / 60)),
    ).toBe(false);
  });
});

describe('freeze-aware heat uses processed accepted-real intervals, not slowed game ticks', () => {
  test('a projection is side-effect-free and the owner commits one authoritative cursor only once', () => {
    const committed = activeRealTimeMs(100);
    expect(
      projectFightingHeatTime(committed, durationMs(17), durationMs(6)),
    ).toBe(111);
    expect(
      projectFightingHeatTime(committed, durationMs(17), durationMs(6)),
    ).toBe(111);
    expect(
      projectFightingHeatTime(committed, durationMs(100), durationMs(100)),
    ).toBe(100);
    expect(
      projectFightingHeatTime(committed, durationMs(1000), durationMs(0)),
    ).toBe(1100);
    expect(committed).toBe(100);
    for (const [elapsed, stopped] of [
      [10, 11],
      [-1, 0],
      [10, -1],
      [NaN, 0],
    ])
      expect(() =>
        projectFightingHeatTime(
          committed,
          elapsed as ReturnType<typeof durationMs>,
          stopped as ReturnType<typeof durationMs>,
        ),
      ).toThrow(RangeError);
  });
  test('existing seven-start capacity/cooling is unchanged, with stops excluded once from its own clock', () => {
    let heat = initialHeat();
    for (let i = 0; i < 7; i++) heat = finishHeat(startHeat(heat, 0), 0);
    expect(heat).toMatchObject({ amount: 7, capacity: 7, lockedUntil: 3000 });
    const frozenProjection = projectFightingHeatTime(
      activeRealTimeMs(0),
      durationMs(2000),
      durationMs(2000),
    );
    expect(advanceHeat(heat, frozenProjection, false).amount).toBe(7);
    const beforeUnlock = projectFightingHeatTime(
      frozenProjection,
      durationMs(2999),
      durationMs(0),
    );
    expect(() =>
      startHeat(advanceHeat(heat, beforeUnlock, false), beforeUnlock),
    ).toThrow('Attack cooling lock');
    const unlocked = projectFightingHeatTime(
      beforeUnlock,
      durationMs(1),
      durationMs(0),
    );
    heat = advanceHeat(heat, unlocked, false);
    expect(heat.amount).toBe(0);
    expect(startHeat(heat, unlocked).amount).toBe(1);
  });
});

test('a wholly frozen fractional real interval leaves the committed heat cursor bit-identical', () => {
  expect(
    projectFightingHeatTime(
      activeRealTimeMs(0.1),
      durationMs(0.2),
      durationMs(0.2),
    ),
  ).toBe(0.1);
});
