// @vitest-environment jsdom
import { requireValue } from '../../src/core/invariant';
import { afterEach, expect, test } from 'vitest';
import { createGame } from '../../src/app/createGame';
import {
  actorId,
  commandId,
  type GameCommand,
  type GameplayCommand,
  type InputModuleContext,
  type InputPort,
} from '../../src/contracts';
import { createFoundationCore } from '../../src/core/foundation';
import { createFixturePorts } from '../core/fixtures/ports';
import {
  createPointerInput,
  type PointerInput,
} from '../../src/input/PointerInput';
import { bindPointerControls } from '../../src/input/dom';

async function harness(
  inputFactory?: (context: InputModuleContext) => InputPort,
) {
  const fixture = createFixturePorts();
  const batches: GameplayCommand[][] = [];
  const direct: string[] = [];
  const game = createGame(
    {
      ...fixture.factories,
      ...(inputFactory ? { input: inputFactory } : {}),
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

// R1-1..5 preserve the first five independent seam-and-qualification-v2 probes.
// Real E adapter + DOM binder + F queue only: Foundation Core has no actors or
// combat. fixture-white is an explicit transport actor, NOT a Core-issued roster.
// These tests do not enable D production binding or change readiness from false.
const pointerCleanups: (() => void)[] = [];
afterEach(() => {
  for (const dispose of pointerCleanups.splice(0).reverse()) dispose();
});
function pointer(target: EventTarget, type: string, id: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  target.dispatchEvent(event);
}
function key(target: EventTarget, type: string, value: string, repeat = false) {
  target.dispatchEvent(
    new KeyboardEvent(type, {
      key: value,
      repeat,
      bubbles: true,
      cancelable: true,
    }),
  );
}
async function pointerHarness(v3 = true, supplyGuard = true) {
  const captures = new Set<number>();
  const nodes = Object.fromEntries(
    ['move', 'punch', 'kick', 'jump', 'guard'].map((name) => {
      const button = document.createElement('button');
      button.type = 'button';
      document.body.append(button);
      button.setPointerCapture = (id) => {
        captures.add(id);
      };
      button.hasPointerCapture = (id) => captures.has(id);
      button.releasePointerCapture = (id) => {
        captures.delete(id);
        pointer(button, 'lostpointercapture', id);
      };
      pointerCleanups.push(() => button.remove());
      return [name, button];
    }),
  ) as Record<'move' | 'punch' | 'kick' | 'jump' | 'guard', HTMLButtonElement>;
  const { guard, ...legacyControls } = nodes;
  // The omitted-G branch supplies only the original four controls; the binder
  // must not create a replacement. This detached fixture button is never bound.
  if (!supplyGuard) guard.remove();
  let input: PointerInput | undefined;
  let binding: ReturnType<typeof bindPointerControls> | undefined;
  const h = await harness((context) => {
    const fixtureActor = actorId('fixture-white');
    const current = v3
      ? createPointerInput(context, fixtureActor, { fightingVersion: 3 })
      : createPointerInput(context, fixtureActor);
    const dom = bindPointerControls(
      current,
      supplyGuard ? nodes : legacyControls,
      document,
    );
    input = current;
    binding = dom;
    return {
      ...current,
      releaseAll() {
        dom.releaseAll();
        current.releaseAll();
      },
      dispose() {
        try {
          dom.dispose();
        } finally {
          current.dispose();
        }
      },
    };
  });
  pointerCleanups.push(() => h.game.dispose());
  expect(h.game.read()?.actors).toEqual([]);
  return {
    ...h,
    nodes,
    captures,
    input: () => requireValue(input),
    binding: () => requireValue(binding),
  };
}

test('R1-1: E pointer/keyboard G owners and P share the F next-tick queue and sequence', async () => {
  const h = await pointerHarness();
  pointer(h.nodes.guard, 'pointerdown', 11);
  key(h.nodes.guard, 'keydown', ' ');
  pointer(h.nodes.punch, 'pointerdown', 12);
  pointer(document, 'pointerup', 12);
  expect(h.batches).toEqual([]);
  expect(h.direct).not.toContain('GuardRequested');
  h.game.advance(10);
  expect(h.batches[0]?.map((c) => c.type)).toEqual([
    'GuardRequested',
    'AttackRequested',
  ]);
  expect(h.batches[0]?.map((c) => c.input.sequence)).toEqual([1, 2]);
  expect(h.batches[0]?.[0]).toMatchObject({
    type: 'GuardRequested',
    active: true,
    actorId: actorId('fixture-white'),
  });
  expect(h.batches[0]?.[1]).toMatchObject({ category: 'punch' });
  pointer(document, 'pointerup', 11);
  h.game.advance(10);
  expect(h.batches).toHaveLength(1);
  key(h.nodes.guard, 'keyup', ' ');
  h.game.advance(10);
  expect(h.batches[1]).toEqual([
    expect.objectContaining({
      type: 'GuardRequested',
      active: false,
      input: expect.objectContaining({ sequence: 3 }),
    }),
  ]);
  expect(h.captures.size).toBe(0);
  expect(h.direct).not.toContain('GuardRequested');
});

test('R1-2: blur clears E owners/capture and F pending Guard without stale up/repeat replay', async () => {
  const h = await pointerHarness();
  pointer(h.nodes.guard, 'pointerdown', 1);
  key(h.nodes.guard, 'keydown', 'Enter');
  const directBefore = h.direct.length;
  window.dispatchEvent(new Event('blur'));
  h.game.advance(10);
  expect(h.batches).toEqual([]);
  expect(h.captures.size).toBe(0);
  expect(h.direct.slice(directBefore)).toContain('InputsReleased');
  pointer(document, 'pointerup', 1);
  key(h.nodes.guard, 'keydown', 'Enter', true);
  key(h.nodes.guard, 'keyup', 'Enter');
  h.game.advance(10);
  expect(h.batches).toEqual([]);
  pointer(h.nodes.guard, 'pointerdown', 2);
  pointer(document, 'pointerup', 2);
  h.game.advance(10);
  expect(
    h.batches[0]?.map((c) => (c.type === 'GuardRequested' ? c.active : null)),
  ).toEqual([true, false]);
});

test('R1-3: DOM detach releases a delivered hold and detached events remain inert', async () => {
  const h = await pointerHarness();
  pointer(h.nodes.guard, 'pointerdown', 1);
  h.game.advance(10);
  expect(h.batches).toHaveLength(1);
  const directBefore = h.direct.length;
  h.binding().dispose();
  expect(h.direct.slice(directBefore)).toContain('InputsReleased');
  expect(h.captures.size).toBe(0);
  pointer(document, 'pointerup', 1);
  pointer(h.nodes.guard, 'pointerdown', 2);
  key(h.nodes.guard, 'keydown', ' ');
  h.nodes.guard.click();
  h.game.advance(10);
  expect(h.batches).toHaveLength(1);
  const directAfter = h.direct.length;
  h.binding().dispose();
  expect(h.direct).toHaveLength(directAfter);
});

test('R1-4: pause/restart drops old E ownership and old-run input but allows a fresh hold', async () => {
  const h = await pointerHarness();
  const oldInput = h.input();
  pointer(h.nodes.guard, 'pointerdown', 1);
  h.game.dispatch({ type: 'PauseRequested', runId: h.run, reason: 'manual' });
  h.game.dispatch({ type: 'ResumeRequested', runId: h.run, reason: 'manual' });
  pointer(document, 'pointerup', 1);
  h.game.advance(10);
  expect(h.batches).toEqual([]);
  expect(h.captures.size).toBe(0);
  await h.game.restart();
  const next = requireValue(h.game.read()).runId;
  expect(next).not.toBe(h.run);
  h.game.dispatch({ type: 'StartRequested', runId: next });
  oldInput.pointerDown(9, 'guard', 0, 0);
  oldInput.pointerUp(9);
  h.game.advance(10);
  expect(h.batches).toEqual([]);
  pointer(h.nodes.guard, 'pointerdown', 2);
  pointer(document, 'pointerup', 2);
  h.game.advance(10);
  expect(h.batches[0]?.map((c) => c.runId)).toEqual([next, next]);
  expect(
    h.batches[0]?.map((c) => (c.type === 'GuardRequested' ? c.active : null)),
  ).toEqual([true, false]);
});

test('R1-5: legacy default preserves P and ignores G, whether the optional G binding is supplied or absent', async () => {
  for (const supplyGuard of [true, false]) {
    const childrenBefore = document.body.childElementCount;
    const h = await pointerHarness(false, supplyGuard);
    expect(document.body.childElementCount).toBe(
      childrenBefore + (supplyGuard ? 5 : 4),
    );
    pointer(h.nodes.guard, 'pointerdown', 1);
    pointer(document, 'pointerup', 1);
    key(h.nodes.guard, 'keydown', ' ');
    key(h.nodes.guard, 'keyup', ' ');
    pointer(h.nodes.punch, 'pointerdown', 2);
    pointer(document, 'pointerup', 2);
    h.game.advance(10);
    expect(h.batches[0]?.map((c) => c.type)).toEqual(['AttackRequested']);
    expect(h.batches[0]?.[0]?.input.sequence).toBe(1);
  }
});
