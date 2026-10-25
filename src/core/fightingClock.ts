import {
  activeRealTimeMs,
  type ActiveRealTimeMs,
  durationMs,
  gameTimeMs,
  tick,
  type DurationMs,
  type GameTimeMs,
} from '../contracts/clock';
import {
  captureFightingClock,
  captureFightingClockSlice,
  fightingClockSliceAt,
  FIGHTING_HZ,
  type FightingClock,
  type FightingClockSlice,
} from '../contracts/fighting';

/** Convert an absolute integer action-clock duration, never accumulate render-frame deltas. */
export function fightingTicksToMs(ticks: number): DurationMs {
  return durationMs((tick(ticks) * 1000) / FIGHTING_HZ);
}

/** Caller supplies real asset/epoch identities and the absolute global step interval. */
export function createFightingClockSlice(
  input: Omit<FightingClockSlice, 'toMotionMs'>,
): FightingClockSlice {
  const from = gameTimeMs(input.fromGameMs),
    to = gameTimeMs(input.toGameMs);
  const motion = durationMs(input.fromMotionMs);
  return captureFightingClockSlice({
    ...input,
    toMotionMs: durationMs(motion + (input.frozen ? 0 : to - from)),
  });
}

/** Half-open epoch lookup retains sub-tick TOI fractions; the final endpoint is not active. */
export function sampleFightingMotion(
  clock: FightingClock,
  at: GameTimeMs,
): DurationMs | null {
  const slice = fightingClockSliceAt(clock, at);
  if (!slice) return null;
  return durationMs(
    slice.fromMotionMs +
      (slice.toMotionMs - slice.fromMotionMs) *
        ((at - slice.fromGameMs) / (slice.toGameMs - slice.fromGameMs)),
  );
}

/**
 * Union an accepted stop with existing frozen coverage, preserving absolute endpoints.
 * Motion continuity is per epoch: an epoch change still begins at zero. Stops outside
 * this step are the caller's next-step responsibility; no stop is charged twice.
 */
export function freezeFightingClock(
  input: FightingClock,
  from: GameTimeMs,
  to: GameTimeMs,
): FightingClock {
  const clock = captureFightingClock(input);
  gameTimeMs(from);
  gameTimeMs(to);
  const first = clock.slices[0],
    last = clock.slices.at(-1);
  if (
    !first ||
    !last ||
    from < first.fromGameMs ||
    to > last.toGameMs ||
    to <= from
  )
    throw new RangeError(
      'Stop must cover a positive interval within the supplied clock',
    );
  if (clock.endpoint && clock.endpoint.epochId !== last.epochId)
    throw new RangeError('Cannot freeze an unproved endpoint transition');
  const slices: FightingClockSlice[] = [];
  let epoch: string | null = null;
  let motion = durationMs(0);
  for (const slice of clock.slices) {
    if (epoch !== slice.epochId) {
      epoch = slice.epochId;
      motion = slice.fromMotionMs;
    }
    const cuts = [
      slice.fromGameMs,
      slice.toGameMs,
      ...(from > slice.fromGameMs && from < slice.toGameMs ? [from] : []),
      ...(to > slice.fromGameMs && to < slice.toGameMs ? [to] : []),
    ].sort((a, b) => a - b);
    for (let index = 1; index < cuts.length; index++) {
      const a = cuts[index - 1],
        b = cuts[index];
      if (a === undefined || b === undefined)
        throw new RangeError('Missing clock cut');
      const frozen = slice.frozen || (a >= from && b <= to);
      const end = durationMs(
        motion +
          (frozen
            ? 0
            : ((slice.toMotionMs - slice.fromMotionMs) * (b - a)) /
              (slice.toGameMs - slice.fromGameMs)),
      );
      slices.push(
        captureFightingClockSlice({
          ...slice,
          fromGameMs: gameTimeMs(a),
          toGameMs: gameTimeMs(b),
          fromMotionMs: motion,
          toMotionMs: end,
          frozen,
        }),
      );
      motion = end;
    }
  }
  return captureFightingClock({
    ...clock,
    slices,
    ...(clock.endpoint
      ? { endpoint: { ...clock.endpoint, motionMs: motion } }
      : {}),
  });
}

/** Both values must already be mapped to the same absolute clock. Equality is a gap. */
export function isFightingTrueCombo(
  nextContactAt: GameTimeMs,
  defenderActionableAt: GameTimeMs,
): boolean {
  return gameTimeMs(nextContactAt) < gameTimeMs(defenderActionableAt);
}

/**
 * Pure projection from ONE committed heat cursor and ONE processed accepted-real
 * interval. The Core owner commits it once; presentation projections must not be
 * fed back as new anchors. frozenRealElapsed must be mapped with Core's realAt,
 * not inferred from death-slow game ms or actor ticks. Existing cooling constants
 * and capacity stay in rules.ts; only accepted hitstop time is excluded here.
 */
export function projectFightingHeatTime(
  committed: ActiveRealTimeMs,
  acceptedRealElapsed: DurationMs,
  frozenRealElapsed: DurationMs,
): ActiveRealTimeMs {
  activeRealTimeMs(committed);
  durationMs(acceptedRealElapsed);
  durationMs(frozenRealElapsed);
  if (frozenRealElapsed > acceptedRealElapsed)
    throw new RangeError(
      'Frozen real interval exceeds processed real interval',
    );
  return activeRealTimeMs(
    committed + (acceptedRealElapsed - frozenRealElapsed),
  );
}
