import { expect, test } from 'vitest';
import { createGame } from '../../src/app/createGame';
import { createFoundationCore } from '../../src/core/foundation';
import {
  actorId,
  commandId,
  type GameCommand,
  type GameplayInputBatch,
  type HostRequest,
  type HostSnapshot,
  type InputModuleContext,
  type InputPort,
} from '../../src/contracts';
import { createFixturePorts } from '../core/fixtures/ports';

test('persistent shell survives title -> initial load failure -> retry -> ready, cancel and repeated requests', async () => {
  const fixtures = createFixturePorts();
  let request: ((request: HostRequest) => void) | undefined;
  const states: HostSnapshot[] = [];
  let attempts = 0;
  const catalog = fixtures.factories.catalog;
  let disposed = 0;
  const game = createGame(
    {
      ...fixtures.factories,
      host: () => ({
        subscribe: (listener) => {
          request = listener;
          return () => {
            request = undefined;
          };
        },
        render: (state) => states.push(state),
        dispose: () => {
          disposed++;
        },
      }),
      catalog: (context) => ({
        ...catalog(context),
        prepare: async () => {
          if (++attempts === 1) throw new Error('fixture load failed');
        },
      }),
    },
    { sessionId: 'host', seed: 1 },
  );
  expect(
    states.at(-1)?.phase,
    'app-lifetime host must exist before a run',
  ).toBe('title');
  request?.({ type: 'PrepareRequested', requestId: 'prepare' });
  await expect.poll(() => game.hostState().phase).toBe('error');
  expect(request).toBeTypeOf('function');
  request?.({ type: 'RetryRequested', requestId: 'retry' });
  request?.({ type: 'RetryRequested', requestId: 'retry' });
  await expect.poll(() => game.hostState().phase).toBe('ready');
  expect(attempts).toBe(2);
  request?.({ type: 'ReturnToTitleRequested', requestId: 'title' });
  expect(game.hostState().phase).toBe('title');
  request?.({ type: 'PrepareRequested', requestId: 'prepare-again' });
  await expect.poll(() => game.hostState().phase).toBe('ready');
  request?.({ type: 'CancelLoadingRequested', requestId: 'cancel' });
  expect(game.hostState().phase).toBe('title');
  expect(disposed).toBe(0);
  game.dispose();
  expect(disposed).toBe(1);
});

test('A orders gameplay packets at the tick and stale/repeated packets cannot replay', async () => {
  const fixtures = createFixturePorts();
  const handled: string[] = [];
  const game = createGame(
    {
      ...fixtures.factories,
      core: (context) => {
        const core = createFoundationCore(context);
        return {
          ...core,
          handleInputBatch: (batch) => {
            for (const command of batch.commands) handled.push(command.type);
            core.handleInputBatch(batch);
          },
        };
      },
    },
    { sessionId: 'ordered', seed: 1, stepMs: 10 },
  );
  await game.start();
  const run = game.read();
  if (!run) throw new Error('Expected active run');
  game.dispatch({ type: 'StartRequested', runId: run.runId });
  const attack: GameCommand = {
    type: 'AttackRequested',
    runId: run.runId,
    actorId: actorId('white'),
    category: 'punch',
    input: { commandId: commandId('request-1'), sequence: 1 },
  };
  const jump: GameCommand = {
    type: 'JumpRequested',
    runId: run.runId,
    actorId: actorId('white'),
    input: { commandId: commandId('request-2'), sequence: 2 },
  };
  game.dispatch(jump);
  game.dispatch(attack);
  expect(
    handled,
    'D/browser event callback must not choose battle priority',
  ).toEqual([]);
  game.advance(10);
  expect(handled).toEqual(['AttackRequested', 'JumpRequested']);
  game.dispatch(attack);
  game.dispatch(jump);
  game.advance(10);
  expect(handled).toHaveLength(2);
  game.dispose();
});

test('held movement captures C basis at gesture start, release before tick clears it, and pause cancels sessions', async () => {
  const fixtures = createFixturePorts();
  let inputContext: InputModuleContext | undefined;
  let camera = 1;
  const acquired: number[] = [];
  const ended: string[] = [];
  const spatial = fixtures.factories.spatial;
  const input = fixtures.factories.input;
  const gate: boolean[] = [];
  const game = createGame(
    {
      ...fixtures.factories,
      spatial: (context) => ({
        ...spatial(context),
        beginMovementSession: (sessionId) => {
          acquired.push(camera);
          return Object.freeze({
            runId: context.runId,
            sessionId,
            revision: camera,
            right: { x: camera, y: 0, z: 0 },
            depth: { x: 0, y: 0, z: 1 },
          });
        },
        endMovementSession: (sessionId) => {
          ended.push(sessionId);
        },
      }),
      input: (context) => {
        inputContext = context;
        const port: InputPort = input(context);
        return { ...port, setGate: (state) => gate.push(state.enabled) };
      },
    },
    { sessionId: 'basis', seed: 1 },
  );
  await game.start();
  const run = game.read();
  if (!run) throw new Error('Expected active run');
  game.dispatch({ type: 'StartRequested', runId: run.runId });
  expect(
    inputContext?.movement,
    'D needs a public gesture-start acquisition port',
  ).toBeDefined();
  const basis = inputContext?.movement.begin('pointer-one');
  camera = 2;
  expect(basis?.revision).toBe(1);
  inputContext?.movement.end('pointer-one', 'released');
  expect(() => inputContext?.movement.begin('pointer-one')).toThrow();
  inputContext?.movement.begin('pointer-two');
  game.dispatch({
    type: 'PauseRequested',
    runId: run.runId,
    reason: 'settings',
  });
  expect(ended).toEqual(['pointer-one', 'pointer-two']);
  expect(acquired).toEqual([1, 2]);
  expect(gate.at(-1)).toBe(false);
  game.dispose();
});

test('run UI routes lifecycle requests but a disposed UI cannot control its successor', async () => {
  const fixtures = createFixturePorts();
  const requests: ((message: HostRequest) => void)[] = [];
  const ui = fixtures.factories.ui;
  const game = createGame(
    {
      ...fixtures.factories,
      ui: (context) => {
        requests.push(context.request);
        return ui(context);
      },
    },
    { sessionId: 'ui-lifetime', seed: 1 },
  );
  await game.start();
  const first = requests[0];
  if (!first) throw new Error('Missing UI request path');
  first({ type: 'StartRequested', requestId: 'start' });
  game.advance(3000); // Explicit UI start finishes its host countdown before gameplay.
  expect(game.read()?.phase).toBe('running');
  first({ type: 'ReturnToTitleRequested', requestId: 'title' });
  expect(game.hostState().phase).toBe('title');
  await game.start();
  first({ type: 'ReturnToTitleRequested', requestId: 'stale-title' });
  expect(game.read()?.phase).toBe('ready');
  game.dispose();
});

test('input arbitration may pause before simulation without starting a forbidden fixed step', async () => {
  const fixtures = createFixturePorts();
  const game = createGame(
    {
      ...fixtures.factories,
      core: (context) => {
        const core = createFoundationCore(context);
        return {
          ...core,
          handleInputBatch: (batch) => {
            core.handleInputBatch(batch);
            core.handle({
              type: 'PauseRequested',
              runId: context.runId,
              reason: 'manual',
            });
          },
        };
      },
    },
    { sessionId: 'core-arbitration', seed: 1, stepMs: 10 },
  );
  await game.start();
  const run = game.read();
  if (!run) throw new Error('Missing run');
  game.request({ type: 'StartRequested', requestId: 'start' });
  game.advance(3000); // Explicit UI start finishes its host countdown before gameplay.
  game.dispatch({
    type: 'JumpRequested',
    runId: run.runId,
    actorId: actorId('white'),
    input: { commandId: commandId('jump'), sequence: 1 },
  });
  expect(() => game.advance(10)).not.toThrow();
  expect(game.read()?.phase).toBe('paused');
  expect(game.read()?.clocks.tick).toBe(0);
  game.dispose();
});

test('one tick preserves competing actions while release/pause/stale packets cannot leak across cutoffs or runs', async () => {
  const fixtures = createFixturePorts();
  let context: InputModuleContext | undefined;
  const batches: GameplayInputBatch[] = [];
  const input = fixtures.factories.input;
  const game = createGame(
    {
      ...fixtures.factories,
      input: (value) => {
        context = value;
        return input(value);
      },
      core: (run) => {
        const base = createFoundationCore(run);
        return {
          ...base,
          handleInputBatch: (batch) => {
            batches.push(batch);
            base.handleInputBatch(batch);
          },
        };
      },
    },
    { sessionId: 'batches', seed: 1, stepMs: 10 },
  );
  await game.start();
  const run = game.read();
  if (!run || !context) throw new Error('Missing run');
  game.request({ type: 'StartRequested', requestId: 'start' });
  game.advance(3000); // Explicit UI start finishes its host countdown before gameplay.
  const basis = context.movement.begin('held');
  const attack: GameCommand = {
    type: 'AttackRequested',
    runId: run.runId,
    actorId: actorId('white'),
    category: 'punch',
    input: { commandId: commandId('a'), sequence: 1 },
  };
  const jump: GameCommand = {
    type: 'JumpRequested',
    runId: run.runId,
    actorId: actorId('white'),
    input: { commandId: commandId('j'), sequence: 2 },
  };
  const move: GameCommand = {
    type: 'MoveRequested',
    runId: run.runId,
    actorId: actorId('white'),
    movementSessionId: basis.sessionId,
    basisRevision: basis.revision,
    x: 0.5,
    z: 0.5,
    input: { commandId: commandId('m'), sequence: 3 },
  };
  game.dispatch(move);
  game.dispatch(jump);
  game.dispatch(attack);
  game.advance(5);
  expect(batches).toHaveLength(0);
  game.advance(5);
  expect(batches[0]?.commands.map((command) => command.type)).toEqual([
    'AttackRequested',
    'JumpRequested',
    'MoveRequested',
  ]);
  expect(batches[0]?.tick).toBe(1);
  for (const command of [attack, jump, move]) game.dispatch(command);
  const released = context.movement.begin('release-before-tick');
  game.dispatch({
    ...move,
    movementSessionId: released.sessionId,
    basisRevision: released.revision,
    input: { commandId: commandId('released'), sequence: 4 },
  });
  context.movement.end(released.sessionId, 'released');
  game.dispatch({
    ...jump,
    input: { commandId: commandId('cancelled'), sequence: 5 },
  });
  game.dispatch({
    type: 'PauseRequested',
    runId: run.runId,
    reason: 'settings',
  });
  game.advance(100);
  game.dispatch({
    type: 'ResumeRequested',
    runId: run.runId,
    reason: 'settings',
  });
  game.advance(10);
  expect(batches).toHaveLength(1);
  game.dispatch({
    ...jump,
    input: { commandId: commandId('late-cancelled'), sequence: 5 },
  });
  game.advance(10);
  expect(batches).toHaveLength(1);
  game.dispatch({
    ...move,
    movementSessionId: released.sessionId,
    input: { commandId: commandId('stale-session'), sequence: 6 },
  });
  game.advance(10);
  expect(batches).toHaveLength(1);
  const old = context;
  await game.restart();
  game.dispatch({
    ...attack,
    input: { commandId: commandId('stale-run'), sequence: 7 },
  });
  expect(() => old.movement.begin('after-restart')).toThrow();
  expect(old.readSnapshot()).toBeNull();
  game.request({ type: 'StartRequested', requestId: 'restart-start' });
  game.advance(3000); // Explicit UI start finishes its host countdown before gameplay.
  game.advance(10);
  expect(batches).toHaveLength(1);
  game.dispose();
});

test('host loading cancel aborts the old run, ignores late completion and retains a fresh prepare path', async () => {
  const fixtures = createFixturePorts();
  const catalog = fixtures.factories.catalog;
  let finish: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  let attempts = 0;
  const game = createGame(
    {
      ...fixtures.factories,
      catalog: (context) => ({
        ...catalog(context),
        prepare: (value) => {
          if (++attempts > 1) return Promise.resolve();
          signal = value;
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      }),
    },
    { sessionId: 'host-cancel', seed: 1 },
  );
  game.request({ type: 'PrepareRequested', requestId: 'prepare' });
  const pending = game.start();
  const oldRun = game.read()?.runId;
  expect(game.hostState().phase).toBe('loading');
  game.request({ type: 'CancelLoadingRequested', requestId: 'cancel-loading' });
  expect(signal?.aborted).toBe(true);
  expect(game.hostState().phase).toBe('title');
  finish?.();
  await pending;
  expect(game.read()).toBeNull();
  game.request({ type: 'PrepareRequested', requestId: 'prepare-fresh' });
  await expect.poll(() => game.hostState().phase).toBe('ready');
  expect(game.read()?.runId).not.toBe(oldRun);
  expect(fixtures.listeners.size).toBe(1);
  game.dispose();
});
