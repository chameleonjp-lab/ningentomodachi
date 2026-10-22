import { expect, test } from 'vitest';
import {
  commandId,
  durationMs,
  tick,
  runId,
  type CorePort,
  type GameplayCommand,
} from '../../src/contracts';
import { setup, run, hitOpponent, advanceCore } from './fixtures/scenarios';
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
