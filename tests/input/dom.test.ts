// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { bindPointerControls } from '../../src/input/dom';
import { createPointerInput } from '../../src/input/PointerInput';
import { player, run, snapshot, viewport } from '../ui/fixtures/core';
import type { GameCommand } from '../../src/contracts';
function pointer(
  target: HTMLElement,
  type: string,
  id: number,
  x = 20,
  y = 30,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  target.dispatchEvent(event);
  return event;
}
test('real DOM listeners preserve multi-touch, suppress only gameplay defaults, skip synthetic click duplicates and clean up', () => {
  const root = document.createElement('section');
  document.body.append(root);
  const move = document.createElement('div');
  const punch = document.createElement('button');
  const kick = document.createElement('button');
  const jump = document.createElement('button');
  root.append(move, punch, kick, jump);
  const commands: GameCommand[] = [];
  let release = 0;
  const input = createPointerInput(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
      readSnapshot: () => snapshot(),
      movement: {
        begin: (sessionId) => ({
          runId: run,
          sessionId,
          revision: 1,
          right: { x: 1, y: 0, z: 0 },
          depth: { x: 0, y: 0, z: 1 },
        }),
        end: () => {},
        releaseAll: () => {
          release++;
        },
      },
    },
    player,
  );
  input.subscribe((c) => commands.push(c));
  input.setGate({ runId: run, enabled: true });
  const binding = bindPointerControls(
    input,
    { move, punch, kick, jump },
    document,
  );
  expect(pointer(move, 'pointerdown', 1).defaultPrevented).toBe(true);
  pointer(jump, 'pointerdown', 2);
  pointer(punch, 'pointerdown', 3);
  pointer(move, 'pointermove', 1, 90, 30);
  punch.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
  expect(commands.map((c) => c.type)).toEqual([
    'MoveRequested',
    'JumpRequested',
    'AttackRequested',
    'MoveRequested',
  ]);
  punch.click();
  expect(commands.at(-1)?.type).toBe('AttackRequested');
  const ordinary = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(ordinary);
  expect(ordinary.defaultPrevented).toBe(false);
  const gameMenu = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
  });
  punch.dispatchEvent(gameMenu);
  expect(gameMenu.defaultPrevented).toBe(true);
  pointer(move, 'pointercancel', 1);
  expect(release).toBe(1);
  binding.dispose();
  const count = commands.length;
  pointer(kick, 'pointerdown', 4);
  expect(commands).toHaveLength(count);
  root.remove();
});
test('failed pointer capture still receives movement and release outside control, without intercepting unrelated page gestures', () => {
  const root = document.createElement('section');
  document.body.append(root);
  const move = document.createElement('div');
  const punch = document.createElement('button');
  const kick = document.createElement('button');
  const jump = document.createElement('button');
  root.append(move, punch, kick, jump);
  const commands: GameCommand[] = [];
  const ended: string[] = [];
  const input = createPointerInput(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
      readSnapshot: () => snapshot(),
      movement: {
        begin: (sessionId) => ({
          runId: run,
          sessionId,
          revision: 1,
          right: { x: 1, y: 0, z: 0 },
          depth: { x: 0, y: 0, z: 1 },
        }),
        end: (id) => {
          ended.push(id);
        },
        releaseAll: () => {},
      },
    },
    player,
  );
  input.subscribe((c) => commands.push(c));
  input.setGate({ runId: run, enabled: true });
  move.setPointerCapture = () => {
    throw Error('capture cancelled');
  };
  const binding = bindPointerControls(
    input,
    { move, punch, kick, jump },
    document,
  );
  pointer(move, 'pointerdown', 1);
  pointer(document.body, 'pointermove', 1, 90, 30);
  pointer(document.body, 'pointerup', 1);
  expect(commands).toHaveLength(2);
  expect(ended).toHaveLength(1);
  expect(pointer(document.body, 'pointermove', 99).defaultPrevented).toBe(
    false,
  );
  binding.dispose();
  root.remove();
});

// These are DOM event-contract checks, not browser or physical-device evidence.
function lifecycleFixture() {
  const root = document.createElement('section');
  const elements = {
    move: document.createElement('div'),
    punch: document.createElement('button'),
    kick: document.createElement('button'),
    jump: document.createElement('button'),
  };
  root.append(...Object.values(elements));
  document.body.append(root);
  const commands: GameCommand[] = [];
  const ended: { id: string; reason: string }[] = [];
  const releases: string[] = [];
  const captures = new Map<number, HTMLElement>();
  const released: number[] = [];
  // jsdom has no pointer-capture implementation. Model its ownership and
  // synchronous loss notification, while exercising the real input adapter.
  for (const element of Object.values(elements)) {
    element.setPointerCapture = (id) => {
      captures.set(id, element);
    };
    element.hasPointerCapture = (id) => captures.get(id) === element;
    element.releasePointerCapture = (id) => {
      captures.delete(id);
      released.push(id);
      pointer(element, 'lostpointercapture', id);
    };
  }
  const input = createPointerInput(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
      readSnapshot: () => snapshot(),
      movement: {
        begin: (sessionId) => ({
          runId: run,
          sessionId,
          revision: 1,
          right: { x: 1, y: 0, z: 0 },
          depth: { x: 0, y: 0, z: 1 },
        }),
        end: (id, reason) => {
          ended.push({ id, reason });
        },
        releaseAll: (reason) => {
          releases.push(reason);
        },
      },
    },
    player,
  );
  input.subscribe((command) => commands.push(command));
  input.setGate({ runId: run, enabled: true });
  const binding = bindPointerControls(input, elements, document);
  return {
    ...elements,
    commands,
    ended,
    releases,
    captures,
    released,
    binding,
    cleanup() {
      binding.dispose();
      root.remove();
    },
  };
}

for (const interruption of ['blur', 'pagehide', 'hidden'] as const) {
  test(`${interruption} releases all captured fingers and requires a fresh movement gesture`, () => {
    const f = lifecycleFixture();
    const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    try {
      pointer(f.move, 'pointerdown', 1);
      pointer(f.jump, 'pointerdown', 2);
      if (interruption === 'hidden') {
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      } else window.dispatchEvent(new Event(interruption));
      expect(f.releases).toEqual(['interruption']);
      expect(f.released).toEqual([1, 2]);
      expect(f.captures.size).toBe(0);
      expect(f.ended).toEqual([]);
      expect(
        pointer(document.body, 'pointermove', 1, 84, 30).defaultPrevented,
      ).toBe(false);
      pointer(document.body, 'pointerup', 2);
      expect(f.commands.map((command) => command.type)).toEqual([
        'MoveRequested',
        'JumpRequested',
      ]);
      pointer(f.move, 'pointerdown', 1);
      pointer(document.body, 'pointermove', 1, 84, 30);
      expect(f.commands.at(-1)).toMatchObject({
        type: 'MoveRequested',
        x: 1,
        z: 0,
      });
      expect(f.commands[2]).toMatchObject({
        movementSessionId: `${run}:gesture:2`,
      });
    } finally {
      if (hidden) Object.defineProperty(document, 'hidden', hidden);
      else Reflect.deleteProperty(document, 'hidden');
      f.cleanup();
    }
  });
}

test('visible visibilitychange leaves the current movement session intact', () => {
  const f = lifecycleFixture();
  const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
  try {
    pointer(f.move, 'pointerdown', 1);
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    pointer(document.body, 'pointermove', 1, 84, 30);
    expect(f.releases).toEqual([]);
    expect(f.released).toEqual([]);
    expect(f.commands.at(-1)).toMatchObject({
      type: 'MoveRequested',
      x: 1,
      z: 0,
    });
  } finally {
    if (hidden) Object.defineProperty(document, 'hidden', hidden);
    else Reflect.deleteProperty(document, 'hidden');
    f.cleanup();
  }
});

test('lost capture cancels only its movement pointer, without replaying held buttons', () => {
  const f = lifecycleFixture();
  try {
    pointer(f.move, 'pointerdown', 1);
    pointer(f.jump, 'pointerdown', 2);
    f.captures.delete(1);
    pointer(f.move, 'lostpointercapture', 1);
    pointer(f.move, 'lostpointercapture', 1);
    expect(f.ended).toEqual([{ id: `${run}:gesture:1`, reason: 'cancelled' }]);
    expect(f.releases).toEqual([]);
    expect(f.captures.has(2)).toBe(true);
    expect(
      pointer(document.body, 'pointermove', 1, 84, 30).defaultPrevented,
    ).toBe(false);
    pointer(document.body, 'pointerup', 2);
    expect(f.commands.map((command) => command.type)).toEqual([
      'MoveRequested',
      'JumpRequested',
    ]);
    pointer(f.move, 'pointerdown', 3);
    expect(f.commands.at(-1)).toMatchObject({
      movementSessionId: `${run}:gesture:2`,
    });
  } finally {
    f.cleanup();
  }
});

test('normal pointerup releases capture once and is not converted to cancellation by lost capture', () => {
  const f = lifecycleFixture();
  try {
    pointer(f.move, 'pointerdown', 1);
    pointer(document.body, 'pointerup', 1);
    pointer(document.body, 'pointerup', 1);
    expect(f.released).toEqual([1]);
    expect(f.ended).toEqual([{ id: `${run}:gesture:1`, reason: 'released' }]);
    expect(f.releases).toEqual([]);
    expect(
      pointer(document.body, 'pointermove', 1, 84, 30).defaultPrevented,
    ).toBe(false);
  } finally {
    f.cleanup();
  }
});

test('nonprimary touch can jump while movement owns the primary touch', () => {
  const f = lifecycleFixture();
  try {
    pointer(f.move, 'pointerdown', 1);
    const secondTouch = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    Object.defineProperties(secondTouch, {
      pointerId: { value: 2 },
      pointerType: { value: 'touch' },
      isPrimary: { value: false },
    });
    f.jump.dispatchEvent(secondTouch);
    pointer(document.body, 'pointerup', 2);
    pointer(document.body, 'pointermove', 1, 84, 30);
    expect(secondTouch.defaultPrevented).toBe(true);
    expect(f.commands.map((command) => command.type)).toEqual([
      'MoveRequested',
      'JumpRequested',
      'MoveRequested',
    ]);
    expect(f.commands.at(-1)).toMatchObject({ x: 1, z: 0 });
    expect(f.ended).toEqual([]);
    expect(f.released).toEqual([2]);
  } finally {
    f.cleanup();
  }
});

test('nonleft mouse buttons do not acquire capture or emit gameplay input', () => {
  const f = lifecycleFixture();
  try {
    for (const button of [1, 2]) {
      const event = new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button,
      });
      Object.defineProperty(event, 'pointerId', { value: button });
      f.jump.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(f.commands).toEqual([]);
    expect(f.captures.size).toBe(0);
  } finally {
    f.cleanup();
  }
});

test('an unrelated page pointer cancellation does not clear the active gameplay gesture', () => {
  const f = lifecycleFixture();
  try {
    pointer(f.move, 'pointerdown', 1);
    pointer(document.body, 'pointercancel', 99);
    pointer(document.body, 'pointermove', 1, 84, 30);
    expect(f.releases).toEqual([]);
    expect(f.commands.at(-1)).toMatchObject({
      type: 'MoveRequested',
      x: 1,
      z: 0,
    });
  } finally {
    f.cleanup();
  }
});

test('disposing twice releases captures once and removes document and window listeners', () => {
  const f = lifecycleFixture();
  try {
    pointer(f.move, 'pointerdown', 1);
    pointer(f.jump, 'pointerdown', 2);
    f.binding.dispose();
    f.binding.dispose();
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(pointer(document.body, 'pointermove', 1).defaultPrevented).toBe(
      false,
    );
    pointer(document.body, 'pointerup', 1);
    pointer(f.jump, 'pointerdown', 2);
    f.jump.click();
    expect(f.releases).toEqual(['dispose']);
    expect(f.released).toEqual([1, 2]);
    expect(f.commands.map((command) => command.type)).toEqual([
      'MoveRequested',
      'JumpRequested',
    ]);
  } finally {
    f.cleanup();
  }
});
