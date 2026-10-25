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
  createDefeatPoseStamp,
  createLivingPoseStamp,
  poseClipIntervals,
  poseClipTime,
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
    if ('kind' in stamp.entry) throw Error('Expected canonical entry');
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

// Stage-1 diagnostic epoch contract: no source sampler or app activation.
import { actorId, runId } from '../../src/contracts';
import {
  captureRecoveryTimelinePolicy,
  createRecoveryPoseEpoch,
  resolvePoseEpoch,
} from '../../src/contracts/pose';

const recoveryInput = () => ({
  runId: runId('r'),
  actorId: actorId('a'),
  outgoing: createLivingPoseStamp({
    version: 1,
    binding: { ...binding, clipId: clipId('KungFuStraight') },
    mode: 'attack',
    startedAt: gameTimeMs(0),
    playback: 'clamp',
    activationId: attackActivationId('hit'),
  }),
  destination: createLivingPoseStamp({ ...idle(), startedAt: gameTimeMs(100) }),
});
it('recovery epoch is detached immutable and exact natural 150ms', () => {
  const i = recoveryInput(),
    r = createRecoveryPoseEpoch(i);
  expect(r).toMatchObject({
    kind: 'recovery',
    startMs: 100,
    endMs: 250,
    durationMs: 150,
    fixedLiftSign: 1,
  });
  expect(Object.isFrozen(r.outgoing.binding)).toBe(true);
  expect(r.outgoing.binding).not.toBe(i.outgoing.binding);
  expect(createRecoveryPoseEpoch({ ...i, actorId: i.actorId })).toEqual(r);
});
it('recovery resolution retains exact old source and destination clocks/sides', () => {
  const r = createRecoveryPoseEpoch(recoveryInput());
  expect(resolvePoseEpoch(r, gameTimeMs(100), 'right')).toMatchObject({
    kind: 'canonical',
    clipTime: 100,
    side: 'left',
  });
  expect(resolvePoseEpoch(r, gameTimeMs(175), 'right')).toMatchObject({
    kind: 'recovery',
    at: 175,
    side: 'right',
    epoch: r,
  });
  expect(resolvePoseEpoch(r, gameTimeMs(250), 'right')).toMatchObject({
    kind: 'canonical',
    clipTime: 50,
    side: 'right',
  });
  expect(resolvePoseEpoch(r, gameTimeMs(200), 'left')).toMatchObject({
    kind: 'recovery',
  });
  expect(resolvePoseEpoch(r, gameTimeMs(250), 'left')).toMatchObject({
    kind: 'canonical',
    clipTime: 50,
    side: 'left',
  });
});
it('recovery rejects retimed destination and forged epoch identity', () => {
  const i = recoveryInput();
  expect(() =>
    createRecoveryPoseEpoch({
      ...i,
      destination: { ...i.destination, startedAt: gameTimeMs(101) },
    }),
  ).toThrow();
  const r = createRecoveryPoseEpoch(i);
  expect(() =>
    resolvePoseEpoch({ ...r, identity: 'forged' }, gameTimeMs(175), 'right'),
  ).toThrow();
});
it('recovery diagnostic capability is explicit and cannot be inferred from v1', () => {
  expect(() =>
    captureRecoveryTimelinePolicy({
      version: 1,
      protocol: 'deterministic-pose-v1',
    } as never),
  ).toThrow();
  expect(
    captureRecoveryTimelinePolicy({
      version: 1,
      protocol: 'kungfu-recovery-epoch-diagnostic-v1',
      durationMs: durationMs(150),
      fixedLiftSign: 1,
    }),
  ).toMatchObject({ durationMs: 150 });
});
it('defeat captures immutable composite left entry and distinct presentation epoch', () => {
  const r = createRecoveryPoseEpoch(recoveryInput());
  const d = createDefeatPoseStamp({
    kind: 'defeat',
    entry: r,
    entryAt: gameTimeMs(175),
    defeatStartedAt: presentationTimeMs(999),
  });
  expect(d).toMatchObject({ entry: r, entryAt: 175, defeatStartedAt: 999 });
  expect(Object.isFrozen(d.entry)).toBe(true);
});

import {
  STARTUP_SOURCES,
  createStartupPoseEpoch,
  capturePoseEpoch,
  captureStartupTimelinePolicy,
} from '../../src/contracts/pose';
const startupPolicy = () =>
  captureStartupTimelinePolicy({
    version: 1,
    protocol: 'side-kick-startup-matrix-v1',
    durationMs: durationMs(100),
    fixedLiftSign: 1,
  });
function startupInput(start = 1000, duration = 100) {
  return {
    runId: runId('startup'),
    actorId: actorId('white'),
    outgoing: idle(),
    destination: createLivingPoseStamp({
      version: 1,
      mode: 'attack',
      playback: 'clamp',
      binding: STARTUP_SOURCES.SideKick.binding,
      startedAt: gameTimeMs(start),
      activationId: attackActivationId('kick'),
    }),
    basis: {
      authority: 'activation-stance-v1' as const,
      oldYaw: 0,
      admittedYaw: Math.PI / 2,
    },
    policy: { ...startupPolicy(), durationMs: durationMs(duration) },
  };
}
it('startup owns immutable identity, exact prior clock and separate basis authority', () => {
  const input = startupInput(),
    epoch = createStartupPoseEpoch(input);
  expect(epoch.outgoingAt).toBe(1000);
  expect(epoch.outgoingSide).toBe('left');
  expect(epoch.firstActiveAt).toBe(1533.3333611488342);
  expect(epoch.deathLayerPolicy).toBe('freeze-entry-through-local-death-v1');
  input.basis.oldYaw = 1;
  expect(epoch.basis.oldYaw).toBe(0);
  expect(Object.isFrozen(epoch.basis)).toBe(true);
  expect(capturePoseEpoch(epoch)).toEqual(epoch);
  expect(createStartupPoseEpoch(startupInput()).identity).toBe(epoch.identity);
});
it('startup fractional endpoints are explicit without changing source clock', () => {
  const epoch = createStartupPoseEpoch(startupInput(1000, 0.1));
  const start = resolvePoseEpoch(epoch, epoch.startMs, 'right');
  const end = resolvePoseEpoch(epoch, epoch.endMs, 'right');
  expect(start).toMatchObject({
    kind: 'startup',
    weight: 0,
    sourceClipTime: 0,
  });
  expect(end).toMatchObject({
    kind: 'startup',
    weight: 1,
    sourceClipTime: epoch.endMs - 1000,
  });
  expect(epoch.endMs - 1000).not.toBe(0.1);
});
it('startup reverse/repeat queries retain advancing authored clock', () => {
  const epoch = createStartupPoseEpoch(startupInput());
  const result = [1090, 1020, 1090].map((at) =>
    resolvePoseEpoch(epoch, gameTimeMs(at), 'right'),
  );
  expect(result[0]).toEqual(result[2]);
  expect(result[1]).toMatchObject({ weight: 0.2, sourceClipTime: 20 });
});
it('startup rejects collapsed timestamps and interval reaching active window', () => {
  for (const [start, duration] of [
    [2 ** 53, 1],
    [1000, 533.3333611488342],
    [1000, 0],
  ])
    expect(() =>
      createStartupPoseEpoch(startupInput(start, duration)),
    ).toThrow();
});
it('startup rejects non-Idle source and mismatched pinned incoming binding', () => {
  const input = startupInput();
  expect(() =>
    createStartupPoseEpoch({
      ...input,
      outgoing: { ...input.outgoing, mode: 'walk' },
    }),
  ).toThrow();
  expect(() =>
    createStartupPoseEpoch({
      ...input,
      destination: {
        ...input.destination,
        binding: { ...input.destination.binding, sourceBindingId: 'wrong' },
      },
    }),
  ).toThrow();
});
it('startup captures all identity fields and rejects forged endpoints/law/basis', () => {
  const epoch = createStartupPoseEpoch(startupInput());
  for (const bad of [
    { ...epoch, endMs: gameTimeMs(1101) },
    { ...epoch, basis: { ...epoch.basis, oldYaw: 1 } },
    { ...epoch, fixedLiftSign: -1 },
  ])
    expect(() => capturePoseEpoch(bad as typeof epoch)).toThrow();
});
it('startup retains strict-left composed defeat with separate presentation epoch', () => {
  const epoch = createStartupPoseEpoch(startupInput());
  const death = createDefeatPoseStamp({
    kind: 'defeat',
    entry: epoch,
    entryAt: gameTimeMs(1050),
    defeatStartedAt: presentationTimeMs(9000),
  });
  expect(death.entry).toEqual(epoch);
  expect(death.defeatStartedAt).toBe(9000);
});
it('startup policy requires explicit stance and deterministic mode, never v1 inference', () => {
  expect(() =>
    capturePoseRunPolicy({
      version: 1,
      mode: 'legacy',
      startup: startupPolicy(),
    }),
  ).toThrow();
  expect(() =>
    capturePoseRunPolicy({
      version: 1,
      mode: 'deterministic-pose-v1',
      startup: startupPolicy(),
    }),
  ).toThrow();
  expect(
    capturePoseRunPolicy({
      version: 1,
      mode: 'deterministic-pose-v1',
      attackStartStance: 'selected-side-kicks-v1',
      startup: startupPolicy(),
    }).startup,
  ).toEqual(startupPolicy());
});
it('startup SideThrust retains its own pinned pre-active domain, not the shorter kick window', () => {
  const i = startupInput(1000, 600);
  const e = createStartupPoseEpoch({
    ...i,
    destination: {
      ...i.destination,
      binding: STARTUP_SOURCES.SideThrustKick.binding,
    },
  });
  expect(e.firstActiveAt).toBe(1755.5555701255798);
  expect(e.rootPolicy).toBe('in-place-posture-xyz');
  expect(e.endMs).toBe(1600);
});
it('startup capture canonicalizes basis field order but rejects negative-zero identity substitution', () => {
  const e = createStartupPoseEpoch(startupInput());
  expect(
    capturePoseEpoch({
      ...e,
      basis: {
        admittedYaw: e.basis.admittedYaw,
        oldYaw: 0,
        authority: 'activation-stance-v1',
      },
    }),
  ).toEqual(e);
  expect(() =>
    capturePoseEpoch({ ...e, basis: { ...e.basis, oldYaw: -0 } }),
  ).toThrow();
});
it('startup rejects invalid sides, query bounds and nonfinite basis without clamping', () => {
  const e = createStartupPoseEpoch(startupInput());
  for (const at of [999, 1101, NaN, Infinity])
    expect(() => resolvePoseEpoch(e, gameTimeMs(at), 'right')).toThrow();
  expect(() => resolvePoseEpoch(e, e.startMs, 'bad' as 'right')).toThrow();
  expect(() =>
    createStartupPoseEpoch({
      ...startupInput(),
      basis: { authority: 'activation-stance-v1', oldYaw: NaN, admittedYaw: 0 },
    }),
  ).toThrow();
});
import { requireStartupCapability } from '../../src/contracts/pose';
it('startup capability refuses old v1 and recovery-only consumers explicitly', () => {
  const p = startupPolicy();
  expect(() =>
    requireStartupCapability(p, {
      version: 1,
      protocol: 'deterministic-pose-v1',
    }),
  ).toThrow('startup capability');
  expect(() => requireStartupCapability(p, undefined)).toThrow(
    'startup capability',
  );
  expect(() =>
    requireStartupCapability(p, {
      version: 1,
      protocol: 'deterministic-pose-v1',
      startup: { ...p, durationMs: durationMs(90) },
    }),
  ).toThrow();
  expect(() =>
    requireStartupCapability(p, {
      version: 1,
      protocol: 'deterministic-pose-v1',
      startup: p,
    }),
  ).not.toThrow();
});

const frozenStartupV1Golden = {
  kind: 'startup',
  version: 'startup-shared-matrix-v1',
  law: 'radius-fixed-lift-positive-diagonal-with-basis-v1',
  deathLayerPolicy: 'freeze-entry-through-local-death-v1',
  runId: 'fixture-run',
  actorId: 'fixture-run:actor:white',
  outgoing: {
    version: 1,
    binding: {
      clipId: 'Idle',
      durationMs: 2022.2222805023193,
      sourceBindingId:
        'pose-v1:40a42d3a6dfd776b19f48d7d2bcaf115e52e4e2b59c410f75e5d5ae8fc01f889',
    },
    mode: 'idle',
    startedAt: 0,
    playback: 'loop',
    activationId: null,
  },
  outgoingAt: 7000,
  outgoingSide: 'left',
  destination: {
    version: 1,
    binding: {
      clipId: 'SideKick',
      durationMs: 1177.7777671813965,
      sourceBindingId:
        'pose-v1:4fb6ea03f86f501457176d3bcbe0faa092cfdde4c6501c22a77eb99b0d451d43',
    },
    mode: 'attack',
    startedAt: 7000,
    playback: 'clamp',
    activationId: 'fixture-run:attack:4',
  },
  basis: {
    authority: 'activation-stance-v1',
    oldYaw: 0,
    admittedYaw: 1.5707963267948966,
  },
  policy: {
    version: 1,
    protocol: 'side-kick-startup-matrix-v1',
    durationMs: 100,
    fixedLiftSign: 1,
  },
  startMs: 7000,
  endMs: 7100,
  firstActiveAt: 7533.333361148834,
  windowPolicy: 'inclusive-accessor-frame-cells-v1:provisional-policy',
  rootPolicy: 'grounded-posture-y',
  fixedLiftSign: 1,
  identity:
    'synthetic-startup-epoch:{"kind":"startup","version":"startup-shared-matrix-v1","law":"radius-fixed-lift-positive-diagonal-with-basis-v1","deathLayerPolicy":"freeze-entry-through-local-death-v1","runId":"fixture-run","actorId":"fixture-run:actor:white","outgoing":{"version":1,"binding":{"clipId":"Idle","durationMs":2022.2222805023193,"sourceBindingId":"pose-v1:40a42d3a6dfd776b19f48d7d2bcaf115e52e4e2b59c410f75e5d5ae8fc01f889"},"mode":"idle","startedAt":0,"playback":"loop","activationId":null},"outgoingAt":7000,"outgoingSide":"left","destination":{"version":1,"binding":{"clipId":"SideKick","durationMs":1177.7777671813965,"sourceBindingId":"pose-v1:4fb6ea03f86f501457176d3bcbe0faa092cfdde4c6501c22a77eb99b0d451d43"},"mode":"attack","startedAt":7000,"playback":"clamp","activationId":"fixture-run:attack:4"},"basis":{"authority":"activation-stance-v1","oldYaw":0,"admittedYaw":1.5707963267948966},"policy":{"version":1,"protocol":"side-kick-startup-matrix-v1","durationMs":100,"fixedLiftSign":1},"startMs":7000,"endMs":7100,"firstActiveAt":7533.333361148834,"windowPolicy":"inclusive-accessor-frame-cells-v1:provisional-policy","rootPolicy":"grounded-posture-y","fixedLiftSign":1}',
} as const;

import {
  STARTUP_FRAME_CAPABILITY,
  STARTUP_FRAME_CAPABILITY_V2,
  captureStartupFrameCapability,
} from '../../src/assets/poseFramePreparation';
const startupV2Policy = () =>
  captureStartupTimelinePolicy({
    version: 2,
    protocol: 'side-kick-startup-matrix-v2',
    durationMs: durationMs(100),
    fixedLiftSign: 1,
    domain: 'fixed-positive-lift-midpoint-half-v1',
  });
it('startup v2 wire preserves frozen v1 identity bytes', () => {
  expect(
    createStartupPoseEpoch(
      frozenStartupV1Golden as unknown as Parameters<
        typeof createStartupPoseEpoch
      >[0],
    ).identity,
  ).toBe(frozenStartupV1Golden.identity);
});
it('startup v2 wire uses distinct immutable epoch law and identity', () => {
  const epoch = createStartupPoseEpoch({
    ...startupInput(),
    policy: startupV2Policy(),
  });
  expect(epoch.version).toBe('startup-shared-matrix-v2');
  expect(epoch.law).toBe('radius-fixed-positive-midpoint-half-with-basis-v2');
  expect(capturePoseEpoch(epoch)).toEqual(epoch);
  expect(epoch.identity).not.toBe(
    createStartupPoseEpoch(startupInput()).identity,
  );
  expect(Object.isFrozen(epoch.policy)).toBe(true);
});
it('startup v2 wire rejects mismatched policy protocol and domain', () => {
  for (const patch of [
    { protocol: 'side-kick-startup-matrix-v1' },
    { domain: 'other' },
  ])
    expect(() =>
      captureStartupTimelinePolicy({
        ...startupV2Policy(),
        ...patch,
      } as Parameters<typeof captureStartupTimelinePolicy>[0]),
    ).toThrow('Unsupported startup policy');
});
it('startup v2 wire rejects forged epoch law', () => {
  const epoch = createStartupPoseEpoch({
    ...startupInput(),
    policy: startupV2Policy(),
  });
  expect(() =>
    capturePoseEpoch({
      ...epoch,
      law: 'radius-fixed-lift-positive-diagonal-with-basis-v1',
    }),
  ).toThrow('Conflicting startup epoch identity');
});
it('startup v2 wire v1-only frame capability rejects v2', () => {
  expect(() =>
    captureStartupFrameCapability(STARTUP_FRAME_CAPABILITY, startupV2Policy()),
  ).toThrow('Missing matching startup frame capability');
  expect(
    captureStartupFrameCapability(STARTUP_FRAME_CAPABILITY, startupPolicy()),
  ).toEqual(STARTUP_FRAME_CAPABILITY);
});
it('startup v2 wire declared dual support preserves exact requested law', () => {
  expect(
    captureStartupFrameCapability(
      STARTUP_FRAME_CAPABILITY_V2,
      startupV2Policy(),
    ),
  ).toEqual(STARTUP_FRAME_CAPABILITY_V2);
  expect(
    captureStartupFrameCapability(STARTUP_FRAME_CAPABILITY_V2, startupPolicy()),
  ).toEqual(STARTUP_FRAME_CAPABILITY_V2);
});
it('startup v2 wire default and legacy remain unchanged', () => {
  expect(capturePoseRunPolicy()).toEqual({ version: 1, mode: 'legacy' });
  expect(
    capturePoseRunPolicy({ version: 1, mode: 'deterministic-pose-v1' }).startup,
  ).toBeUndefined();
});

it('crouch hold never advances or wraps and retains left-limit death entry', () => {
  const hold = createLivingPoseStamp({
    version: 1,
    binding: { ...binding, clipId: clipId('CrouchMove') },
    mode: 'crouch',
    startedAt: gameTimeMs(0),
    playback: 'hold',
    activationId: null,
  });
  for (const at of [0, 100, 1000000])
    expect(poseClipTime(hold, gameTimeMs(at))).toBe(0);
  expect(poseClipTime(hold, gameTimeMs(100), 'left')).toBe(0);
  expect([...poseClipIntervals(hold, gameTimeMs(10), gameTimeMs(100))]).toEqual(
    [{ kind: 'held', gameFrom: 10, gameTo: 100, clipFrom: 0, clipTo: 0 }],
  );
  expect([...poseClipIntervals(hold, gameTimeMs(0), gameTimeMs(0))]).toEqual(
    [],
  );
  const delayed = createLivingPoseStamp({ ...hold, startedAt: gameTimeMs(10) });
  expect(poseClipTime(delayed, gameTimeMs(10))).toBe(0);
  expect(() => poseClipTime(delayed, gameTimeMs(9))).toThrow(/activation/);
  expect(() => poseClipTime(delayed, gameTimeMs(10), 'left')).toThrow(
    /activation/,
  );
  expect(() =>
    poseClipIntervals(delayed, gameTimeMs(9), gameTimeMs(100)),
  ).toThrow();
  const death = createDefeatPoseStamp({
    kind: 'defeat',
    entry: hold,
    entryAt: gameTimeMs(100),
    defeatStartedAt: presentationTimeMs(900),
  });
  if ('kind' in death.entry) throw Error('Expected held canonical entry');
  expect(death.entry).toEqual(hold);
  expect(poseClipTime(death.entry, death.entryAt, 'left')).toBe(0);
  for (const playback of ['loop', 'clamp'] as const)
    expect(() => createLivingPoseStamp({ ...hold, playback })).toThrow(
      /playback/,
    );
  for (const mode of ['idle', 'walk', 'run', 'jump', 'attack'] as const)
    expect(() => createLivingPoseStamp({ ...hold, mode })).toThrow(/playback/);
});
