import { expect, test, vi } from 'vitest';
import { createResidentAssetStage } from '../../src/app/residentAssets';
import { createCore } from '../../src/core';
import { fixtureCatalog } from '../core/fixtures/scenarios';
import {
  clipId,
  durationMs,
  runId,
  type ActorColor,
} from '../../src/contracts';

function fixture(missing?: string) {
  const core = createCore(
    { runId: runId('pose-stage'), seed: 1 },
    { ...fixtureCatalog(), enemyAi: false },
  );
  const created: Array<{
    node: ActorColor;
    dispose: () => void;
  }> = [];
  const source = {
    locomotionClips: {
      idle: clipId('idle'),
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
    },
    clipDuration: () => durationMs(1000),
    create(color: ActorColor) {
      const rig = {
        node: color,
        seek: vi.fn(),
        setEmissiveEnabled: vi.fn(),
        dispose: vi.fn(),
        ...(missing === `${color}:pose` ? {} : { seekPose: vi.fn() }),
        ...(missing === `${color}:death` ? {} : { seekDefeat: vi.fn() }),
      };
      created.push(rig);
      return rig;
    },
  };
  const yielded = vi.fn(async () => {});
  const stage = createResidentAssetStage(core.read(), source, yielded, {
    version: 1,
    mode: 'deterministic-pose-v1',
  });
  return { core, stage, created, yielded, source };
}
for (const missing of ['white:pose', 'white:death', 'blue:pose', 'blue:death'])
  test(`required staged driver rejects missing ${missing} and releases every acquired rig`, async () => {
    const f = fixture(missing);
    await expect(f.stage.prepare(new AbortController().signal)).rejects.toThrow(
      /pose/i,
    );
    expect(f.created.map((r) => r.node)).toEqual(
      missing.startsWith('white') ? ['white'] : ['white', 'blue'],
    );
    for (const rig of f.created) expect(rig.dispose).toHaveBeenCalledOnce();
    f.stage.dispose();
    f.core.dispose();
  });
test('actual two required drivers qualify without a probe or seek and remain exact once-only transfers', async () => {
  const f = fixture();
  await f.stage.prepare(new AbortController().signal);
  expect(f.created.map((r) => r.node)).toEqual(['white', 'blue']);
  expect(f.yielded).toHaveBeenCalledOnce();
  f.stage.render(f.core.read(), () => {
    expect(f.stage.assets.create('white')).toBe(f.created[0]);
    expect(f.stage.assets.create('blue')).toBe(f.created[1]);
  });
  f.stage.dispose();
  for (const rig of f.created) {
    expect(rig.dispose).not.toHaveBeenCalled();
    rig.dispose();
  }
  f.core.dispose();
});

test('a future invalid driver is rejected within its legitimate lease without releasing transferred residents', async () => {
  const f = fixture('green:pose');
  await f.stage.prepare(new AbortController().signal);
  f.stage.render(f.core.read(), () => {
    f.stage.assets.create('white');
    f.stage.assets.create('blue');
  });
  const initial = f.core.read();
  const ids = initial.actors
    .filter((actor) => actor.color === 'white' || actor.color === 'green')
    .map((actor) => actor.actorId);
  expect(() =>
    f.stage.render({ ...initial, residentActorIds: ids }, () =>
      f.stage.assets.create('green'),
    ),
  ).toThrow(/pose/i);
  expect(f.created.map((rig) => rig.node)).toEqual(['white', 'blue', 'green']);
  expect(f.created[2]!.dispose).toHaveBeenCalledOnce();
  expect(f.created[0]!.dispose).not.toHaveBeenCalled();
  expect(f.created[1]!.dispose).not.toHaveBeenCalled();
  expect(() => f.stage.assets.create('green')).toThrow('lease');
  f.stage.dispose();
  f.created[0]!.dispose();
  f.created[1]!.dispose();
  f.core.dispose();
});

for (const method of ['seekPose', 'seekDefeat'] as const)
  for (const kind of ['throw', 'reentrant'] as const)
    for (const color of ['white', 'blue'] as const)
      test(`${color} ${method} ${kind} getter cannot leak an untransferred rig; fresh preparation succeeds`, async () => {
        const f = fixture();
        const original = f.source.create;
        const failure = new Error('original getter failure');
        f.source.create = (createdColor) => {
          const rig = original(createdColor);
          if (createdColor === color)
            Object.defineProperty(rig, method, {
              get() {
                if (kind === 'throw') throw failure;
                f.stage.dispose();
                return () => {};
              },
            });
          return rig;
        };
        const loading = f.stage.prepare(new AbortController().signal);
        if (kind === 'throw') await expect(loading).rejects.toBe(failure);
        else await expect(loading).rejects.toThrow('cancelled');
        expect(f.created.map((r) => r.node)).toEqual(
          color === 'white' ? ['white'] : ['white', 'blue'],
        );
        for (const rig of f.created) expect(rig.dispose).toHaveBeenCalledOnce();
        f.stage.dispose();
        for (const rig of f.created) expect(rig.dispose).toHaveBeenCalledOnce();
        f.core.dispose();
        const next = fixture();
        await next.stage.prepare(new AbortController().signal);
        expect(next.created.map((r) => r.node)).toEqual(['white', 'blue']);
        next.stage.dispose();
        next.core.dispose();
      });
for (const method of ['seekPose', 'seekDefeat'] as const)
  test(`${method} getter original error survives current-rig cleanup failure`, async () => {
    const f = fixture();
    const original = f.source.create;
    const failure = new Error('getter primary');
    f.source.create = (color) => {
      const rig = original(color);
      if (color === 'blue') {
        Object.defineProperty(rig, method, {
          get() {
            throw failure;
          },
        });
        rig.dispose.mockImplementation(() => {
          throw new Error('cleanup secondary');
        });
      }
      return rig;
    };
    await expect(f.stage.prepare(new AbortController().signal)).rejects.toBe(
      failure,
    );
    for (const rig of f.created) expect(rig.dispose).toHaveBeenCalledOnce();
    f.stage.dispose();
    f.core.dispose();
  });

test('pose descriptor is captured once before staging yields and is detached from caller mutation', async () => {
  const f = fixture();
  const descriptor = {
    version: 1 as const,
    bindingSetId: 'captured',
    clips: ['idle', 'walk', 'run', 'jump'].map((id) => ({
      clipId: clipId(id),
      durationMs: durationMs(1000),
      sourceBindingId: `trusted:${id}`,
    })),
    locomotion: {
      idle: clipId('idle'),
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
    },
  };
  const read = vi.fn(() => descriptor);
  const source = {
    ...f.source,
    get poseBindings() {
      return read();
    },
  };
  const stage = createResidentAssetStage(f.core.read(), source, async () => {
    descriptor.bindingSetId = 'mutated';
    descriptor.clips[0]!.sourceBindingId = 'mutated';
  });
  try {
    expect(read).toHaveBeenCalledTimes(1);
    await stage.prepare(new AbortController().signal);
    expect(read).toHaveBeenCalledTimes(1);
    expect(stage.assets.poseBindings).toMatchObject({
      bindingSetId: 'captured',
      clips: [{ sourceBindingId: 'trusted:idle' }, {}, {}, {}],
    });
    expect(Object.isFrozen(stage.assets.poseBindings)).toBe(true);
    expect(Object.isFrozen(stage.assets.poseBindings!.clips[0])).toBe(true);
  } finally {
    stage.dispose();
    f.stage.dispose();
    f.core.dispose();
  }
});

import {
  RECOVERY_FRAME_CAPABILITY,
  createPoseFrameDriver,
} from '../../src/assets/poseFramePreparation';
const recoveryPolicy = {
  version: 1 as const,
  mode: 'deterministic-pose-v1' as const,
  recovery: RECOVERY_FRAME_CAPABILITY,
};
test('synthetic stage2 resident capability failure occurs before actor allocation', () => {
  const f = fixture();
  expect(() =>
    createResidentAssetStage(
      f.core.read(),
      f.source,
      async () => {},
      recoveryPolicy,
    ),
  ).toThrow();
  expect(f.created).toHaveLength(0);
  f.stage.dispose();
  f.core.dispose();
});
test('synthetic stage2 resident stage requires actual per-actor prepare capability', async () => {
  const f = fixture(),
    stage = createResidentAssetStage(
      f.core.read(),
      {
        ...f.source,
        recoveryCapability: RECOVERY_FRAME_CAPABILITY,
        stageActor() {
          throw Error('not invoked during readiness');
        },
      },
      async () => {},
      recoveryPolicy,
    );
  await expect(stage.prepare(new AbortController().signal)).rejects.toThrow(
    'recovery',
  );
  expect(f.created).toHaveLength(1);
  expect(f.created[0]?.dispose).toHaveBeenCalledOnce();
  stage.dispose();
  f.stage.dispose();
  f.core.dispose();
});
test('synthetic stage2 resident readiness does not invoke private evaluators or allocate numeric H', async () => {
  const f = fixture(),
    evaluate = vi.fn(() => ({
      pose: [
        {
          id: 'root',
          parent: null,
          t: [0, 0, 0],
          q: [0, 0, 0, 1],
          s: [1, 1, 1],
        },
      ],
    }));
  const stage = createResidentAssetStage(
    f.core.read(),
    {
      ...f.source,
      recoveryCapability: RECOVERY_FRAME_CAPABILITY,
      stageActor() {
        throw Error('not invoked during readiness');
      },
      create: (color) => ({
        ...f.source.create(color),
        poseFrame: createPoseFrameDriver(
          evaluate,
          () => {},
          () => {},
        ),
      }),
    },
    async () => {},
    recoveryPolicy,
  );
  await stage.prepare(new AbortController().signal);
  expect(f.created).toHaveLength(2);
  expect(evaluate).not.toHaveBeenCalled();
  expect(stage.assets.recoveryCapability).toEqual(RECOVERY_FRAME_CAPABILITY);
  stage.dispose();
  f.stage.dispose();
  f.core.dispose();
});
