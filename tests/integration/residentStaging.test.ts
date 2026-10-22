import { expect, test, vi } from 'vitest';
import { createResidentAssetStage } from '../../src/app/residentAssets';
import { createCore } from '../../src/core';
import { fixtureCatalog } from '../core/fixtures/scenarios';
import {
  actorId,
  clipId,
  durationMs,
  runId,
  type ActorColor,
} from '../../src/contracts';
import type { AnimatorAssets, ActorRig } from '../../src/assets';

function fixture(yieldTask?: () => Promise<void>) {
  const core = createCore(
    { runId: runId('authoritative-staging'), seed: 7 },
    { ...fixtureCatalog(), enemyAi: false },
  );
  const snapshot = core.read();
  const created: ActorRig<ActorColor>[] = [];
  const source: AnimatorAssets<ActorColor> = {
    locomotionClips: {
      idle: clipId('idle'),
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
    },
    clipDuration() {
      expect(this).toBe(source);
      return durationMs(500);
    },
    create: vi.fn(function (
      this: AnimatorAssets<ActorColor>,
      color: ActorColor,
    ) {
      expect(this).toBe(source);
      const rig = {
        node: color,
        seek: vi.fn(),
        setEmissiveEnabled: vi.fn(),
        dispose: vi.fn(),
      };
      created.push(rig);
      return rig;
    }),
  };
  const stage = createResidentAssetStage(snapshot, source, yieldTask);
  return { core, snapshot, source, stage, created };
}

test('Core-issued resident plan stages only the pair, transfers once, and preserves future creation', async () => {
  let release!: () => void;
  const f = fixture(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const preparation = f.stage.prepare(new AbortController().signal);
  expect(f.snapshot.currentOpponentId).toBeNull();
  expect(f.created.map((rig) => rig.node)).toEqual(['white']);
  expect(() => f.stage.assets.create('white')).toThrow('lease');
  release();
  await preparation;
  expect(f.created.map((rig) => rig.node)).toEqual(['white', 'blue']);
  expect(f.stage.assets.clipDuration(clipId('idle'))).toBe(500);
  f.stage.render(f.snapshot, () => {
    expect(f.stage.assets.create('white')).toBe(f.created[0]);
    expect(f.stage.assets.create('blue')).toBe(f.created[1]);
    expect(() => f.stage.assets.create('white')).toThrow('repeated');
    expect(() => f.stage.assets.create('green')).toThrow('Invalid');
  });
  const green = f.snapshot.actors.find((actor) => actor.color === 'green')!;
  const white = f.snapshot.actors.find((actor) => actor.color === 'white')!;
  f.stage.render(
    { ...f.snapshot, residentActorIds: [white.actorId, green.actorId] },
    () => {
      expect(f.stage.assets.create('green').node).toBe('green');
    },
  );
  expect(f.created.map((rig) => rig.node)).toEqual(['white', 'blue', 'green']);
  f.stage.dispose();
  for (const rig of f.created) {
    expect(rig.dispose).not.toHaveBeenCalled();
    rig.dispose();
  }
  f.core.dispose();
});

test('lease closes on throw and rejects wrong run, unknown ID and recoloring before allocation', async () => {
  const f = fixture();
  await f.stage.prepare(new AbortController().signal);
  const draw = vi.fn();
  expect(() =>
    f.stage.render({ ...f.snapshot, runId: runId('other') }, draw),
  ).toThrow();
  expect(() =>
    f.stage.render(
      { ...f.snapshot, residentActorIds: [actorId('invented')] },
      draw,
    ),
  ).toThrow();
  expect(() =>
    f.stage.render(
      {
        ...f.snapshot,
        actors: f.snapshot.actors.map((actor, i) =>
          i === 0 ? { ...actor, color: 'black' } : actor,
        ),
      },
      draw,
    ),
  ).toThrow();
  expect(draw).not.toHaveBeenCalled();
  expect(() =>
    f.stage.render(f.snapshot, () => {
      throw new Error('draw failure');
    }),
  ).toThrow('draw failure');
  expect(() => f.stage.assets.create('white')).toThrow('lease');
  expect(f.created).toHaveLength(2);
  f.stage.dispose();
  for (const rig of f.created) expect(rig.dispose).toHaveBeenCalledOnce();
  expect(() => f.stage.render(f.snapshot, draw)).toThrow();
  f.core.dispose();
});

test.each(['abort', 'dispose'] as const)(
  '%s during the staging yield releases the first rig and never creates the second',
  async (action) => {
    let release!: () => void;
    const f = fixture(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const preparation = f.stage.prepare(controller.signal);
    if (action === 'abort') controller.abort();
    else f.stage.dispose();
    release();
    await expect(preparation).rejects.toThrow('cancelled');
    expect(f.created).toHaveLength(1);
    expect(f.created[0]!.dispose).toHaveBeenCalledOnce();
    f.stage.dispose();
    f.core.dispose();
  },
);

test('failed second creation releases the first rig and retains the original error if cleanup throws', async () => {
  const f = fixture();
  const create = f.source.create.bind(f.source);
  f.source.create = (color) => {
    if (color === 'blue') throw new Error('second creation failure');
    const rig = create(color);
    vi.mocked(rig.dispose).mockImplementation(() => {
      throw new Error('cleanup failure');
    });
    return rig;
  };
  await expect(f.stage.prepare(new AbortController().signal)).rejects.toThrow(
    'second creation failure',
  );
  expect(f.created[0]!.dispose).toHaveBeenCalledOnce();
  f.stage.dispose();
  f.core.dispose();
});

test('disposal attempts every pending rig even when the first cleanup throws', async () => {
  const f = fixture();
  await f.stage.prepare(new AbortController().signal);
  vi.mocked(f.created[0]!.dispose).mockImplementation(() => {
    throw new Error('cleanup');
  });
  expect(() => f.stage.dispose()).toThrow('Pending rig cleanup failed');
  for (const rig of f.created) expect(rig.dispose).toHaveBeenCalledOnce();
  f.stage.dispose();
  f.core.dispose();
});

test('reentrant disposal during creation still releases the returned untransferred rig', async () => {
  const f = fixture();
  const create = f.source.create.bind(f.source);
  f.source.create = (color) => {
    const rig = create(color);
    f.stage.dispose();
    return rig;
  };
  await expect(f.stage.prepare(new AbortController().signal)).rejects.toThrow(
    'cancelled',
  );
  expect(f.created).toHaveLength(1);
  expect(f.created[0]!.dispose).toHaveBeenCalledOnce();
  f.core.dispose();
});

test.each(['before', 'white', 'blue'] as const)(
  'abort at %s releases every acquired rig without a later create',
  async (boundary) => {
    const f = fixture();
    const controller = new AbortController();
    const create = f.source.create.bind(f.source);
    f.source.create = (color) => {
      const rig = create(color);
      if (color === boundary) controller.abort();
      return rig;
    };
    if (boundary === 'before') controller.abort();
    await expect(f.stage.prepare(controller.signal)).rejects.toThrow(
      'cancelled',
    );
    expect(f.created).toHaveLength(
      boundary === 'before' ? 0 : boundary === 'white' ? 1 : 2,
    );
    for (const rig of f.created) expect(rig.dispose).toHaveBeenCalledOnce();
    f.stage.dispose();
    f.core.dispose();
  },
);

test('a failed task yield retains its error and releases the initial pending rig', async () => {
  const f = fixture(async () => {
    throw new Error('task scheduling failed');
  });
  await expect(f.stage.prepare(new AbortController().signal)).rejects.toThrow(
    'task scheduling failed',
  );
  expect(f.created).toHaveLength(1);
  expect(f.created[0]!.dispose).toHaveBeenCalledOnce();
  f.stage.dispose();
  f.core.dispose();
});

test('future creation interrupted synchronously releases only its returned rig, not transferred rigs', async () => {
  const f = fixture();
  await f.stage.prepare(new AbortController().signal);
  f.stage.render(f.snapshot, () => {
    f.stage.assets.create('white');
    f.stage.assets.create('blue');
  });
  const create = f.source.create.bind(f.source);
  f.source.create = (color) => {
    const rig = create(color);
    f.stage.dispose();
    return rig;
  };
  const white = f.snapshot.actors.find((a) => a.color === 'white')!;
  const green = f.snapshot.actors.find((a) => a.color === 'green')!;
  expect(() =>
    f.stage.render(
      { ...f.snapshot, residentActorIds: [white.actorId, green.actorId] },
      () => {
        f.stage.assets.create('green');
      },
    ),
  ).toThrow('cancelled');
  expect(f.created[2]!.dispose).toHaveBeenCalledOnce();
  for (const rig of f.created.slice(0, 2)) {
    expect(rig.dispose).not.toHaveBeenCalled();
    rig.dispose();
  }
  f.core.dispose();
});
