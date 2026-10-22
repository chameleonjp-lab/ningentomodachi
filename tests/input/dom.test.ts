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
