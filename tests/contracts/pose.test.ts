import { describe, expect, it } from 'vitest';
import {
  attackActivationId,
  clipId,
  durationMs,
  gameTimeMs,
  presentationTimeMs,
} from '../../src/contracts';
import {
  capturePoseRunPolicy,
  createLivingPoseStamp,
  createDefeatPoseStamp,
  poseClipTime,
  poseClipIntervals,
} from '../../src/contracts/pose';

const binding = {
  clipId: clipId('Idle'),
  durationMs: durationMs(100),
  sourceBindingId: 'verified-source-policy',
};
const idle = () =>
  createLivingPoseStamp({
    version: 1,
    binding,
    mode: 'idle',
    startedAt: gameTimeMs(10),
    playback: 'loop',
    activationId: null,
  });

describe('immutable deterministic pose contract (not anatomy readiness)', () => {
  it.each([
    [10, Number.MIN_VALUE],
    [2 ** 52, 0.25],
    [Number.MAX_VALUE, Number.MAX_VALUE],
  ])(
    'rejects unrepresentable clamp endpoints at %s with duration %s',
    (start, duration) => {
      expect(() =>
        createLivingPoseStamp({
          ...idle(),
          mode: 'jump',
          playback: 'clamp',
          startedAt: gameTimeMs(start),
          binding: { ...binding, durationMs: durationMs(duration) },
        }),
      ).toThrow('representable');
    },
  );
  it('preserves finite representable neighboring clamp endpoints without a duration cap', () => {
    for (const [start, duration] of [
      [10, 2 ** -49],
      [2 ** 52, 1],
    ]) {
      const stamp = createLivingPoseStamp({
        ...idle(),
        mode: 'jump',
        playback: 'clamp',
        startedAt: gameTimeMs(start!),
        binding: { ...binding, durationMs: durationMs(duration!) },
      });
      expect(poseClipTime(stamp, stamp.startedAt)).toBe(0);
      const end = gameTimeMs(stamp.startedAt + stamp.binding.durationMs);
      expect(end).toBeGreaterThan(stamp.startedAt);
      expect(poseClipTime(stamp, end)).toBe(stamp.binding.durationMs);
      expect([...poseClipIntervals(stamp, stamp.startedAt, end)]).toEqual([
        {
          kind: 'interval',
          gameFrom: stamp.startedAt,
          gameTo: end,
          clipFrom: 0,
          clipTo: stamp.binding.durationMs,
        },
      ]);
    }
  });
  it('does not turn the representable instant before a seam into a new cycle', () => {
    const stamp = createLivingPoseStamp({
      ...idle(),
      startedAt: gameTimeMs(0),
      binding: { ...binding, durationMs: durationMs(0.1) },
    });
    const seam = gameTimeMs(17 * 0.1);
    expect(1.7).toBeLessThan(seam);
    expect(poseClipTime(stamp, gameTimeMs(1.7))).toBeGreaterThan(
      0.099999999999,
    );
    expect(poseClipTime(stamp, seam)).toBe(0);
  });
  it('uses exact representable epoch-relative seams for fractional durations', () => {
    const stamp = createLivingPoseStamp({
      ...idle(),
      startedAt: gameTimeMs(0.1),
      binding: { ...binding, durationMs: durationMs(0.2) },
    });
    const seam = gameTimeMs(stamp.startedAt + stamp.binding.durationMs);
    expect(poseClipTime(stamp, seam)).toBe(0);
    expect(poseClipTime(stamp, seam, 'left')).toBe(0.2);
    const pieces = [
      ...poseClipIntervals(stamp, stamp.startedAt, gameTimeMs(1.1)),
    ];
    for (const piece of pieces) {
      expect(piece.clipFrom).toBe(poseClipTime(stamp, piece.gameFrom));
      expect(piece.clipTo).toBe(poseClipTime(stamp, piece.gameTo, 'left'));
    }
  });
  it('captures run mode without retaining mutable caller state', () => {
    const input = {
      version: 1 as const,
      mode: 'deterministic-pose-v1' as 'legacy' | 'deterministic-pose-v1',
    };
    const captured = capturePoseRunPolicy(input);
    input.mode = 'legacy';
    expect(captured.mode).toBe('deterministic-pose-v1');
    expect(Object.isFrozen(captured)).toBe(true);
    expect(capturePoseRunPolicy()).toEqual({ version: 1, mode: 'legacy' });
  });
  it('copies and freezes nested source binding', () => {
    const input = { ...binding };
    const stamp = createLivingPoseStamp({ ...idle(), binding: input });
    input.durationMs = durationMs(7);
    expect(stamp.binding.durationMs).toBe(100);
    expect(Object.isFrozen(stamp)).toBe(true);
    expect(Object.isFrozen(stamp.binding)).toBe(true);
  });
  it.each([NaN, Infinity, -1, 0])('rejects invalid duration %s', (value) => {
    expect(() =>
      createLivingPoseStamp({
        ...idle(),
        binding: { ...binding, durationMs: value as typeof binding.durationMs },
      }),
    ).toThrow();
  });
  it('requires attack identity and correct playback mode', () => {
    expect(() =>
      createLivingPoseStamp({ ...idle(), mode: 'attack', playback: 'clamp' }),
    ).toThrow();
    expect(() =>
      createLivingPoseStamp({
        ...idle(),
        activationId: attackActivationId('a'),
      }),
    ).toThrow();
    expect(() => createLivingPoseStamp({ ...idle(), mode: 'jump' })).toThrow();
    expect(() =>
      createLivingPoseStamp({
        ...idle(),
        binding: { ...binding, sourceBindingId: '' },
      }),
    ).toThrow();
  });
  it('maps fractional times without rounding or shifting the source first key', () => {
    expect(poseClipTime(idle(), gameTimeMs(10))).toBe(0);
    expect(poseClipTime(idle(), gameTimeMs(25.125))).toBe(15.125);
  });
  it('distinguishes death left-limit from following loop-seam pose', () => {
    expect(poseClipTime(idle(), gameTimeMs(110))).toBe(0);
    expect(poseClipTime(idle(), gameTimeMs(110), 'left')).toBe(100);
    expect(poseClipTime(idle(), gameTimeMs(210), 'left')).toBe(100);
    expect(() => poseClipTime(idle(), gameTimeMs(10), 'left')).toThrow();
  });
  it('clamps jump and attack without a second slow multiplier', () => {
    const jump = createLivingPoseStamp({
      ...idle(),
      mode: 'jump',
      playback: 'clamp',
    });
    expect(poseClipTime(jump, gameTimeMs(35))).toBe(25);
    expect(poseClipTime(jump, gameTimeMs(210))).toBe(100);
    const attack = createLivingPoseStamp({
      ...jump,
      mode: 'attack',
      activationId: attackActivationId('a'),
    });
    expect(poseClipTime(attack, gameTimeMs(110), 'left')).toBe(100);
  });
  it('rejects future/nonfinite times rather than fabricating a zero pose', () => {
    for (const value of [9, NaN, Infinity, -1])
      expect(() =>
        poseClipTime(idle(), value as ReturnType<typeof gameTimeMs>),
      ).toThrow();
  });
  it('splits loops with end-limit geometry, never sweeps end back to start', () => {
    const pieces = [
      ...poseClipIntervals(idle(), gameTimeMs(95), gameTimeMs(225)),
    ];
    expect(pieces).toEqual([
      {
        kind: 'interval',
        gameFrom: 95,
        gameTo: 110,
        clipFrom: 85,
        clipTo: 100,
      },
      {
        kind: 'interval',
        gameFrom: 110,
        gameTo: 210,
        clipFrom: 0,
        clipTo: 100,
      },
      { kind: 'interval', gameFrom: 210, gameTo: 225, clipFrom: 0, clipTo: 15 },
    ]);
    expect(pieces.every(Object.isFrozen)).toBe(true);
  });
  it('preserves positive held time after a clamped clip ends', () => {
    const jump = createLivingPoseStamp({
      ...idle(),
      mode: 'jump',
      playback: 'clamp',
    });
    expect([
      ...poseClipIntervals(jump, gameTimeMs(95), gameTimeMs(225)),
    ]).toEqual([
      {
        kind: 'interval',
        gameFrom: 95,
        gameTo: 110,
        clipFrom: 85,
        clipTo: 100,
      },
      { kind: 'held', gameFrom: 110, gameTo: 225, clipFrom: 100, clipTo: 100 },
    ]);
    expect(
      [...poseClipIntervals(jump, gameTimeMs(200), gameTimeMs(225))][0]?.kind,
    ).toBe('held');
    expect([
      ...poseClipIntervals(jump, gameTimeMs(200), gameTimeMs(200)),
    ]).toEqual([]);
  });
  it('captures immutable interval inputs and is replayable without mutable clocks', () => {
    const mutable = { ...idle(), binding: { ...binding } };
    const query = poseClipIntervals(mutable, gameTimeMs(10), gameTimeMs(35));
    mutable.binding.durationMs = durationMs(5);
    expect([...query]).toEqual([...query]);
    expect([...query]).toEqual([
      { kind: 'interval', gameFrom: 10, gameTo: 35, clipFrom: 0, clipTo: 25 },
    ]);
  });
  it('rejects reversed intervals eagerly and does not invent time before activation', () => {
    expect(() =>
      poseClipIntervals(idle(), gameTimeMs(30), gameTimeMs(20)),
    ).toThrow();
    expect(() =>
      poseClipIntervals(idle(), gameTimeMs(0), gameTimeMs(20)),
    ).toThrow();
  });
  it('captures reconstructable death entry and preserves its original presentation epoch', () => {
    const stamp = createDefeatPoseStamp({
      kind: 'defeat',
      entry: idle(),
      entryAt: gameTimeMs(110),
      defeatStartedAt: presentationTimeMs(900),
    });
    expect(poseClipTime(stamp.entry, stamp.entryAt, 'left')).toBe(100);
    expect(stamp.defeatStartedAt).toBe(900);
    expect(Object.isFrozen(stamp.entry.binding)).toBe(true);
    expect(() =>
      createDefeatPoseStamp({ ...stamp, entryAt: gameTimeMs(10) }),
    ).toThrow();
  });
  it('keeps independent attack activation epochs even for repeated clip IDs', () => {
    const first = createLivingPoseStamp({
      ...idle(),
      mode: 'attack',
      playback: 'clamp',
      activationId: attackActivationId('first'),
    });
    const second = createLivingPoseStamp({
      ...first,
      startedAt: gameTimeMs(120),
      activationId: attackActivationId('second'),
    });
    expect(poseClipTime(first, gameTimeMs(130))).toBe(100);
    expect(poseClipTime(second, gameTimeMs(130))).toBe(10);
  });
  it('rejects unsupported runtime versions/modes/sides', () => {
    expect(() =>
      capturePoseRunPolicy({ version: 2, mode: 'legacy' } as never),
    ).toThrow();
    expect(() =>
      capturePoseRunPolicy({ version: 1, mode: 'anatomy-ready' } as never),
    ).toThrow();
    expect(() =>
      createLivingPoseStamp({ ...idle(), version: 2 } as never),
    ).toThrow();
    expect(() =>
      poseClipTime(idle(), gameTimeMs(20), 'future' as never),
    ).toThrow();
  });
  it('has identical point mapping independent of query partitions or repeated reads', () => {
    const stamp = idle();
    const query = [
      ...poseClipIntervals(stamp, gameTimeMs(10), gameTimeMs(260)),
    ];
    for (const piece of query) {
      expect(piece.clipFrom).toBe(poseClipTime(stamp, piece.gameFrom));
      expect(piece.clipTo).toBe(poseClipTime(stamp, piece.gameTo, 'left'));
    }
    expect(poseClipTime(stamp, gameTimeMs(42.5))).toBe(32.5);
    expect(poseClipTime(stamp, gameTimeMs(60))).toBe(50);
  });
  it('does not allocate an array for a long query and rejects unrepresentable progress', () => {
    const query = poseClipIntervals(idle(), gameTimeMs(10), gameTimeMs(1e12));
    expect(Object.isFrozen(query)).toBe(true);
    expect(query[Symbol.iterator]().next().value).toEqual({
      kind: 'interval',
      gameFrom: 10,
      gameTo: 110,
      clipFrom: 0,
      clipTo: 100,
    });
    const tiny = createLivingPoseStamp({
      ...idle(),
      binding: { ...binding, durationMs: durationMs(Number.MIN_VALUE) },
    });
    expect(() => [
      ...poseClipIntervals(tiny, gameTimeMs(10), gameTimeMs(11)),
    ]).toThrow('representable');
  });
});
