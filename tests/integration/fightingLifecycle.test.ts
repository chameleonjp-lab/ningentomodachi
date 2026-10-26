import { requireValue } from '../../src/core/invariant';
import { expect, test } from 'vitest';
import { createGame } from '../../src/app/createGame';
import {
  actorId,
  commandId,
  type GameCommand,
  type GameplayCommand,
} from '../../src/contracts';
import { createFoundationCore } from '../../src/core/foundation';
import { createFixturePorts } from '../core/fixtures/ports';

async function harness() {
  const fixture = createFixturePorts();
  const batches: GameplayCommand[][] = [];
  const direct: string[] = [];
  const game = createGame(
    {
      ...fixture.factories,
      core: (context) => {
        const core = createFoundationCore(context);
        return {
          ...core,
          handle: (command) => {
            direct.push(command.type);
            core.handle(command);
          },
          handleInputBatch: (batch) => {
            batches.push([...batch.commands]);
            core.handleInputBatch(batch);
          },
        };
      },
    },
    { sessionId: 'fighting-guard-transport-only', seed: 1, stepMs: 10 },
  );
  await game.start();
  const run = requireValue(game.read()).runId;
  const guard = (
    sequence: number,
    active = true,
  ): Extract<GameplayCommand, { type: 'GuardRequested' }> => ({
    type: 'GuardRequested',
    runId: run,
    actorId: actorId('fixture-white'),
    active,
    input: { commandId: commandId(`guard:${sequence}`), sequence },
  });
  game.dispatch({ type: 'StartRequested', runId: run });
  return { game, guard, batches, direct, run };
}

test('Guard down/up uses the existing ordered next-tick batch, not direct Core.handle', async () => {
  const h = await harness();
  try {
    const down = h.guard(1),
      up = h.guard(2, false);
    h.game.dispatch(up);
    h.game.dispatch(down);
    expect(h.batches).toEqual([]);
    expect(h.direct).not.toContain('GuardRequested');
    h.game.advance(10);
    expect(h.batches[0]).toEqual([down, up]);
    h.game.dispatch(down);
    h.game.dispatch(up);
    h.game.advance(10);
    expect(h.batches).toHaveLength(1);
  } finally {
    h.game.dispose();
  }
});

test('malformed Guard does not consume packet identity or sequence', async () => {
  const h = await harness();
  try {
    const valid = h.guard(1);
    h.game.dispatch({ ...valid, active: 'yes' } as unknown as GameCommand);
    h.game.dispatch(valid);
    h.game.advance(10);
    expect(h.batches[0]).toEqual([valid]);
  } finally {
    h.game.dispose();
  }
});

test('release, pause and fresh run discard queued guard without replay', async () => {
  const h = await harness();
  try {
    h.game.dispatch(h.guard(1));
    h.game.dispatch({ type: 'InputsReleased', runId: h.run });
    h.game.advance(10);
    expect(h.batches).toEqual([]);
    h.game.dispatch(h.guard(2));
    h.game.dispatch({
      type: 'PauseRequested',
      runId: h.run,
      reason: 'settings',
    });
    h.game.dispatch(h.guard(3));
    h.game.dispatch({
      type: 'ResumeRequested',
      runId: h.run,
      reason: 'settings',
    });
    h.game.advance(10);
    expect(h.batches).toEqual([]);
    await h.game.restart();
    const next = requireValue(h.game.read()).runId;
    expect(next).not.toBe(h.run);
    h.game.dispatch({ type: 'StartRequested', runId: next });
    h.game.dispatch(h.guard(4));
    h.game.advance(10);
    expect(h.batches).toEqual([]);
  } finally {
    h.game.dispose();
  }
});

test('Guard packet captures active and sequence immutably before later caller mutation', async () => {
  const h = await harness();
  try {
    const packet = h.guard(1);
    h.game.dispatch(packet);
    Reflect.set(packet, 'active', false);
    Reflect.set(packet.input, 'sequence', 999);
    h.game.advance(10);
    expect(h.batches[0]?.[0]).toMatchObject({
      type: 'GuardRequested',
      active: true,
      input: { sequence: 1 },
    });
  } finally {
    h.game.dispose();
  }
});

test('Guard own accessor is rejected without evaluation or consuming corrected packet identity', async () => {
  const h = await harness();
  let reads = 0;
  try {
    const packet = h.guard(1);
    Object.defineProperty(packet, 'active', {
      enumerable: true,
      get() {
        return ++reads === 1 ? true : 'not-a-boolean';
      },
    });
    h.game.dispatch(packet);
    h.game.dispatch(h.guard(1, false));
    h.game.advance(10);
    expect(reads).toBe(0);
    expect(h.batches).toEqual([[h.guard(1, false)]]);
  } finally {
    h.game.dispose();
  }
});

test.each(['type', 'runId', 'actorId', 'active', 'input'] as const)(
  'Guard %s accessor never executes before correction is accepted',
  async (field) => {
    const h = await harness();
    let reads = 0;
    try {
      const packet = h.guard(1);
      Object.defineProperty(packet, field, {
        enumerable: true,
        get() {
          reads++;
          throw new Error('original getter must not execute');
        },
      });
      expect(() => h.game.dispatch(packet)).not.toThrow();
      h.game.dispatch(h.guard(1, false));
      h.game.advance(10);
      expect(reads).toBe(0);
      expect(h.batches).toEqual([[h.guard(1, false)]]);
    } finally {
      h.game.dispose();
    }
  },
);

test.each(['commandId', 'sequence'] as const)(
  'Guard input.%s accessor cannot consume identity or run code',
  async (field) => {
    const h = await harness();
    let reads = 0;
    try {
      const packet = h.guard(1);
      Object.defineProperty(packet.input, field, {
        enumerable: true,
        get() {
          reads++;
          throw new Error('nested getter must not execute');
        },
      });
      expect(() => h.game.dispatch(packet)).not.toThrow();
      h.game.dispatch(h.guard(1, false));
      h.game.advance(10);
      expect(reads).toBe(0);
      expect(h.batches).toEqual([[h.guard(1, false)]]);
    } finally {
      h.game.dispose();
    }
  },
);

test('Guard captures own data without original property Get or iterator reads', async () => {
  const h = await harness();
  let reads = 0;
  try {
    const packet = h.guard(1);
    const input = new Proxy(packet.input, {
      get() {
        reads++;
        throw new Error('no original Get');
      },
    });
    const proxy = new Proxy(
      { ...packet, input },
      {
        get() {
          reads++;
          throw new Error('no original Get');
        },
      },
    );
    expect(() => h.game.dispatch(proxy)).not.toThrow();
    h.game.advance(10);
    expect(reads).toBe(0);
    expect(h.batches).toEqual([[h.guard(1)]]);
  } finally {
    h.game.dispose();
  }
});

test('source descriptor trap side effects remain external and cannot enqueue into the stopped run', async () => {
  const h = await harness();
  let descriptorCallbacks = 0;
  try {
    const packet = new Proxy(h.guard(1), {
      ownKeys(target) {
        descriptorCallbacks++;
        h.game.stop();
        return Reflect.ownKeys(target);
      },
    });
    expect(() => h.game.dispatch(packet)).not.toThrow();
    expect(descriptorCallbacks).toBe(1);
    expect(h.game.read()).toBeNull();
    expect(h.batches).toEqual([]);
  } finally {
    h.game.dispose();
  }
});

test('a non-Guard discriminator cannot later change into an uncaptured Guard through source callbacks', async () => {
  const h = await harness();
  try {
    const target = {
      ...h.guard(1),
      type: 'AttackRequested',
      active: 'not-a-boolean',
    };
    const packet = new Proxy(target, {
      get(value, key, receiver) {
        return key === 'type'
          ? 'GuardRequested'
          : Reflect.get(value, key, receiver);
      },
    }) as unknown as GameCommand;
    h.game.dispatch(packet);
    h.game.dispatch(h.guard(1, false));
    h.game.advance(10);
    expect(h.batches).toEqual([[h.guard(1, false)]]);
  } finally {
    h.game.dispose();
  }
});
