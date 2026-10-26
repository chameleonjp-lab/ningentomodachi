// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import {
  actorId,
  runId,
  type GameCommand,
  type GameSnapshot,
  type InputModuleContext,
} from '../../src/contracts';
import { bindPointerControls } from '../../src/input/dom';
import { createPointerInput } from '../../src/input/PointerInput';
import { actor, player, run, snapshot, viewport } from '../ui/fixtures/core';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function fixture(fighting = true, selectedActor?: ReturnType<typeof actorId>) {
  const commands: GameCommand[] = [];
  const released: string[] = [];
  const ended: string[] = [];
  let observed: GameSnapshot | null = snapshot();
  let basis = 4;
  const context: InputModuleContext = {
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
    readSnapshot: () => observed,
    movement: {
      begin: (sessionId) => ({
        runId: run,
        sessionId,
        revision: basis,
        right: { x: 1, y: 0, z: 0 },
        depth: { x: 0, y: 0, z: 1 },
      }),
      end: (sessionId) => {
        ended.push(sessionId);
      },
      releaseAll: (reason) => {
        released.push(reason);
      },
    },
  };
  const input = createPointerInput(
    context,
    selectedActor,
    fighting ? { fightingVersion: 3 } : {},
  );
  input.subscribe((command) => commands.push(command));
  input.setGate({ runId: run, enabled: true });
  cleanups.push(() => input.dispose());
  return {
    input,
    commands,
    released,
    ended,
    observe: (value: GameSnapshot | null) => {
      observed = value;
    },
    rotate: () => {
      basis = 9;
    },
  };
}
const guards = (commands: GameCommand[]) =>
  commands.filter((c) => c.type === 'GuardRequested');

test('G needs explicit v3 opt-in; legacy P/K/jump stay edge inputs', () => {
  const f = fixture(false);
  f.input.pointerDown(1, 'guard', 0, 0);
  f.input.pointerUp(1);
  f.input.pointerDown(2, 'punch', 0, 0);
  f.input.pointerDown(3, 'kick', 0, 0);
  f.input.pointerDown(4, 'jump', 0, 0);
  expect(f.commands.map((c) => c.type)).toEqual([
    'AttackRequested',
    'AttackRequested',
    'JumpRequested',
  ]);
  expect(
    f.commands
      .filter((c) => c.type === 'AttackRequested')
      .map((c) => c.category),
  ).toEqual(['punch', 'kick']);
});
test('G first press and final release capture lazy actor identity without hold repeats or movement', () => {
  const f = fixture();
  f.observe(null);
  f.input.pointerDown(1, 'guard', 0, 0);
  expect(f.commands).toEqual([]);
  f.observe(snapshot());
  f.input.pointerDown(1, 'guard', 0, 0);
  f.input.pointerDown(1, 'guard', 0, 0);
  f.input.pointerMove(1, 100, -100);
  f.input.pointerUp(99);
  f.observe(
    snapshot({
      actors: [{ ...actor(actorId('replacement')), color: 'white' }],
    }),
  );
  f.input.pointerUp(1);
  f.input.pointerUp(1, true);
  expect(f.commands).toMatchObject([
    {
      type: 'GuardRequested',
      actorId: player,
      active: true,
      input: { sequence: 1 },
    },
    {
      type: 'GuardRequested',
      actorId: player,
      active: false,
      input: { sequence: 2 },
    },
  ]);
  expect(f.ended).toEqual([]);
});
test('foreign snapshots never supply an implicit guard actor, selected actors retain their binding', () => {
  const f = fixture();
  f.observe(snapshot({ runId: runId('old-run') }));
  f.input.pointerDown(1, 'guard', 0, 0);
  expect(f.commands).toEqual([]);
  const selected = actorId('selected');
  const s = fixture(true, selected);
  s.observe(null);
  s.input.pointerDown(1, 'guard', 0, 0);
  s.input.pointerUp(1);
  expect(guards(s.commands).map((c) => c.actorId)).toEqual([
    selected,
    selected,
  ]);
});
test.each([
  [1, 2],
  [2, 1],
])(
  'two G fingers release only after the last owner in order %j',
  (first, last) => {
    const f = fixture();
    f.input.pointerDown(1, 'guard', 0, 0);
    f.input.pointerDown(2, 'guard', 0, 0);
    f.input.pointerUp(first, true);
    expect(guards(f.commands).map((c) => c.active)).toEqual([true]);
    f.input.pointerUp(last);
    expect(guards(f.commands).map((c) => c.active)).toEqual([true, false]);
  },
);
test.each(['guard-first', 'crouch-first'])(
  'G and held crouch remain independent in %s order',
  (order) => {
    const f = fixture();
    if (order === 'guard-first') f.input.pointerDown(1, 'guard', 0, 0);
    f.input.pointerDown(2, 'move', 0, 0);
    f.input.pointerMove(2, 0, 40);
    if (order === 'crouch-first') f.input.pointerDown(1, 'guard', 0, 0);
    f.input.pointerMove(2, 0, 0);
    expect(
      f.commands
        .filter((c) => c.type === 'CrouchRequested')
        .map((c) => c.active),
    ).toEqual([true, false]);
    expect(guards(f.commands).map((c) => c.active)).toEqual([true]);
    f.input.pointerUp(1);
    expect(f.ended).toEqual([]);
    f.input.pointerUp(2);
    expect(f.ended).toHaveLength(1);
  },
);
test.each(['guard-first', 'attacks-first'])(
  'P/K transport stays chronological with G and busy permissions: %s',
  (order) => {
    const f = fixture();
    const busy = { allowed: false, reason: 'busy' } as const;
    f.observe(
      snapshot({
        actors: [
          {
            ...actor(),
            actions: { punch: busy, kick: busy, jump: busy, move: busy },
          },
        ],
      }),
    );
    if (order === 'guard-first') f.input.pointerDown(1, 'guard', 0, 0);
    f.input.pointerDown(2, 'punch', 0, 0);
    f.input.pointerDown(3, 'kick', 0, 0);
    if (order === 'attacks-first') f.input.pointerDown(1, 'guard', 0, 0);
    f.input.pointerUp(1);
    f.input.pointerDown(4, 'punch', 0, 0);
    expect(
      f.commands
        .filter((c) => c.type === 'AttackRequested')
        .map((c) => c.category),
    ).toEqual(['punch', 'kick', 'punch']);
    expect(
      f.commands.map((c) => ('input' in c ? c.input.sequence : 0)),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(
      new Set(f.commands.map((c) => ('input' in c ? c.input.commandId : '')))
        .size,
    ).toBe(5);
    expect(f.commands[0]?.type).toBe(
      order === 'guard-first' ? 'GuardRequested' : 'AttackRequested',
    );
  },
);
test('G never turns horizontal/up swipe or separate jump into defense, and movement keeps captured basis', () => {
  const f = fixture();
  f.input.pointerDown(1, 'guard', 0, 0);
  f.input.pointerDown(2, 'move', 0, 0);
  f.rotate();
  f.input.pointerMove(2, 64, 0);
  f.input.pointerMove(2, 0, -40);
  f.input.pointerMove(2, 0, -50);
  f.input.pointerDown(3, 'jump', 0, 0);
  expect(
    f.commands
      .filter((c) => c.type === 'MoveRequested')
      .map((c) => c.basisRevision),
  ).toEqual([4, 4, 4, 4]);
  expect(f.commands.filter((c) => c.type === 'JumpRequested')).toHaveLength(2);
  expect(guards(f.commands).map((c) => c.active)).toEqual([true]);
});
test.each(['release', 'gate', 'cancel', 'dispose'])(
  '%s clears ownership without a stale release/replayed down',
  (kind) => {
    const f = fixture();
    f.input.pointerDown(1, 'guard', 0, 0);
    if (kind === 'release') f.input.releaseAll();
    if (kind === 'gate') f.input.setGate({ runId: run, enabled: false });
    if (kind === 'cancel') f.input.cancel('interruption');
    if (kind === 'dispose') f.input.dispose();
    f.input.pointerUp(1);
    f.input.setGate({ runId: run, enabled: true });
    f.input.pointerMove(1, 0, 20);
    expect(guards(f.commands).map((c) => c.active)).toEqual([true]);
    f.input.pointerDown(1, 'guard', 0, 0);
    expect(guards(f.commands).map((c) => c.active)).toEqual(
      kind === 'dispose' ? [true] : [true, true],
    );
  },
);
test('foreign gates and malformed/duplicate pointers cannot clear or acquire G', () => {
  const f = fixture();
  f.input.pointerDown(1, 'guard', NaN, 0);
  f.input.pointerDown(1, 'guard', 0, Infinity);
  f.input.pointerDown(1, 'guard', 0, 0);
  f.input.setGate({ runId: runId('other-run'), enabled: false });
  f.input.pointerDown(1, 'punch', 0, 0);
  f.input.pointerUp(1);
  expect(guards(f.commands).map((c) => c.active)).toEqual([true, false]);
  expect(f.commands).toHaveLength(2);
});
test.each(['begin', 'end'])(
  'synchronous cancellation during G %s cannot restore ownership',
  (when) => {
    const f = fixture();
    f.input.subscribe((command) => {
      if (
        command.type === 'GuardRequested' &&
        command.active === (when === 'begin')
      )
        f.input.cancel('interruption');
    });
    f.input.pointerDown(1, 'guard', 0, 0);
    f.input.pointerUp(1);
    f.input.pointerUp(1);
    expect(guards(f.commands).map((c) => c.active)).toEqual(
      when === 'begin' ? [true] : [true, false],
    );
    expect(f.released).toEqual(['interruption']);
  },
);

function pointer(
  target: EventTarget,
  type: string,
  id: number,
  x = 0,
  y = 0,
  button = 0,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  Object.defineProperty(event, 'isPrimary', { value: false });
  target.dispatchEvent(event);
  return event;
}
function domFixture() {
  const f = fixture();
  const captures = new Set<number>();
  const controls = Object.fromEntries(
    ['move', 'punch', 'kick', 'jump', 'guard'].map((action) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.textContent = action;
      node.setPointerCapture = (id) => {
        captures.add(id);
      };
      node.hasPointerCapture = (id) => captures.has(id);
      node.releasePointerCapture = (id) => {
        captures.delete(id);
        pointer(node, 'lostpointercapture', id);
      };
      document.body.append(node);
      return [action, node];
    }),
  ) as Record<'move' | 'punch' | 'kick' | 'jump' | 'guard', HTMLButtonElement>;
  const binding = bindPointerControls(f.input, controls, document);
  cleanups.push(() => {
    binding.dispose();
    for (const node of Object.values(controls)) node.remove();
  });
  return { ...f, controls, binding, captures };
}
test('optional G DOM control retains capture across controls and releases exactly once outside', () => {
  const f = domFixture();
  pointer(f.controls.guard, 'pointerdown', 1);
  pointer(f.controls.punch, 'pointerdown', 1);
  pointer(document.body, 'pointermove', 1, 50, -60);
  pointer(document.body, 'pointerup', 1);
  pointer(f.controls.guard, 'lostpointercapture', 1);
  f.controls.guard.dispatchEvent(
    new MouseEvent('click', { detail: 1, bubbles: true }),
  );
  expect(guards(f.commands).map((c) => c.active)).toEqual([true, false]);
  expect(f.commands).toHaveLength(2);
  expect(f.captures.size).toBe(0);
});
test('G lost capture releases only its pointer, preserving crouch and the other G finger', () => {
  const f = domFixture();
  pointer(f.controls.move, 'pointerdown', 3);
  pointer(document, 'pointermove', 3, 0, 40);
  pointer(f.controls.guard, 'pointerdown', 1);
  pointer(f.controls.guard, 'pointerdown', 2);
  pointer(f.controls.kick, 'lostpointercapture', 1);
  pointer(f.controls.guard, 'lostpointercapture', 1);
  expect(guards(f.commands).map((c) => c.active)).toEqual([true]);
  pointer(f.controls.guard, 'lostpointercapture', 2);
  expect(guards(f.commands).map((c) => c.active)).toEqual([true, false]);
  expect(f.ended).toEqual([]);
});
test.each(['pointercancel', 'blur', 'pagehide', 'hidden', 'dispose'])(
  '%s cancels all controls without guard release echo',
  (kind) => {
    const f = domFixture();
    pointer(f.controls.guard, 'pointerdown', 1);
    pointer(f.controls.move, 'pointerdown', 2);
    if (kind === 'pointercancel') pointer(document, 'pointercancel', 1);
    if (kind === 'blur' || kind === 'pagehide')
      window.dispatchEvent(new Event(kind));
    if (kind === 'hidden') {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: false,
      });
    }
    if (kind === 'dispose') f.binding.dispose();
    pointer(document, 'pointerup', 1);
    pointer(document, 'pointerup', 2);
    expect(guards(f.commands).map((c) => c.active)).toEqual([true]);
    expect(f.captures.size).toBe(0);
    expect(f.released).toEqual([
      kind === 'dispose'
        ? 'dispose'
        : kind === 'pointercancel'
          ? 'pointer-cancel'
          : 'interruption',
    ]);
  },
);
test('visible changes and unrelated pointers preserve G; non-left and unrelated defaults remain untouched', () => {
  const f = domFixture();
  pointer(f.controls.guard, 'pointerdown', 7, 0, 0, 2);
  expect(f.commands).toEqual([]);
  pointer(f.controls.guard, 'pointerdown', 1);
  pointer(document, 'pointercancel', 99);
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(pointer(document.body, 'pointermove', 99).defaultPrevented).toBe(
    false,
  );
  expect(guards(f.commands).map((c) => c.active)).toEqual([true]);
});
test('failed OS capture still supports G document-up fallback', () => {
  const f = domFixture();
  f.controls.guard.setPointerCapture = () => {
    throw Error('OS capture unavailable');
  };
  pointer(f.controls.guard, 'pointerdown', 1);
  pointer(document.body, 'pointerup', 1);
  expect(guards(f.commands).map((c) => c.active)).toEqual([true, false]);
});
test('cancellation during down does not reacquire native capture after the host clears ownership', () => {
  const f = domFixture();
  f.input.subscribe((command) => {
    if (command.type === 'GuardRequested' && command.active)
      f.binding.releaseAll();
  });
  pointer(f.controls.guard, 'pointerdown', 1);
  expect(f.captures.size).toBe(0);
});
test.each([' ', 'Enter'])(
  'focused G %j key is momentary, ignores repeat, and releases on keyup/focus loss',
  (key) => {
    const f = domFixture();
    const fire = (type: string, repeat = false) =>
      f.controls.guard.dispatchEvent(
        new KeyboardEvent(type, {
          key,
          repeat,
          bubbles: true,
          cancelable: true,
        }),
      );
    fire('keydown');
    fire('keydown', true);
    fire('keydown');
    expect(guards(f.commands).map((c) => c.active)).toEqual([true]);
    fire('keyup');
    expect(guards(f.commands).map((c) => c.active)).toEqual([true, false]);
    fire('keydown');
    f.controls.guard.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true }),
    );
    fire('keyup');
    expect(guards(f.commands).map((c) => c.active)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  },
);
test('assistive G click remains an honest tap, not a sticky toggle or protection claim', () => {
  const f = domFixture();
  f.controls.guard.click();
  f.controls.guard.click();
  expect(guards(f.commands).map((c) => c.active)).toEqual([
    true,
    false,
    true,
    false,
  ]);
});

test('a synchronous fresh movement on G release is not ended by the old G up', () => {
  const f = fixture();
  f.input.subscribe((command) => {
    if (command.type === 'GuardRequested' && !command.active)
      f.input.pointerDown(1, 'move', 0, 0);
  });
  f.input.pointerDown(1, 'guard', 0, 0);
  f.input.pointerUp(1);
  expect(f.ended).toEqual([]);
  f.input.pointerMove(1, 64, 0);
  expect(f.commands.at(-1)).toMatchObject({ type: 'MoveRequested', x: 1 });
});
test('keyboard and pointer G owners aggregate and host local release drops key ownership without echo', () => {
  const f = domFixture();
  f.controls.guard.dispatchEvent(
    new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
  );
  pointer(f.controls.guard, 'pointerdown', 1);
  f.controls.guard.dispatchEvent(
    new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }),
  );
  expect(guards(f.commands).map((c) => c.active)).toEqual([true]);
  f.binding.releaseAll();
  f.input.releaseAll();
  pointer(document, 'pointerup', 1);
  f.controls.guard.dispatchEvent(
    new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }),
  );
  expect(guards(f.commands).map((c) => c.active)).toEqual([true]);
  f.controls.guard.dispatchEvent(
    new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
  );
  expect(guards(f.commands).map((c) => c.active)).toEqual([true, true]);
});

test('explicit selectedActor preserves legacy lazy binding without reading a snapshot', () => {
  const commands: GameCommand[] = [];
  const input = createPointerInput(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
      readSnapshot: () => {
        throw Error('snapshot is not constructed yet');
      },
      movement: {
        begin: () => {
          throw Error('not a movement gesture');
        },
        end: () => {},
        releaseAll: () => {},
      },
    },
    player,
    { fightingVersion: 3 },
  );
  cleanups.push(() => input.dispose());
  input.subscribe((command) => commands.push(command));
  input.setGate({ runId: run, enabled: true });
  input.pointerDown(1, 'punch', 0, 0);
  input.pointerDown(2, 'guard', 0, 0);
  input.pointerUp(2);
  expect(commands.map((c) => c.type)).toEqual([
    'AttackRequested',
    'GuardRequested',
    'GuardRequested',
  ]);
});

test('semantic helper resolves same-run white lazily and canonically captures detached packets', async () => {
  const { toGuardIntent } = await import('../../src/input/guardIntent');
  let observed: GameSnapshot | null = null;
  const context = { runId: run, readSnapshot: () => observed };
  const input = {
    commandId: 'semantic-guard' as ReturnType<
      typeof import('../../src/contracts').commandId
    >,
    sequence: 1,
  };
  expect(toGuardIntent(true, context, input)).toBeNull();
  observed = snapshot({ runId: runId('old-run') });
  expect(toGuardIntent(true, context, input)).toBeNull();
  observed = snapshot();
  const intent = toGuardIntent(true, context, input);
  input.sequence = 2;
  expect(intent).toMatchObject({
    type: 'GuardRequested',
    runId: run,
    actorId: player,
    active: true,
    input: { sequence: 1 },
  });
  expect(Object.isFrozen(intent?.input)).toBe(true);
  expect(() => toGuardIntent(true, context, { ...input, sequence: 0 })).toThrow(
    RangeError,
  );
});
