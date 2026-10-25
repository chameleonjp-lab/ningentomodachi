import { expect, test } from 'vitest';
import { createPointerInput } from '../../src/input/PointerInput';
import { run, player, actor, snapshot, viewport } from '../ui/fixtures/core';
import {
  type GameCommand,
  type InputModuleContext,
  attackActivationId,
  clipId,
  gameTimeMs,
  runId,
  tick,
} from '../../src/contracts';
function setup() {
  const commands: GameCommand[] = [];
  const begun: string[] = [];
  const ended: string[] = [];
  const released: string[] = [];
  let basis = 4;
  let observed = snapshot();
  const context: InputModuleContext = {
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
    readSnapshot: () => observed,
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
    observe: (value: ReturnType<typeof snapshot>) => {
      observed = value;
    },
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
test('horizontal signs remain local to a captured rotated C basis without depth travel', () => {
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

test('up swipe emits one jump and no depth movement', () => {
  const s = setup();
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(1, 'move', 100, 100);
  s.input.pointerMove(1, 100, 69);
  expect(s.commands.filter((c) => c.type === 'JumpRequested')).toEqual([]);
  s.input.pointerMove(1, 100, 68);
  expect(s.commands.at(-1)?.type).toBe('JumpRequested');
  for (const y of [0, 100, 68, -100]) s.input.pointerMove(1, 100, y);
  expect(s.commands.filter((c) => c.type === 'JumpRequested')).toHaveLength(1);
  expect(
    s.commands
      .filter((c) => c.type === 'MoveRequested')
      .every((c) => c.x === 0 && c.z === 0),
  ).toBe(true);
  s.input.pointerUp(1);
  s.input.pointerDown(1, 'move', 100, 100);
  s.input.pointerMove(1, 100, 68);
  expect(s.commands.filter((c) => c.type === 'JumpRequested')).toHaveLength(2);
});

test('down swipe holds crouch then releases on return lift and cancellation', () => {
  const s = setup();
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(1, 'move', 0, 0);
  s.input.pointerMove(1, 0, 31);
  expect(s.commands.filter((c) => c.type === 'CrouchRequested')).toEqual([]);
  s.input.pointerMove(1, 0, 32);
  expect(s.commands.at(-1)).toMatchObject({
    type: 'CrouchRequested',
    active: true,
    movementSessionId: s.begun[0],
    basisRevision: 4,
  });
  s.input.pointerMove(1, 0, 90);
  s.input.pointerMove(1, 0, 13);
  expect(s.commands.filter((c) => c.type === 'CrouchRequested')).toHaveLength(
    1,
  );
  s.input.pointerMove(1, 0, 12);
  expect(s.commands.at(-1)).toMatchObject({
    type: 'CrouchRequested',
    active: false,
  });
  s.input.pointerMove(1, 0, 32);
  s.input.pointerMove(1, 0, -32);
  expect(s.commands.slice(-2).map((c) => c.type)).toEqual([
    'CrouchRequested',
    'JumpRequested',
  ]);
  expect(s.commands.at(-2)).toMatchObject({ active: false });
  const count = s.commands.length;
  s.input.pointerUp(1);
  expect(s.ended).toEqual(s.begun);
  expect(s.commands).toHaveLength(count);
  s.input.pointerDown(1, 'move', 0, 0);
  s.input.pointerMove(1, 0, 32);
  const cancelledCount = s.commands.length;
  s.input.cancel('pointer-cancel');
  expect(s.released).toEqual(['pointer-cancel']);
  expect(s.commands).toHaveLength(cancelledCount);
});

test.each([
  { dx: 25.6, dy: -32, jump: 1, crouch: 0, horizontal: 0 },
  { dx: 25.61, dy: -32, jump: 0, crouch: 0, horizontal: 25.61 / 64 },
  { dx: -25.6, dy: 32, jump: 0, crouch: 1, horizontal: 0 },
  { dx: 0, dy: -31, jump: 0, crouch: 0, horizontal: 0 },
  { dx: 12, dy: 0, jump: 0, crouch: 0, horizontal: 0 },
  { dx: 13, dy: 0, jump: 0, crouch: 0, horizontal: 13 / 64 },
  { dx: -128, dy: 1, jump: 0, crouch: 0, horizontal: -1 },
])(
  'diagonal threshold/deadzone dx=$dx dy=$dy never combines horizontal with vertical action',
  ({ dx, dy, jump, crouch, horizontal }) => {
    const s = setup();
    s.input.setGate({ runId: run, enabled: true });
    s.input.pointerDown(1, 'move', 0, 0);
    s.input.pointerMove(1, dx, dy);
    expect(s.commands.filter((c) => c.type === 'JumpRequested')).toHaveLength(
      jump,
    );
    expect(s.commands.filter((c) => c.type === 'CrouchRequested')).toHaveLength(
      crouch,
    );
    expect(
      s.commands.filter((c) => c.type === 'MoveRequested').at(-1),
    ).toMatchObject({ x: horizontal, z: 0 });
  },
);

test('nonfinite coordinates unknown pointers and stale pointer reuse never double-fire', () => {
  const s = setup();
  s.input.setGate({ runId: run, enabled: true });
  for (const [x, y] of [
    [NaN, 0],
    [0, Infinity],
    [-Infinity, 0],
  ])
    s.input.pointerDown(1, 'move', x ?? 0, y ?? 0);
  expect(s.begun).toEqual([]);
  s.input.pointerDown(1, 'move', 0, 0);
  for (const [id, x, y] of [
    [99, 0, -32],
    [1, NaN, -32],
    [1, 0, Infinity],
  ])
    s.input.pointerMove(id ?? 0, x ?? 0, y ?? 0);
  expect(s.commands).toHaveLength(1);
  s.input.pointerMove(1, 0, -32);
  s.input.setGate({ runId: run, enabled: false });
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerMove(1, 0, -64);
  expect(s.commands.filter((c) => c.type === 'JumpRequested')).toHaveLength(1);
  s.input.pointerDown(1, 'move', 0, 0);
  s.input.pointerMove(1, 0, 32);
  expect(s.commands.at(-1)).toMatchObject({
    type: 'CrouchRequested',
    active: true,
    movementSessionId: s.begun[1],
  });
  s.input.pointerUp(1, true);
  expect(s.ended).toEqual([s.begun[1]]);
});

test.each(['move-first', 'attack-first'])(
  'two pointers keep ownership independent in %s press order',
  (order) => {
    const s = setup();
    s.input.setGate({ runId: run, enabled: true });
    if (order === 'attack-first') s.input.pointerDown(2, 'punch', 0, 0);
    s.input.pointerDown(1, 'move', 0, 0);
    s.input.pointerMove(1, 0, 32);
    if (order === 'move-first') s.input.pointerDown(2, 'punch', 0, 0);
    s.input.pointerMove(2, 0, -100);
    s.input.pointerUp(2);
    expect(s.ended).toEqual([]);
    s.input.pointerMove(1, 0, -32);
    expect(s.commands.filter((c) => c.type === 'AttackRequested')).toHaveLength(
      1,
    );
    expect(s.commands.filter((c) => c.type === 'JumpRequested')).toHaveLength(
      1,
    );
    s.input.pointerUp(1);
    expect(s.ended).toEqual(s.begun);
  },
);

test.each([-32, 32])(
  'synchronous release during a vertical move at $0 never emits a stale action',
  (y) => {
    const s = setup();
    s.input.setGate({ runId: run, enabled: true });
    s.input.pointerDown(1, 'move', 0, 0);
    s.input.subscribe((command) => {
      if (command.type === 'MoveRequested') s.input.cancel('interruption');
    });
    expect(() => s.input.pointerMove(1, 0, y)).not.toThrow();
    expect(s.commands.map((c) => c.type)).toEqual([
      'MoveRequested',
      'MoveRequested',
    ]);
    expect(s.released).toEqual(['interruption']);
  },
);

test.each([-32, 32])(
  'synchronous repeated vertical movement at %s delivers its action once',
  (y) => {
    const s = setup();
    s.input.setGate({ runId: run, enabled: true });
    s.input.pointerDown(1, 'move', 0, 0);
    let repeated = false;
    s.input.subscribe((command) => {
      if (command.type === 'MoveRequested' && !repeated) {
        repeated = true;
        s.input.pointerMove(1, 0, y * 2);
      }
    });
    s.input.pointerMove(1, 0, y);
    expect(
      s.commands.filter(
        (c) => c.type === (y < 0 ? 'JumpRequested' : 'CrouchRequested'),
      ),
    ).toHaveLength(1);
  },
);

test('fresh Core attack state releases the local hold without rearming a still-down gesture or dropping attacks', () => {
  const s = setup();
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(1, 'move', 0, 0);
  s.input.pointerMove(1, 0, 32);
  s.observe(snapshot({ actors: [{ ...actor(), crouching: true }] }));
  s.input.pointerDown(2, 'punch', 0, 0);
  s.input.pointerUp(2);
  s.observe(
    snapshot({
      actors: [
        {
          ...actor(),
          crouching: false,
          attack: {
            activationId: attackActivationId('accepted'),
            clipId: clipId('punch'),
            category: 'punch',
            startedAt: gameTimeMs(0),
            consumedImpacts: [],
            impactBindings: [],
          },
        },
      ],
    }),
  );
  s.input.pointerMove(1, 0, 40);
  s.input.pointerMove(1, 64, 20);
  expect(s.commands.at(-1)).toMatchObject({
    type: 'MoveRequested',
    x: 1,
    z: 0,
  });
  expect(
    s.commands.filter((c) => c.type === 'CrouchRequested' && c.active),
  ).toHaveLength(1);
  s.input.pointerDown(2, 'kick', 0, 0);
  expect(
    s.commands
      .filter((c) => c.type === 'AttackRequested')
      .map((c) => c.category),
  ).toEqual(['punch', 'kick']);
});

test('same-gesture reentrant down then deadzone cannot deliver stale crouch true', () => {
  const s = setup();
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(1, 'move', 0, 0);
  let returned = false;
  s.input.subscribe((command) => {
    if (command.type === 'MoveRequested' && !returned) {
      returned = true;
      s.input.pointerMove(1, 0, 0);
    }
  });
  s.input.pointerMove(1, 0, 32);
  s.input.pointerMove(1, 0, 0);
  expect(
    s.commands.filter((c) => c.type === 'CrouchRequested').map((c) => c.active),
  ).toEqual([false]);
  s.input.pointerMove(1, 0, 32);
  expect(s.commands.at(-1)).toMatchObject({
    type: 'CrouchRequested',
    active: true,
  });
});

test('same-gesture reentrant deadzone then down cannot deliver stale crouch false', () => {
  const s = setup();
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(1, 'move', 0, 0);
  s.input.pointerMove(1, 0, 32);
  let recrossed = false;
  s.input.subscribe((command) => {
    if (command.type === 'MoveRequested' && !recrossed) {
      recrossed = true;
      s.input.pointerMove(1, 0, 32);
    }
  });
  s.input.pointerMove(1, 0, 0);
  expect(
    s.commands.filter((c) => c.type === 'CrouchRequested').map((c) => c.active),
  ).toEqual([true, true]);
  s.input.pointerMove(1, 0, 40);
  expect(s.commands.filter((c) => c.type === 'CrouchRequested')).toHaveLength(
    2,
  );
});

test('completed attack clears a stationary local hold even when no active attack snapshot was sampled', () => {
  const s = setup();
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(1, 'move', 0, 0);
  s.input.pointerMove(1, 0, 32);
  s.input.pointerDown(2, 'punch', 0, 0);
  s.observe(
    snapshot({
      revision: 3,
      clocks: { ...snapshot().clocks, tick: tick(3) },
      actors: [{ ...actor(), crouching: false, attack: null }],
    }),
  );
  s.input.pointerMove(1, 64, 20);
  expect(s.commands.at(-1)).toMatchObject({
    type: 'MoveRequested',
    x: 1,
    z: 0,
  });
  expect(
    s.commands.filter((c) => c.type === 'CrouchRequested' && c.active),
  ).toHaveLength(1);
});

test('a newer non-tick snapshot cannot clear a crouch request still queued before its first tick', () => {
  const s = setup();
  s.input.setGate({ runId: run, enabled: true });
  s.input.pointerDown(1, 'move', 0, 0);
  s.input.pointerMove(1, 0, 32);
  s.observe(
    snapshot({
      revision: 2,
      actors: [{ ...actor(), crouching: false, attack: null }],
    }),
  );
  s.input.pointerMove(1, 64, 20);
  expect(s.commands.at(-1)).toMatchObject({
    type: 'MoveRequested',
    x: 0,
    z: 0,
  });
  s.input.pointerMove(1, 0, 12);
  expect(s.commands.at(-1)).toMatchObject({
    type: 'CrouchRequested',
    active: false,
  });
});
