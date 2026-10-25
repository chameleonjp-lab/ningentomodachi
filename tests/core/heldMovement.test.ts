import { expect, test } from 'vitest';
import {
  clipId,
  commandId,
  durationMs,
  tick,
  runId,
  type CorePort,
  type GameplayCommand,
} from '../../src/contracts';
import { requireValue } from '../../src/core/invariant';
import { createCore } from '../../src/core/createCore';
import {
  setup,
  run,
  hitOpponent,
  advanceCore,
  fixtureCatalog,
  attack,
  step,
  envelope,
  reference,
} from './fixtures/scenarios';
function commands(core: CorePort) {
  const actorId = core.read().actors[0]?.actorId;
  if (!actorId) throw new Error('Missing player');
  let sequence = 0;
  const base = () => ({
    runId: run,
    actorId,
    input: { commandId: commandId(`held:${++sequence}`), sequence },
  });
  return {
    move: (x = 1, z = 0): GameplayCommand => ({
      ...base(),
      type: 'MoveRequested',
      x,
      z,
      movementSessionId: 'held',
      basisRevision: 0,
    }),
    attack: (): GameplayCommand => ({
      ...base(),
      type: 'AttackRequested',
      category: 'punch',
    }),
    jump: (): GameplayCommand => ({ ...base(), type: 'JumpRequested' }),
    crouch: (active = true, session = 'held'): GameplayCommand => ({
      ...base(),
      type: 'CrouchRequested',
      active,
      movementSessionId: session,
      basisRevision: 0,
    }),
  };
}
function batch(core: CorePort, commands: readonly GameplayCommand[]) {
  core.handleInputBatch({
    runId: run,
    tick: tick(core.read().clocks.tick + 1),
    commands,
  });
}
function next(core: CorePort) {
  core.present(durationMs(1));
  const request = core.beginStep({ durationMs: durationMs(1) });
  core.completeStep({
    snapshot: {
      runId: run,
      tick: core.read().clocks.tick,
      actors: [],
      vehicles: [],
    },
    candidates: [],
  });
  return request;
}
test.each(['same', 'prior', 'during'] as const)(
  'retains %s held movement while attack suppresses free application',
  (timing) => {
    const core = setup(),
      c = commands(core),
      move = c.move(),
      attack = c.attack(),
      jump = c.jump();
    if (timing === 'same') batch(core, [move, attack, jump]);
    else if (timing === 'prior') {
      batch(core, [move]);
      batch(core, [attack, jump]);
    } else {
      batch(core, [attack, jump]);
      batch(core, [move]);
    }
    const request = next(core);
    expect(request.intents).toEqual([move]);
    expect(request.snapshot.actors[0]?.actions.move).toEqual({
      allowed: false,
      reason: 'busy',
    });
    for (let i = 0; i < 11; i++) next(core);
    expect(core.read().actors[0]?.attack).toBeNull();
    expect(next(core).intents).toEqual([move]);
  },
);
test('during-attack direction changes replace held direction and zero intent stops it', () => {
  const core = setup(),
    c = commands(core);
  batch(core, [c.move(), c.attack()]);
  const changed = c.move(0, -1);
  batch(core, [changed]);
  expect(next(core).intents).toEqual([changed]);
  const stopped = c.move(0, 0);
  batch(core, [stopped]);
  expect(next(core).intents).toEqual([stopped]);
});
test.each(['release', 'session-end', 'pause', 'background'] as const)(
  '%s clears held intent and stale-run commands cannot restore it',
  (kind) => {
    const core = setup(),
      c = commands(core);
    batch(core, [c.move(), c.attack()]);
    if (kind === 'release') core.handle({ type: 'InputsReleased', runId: run });
    if (kind === 'session-end')
      core.handle({
        type: 'MovementSessionEnded',
        runId: run,
        sessionId: 'held',
      });
    if (kind === 'pause') {
      core.handle({ type: 'PauseRequested', runId: run, reason: 'settings' });
      core.handle({ type: 'ResumeRequested', runId: run, reason: 'settings' });
    }
    if (kind === 'background') {
      core.handle({ type: 'Backgrounded', runId: run });
      core.handle({ type: 'Foregrounded', runId: run });
      core.handle({
        type: 'ResumeRequested',
        runId: run,
        reason: 'interruption',
      });
    }
    core.handle({ ...c.move(), runId: runId('stale') });
    expect(next(core).intents).toEqual([]);
  },
);
test('opponent defeat clears held direction and cannot retain new movement through encounter lock', () => {
  const core = setup(),
    c = commands(core);
  batch(core, [c.move()]);
  for (let i = 0; i < 5; i++) hitOpponent(core);
  expect(core.read().presentation.kind).toBe('opponent-defeat');
  batch(core, [c.move()]);
  expect(next(core).intents).toEqual([]);
});

test('normal-speed defeat finish transports movement and jump while combat stays gated', () => {
  const core = setup();
  for (let n = 0; n < 5; n++) hitOpponent(core);
  advanceCore(core, 1500);
  const c = commands(core),
    move = c.move(),
    jump = c.jump();
  batch(core, [move, c.attack(), jump]);
  const request = next(core);
  expect(request.snapshot.presentation.kind).toBe('opponent-defeat-finish');
  expect(request.intents).toContainEqual(move);
  expect(request.intents).toContainEqual(jump);
  expect(request.snapshot.actors[0]?.attack).toBeNull();
  expect(request.snapshot.currentOpponentId).toBeNull();
});

function crouchCore(damage = 100) {
  const fixture = fixtureCatalog(damage);
  const core = createCore(
    { runId: run, seed: 42 },
    {
      ...fixture,
      catalog: {
        ...fixture.catalog,
        pose: {
          version: 1,
          bindingSetId: 'crouch-fixture',
          clips: [
            {
              clipId: clipId('CrouchMove'),
              durationMs: durationMs(1000),
              sourceBindingId: 'synthetic:crouch',
            },
          ],
          locomotion: {
            idle: clipId('Idle'),
            walk: clipId('Walk'),
            run: clipId('Run'),
            jump: clipId('Jump'),
            crouch: clipId('CrouchMove'),
          },
        },
      },
      enemyAi: false,
    },
  );
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  core.drain();
  return core;
}
function crouching(core: CorePort) {
  return core.read().actors[0]?.crouching ?? false;
}
function ground(core: CorePort, grounded: boolean) {
  core.present(durationMs(1));
  core.beginStep({ durationMs: durationMs(1) });
  core.completeStep({
    snapshot: {
      runId: run,
      tick: core.read().clocks.tick,
      vehicles: [],
      actors: [
        {
          actorId: requireValue(core.read().actors[0]).actorId,
          position: { x: 0, y: grounded ? 0 : 1, z: 0 },
          facing: { x: 0, y: 0, z: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          grounded,
          locomotion: grounded ? 'idle' : 'jump',
        },
      ],
    },
    candidates: [],
  });
}
test('crouch requires the prepared optional mapping and does not enable generic fixtures', () => {
  const generic = setup(),
    c = commands(generic);
  batch(generic, [c.crouch()]);
  next(generic);
  expect(crouching(generic)).toBe(false);
  const core = crouchCore();
  batch(core, [commands(core).crouch()]);
  expect(next(core).snapshot.actors[0]?.crouching).toBe(true);
});
test('attack beats crouch activation and jump without changing existing attack arbitration', () => {
  const core = crouchCore(),
    c = commands(core);
  batch(core, [c.crouch()]);
  next(core);
  expect(crouching(core)).toBe(true);
  batch(core, [c.crouch(), c.jump(), c.attack()]);
  const request = next(core);
  expect(request.snapshot.actors[0]?.crouching).toBe(false);
  expect(request.snapshot.actors[0]?.attack?.category).toBe('punch');
  expect(request.intents.some((i) => i.type === 'JumpRequested')).toBe(false);
  const activation = core.read().actors[0]?.attack?.activationId;
  batch(core, [c.attack(), c.crouch(false)]);
  expect(next(core).snapshot.actors[0]?.attack?.activationId).toBe(activation);
  expect(crouching(core)).toBe(false);
  for (let n = 0; n < 12; n++) next(core);
  expect(crouching(core)).toBe(false);
  batch(core, [c.crouch()]);
  next(core);
  expect(crouching(core)).toBe(true);
  batch(core, [c.jump(), c.crouch()]);
  expect(next(core).intents.some((i) => i.type === 'JumpRequested')).toBe(true);
  expect(crouching(core)).toBe(false);
});
test('cooling rejected attack permits jump and crouch without inventing a new attack', () => {
  const core = crouchCore(),
    c = commands(core);
  for (let n = 0; n < 7; n++) {
    batch(core, [c.attack()]);
    for (let t = 0; t < 10; t++) next(core);
  }
  expect(core.read().actors[0]?.actions.punch).toMatchObject({
    allowed: false,
    reason: 'cooling-lock',
  });
  batch(core, [c.crouch(), c.attack()]);
  next(core);
  expect(crouching(core)).toBe(true);
  expect(core.read().actors[0]?.attack).toBeNull();
  batch(core, [c.attack(), c.jump(), c.crouch(false)]);
  expect(next(core).intents.some((i) => i.type === 'JumpRequested')).toBe(true);
  expect(crouching(core)).toBe(false);
  expect(core.read().actors[0]?.attack).toBeNull();
});
test('pause background transition death and retry clear crouch ownership', () => {
  for (const kind of [
    'pause',
    'background',
    'release',
    'session-end',
  ] as const) {
    const core = crouchCore(),
      c = commands(core);
    batch(core, [c.crouch()]);
    next(core);
    expect(crouching(core)).toBe(true);
    if (kind === 'pause') {
      core.handle({ type: 'PauseRequested', runId: run, reason: 'manual' });
      core.handle({ type: 'ResumeRequested', runId: run, reason: 'manual' });
    }
    if (kind === 'background') {
      core.handle({ type: 'Backgrounded', runId: run });
      core.handle({ type: 'Foregrounded', runId: run });
      core.handle({
        type: 'ResumeRequested',
        runId: run,
        reason: 'interruption',
      });
    }
    if (kind === 'release') core.handle({ type: 'InputsReleased', runId: run });
    if (kind === 'session-end')
      core.handle({
        type: 'MovementSessionEnded',
        runId: run,
        sessionId: 'held',
      });
    expect(crouching(core)).toBe(false);
    next(core);
    expect(crouching(core)).toBe(false);
  }
  const transition = crouchCore(),
    c = commands(transition);
  batch(transition, [c.crouch()]);
  next(transition);
  expect(crouching(transition)).toBe(true);
  for (let n = 0; n < 5; n++) {
    attack(transition);
    const source = reference(transition);
    step(transition, (at) => [
      {
        ...envelope(at, `transition:${n}`),
        kind: 'body-hit',
        source,
        targetActorId: requireValue(transition.read().currentOpponentId),
      },
    ]);
  }
  expect(crouching(transition)).toBe(false);
  batch(transition, [c.crouch()]);
  next(transition);
  expect(crouching(transition)).toBe(false);
  advanceCore(transition, 1700);
  expect(crouching(transition)).toBe(false);
  const dead = crouchCore(),
    d = commands(dead);
  batch(dead, [d.crouch()]);
  next(dead);
  for (let n = 0; n < 5; n++) {
    attack(dead, 'blue');
    const enemy = reference(dead, 'blue');
    step(dead, (at) => [
      {
        ...envelope(at, `death:${n}`),
        kind: 'body-hit',
        source: enemy,
        targetActorId: requireValue(dead.read().actors[0]).actorId,
      },
    ]);
  }
  expect(dead.read().phase).toBe('terminal');
  expect(crouching(dead)).toBe(false);
});
test('airborne crouch is rejected without a landing reservation and closed sessions cannot replay', () => {
  const core = crouchCore(),
    c = commands(core);
  ground(core, false);
  batch(core, [c.crouch()]);
  ground(core, true);
  expect(crouching(core)).toBe(false);
  next(core);
  expect(crouching(core)).toBe(false);
  batch(core, [c.crouch()]);
  next(core);
  expect(crouching(core)).toBe(true);
  core.handle({ type: 'MovementSessionEnded', runId: run, sessionId: 'held' });
  batch(core, [c.crouch()]);
  next(core);
  expect(crouching(core)).toBe(false);
  batch(core, [c.crouch(true, 'new-session')]);
  next(core);
  expect(crouching(core)).toBe(true);
  batch(core, [c.crouch(false, 'held')]);
  next(core);
  expect(crouching(core)).toBe(true);
});
