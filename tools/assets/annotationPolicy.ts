/** Explicit provisional interpretation, not an inferred source hit window.
 * The last inclusive integer frame owns its following frame cell, so peaks on
 * that frame are not lost at a half-open runtime end. Terminal overflow is
 * unresolved: reject instead of extending a clip, clamping, or guessing width. */
export function inclusiveFrameWindow(input: {
  readonly sourceStartFrame: number;
  readonly fps: number;
  readonly firstFrame: number;
  readonly lastFrame: number;
  readonly peakFrame: number;
  readonly durationMs: number;
}): {
  readonly policy: 'inclusive-source-frame-cells-v1';
  readonly acceptance: 'provisional-policy';
  readonly startMs: number;
  readonly endMs: number;
  readonly peakMs: number;
} {
  if (
    ![
      input.sourceStartFrame,
      input.firstFrame,
      input.lastFrame,
      input.peakFrame,
    ].every(Number.isSafeInteger) ||
    !Number.isFinite(input.fps) ||
    input.fps <= 0 ||
    !Number.isFinite(input.durationMs) ||
    input.durationMs <= 0 ||
    input.firstFrame < input.sourceStartFrame ||
    input.lastFrame < input.firstFrame ||
    input.peakFrame < input.firstFrame ||
    input.peakFrame > input.lastFrame
  )
    throw new RangeError('Explicit valid inclusive source window required');
  const time = (frame: number) =>
    ((frame - input.sourceStartFrame) / input.fps) * 1000;
  const startMs = time(input.firstFrame),
    endMs = time(input.lastFrame + 1),
    peakMs = time(input.peakFrame);
  if (
    ![startMs, endMs, peakMs].every(Number.isFinite) ||
    startMs >= endMs ||
    peakMs < startMs ||
    peakMs >= endMs ||
    endMs > input.durationMs
  )
    throw new RangeError('Source window exceeds actual clip or loses its peak');
  return {
    policy: 'inclusive-source-frame-cells-v1',
    acceptance: 'provisional-policy',
    startMs,
    endMs,
    peakMs,
  };
}

/** Narrow integer-frame/accessor correspondence for these two source exports only.
 * Keep README-relative time separate; do not trim the binary's positive initial hold.
 * Fractional/missing/nonuniform source samples need their own evidence and fail closed. */
export function inclusiveAccessorFrameWindow(
  input: Parameters<typeof inclusiveFrameWindow>[0] & {
    readonly sourceEndFrame: number;
    readonly accessorTimesSeconds: readonly number[];
  },
) {
  const relativeClock = inclusiveFrameWindow(input);
  const times = input.accessorTimesSeconds;
  if (
    !Number.isSafeInteger(input.sourceEndFrame) ||
    times.length !== input.sourceEndFrame - input.sourceStartFrame + 1 ||
    !times.length ||
    times.some(
      (time, i) =>
        !Number.isFinite(time) ||
        time < 0 ||
        (i > 0 && time <= (times[i - 1] ?? Infinity)) ||
        Math.abs(time - ((times[0] ?? 0) + i / input.fps)) > 2e-7,
    )
  )
    throw new Error('Unproven integer-frame/accessor correspondence');
  const at = (frame: number) => {
    const time = times[frame - input.sourceStartFrame];
    if (time === undefined)
      throw new Error('Missing inclusive endpoint accessor');
    return time * 1000;
  };
  const startMs = at(input.firstFrame),
    peakMs = at(input.peakFrame),
    endMs = at(input.lastFrame + 1);
  if (
    endMs > input.durationMs ||
    startMs >= endMs ||
    peakMs < startMs ||
    peakMs >= endMs
  )
    throw new Error('Accessor window exceeds actual clip');
  return {
    policy: 'inclusive-accessor-frame-cells-v1' as const,
    acceptance: 'provisional-policy' as const,
    startMs,
    endMs,
    peakMs,
    relativeClock,
    initialHoldEndMs: (times[0] ?? 0) * 1000,
  };
}
