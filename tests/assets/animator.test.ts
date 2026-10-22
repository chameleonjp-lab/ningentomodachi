import { expect, test } from 'vitest';
import {
  activeRealTimeMs,
  actorId,
  clipId,
  durationMs,
  gameTimeMs,
  presentationTimeMs,
  runId,
  tick,
  type AnimationModuleContext,
  type CommittedFrame,
} from '../../src/contracts';
import {
  createActorAnimator,
  type ActorRig,
} from '../../src/assets/actorAnimator';
const run = runId('animation-run');
const player = actorId('white');
function frame(time = 0): CommittedFrame {
  const allowed = { allowed: true as const, reason: null };
  return {
    snapshot: {
      revision: 1,
      contractVersion: 1,
      runId: run,
      phase: 'running',
      clocks: {
        tick: tick(0),
        gameTimeMs: gameTimeMs(time),
        activeRealTimeMs: activeRealTimeMs(time),
        presentationTimeMs: presentationTimeMs(time),
      },
      seed: 1,
      pauseReasons: [],
      quality: 'standard',
      actors: [
        {
          actorId: player,
          color: 'white',
          hp: 500,
          maxHp: 500,
          heat: { amount: 0, capacity: 7, lockedUntil: null },
          attack: null,
          defeated: false,
          actions: {
            punch: allowed,
            kick: allowed,
            jump: allowed,
            move: allowed,
          },
        },
      ],
      currentOpponentId: null,
      result: null,
      presentation: { kind: 'none' },
      world: { vehicles: [], objects: [] },
    },
    spatial: {
      runId: run,
      tick: tick(0),
      actors: [
        {
          actorId: player,
          position: { x: 0, y: 0, z: 3 },
          facing: { x: 0, y: 0, z: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          grounded: true,
          locomotion: 'idle',
        },
      ],
      vehicles: [],
    },
    events: [],
    viewport: {
      revision: 1,
      widthCssPx: 800,
      heightCssPx: 600,
      offsetLeftCssPx: 0,
      offsetTopCssPx: 0,
      devicePixelRatio: 1,
      safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  };
}
test('animation mounts once, seeks absolute game time at rate one, ignores stale frames and disposes B-owned resources after detach', () => {
  const order: string[] = [];
  const seeks: { clip: string; time: number }[] = [];
  const node = {};
  const context: AnimationModuleContext<object> = {
    runId: run,
    seed: 1,
    viewport: { read: () => frame().viewport, subscribe: () => () => {} },
    renderHost: {
      runId: run,
      mountActor: ({ node: mounted }) => {
        expect(mounted).toBe(node);
        order.push('mount');
        return () => {
          order.push('detach');
        };
      },
    },
  };
  const rig: ActorRig<object> = {
    node,
    seek: (clip, time) => {
      seeks.push({ clip, time });
    },
    setEmissiveEnabled: () => {},
    dispose: () => {
      order.push('dispose');
    },
  };
  const animator = createActorAnimator(context, {
    create: () => rig,
    clipDuration: () => durationMs(1000),
    locomotionClips: {
      idle: clipId('Idle'),
      walk: clipId('Walk'),
      run: clipId('Run'),
      jump: clipId('Jump'),
    },
  });
  animator.render(frame(0));
  animator.render(frame(250));
  animator.render(frame(250));
  expect(order).toEqual(['mount']);
  expect(seeks.at(-1)).toEqual({ clip: 'Idle', time: 0.25 });
  const stale = frame(500);
  animator.render({
    ...stale,
    snapshot: { ...stale.snapshot, runId: runId('stale') },
  });
  expect(seeks).toHaveLength(3);
  animator.dispose();
  animator.dispose();
  expect(order).toEqual(['mount', 'detach', 'dispose']);
});
test('failed mount releases unreturned resources and removed actors do not leak', () => {
  let disposed = 0;
  const context: AnimationModuleContext<object> = {
    runId: run,
    seed: 1,
    viewport: { read: () => frame().viewport, subscribe: () => () => {} },
    renderHost: {
      runId: run,
      mountActor: () => {
        throw new Error('mount failure');
      },
    },
  };
  const animator = createActorAnimator(context, {
    create: () => ({
      node: {},
      seek: () => {},
      setEmissiveEnabled: () => {},
      dispose: () => {
        disposed++;
      },
    }),
    clipDuration: () => durationMs(1000),
    locomotionClips: {
      idle: clipId('Idle'),
      walk: clipId('Walk'),
      run: clipId('Run'),
      jump: clipId('Jump'),
    },
  });
  expect(() => animator.render(frame())).toThrow('mount failure');
  expect(disposed).toBe(1);
  animator.dispose();
});

test('missed defeat frames seek durable A death timing and never revert a defeated actor to idle', () => {
  const seeks: { clip: string; time: number }[] = [];
  const context: AnimationModuleContext<object> = {
    runId: run,
    seed: 1,
    viewport: { read: () => frame().viewport, subscribe: () => () => {} },
    renderHost: { runId: run, mountActor: () => () => {} },
  };
  const animator = createActorAnimator(context, {
    create: () => ({
      node: {},
      seek: (clip, time) => {
        seeks.push({ clip, time });
      },
      setEmissiveEnabled: () => {},
      dispose: () => {},
    }),
    clipDuration: () => durationMs(500),
    locomotionClips: {
      idle: clipId('Idle'),
      walk: clipId('Walk'),
      run: clipId('Run'),
      jump: clipId('Jump'),
    },
  });
  const input = frame(1500);
  const actor = input.snapshot.actors[0];
  if (!actor) throw new Error('Fixture');
  const dead = {
    ...input,
    snapshot: {
      ...input.snapshot,
      actors: [
        {
          ...actor,
          hp: 0,
          defeated: true,
          defeatPresentation: {
            category: 'kick' as const,
            startedAt: presentationTimeMs(0),
            slowDurationMs: durationMs(1500),
            playbackRate: 0.25 as const,
          },
        },
      ],
    },
  };
  animator.render(dead);
  expect(seeks.at(-1)).toEqual({ clip: 'DefeatKick', time: 0.375 });
  animator.render({
    ...dead,
    snapshot: {
      ...dead.snapshot,
      clocks: {
        ...dead.snapshot.clocks,
        presentationTimeMs: presentationTimeMs(1625),
      },
    },
  });
  expect(seeks.at(-1)).toEqual({ clip: 'DefeatKick', time: 0.5 });
  animator.dispose();
});
