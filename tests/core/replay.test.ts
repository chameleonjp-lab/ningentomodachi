import { requireValue } from '../../src/core/invariant';
import { expect, test } from 'vitest';
import { durationMs, commandId } from '../../src/contracts';
import {
  recordCore,
  replayCore,
  recordIntentProvider,
  replayIntentProvider,
} from '../../src/core/replay';
import { createCore } from '../../src/core/createCore';
import {
  attack,
  envelope,
  fixtureCatalog,
  reference,
  run,
  step,
} from './fixtures/scenarios';
test('immutable public commands and candidate tape reproduce authoritative states/events exactly', () => {
  const factory = () =>
    createCore(
      { runId: run, seed: 123 },
      { ...fixtureCatalog(), enemyAi: false },
    );
  const recorder = recordCore(factory());
  const core = recorder.core;
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  core.drain();
  core.present(durationMs(10));
  attack(core);
  const source = reference(core),
    targetActorId = requireValue(core.read().currentOpponentId);
  step(core, (at) => [
    { ...envelope(at), kind: 'body-hit', source, targetActorId },
    { ...envelope(at, 'duplicate'), kind: 'body-hit', source, targetActorId },
  ]);
  core.handle({ type: 'PauseRequested', runId: run, reason: 'settings' });
  core.present(durationMs(500));
  core.handle({ type: 'ResumeRequested', runId: run, reason: 'settings' });
  core.present(durationMs(200));
  core.drain();
  const tape = recorder.read();
  expect(Object.isFrozen(tape)).toBe(true);
  expect(Object.isFrozen(tape[0])).toBe(true);
  const replay = replayCore(factory(), tape);
  expect(replay.snapshot).toEqual(core.read());
  expect(replay.outputs).toEqual(recorder.outputs());
  expect(requireValue(core.read().actors[1]).hp).toBe(400);
});

test('AI public intents are recorded rather than reacquiring a different live camera/session basis', () => {
  const provider = recordIntentProvider((snapshot) => [
    {
      type: 'AttackRequested',
      runId: run,
      actorId: requireValue(snapshot.currentOpponentId),
      category: 'kick',
      input: { commandId: commandId('recorded-ai'), sequence: 1 },
    },
  ]);
  const factory = (
    enemyAi: Exclude<Parameters<typeof createCore>[1]['enemyAi'], undefined>,
  ) => createCore({ runId: run, seed: 123 }, { ...fixtureCatalog(), enemyAi });
  const recording = recordCore(factory(provider.decide));
  recording.core.handle({ type: 'AssetsReady', runId: run });
  recording.core.handle({ type: 'StartRequested', runId: run });
  recording.core.present(durationMs(10));
  step(recording.core);
  expect(provider.read()).toHaveLength(1);
  const replay = replayCore(
    factory(replayIntentProvider(provider.read())),
    recording.read(),
  );
  expect(replay.snapshot).toEqual(recording.core.read());
  expect(replay.outputs).toEqual(recording.outputs());
  expect(requireValue(recording.core.read().actors[1]).heat.amount).toBe(1);
});
