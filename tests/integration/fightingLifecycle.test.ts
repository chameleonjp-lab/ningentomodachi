// @vitest-environment jsdom
import { requireValue } from '../../src/core/invariant';
import { afterEach, expect, test } from 'vitest';
import { createGame } from '../../src/app/createGame';
import {
  actorId,
  commandId,
  clipId,
  contactId,
  durationMs,
  gameTimeMs,
  FIGHTING_ENTRIES,
  FIGHTING_MOVE_SPECS,
  type ActorColor,
  type MotionDefinition,
  type HitLevel,
  type SpatialCandidate,
  type SpatialStepRequest,
  type FightingSpatialStepResult,
  type GameCommand,
  type GameplayCommand,
  type InputModuleContext,
  type InputPort,
} from '../../src/contracts';
import { createFoundationCore } from '../../src/core/foundation';
import { createCore, type CoreOptions } from '../../src/core/createCore';
import { fixtureCatalog } from '../core/fixtures/scenarios';
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

// R2: real E/F/Core authority with the existing fightingGuard synthetic config.
// Empty-world core-evidence-only fixture; NOT actual C/D geometry or production.
const R2_STEP = 1000 / 60;
const r2PoseClips = {
  standing: clipId('synthetic:idle'),
  crouching: clipId('synthetic:crouch'),
  airborne: clipId('synthetic:air'),
  landing: clipId('synthetic:land'),
  'guard-standing': clipId('synthetic:guard-standing'),
  'guard-crouching': clipId('synthetic:guard-crouching'),
  'hit-standing': clipId('synthetic:hit-standing'),
  'hit-crouching': clipId('synthetic:hit-crouching'),
};
/** Synthetic Core authority fixture, NOT actual robot/shape/readiness evidence. */
function r2Options(level: HitLevel = 'mid'): CoreOptions {
  const legacy = fixtureCatalog();
  const definitions = legacy.catalog.list().map((m) => ({
    ...m,
    durationMs: durationMs(2000),
    impacts: m.impacts.map((i) => ({ ...i, endMs: durationMs(1500) })),
    rootCurve: [
      requireValue(m.rootCurve[0]),
      { ...requireValue(m.rootCurve[1]), atMs: durationMs(2000) },
    ],
  }));
  const entries = FIGHTING_ENTRIES.map((entry) => ({
    ...entry,
    clipId: clipId(`synthetic:${entry.posture}:${entry.moveId}`),
  }));
  const player: MotionDefinition[] = entries.map((entry) => {
    const spec = FIGHTING_MOVE_SPECS[entry.moveId];
    const total =
      (spec.startupTicks + spec.activeTicks + spec.recoveryTicks) * R2_STEP;
    return {
      ...requireValue(definitions[0]),
      clipId: entry.clipId,
      category:
        entry.moveId.startsWith('k_') || entry.moveId === 'a_kick'
          ? 'kick'
          : 'punch',
      durationMs: durationMs(total),
      impacts: [
        {
          impactIndex: 0,
          startMs: durationMs(spec.startupTicks * R2_STEP),
          endMs: durationMs((spec.startupTicks + spec.activeTicks) * R2_STEP),
          damageShare: 1,
          shapeId: 'synthetic',
        },
      ],
      rootCurve: [
        requireValue(requireValue(definitions[0]).rootCurve[0]),
        {
          ...requireValue(requireValue(definitions[0]).rootCurve[1]),
          atMs: durationMs(total),
        },
      ],
    };
  });
  return {
    moves: legacy.moves,
    enemyAi: false,
    catalog: {
      list: () => definitions,
      get: (id) => definitions.find((m) => m.clipId === id),
    },
    fighting: {
      mode: 'core-evidence-only',
      policy: {
        version: 3,
        hpPerNormalizedPoint: 5,
        guardFrontDotMin: 0,
        hitstunPosture: 'retain-contact-posture',
      },
      entries,
      poseClips: r2PoseClips,
      catalog: {
        list: () => player,
        get: (id) => player.find((m) => m.clipId === id),
      },
      legacyImpactProfiles: definitions.flatMap((m) =>
        m.impacts.map((i) => ({
          clipId: m.clipId,
          impactIndex: i.impactIndex,
          level,
          hitstunTicks: 18,
          hitstopTicks: 6,
          blockstunTicks: 10,
          blockstopTicks: 4,
        })),
      ),
    },
  };
}

async function encounterHarness() {
  const fixture = createFixturePorts();
  const batches: GameplayCommand[][] = [],
    emitted: GameCommand[] = [];
  const gates: boolean[] = [],
    releases: string[] = [];
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
  const base = r2Options('low'),
    fighting = requireValue(base.fighting);
  const options = {
    ...base,
    fighting: {
      ...fighting,
      policy: { ...fighting.policy, hpPerNormalizedPoint: 100 },
    },
  };
  let nextHit:
    | ((request: SpatialStepRequest) => SpatialCandidate[])
    | undefined;
  let stepHook: (() => void) | undefined, releaseHook: (() => void) | undefined;
  const game = createGame(
    {
      ...fixture.factories,
      core(context) {
        const core = createCore(context, options);
        return {
          ...core,
          handleInputBatch(batch) {
            batches.push([...batch.commands]);
            core.handleInputBatch(batch);
          },
        };
      },
      input(context) {
        // Unlike R1's Foundation fixture, real Core supplies this run's actor IDs.
        const input = createPointerInput(context, undefined, {
          fightingVersion: 3,
        });
        const dom = bindPointerControls(input, nodes, document);
        input.subscribe((command) => emitted.push(command));
        return {
          ...input,
          setGate(gate) {
            gates.push(gate.enabled);
            input.setGate(gate);
          },
          releaseAll() {
            releases.push('input.releaseAll');
            dom.releaseAll();
            input.releaseAll();
            const hook = releaseHook;
            releaseHook = undefined;
            hook?.();
          },
          dispose() {
            try {
              dom.dispose();
            } finally {
              input.dispose();
            }
          },
        };
      },
      spatial(context) {
        return {
          ...fixture.factories.spatial(context),
          step(request) {
            const make = nextHit;
            nextHit = undefined;
            const candidates = make?.(request) ?? [];
            const hook = stepHook;
            stepHook = undefined;
            hook?.();
            // Existing synthetic fightingGuard witness schema. Core alone accepts KO.
            const result: FightingSpatialStepResult = {
              snapshot: {
                runId: context.runId,
                tick: request.snapshot.clocks.tick,
                vehicles: [],
                actors: request.snapshot.actors.map((a, i) => ({
                  actorId: a.actorId,
                  position: { x: 0, y: 0, z: i },
                  facing: { x: 0, y: 0, z: i === 0 ? 1 : -1 },
                  velocity: { x: 0, y: 0, z: 0 },
                  grounded: true,
                  locomotion: 'idle',
                })),
              },
              candidates,
              fighting: {
                stepTick: request.snapshot.clocks.tick,
                takeoffs: [],
                landings: [],
                contacts: candidates.flatMap((c) =>
                  c.kind === 'body-hit'
                    ? [
                        {
                          contactId: c.contactId,
                          atGameMs: c.at,
                          sourceActorId: c.source.actorId,
                          targetActorId: c.targetActorId,
                          sourcePosition: { x: 0, y: 0, z: 1 },
                          targetPosition: { x: 0, y: 0, z: 0 },
                          sourceFacing: { x: 0, y: 0, z: -1 },
                          targetFacing: { x: 0, y: 0, z: 1 },
                        },
                      ]
                    : [],
                ),
              },
            };
            return result;
          },
        };
      },
    },
    {
      sessionId: 'R2-empty-world-Core-evidence',
      seed: 42,
      stepMs: R2_STEP,
      maxStepsPerFrame: 1000,
    },
  );
  pointerCleanups.push(() => {
    releaseHook = undefined;
    game.dispose();
  });
  await game.start();
  const run = requireValue(game.read()).runId;
  game.dispatch({ type: 'StartRequested', runId: run });
  expect(game.read()?.world).toEqual({ vehicles: [], objects: [] });
  const actor = (color: ActorColor = 'white') =>
    requireValue(game.read()?.actors.find((a) => a.color === color));
  let serial = 0;
  return {
    game,
    run,
    nodes,
    actor,
    batches,
    emitted,
    gates,
    releases,
    captures,
    outputs: fixture.outputs,
    onRelease(hook: () => void) {
      releaseHook = hook;
    },
    hit(source: ActorColor, target: ActorColor, hook?: () => void) {
      nextHit = (request) => {
        const a = requireValue(
          request.snapshot.actors.find((a) => a.color === source),
        );
        const victim = requireValue(
          request.snapshot.actors.find((a) => a.color === target),
        );
        const attack = requireValue(a.attack),
          start = request.snapshot.clocks.gameTimeMs - request.step.durationMs;
        return [
          {
            kind: 'body-hit',
            runId: run,
            contactId: contactId(`R2-contact:${++serial}`),
            at: gameTimeMs(start + R2_STEP / 4),
            interval: {
              from: gameTimeMs(start),
              to: request.snapshot.clocks.gameTimeMs,
            },
            point: { x: 0, y: 1, z: 0 },
            evidence: 'swept-shape',
            source: {
              actorId: a.actorId,
              activationId: attack.activationId,
              impactId: requireValue(attack.impactBindings[0]).impactId,
            },
            targetActorId: victim.actorId,
          },
        ];
      };
      stepHook = hook;
      game.advance(R2_STEP);
    },
    attack(color: ActorColor, sequence: number) {
      game.dispatch({
        type: 'AttackRequested',
        runId: run,
        actorId: actor(color).actorId,
        category: 'punch',
        input: { commandId: commandId(`R2-enemy:${sequence}`), sequence },
      });
    },
    readyLethal() {
      pointer(nodes.punch, 'pointerdown', 10);
      pointer(document, 'pointerup', 10);
      game.advance(5 * R2_STEP);
    },
  };
}

test('R2 control: same-opponent drains preserve active G and do not replay events or release owners', async () => {
  const h = await encounterHarness();
  pointer(h.nodes.guard, 'pointerdown', 1);
  h.game.advance(R2_STEP);
  expect(h.actor().fighting?.guardHeld).toBe(true);
  const releases = h.releases.length,
    batches = h.batches.length;
  for (let i = 0; i < 3; i++) h.game.advance(0);
  expect(h.releases).toHaveLength(releases);
  expect(h.batches).toHaveLength(batches);
  expect(h.captures.has(1)).toBe(true);
  expect(
    h.outputs.slice(-3).every((output) => output.events.length === 0),
  ).toBe(true);
  h.game.advance(3 * R2_STEP);
  expect(h.releases).toHaveLength(releases);
  expect(h.batches).toHaveLength(batches);
  expect(h.actor().fighting?.guardHeld).toBe(true);
  expect(h.captures.has(1)).toBe(true);
  pointer(document, 'pointerup', 1);
  h.game.advance(R2_STEP);
  expect(h.actor().fighting?.guardHeld).toBe(false);
});

test('R2: accepted KO and next opponent each clear local G owners, including intermission presses', async () => {
  const h = await encounterHarness(),
    white = h.actor().actorId;
  h.readyLethal();
  pointer(h.nodes.guard, 'pointerdown', 1);
  key(h.nodes.guard, 'keydown', 'Enter');
  h.game.advance(R2_STEP);
  expect(h.actor().fighting?.guardHeld).toBe(false); // locally held, not defense while attacking
  const before = h.releases.length;
  h.hit('white', 'blue');
  expect(h.actor('blue').defeated).toBe(true);
  expect(h.game.read()?.currentOpponentId).toBeNull();
  expect(h.game.read()?.phase).toBe('running');
  expect(h.releases.length - before).toBe(1);
  expect(h.captures.size).toBe(0);
  expect(h.outputs.at(-1)?.events.map((e) => e.type)).toEqual([
    'HpChanged',
    'ActorDefeated',
    'OpponentChanged',
    'HeatChanged',
  ]);
  for (let i = 0; i < 3; i++) h.game.advance(0);
  expect(h.releases.length - before).toBe(1);
  const emitted = h.emitted.length;
  pointer(document, 'pointerup', 1);
  key(h.nodes.guard, 'keydown', 'Enter', true);
  key(h.nodes.guard, 'keyup', 'Enter');
  expect(h.emitted).toHaveLength(emitted);
  pointer(h.nodes.guard, 'pointerdown', 2);
  h.game.advance(R2_STEP);
  expect(h.actor().fighting?.guardHeld).toBe(true);
  h.game.advance(1630);
  expect(h.game.read()?.currentOpponentId).toBe(h.actor('green').actorId);
  expect(h.releases.length - before).toBe(2);
  expect(h.captures.size).toBe(0);
  expect(h.actor().actorId).toBe(white);
  expect(h.actor().fighting?.guardHeld).toBe(false);
  expect(h.actor('blue').fighting?.guardHeld).toBe(false);
  expect(h.actor('green').fighting?.guardHeld).toBe(false);
  expect(h.gates).toEqual([false, true]);
  pointer(h.nodes.guard, 'pointerdown', 3);
  h.game.advance(R2_STEP);
  expect(h.actor().fighting?.guardHeld).toBe(true);
  pointer(document, 'pointerup', 2);
  key(h.nodes.guard, 'keyup', 'Enter');
  h.game.advance(R2_STEP);
  expect(h.actor().fighting?.guardHeld).toBe(true);
  pointer(document, 'pointerup', 3);
  h.game.advance(R2_STEP);
  expect(h.actor().fighting?.guardHeld).toBe(false);
});

test('R2: accepted KO purges known G and K queued reentrantly after the fixed-step input cut', async () => {
  const h = await encounterHarness();
  h.readyLethal();
  h.hit('white', 'blue', () => {
    pointer(h.nodes.guard, 'pointerdown', 1);
    pointer(h.nodes.kick, 'pointerdown', 11);
    pointer(document, 'pointerup', 11);
  });
  expect(h.releases).toHaveLength(1);
  expect(h.captures.size).toBe(0);
  const delivered = h.batches.length;
  h.game.advance(R2_STEP);
  expect(h.batches).toHaveLength(delivered);
  expect(h.actor().fighting?.guardHeld).toBe(false);
  const old = h.emitted
    .filter((c): c is GameplayCommand => 'input' in c)
    .slice(-2);
  expect(old.map((c) => c.input.sequence)).toEqual([2, 3]);
  for (const command of old) h.game.dispatch(command);
  h.game.advance(R2_STEP);
  expect(h.batches).toHaveLength(delivered);
  pointer(h.nodes.guard, 'pointerdown', 2);
  h.game.advance(R2_STEP);
  expect(h.batches.at(-1)?.map((c) => c.input.sequence)).toEqual([4]);
  expect(h.actor().fighting?.guardHeld).toBe(true);
});

test('R2: identity is recorded before release callback republication and a genuinely fresh down survives', async () => {
  const h = await encounterHarness();
  h.readyLethal();
  pointer(h.nodes.guard, 'pointerdown', 1);
  let callbacks = 0;
  h.onRelease(() => {
    callbacks++;
    h.game.dispatch({
      type: 'QualityChanged',
      runId: h.run,
      quality: 'standard',
    });
    pointer(h.nodes.guard, 'pointerdown', 2);
  });
  h.hit('white', 'blue');
  expect(callbacks).toBe(1);
  expect(h.releases).toHaveLength(1);
  expect(h.captures.has(2)).toBe(true);
  h.game.advance(R2_STEP);
  expect(h.actor().fighting?.guardHeld).toBe(true);
  expect(h.batches.at(-1)?.[0]).toMatchObject({
    type: 'GuardRequested',
    active: true,
  });
});

test('R2: a release callback pause cannot be overwritten by the outer running publication', async () => {
  const h = await encounterHarness();
  h.readyLethal();
  pointer(h.nodes.guard, 'pointerdown', 1);
  h.onRelease(() =>
    h.game.dispatch({ type: 'PauseRequested', runId: h.run, reason: 'manual' }),
  );
  h.hit('white', 'blue');
  expect(h.game.read()?.phase).toBe('paused');
  expect(h.gates.at(-1)).toBe(false);
  expect(h.captures.size).toBe(0);
  h.game.dispatch({ type: 'ResumeRequested', runId: h.run, reason: 'manual' });
  h.game.advance(0);
  expect(h.actor().fighting?.guardHeld).toBe(false);
  pointer(h.nodes.guard, 'pointerdown', 2);
  h.game.advance(R2_STEP);
  expect(h.actor().fighting?.guardHeld).toBe(true);
});

test('R2: stopping from the transition release cannot reopen disposed input or retain native captures', async () => {
  const h = await encounterHarness();
  h.readyLethal();
  pointer(h.nodes.guard, 'pointerdown', 1);
  h.onRelease(() => h.game.stop());
  expect(() => h.hit('white', 'blue')).not.toThrow();
  expect(h.game.read()).toBeNull();
  expect(h.gates.at(-1)).toBe(false);
  expect(h.captures.size).toBe(0);
});

test('R2 control: terminal player KO retains its single existing gate-edge release and stale events stay inert', async () => {
  const h = await encounterHarness();
  pointer(h.nodes.guard, 'pointerdown', 1);
  key(h.nodes.guard, 'keydown', 'Enter');
  h.game.advance(R2_STEP);
  expect(h.actor().fighting?.guardHeld).toBe(true);
  const before = h.releases.length;
  for (let i = 0; i < 5; i++) {
    h.attack('blue', i + 2);
    h.hit('blue', 'white');
    if (i < 4) h.game.advance(2600);
  }
  expect(h.game.read()?.phase).toBe('terminal');
  expect(h.actor().defeated).toBe(true);
  expect(h.captures.size).toBe(0);
  expect(h.releases.length - before).toBe(1);
  const emitted = h.emitted.length;
  pointer(document, 'pointerup', 1);
  key(h.nodes.guard, 'keydown', 'Enter', true);
  key(h.nodes.guard, 'keyup', 'Enter');
  h.game.advance(0);
  h.game.advance(0);
  expect(h.emitted).toHaveLength(emitted);
  expect(h.releases.length - before).toBe(1);
  expect(h.gates).toEqual([false, true, false]);
});
