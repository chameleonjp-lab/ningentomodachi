import { expect, test } from 'vitest';
import { durationMs, tick } from '../../src/contracts';
import { requireValue } from '../../src/core/invariant';
import { advanceCore, hitOpponent, run, setup } from './fixtures/scenarios';

function fallen() {
  const core = setup();
  for (let n = 0; n < 5; n++) hitOpponent(core);
  return core;
}

test('only white and current opponent reside while the entire logical roster survives', () => {
  const core = setup();
  const initial = core.read();
  expect(initial.residentActorIds).toEqual(
    initial.actors.slice(0, 2).map((a) => a.actorId),
  );
  advanceCore(core, 10000);
  expect(core.read().actors.slice(2)).toEqual(initial.actors.slice(2));
  expect(core.read().actors).toHaveLength(5);
});

test('ordinary enemy finishes the complete death clip before atomic retirement and next combat', () => {
  const core = fallen();
  const death = core.read();
  const victim = requireValue(death.actors[1]);
  expect(death.residentActorIds).toEqual([
    requireValue(death.actors[0]).actorId,
    victim.actorId,
  ]);
  expect(death.currentOpponentId).toBeNull();
  advanceCore(core, 1500);
  const finish = core.read();
  expect(finish.presentation).toMatchObject({
    kind: 'opponent-defeat-finish',
    actorId: victim.actorId,
    startedAt: victim.defeatPresentation?.startedAt,
    endsAt: Number(victim.defeatPresentation?.startedAt) + 1625,
  });
  expect(finish.currentOpponentId).toBeNull();
  expect(finish.residentActorIds).toEqual(death.residentActorIds);
  expect(requireValue(finish.actors[0]).actions.move.allowed).toBe(true);
  expect(requireValue(finish.actors[0]).actions.jump.allowed).toBe(true);
  expect(requireValue(finish.actors[0]).actions.punch.allowed).toBe(false);
  advanceCore(core, 124);
  expect(core.read().currentOpponentId).toBeNull();
  advanceCore(core, 1);
  const next = core.read();
  expect(next.presentation.kind).toBe('none');
  expect(next.currentOpponentId).toBe(requireValue(next.actors[2]).actorId);
  expect(next.residentActorIds).toEqual([
    requireValue(next.actors[0]).actorId,
    requireValue(next.actors[2]).actorId,
  ]);
  expect(requireValue(next.actors[1]).defeatPresentation).toEqual(
    victim.defeatPresentation,
  );
  expect(requireValue(next.actors[2]).heat.amount).toBe(0);
  expect(next.actors).toHaveLength(5);
});

test('pause during the normal-speed tail preserves residency and both transition clocks', () => {
  const core = fallen();
  advanceCore(core, 1500);
  core.handle({ type: 'PauseRequested', runId: run, reason: 'settings' });
  const paused = core.read();
  expect(paused.presentation.kind).toBe('opponent-defeat-finish');
  core.present(durationMs(10000));
  expect(core.read()).toEqual(paused);
  core.handle({ type: 'ResumeRequested', runId: run, reason: 'settings' });
  advanceCore(core, 125);
  expect(core.read().currentOpponentId).toBe(
    requireValue(core.read().actors[2]).actorId,
  );
});

test('accepted presentation cannot retire the victim or unlock movement ahead of processed backlog', () => {
  const core = fallen();
  const residents = core.read().residentActorIds;
  core.present(durationMs(1625));
  expect(core.read().presentation.kind).toBe('opponent-defeat-finish');
  expect(core.read().residentActorIds).toEqual(residents);
  expect(core.read().currentOpponentId).toBeNull();
  expect(core.read().actors[0]?.actions.move.allowed).toBe(false);
  advanceCore(core, 0);
  expect(core.read().currentOpponentId).toBe(
    requireValue(core.read().actors[2])?.actorId,
  );
});

test('disposed Core retains its stopped logical snapshot without accepting stale transport after caches clear', () => {
  const core = setup();
  core.dispose();
  const stopped = core.read();
  core.handleInputBatch({
    runId: run,
    tick: tick(stopped.clocks.tick + 1),
    commands: [],
  });
  expect(core.read()).toEqual(stopped);
  expect(core.read().phase).toBe('stopped');
});
