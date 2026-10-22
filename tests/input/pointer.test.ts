import { expect, test } from 'vitest';
import { createPointerInput } from '../../src/input/PointerInput';
import { run, player, snapshot, viewport } from '../ui/fixtures/core';
import {
  type GameCommand,
  type InputModuleContext,
  runId,
} from '../../src/contracts';
function setup() {
  const commands: GameCommand[] = [];
  const begun: string[] = [];
  const ended: string[] = [];
  const released: string[] = [];
  let basis = 4;
  const context: InputModuleContext = {
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
    readSnapshot: () => snapshot(),
    movement: {
      begin: (sessionId) => {
        begun.push(sessionId);
        return {
          runId: run,
          sessionId,
          revision: basis,
          right: { x: 1, y: 0, z: 0 },
          depth: { x: 0, y: 0, z: 1 },
        };
      },
      end: (id) => {
        ended.push(id);
      },
      releaseAll: (reason) => {
        released.push(reason);
      },
    },
  };
  const input = createPointerInput(context, player);
  input.subscribe((command) => commands.push(command));
  return {
    input,
    commands,
    begun,
    ended,
    released,
    rotate: () => {
      basis = 9;
    },
  };
}
test('starts disabled; captures basis synchronously at zero displacement and retains it while camera moves', () => {
  const s = setup();
  s.input.pointerDown(1, 'move', 20, 30);
  expect(s.begun).toEqual([]);
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(1, 'move', 20, 30);
  expect(s.begun).toHaveLength(1);
  expect(s.commands[0]).toMatchObject({
    type: 'MoveRequested',
    x: 0,
    z: 0,
    basisRevision: 4,
  });
  s.rotate();
  s.input.pointerMove(1, 200, 210);
  expect(s.commands[1]).toMatchObject({
    type: 'MoveRequested',
    basisRevision: 4,
  });
  const command = s.commands[1];
  if (command?.type !== 'MoveRequested') throw Error('move missing');
  expect(Math.hypot(command.x, command.z)).toBeCloseTo(1);
});
test('simultaneous movement jump punch kick preserves unique monotonic source identity and pointer ownership', () => {
  const s = setup();
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(1, 'move', 0, 0);
  s.input.pointerDown(2, 'jump', 0, 0);
  s.input.pointerDown(3, 'punch', 0, 0);
  s.input.pointerDown(4, 'kick', 0, 0);
  s.input.pointerDown(3, 'jump', 0, 0);
  s.input.pointerDown(5, 'move', 0, 0);
  expect(s.commands.map((c) => c.type)).toEqual([
    'MoveRequested',
    'JumpRequested',
    'AttackRequested',
    'AttackRequested',
  ]);
  expect(s.commands.map((c) => ('input' in c ? c.input.sequence : 0))).toEqual([
    1, 2, 3, 4,
  ]);
  expect(
    new Set(s.commands.map((c) => ('input' in c ? c.input.commandId : '')))
      .size,
  ).toBe(4);
});
test('release ends sessions, does not echo during A release, and OS pointer reuse gets a fresh session', () => {
  const s = setup();
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(1, 'move', 0, 0);
  s.input.pointerUp(1);
  expect(s.ended).toEqual(s.begun);
  s.input.pointerDown(1, 'move', 0, 0);
  expect(s.begun[1]).not.toBe(s.begun[0]);
  const n = s.commands.length;
  s.input.releaseAll();
  expect(s.commands).toHaveLength(n);
  s.input.pointerMove(1, 100, 0);
  expect(s.commands).toHaveLength(n);
  s.input.setGate({ runId: run, enabled: false });
  s.input.setGate({ runId: runId('stale'), enabled: true });
  s.input.pointerDown(3, 'punch', 0, 0);
  expect(s.commands).toHaveLength(n);
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(3, 'punch', 0, 0);
  expect(s.commands.at(-1)).toMatchObject({ input: { sequence: n + 1 } });
});
test('local cancellation requests all-release; disposal permanently rejects new input', () => {
  const s = setup();
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(1, 'move', 0, 0);
  s.input.cancel('pointer-cancel');
  expect(s.released).toEqual(['pointer-cancel']);
  s.input.pointerMove(1, 100, 100);
  expect(s.commands).toHaveLength(1);
  s.input.dispose();
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(2, 'jump', 0, 0);
  expect(s.commands).toHaveLength(1);
});
test('input can be constructed before active snapshot; resolves player only at user gesture', () => {
  let ready = false;
  const commands: GameCommand[] = [];
  const input = createPointerInput({
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
    readSnapshot: () => (ready ? snapshot() : null),
    movement: {
      begin: (sessionId) => ({
        runId: run,
        sessionId,
        revision: 1,
        right: { x: 1, y: 0, z: 0 },
        depth: { x: 0, y: 0, z: 1 },
      }),
      end: () => {},
      releaseAll: () => {},
    },
  });
  input.subscribe((c) => commands.push(c));
  input.setGate({ runId: run, enabled: true });
  input.pointerDown(1, 'punch', 0, 0);
  expect(commands).toEqual([]);
  ready = true;
  input.pointerDown(1, 'punch', 0, 0);
  expect(commands[0]).toMatchObject({
    type: 'AttackRequested',
    actorId: player,
  });
});
test('screen-right x and screen-up depth signs remain local to a captured rotated C basis', () => {
  const commands: GameCommand[] = [];
  let revision = 4;
  let captures = 0;
  const input = createPointerInput({
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
    readSnapshot: () => snapshot(),
    movement: {
      begin: (sessionId) => {
        captures++;
        return {
          runId: run,
          sessionId,
          revision,
          right: { x: 0, y: 0, z: -1 },
          depth: { x: 1, y: 0, z: 0 },
        };
      },
      end: () => {},
      releaseAll: () => {},
    },
  });
  input.subscribe((c) => commands.push(c));
  input.setGate({ runId: run, enabled: true });
  input.pointerDown(1, 'move', 100, 100);
  revision = 9;
  for (const [x, y, expectedX, expectedZ] of [
    [164, 100, 1, 0],
    [36, 100, -1, 0],
    [100, 36, 0, 1],
    [100, 164, 0, -1],
  ]) {
    input.pointerMove(1, x ?? 0, y ?? 0);
    expect(commands.at(-1)).toMatchObject({
      type: 'MoveRequested',
      x: expectedX,
      z: expectedZ,
      basisRevision: 4,
    });
  }
  expect(captures).toBe(1);
  input.pointerUp(1);
  input.pointerDown(1, 'move', 100, 100);
  expect(commands.at(-1)).toMatchObject({ basisRevision: 9 });
  expect(captures).toBe(2);
});
