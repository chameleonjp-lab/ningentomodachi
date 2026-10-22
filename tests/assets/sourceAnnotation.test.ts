import { expect, test } from 'vitest';
import { inclusiveFrameWindow } from '../../tools/assets/annotationPolicy';

test('inclusive source frame cells retain an impact peak at the stated final frame', () => {
  const window = inclusiveFrameWindow({
    sourceStartFrame: 1,
    fps: 45,
    firstFrame: 16,
    lastFrame: 19,
    peakFrame: 19,
    durationMs: 977.77778,
  });
  expect(window.startMs).toBeCloseTo(333.3333333333333, 10);
  expect(window.endMs).toBeCloseTo(422.22222222222223, 10);
  expect(window.peakMs).toBeGreaterThanOrEqual(window.startMs);
  expect(window.peakMs).toBeLessThan(window.endMs);
  expect(window.policy).toBe('inclusive-source-frame-cells-v1');
  expect(window.acceptance).toBe('provisional-policy');
});

test('missing widths and final-sample extension are rejected rather than fabricated or clamped', () => {
  const valid = {
    sourceStartFrame: 1,
    fps: 45,
    firstFrame: 22,
    lastFrame: 25,
    peakFrame: 24,
    durationMs: (48 / 45) * 1000,
  };
  expect(inclusiveFrameWindow(valid).peakMs).toBeCloseTo((23 / 45) * 1000, 10);
  for (const invalid of [
    { ...valid, firstFrame: NaN },
    { ...valid, lastFrame: NaN },
    { ...valid, lastFrame: 21 },
    { ...valid, peakFrame: 26 },
    { ...valid, fps: 0 },
    { ...valid, sourceStartFrame: 23 },
    { ...valid, firstFrame: 48, lastFrame: 49, peakFrame: 49 },
    { ...valid, firstFrame: 22.5 },
    { ...valid, durationMs: Infinity },
  ])
    expect(() => inclusiveFrameWindow(invalid)).toThrow();
});

test('raw-accessor frame cells preserve the positive first timestamp and inclusive terminal peak', async () => {
  const { inclusiveAccessorFrameWindow } = await import(
    '../../tools/assets/annotationPolicy'
  );
  const input = {
    sourceStartFrame: 1,
    sourceEndFrame: 5,
    fps: 45,
    firstFrame: 2,
    lastFrame: 3,
    peakFrame: 3,
    durationMs: (5 / 45) * 1000,
    accessorTimesSeconds: [1, 2, 3, 4, 5].map((frame) =>
      Math.fround(frame / 45),
    ),
  };
  const result = inclusiveAccessorFrameWindow(input);
  expect(result.startMs).toBe((input.accessorTimesSeconds[1] ?? NaN) * 1000);
  expect(result.peakMs).toBe((input.accessorTimesSeconds[2] ?? NaN) * 1000);
  expect(result.endMs).toBe((input.accessorTimesSeconds[3] ?? NaN) * 1000);
  expect(result.peakMs).toBeLessThan(result.endMs);
  expect(result.relativeClock.peakMs).toBe((2 / 45) * 1000);
  expect(result.initialHoldEndMs).toBe(
    (input.accessorTimesSeconds[0] ?? NaN) * 1000,
  );
  expect(() =>
    inclusiveAccessorFrameWindow({ ...input, lastFrame: 5 }),
  ).toThrow();
  expect(() =>
    inclusiveAccessorFrameWindow({
      ...input,
      accessorTimesSeconds: [0, 0.025, 0.03, 0.04, 0.05],
    }),
  ).toThrow();
});
