import { expect, test } from 'vitest';
import { createGame } from '../../src/app/createGame';
import { createCore } from '../../src/core/createCore';
import {
  createPointerInput,
  type PointerInput,
} from '../../src/input/PointerInput';
import { requireValue } from '../../src/core/invariant';
import {
  clipId,
  commandId,
  durationMs,
  MOTION_SPACE,
  type CommittedFrame,
  type GameCommand,
  type InputModuleContext,
  type MotionCatalogPort,
  type PoseCatalogBindings,
  type PoseRunPolicy,
} from '../../src/contracts';
import { createSpatialEngine } from '../../src/world/spatial-engine';
import { createParisBattleLayout } from '../../src/world/street-layout';
import { createFixturePorts } from '../core/fixtures/ports';
import { fixtureCatalog } from '../core/fixtures/scenarios';

async function harness(strikeHeight?: number) {
  const fixture = createFixturePorts(),
    prepared = fixtureCatalog();
  const pose: PoseCatalogBindings = {
    version: 1,
    bindingSetId: 'synthetic:crouch-controls',
    clips: [
      ...prepared.catalog.list().map((m) => ({
        clipId: m.clipId,
        durationMs: m.durationMs,
        sourceBindingId: `synthetic:${m.clipId}`,
      })),
      ...['idle', 'walk', 'run', 'jump', 'crouch'].map((id) => ({
        clipId: clipId(id),
        durationMs: durationMs(1000),
        sourceBindingId: `synthetic:${id}`,
      })),
    ],
    locomotion: {
      idle: clipId('idle'),
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
      crouch: clipId('crouch'),
    },
  };
  const catalog: MotionCatalogPort = {
    ...prepared.catalog,
    pose,
    prepare: async () => {},
    sampleMotion: (id, fromMs, toMs) =>
      strikeHeight === undefined
        ? undefined
        : {
            clipId: id,
            fromMs,
            toMs,
            space: MOTION_SPACE,
            rootSegments: [],
            hitVolumeSegments: [
              {
                impactIndex: 0,
                shapeId: 'synthetic-strike',
                fromMs,
                toMs,
                activeWindow: { startMs: durationMs(0), endMs: durationMs(10) },
                from: {
                  kind: 'sphere',
                  center: { x: 0, y: strikeHeight, z: 0 },
                  radiusM: 0.1,
                },
                to: {
                  kind: 'sphere',
                  center: { x: 0, y: strikeHeight, z: 3 },
                  radiusM: 0.1,
                },
              },
            ],
          },
    dispose: () => {},
  };
  const policy: PoseRunPolicy = { version: 1, mode: 'deterministic-pose-v1' };
  let input!: InputModuleContext;
  let pointer!: PointerInput;
  const inputCommands: GameCommand[] = [];
  let rendered!: CommittedFrame;
  let engine!: ReturnType<typeof createSpatialEngine>;
  const game = createGame(
    {
      ...fixture.factories,
      core: (context) =>
        createCore(context, { catalog, moves: prepared.moves, enemyAi: false }),
      catalog: () => catalog,
      animation: (context) => ({
        ...fixture.factories.animation(context),
        poseProtocol: { version: 1, protocol: 'deterministic-pose-v1' },
        render: (frame) => {
          rendered = frame;
        },
      }),
      spatial: (context) => {
        const original = fixture.factories.spatial(context);
        engine = createSpatialEngine(
          context.runId,
          createParisBattleLayout(),
          policy,
        );
        return {
          ...original,
          poseProtocol: requireValue(engine.poseProtocol),
          step: engine.step,
          commit: engine.commit,
          beginMovementSession: (session) =>
            engine.begin(session, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
          endMovementSession: (session) => engine.end(session),
          dispose: () => {
            engine.dispose();
            original.dispose();
          },
        };
      },
      input: (context) => {
        input = context;
        pointer = createPointerInput(context);
        pointer.subscribe((command) => inputCommands.push(command));
        return pointer;
      },
    },
    { sessionId: 'crouch-controls', seed: 42, posePolicy: policy, stepMs: 10 },
  );
  const snapshot = () => requireValue(game.read());
  await game.start();
  game.dispatch({ type: 'StartRequested', runId: snapshot().runId });
  let sequence = 0;
  function crouch(
    active = true,
    session = 'pointer:1:1',
    basisRevision = 0,
  ): Extract<GameCommand, { type: 'CrouchRequested' }> {
    return {
      type: 'CrouchRequested',
      active,
      movementSessionId: session,
      basisRevision,
      runId: snapshot().runId,
      actorId: requireValue(snapshot().actors[0]).actorId,
      input: { commandId: commandId(`crouch:${++sequence}`), sequence },
    };
  }
  function action(
    type: 'AttackRequested' | 'JumpRequested',
    color: 'white' | 'blue' = 'white',
  ): GameCommand {
    return {
      ...(type === 'AttackRequested'
        ? { type, category: 'punch' as const }
        : { type }),
      runId: snapshot().runId,
      actorId: requireValue(snapshot().actors.find((a) => a.color === color))
        .actorId,
      input: { commandId: commandId(`action:${++sequence}`), sequence },
    };
  }
  const player = () => requireValue(snapshot().actors[0]);
  const spatial = (color: 'white' | 'blue' = 'white') =>
    requireValue(
      rendered.spatial.actors.find(
        (a) =>
          a.actorId ===
          requireValue(snapshot().actors.find((a) => a.color === color))
            .actorId,
      ),
    );
  function move(session: string, revision: number): GameCommand {
    return {
      type: 'MoveRequested',
      runId: snapshot().runId,
      actorId: player().actorId,
      x: 1,
      z: 0,
      movementSessionId: session,
      basisRevision: revision,
      input: { commandId: commandId(`move:${++sequence}`), sequence },
    };
  }
  return {
    game,
    input,
    pointer,
    inputCommands,
    crouch,
    action,
    move,
    player,
    spatial,
  };
}

test('up swipe jumps once even after landing and never travels in depth', async () => {
  const h = await harness();
  const start = h.spatial().position;
  h.pointer.pointerDown(1, 'move', 100, 100);
  h.pointer.pointerMove(1, 100, 69);
  h.game.advance(10);
  expect(h.spatial().grounded).toBe(true);
  h.pointer.pointerMove(1, 100, 68);
  h.game.advance(10);
  expect(h.spatial().grounded).toBe(false);
  h.game.advance(1200);
  expect(h.spatial().grounded).toBe(true);
  h.pointer.pointerMove(1, 100, 100);
  h.pointer.pointerMove(1, 100, 0);
  h.game.advance(10);
  expect(h.spatial().grounded).toBe(true);
  expect(h.spatial().position).toEqual(start);
  expect(
    h.inputCommands.filter((c) => c.type === 'JumpRequested'),
  ).toHaveLength(1);
  expect(
    h.inputCommands
      .filter((c) => c.type === 'MoveRequested')
      .every((c) => c.x === 0 && c.z === 0),
  ).toBe(true);
  h.game.dispose();
});

test('down swipe is held until deadzone return and accepted attack needs a new down threshold crossing', async () => {
  const h = await harness();
  h.pointer.pointerDown(1, 'move', 0, 0);
  h.pointer.pointerMove(1, 0, 32);
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  h.pointer.pointerDown(2, 'punch', 0, 0);
  h.game.advance(10);
  expect(h.player().crouching).toBe(false);
  h.pointer.pointerUp(2);
  for (const y of [40, 50, 32]) {
    h.pointer.pointerMove(1, 0, y);
    h.game.advance(10);
    expect(h.player().crouching).toBe(false);
  }
  expect(
    h.inputCommands.filter((c) => c.type === 'CrouchRequested' && c.active),
  ).toHaveLength(1);
  h.pointer.pointerMove(1, 0, 31);
  h.pointer.pointerMove(1, 0, 32);
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  h.pointer.pointerMove(1, 0, 13);
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  h.pointer.pointerMove(1, 0, 12);
  h.game.advance(10);
  expect(h.player().crouching).toBe(false);
  h.game.dispose();
});

test('reentrant down return stays standing after the fixed tick and can crouch on a fresh crossing', async () => {
  const h = await harness();
  h.pointer.pointerDown(1, 'move', 0, 0);
  let returned = false;
  h.pointer.subscribe((command) => {
    if (command.type === 'MoveRequested' && !returned) {
      returned = true;
      h.pointer.pointerMove(1, 0, 0);
    }
  });
  h.pointer.pointerMove(1, 0, 32);
  h.pointer.pointerMove(1, 0, 0);
  h.game.advance(10);
  expect(h.player().crouching).toBe(false);
  expect(h.spatial().locomotion).toBe('idle');
  expect(
    h.inputCommands
      .filter((c) => c.type === 'CrouchRequested')
      .map((c) => c.active),
  ).toEqual([false]);
  h.pointer.pointerMove(1, 0, 32);
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  h.game.dispose();
});

test('reentrant deadzone then down keeps the newer crouch through the fixed tick', async () => {
  const h = await harness();
  h.pointer.pointerDown(1, 'move', 0, 0);
  h.pointer.pointerMove(1, 0, 32);
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  let recrossed = false;
  h.pointer.subscribe((command) => {
    if (command.type === 'MoveRequested' && !recrossed) {
      recrossed = true;
      h.pointer.pointerMove(1, 0, 32);
    }
  });
  h.pointer.pointerMove(1, 0, 0);
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  expect(h.spatial().locomotion).toBe('crouch');
  expect(
    h.inputCommands
      .filter((c) => c.type === 'CrouchRequested')
      .map((c) => c.active),
  ).toEqual([true, true]);
  h.pointer.pointerMove(1, 0, 12);
  h.game.advance(10);
  expect(h.player().crouching).toBe(false);
  h.game.dispose();
});

test('stationary movement finger resumes lateral travel after accepted attack has already completed', async () => {
  const h = await harness();
  h.pointer.pointerDown(1, 'move', 0, 0);
  h.pointer.pointerMove(1, 0, 32);
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  h.pointer.pointerDown(2, 'punch', 0, 0);
  h.game.advance(30);
  expect(h.player()).toMatchObject({ crouching: false, attack: null });
  const before = h.spatial().position.x;
  h.pointer.pointerMove(1, 64, 20);
  expect(h.inputCommands.at(-1)).toMatchObject({
    type: 'MoveRequested',
    x: 1,
    z: 0,
  });
  h.game.advance(10);
  expect(h.spatial().position.x).toBeGreaterThan(before);
  expect(h.player().crouching).toBe(false);
  expect(
    h.inputCommands.filter((c) => c.type === 'CrouchRequested' && c.active),
  ).toHaveLength(1);
  h.game.dispose();
});

test('non-tick quality publication preserves queued crouch until Core accepts it', async () => {
  const h = await harness();
  h.pointer.pointerDown(1, 'move', 0, 0);
  h.pointer.pointerMove(1, 0, 32);
  h.game.dispatch({
    type: 'QualityChanged',
    runId: requireValue(h.game.read()).runId,
    quality: 'low',
  });
  h.pointer.pointerMove(1, 64, 20);
  expect(h.inputCommands.at(-1)).toMatchObject({
    type: 'MoveRequested',
    x: 0,
    z: 0,
  });
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  h.pointer.pointerMove(1, 0, 12);
  h.game.advance(10);
  expect(h.player().crouching).toBe(false);
  h.game.dispose();
});

test('airborne rejected down swipe is not reserved or resent on landing', async () => {
  const h = await harness();
  h.pointer.pointerDown(2, 'jump', 0, 0);
  h.game.advance(10);
  h.pointer.pointerDown(1, 'move', 0, 0);
  h.pointer.pointerMove(1, 0, 32);
  h.game.advance(10);
  expect(h.player().crouching).toBe(false);
  h.game.advance(1200);
  expect(h.spatial().grounded).toBe(true);
  h.pointer.pointerMove(1, 0, 40);
  h.game.advance(10);
  expect(h.player().crouching).toBe(false);
  expect(
    h.inputCommands.filter((c) => c.type === 'CrouchRequested' && c.active),
  ).toHaveLength(1);
  h.pointer.pointerMove(1, 0, 0);
  h.pointer.pointerMove(1, 0, 32);
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  h.game.dispose();
});

test('Core rejection of an airborne down swipe restores lateral input after its admission tick', async () => {
  const h = await harness();
  h.pointer.pointerDown(2, 'jump', 0, 0);
  h.game.advance(10);
  h.pointer.pointerDown(1, 'move', 0, 0);
  h.pointer.pointerMove(1, 0, 32);
  h.game.advance(10);
  expect(h.spatial().grounded).toBe(false);
  expect(h.player().crouching).toBe(false);
  h.pointer.pointerMove(1, 64, 20);
  expect(h.inputCommands.at(-1)).toMatchObject({
    type: 'MoveRequested',
    x: 1,
    z: 0,
  });
  expect(
    h.inputCommands.filter((c) => c.type === 'CrouchRequested' && c.active),
  ).toHaveLength(1);
  h.game.dispose();
});

test.each(['release', 'lost-capture', 'all-cancel'] as const)(
  '%s purges a queued crouch before the next tick and a reused pointer gets fresh flags',
  async (ending) => {
    const h = await harness();
    h.pointer.pointerDown(1, 'move', 0, 0);
    h.pointer.pointerMove(1, 0, 32);
    expect(h.inputCommands.at(-1)).toMatchObject({
      type: 'CrouchRequested',
      active: true,
    });
    if (ending === 'all-cancel') h.pointer.cancel('pointer-cancel');
    else h.pointer.pointerUp(1, ending === 'lost-capture');
    h.game.advance(10);
    expect(h.player().crouching).toBe(false);
    h.pointer.pointerMove(1, 0, 64);
    h.pointer.pointerDown(1, 'move', 0, 0);
    h.pointer.pointerMove(1, 0, 32);
    h.game.advance(10);
    expect(h.player().crouching).toBe(true);
    h.pointer.pointerUp(1);
    expect(h.player().crouching).toBe(false);
    h.game.dispose();
  },
);

test.each(['pause', 'background'] as const)(
  '%s clears actual swipe flags and requires fresh movement after resume',
  async (kind) => {
    const h = await harness();
    h.pointer.pointerDown(1, 'move', 0, 0);
    h.pointer.pointerMove(1, 0, 32);
    h.game.advance(10);
    expect(h.player().crouching).toBe(true);
    const runId = requireValue(h.game.read()).runId;
    h.game.dispatch(
      kind === 'pause'
        ? { type: 'PauseRequested', runId, reason: 'manual' }
        : { type: 'Backgrounded', runId },
    );
    expect(h.player().crouching).toBe(false);
    if (kind === 'background') h.game.dispatch({ type: 'Foregrounded', runId });
    h.game.dispatch({
      type: 'ResumeRequested',
      runId,
      reason: kind === 'pause' ? 'manual' : 'interruption',
    });
    h.pointer.pointerMove(1, 0, 64);
    h.game.advance(10);
    expect(h.player().crouching).toBe(false);
    h.pointer.pointerDown(1, 'move', 0, 0);
    h.pointer.pointerMove(1, 0, 32);
    h.game.advance(10);
    expect(h.player().crouching).toBe(true);
    h.game.dispose();
  },
);

test('crouch session release purges queued activation before next tick', async () => {
  const h = await harness();
  const first = h.input.movement.begin('pointer:1:1');
  h.game.dispatch(h.crouch(true, first.sessionId, first.revision));
  h.input.movement.end(first.sessionId, 'released');
  h.game.advance(10);
  expect(h.player().crouching ?? false).toBe(false);
  // Reusing the physical pointer with a new session remains valid.
  const next = h.input.movement.begin('pointer:1:2');
  h.game.dispatch(h.crouch(true, next.sessionId, next.revision));
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  h.input.movement.end(next.sessionId, 'released');
  expect(h.player().crouching).toBe(false);
  h.game.dispatch(h.crouch(true, first.sessionId, first.revision));
  h.game.advance(10);
  expect(h.player().crouching).toBe(false);
  expect(() => h.input.movement.begin(first.sessionId)).toThrow(/reused/i);
  h.game.dispose();
});

test('crouch uses the same fixed clock for stationary motor, pose hold and release', async () => {
  const h = await harness(),
    basis = h.input.movement.begin('pointer:1:1');
  const before = h.spatial().position;
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  expect(h.spatial()).toMatchObject({
    grounded: true,
    locomotion: 'crouch',
    position: before,
    pose: {
      kind: 'living',
      living: { mode: 'crouch', playback: 'hold', startedAt: 0 },
    },
  });
  const stamp = h.spatial().pose;
  h.game.advance(100);
  expect(h.spatial().position).toEqual(before);
  expect(h.spatial().pose).toEqual(stamp);
  h.game.dispatch(h.crouch(false, basis.sessionId, basis.revision));
  h.game.advance(10);
  expect(h.spatial()).toMatchObject({
    locomotion: 'idle',
    pose: { kind: 'living', living: { mode: 'idle', startedAt: 110 } },
  });
  h.game.dispose();
});

test('crouch release before tick and all release cannot resurrect buffered activation', async () => {
  const h = await harness(),
    basis = h.input.movement.begin('pointer:1:1');
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
  h.game.dispatch(h.crouch(false, basis.sessionId, basis.revision));
  h.game.advance(10);
  expect(h.player().crouching ?? false).toBe(false);
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
  h.game.dispatch({
    type: 'InputsReleased',
    runId: requireValue(h.game.read()).runId,
  });
  h.game.advance(10);
  expect(h.player().crouching ?? false).toBe(false);
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
  h.game.advance(10);
  expect(h.player().crouching ?? false).toBe(false);
  h.game.dispose();
});

test('crouch activation requires a current session and exact basis revision', async () => {
  const h = await harness(),
    basis = h.input.movement.begin('pointer:1:1');
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision + 1));
  h.game.advance(10);
  expect(h.player().crouching ?? false).toBe(false);
  h.game.dispatch(h.crouch(true, 'unknown', basis.revision));
  h.game.advance(10);
  expect(h.player().crouching ?? false).toBe(false);
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
  h.game.advance(10);
  expect(h.player().crouching).toBe(true);
  h.game.dispose();
});

test('crouch is cancelled by accepted attack and jump with no post-action reservation', async () => {
  const h = await harness(),
    basis = h.input.movement.begin('pointer:1:1');
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
  h.game.advance(10);
  h.game.dispatch(h.action('AttackRequested'));
  h.game.advance(10);
  expect(h.player().crouching).toBe(false);
  expect(h.spatial().pose).toMatchObject({
    kind: 'living',
    living: { mode: 'idle' },
  });
  h.game.advance(20);
  expect(h.spatial().locomotion).toBe('idle');
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
  h.game.advance(10);
  h.game.dispatch(h.action('JumpRequested'));
  h.game.advance(10);
  expect(h.player().crouching).toBe(false);
  expect(h.spatial().grounded).toBe(false);
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
  h.game.advance(10);
  expect(h.player().crouching).toBe(false);
  h.game.advance(1200);
  expect(h.spatial().grounded).toBe(true);
  expect(h.player().crouching).toBe(false);
  h.game.dispose();
});

test('pause background and retry clear crouch and its pose without waiting for another fixed tick', async () => {
  const h = await harness();
  for (const kind of ['pause', 'background'] as const) {
    const basis = h.input.movement.begin(`pointer:${kind}`);
    h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
    h.game.advance(10);
    expect(h.player().crouching).toBe(true);
    h.game.dispatch(
      kind === 'pause'
        ? {
            type: 'PauseRequested',
            runId: requireValue(h.game.read()).runId,
            reason: 'manual',
          }
        : { type: 'Backgrounded', runId: requireValue(h.game.read()).runId },
    );
    expect(h.player().crouching).toBe(false);
    expect(h.spatial().locomotion).toBe('idle');
    expect(h.spatial().pose).toMatchObject({
      kind: 'living',
      living: { mode: 'idle' },
    });
    if (kind === 'pause')
      h.game.dispatch({
        type: 'ResumeRequested',
        runId: requireValue(h.game.read()).runId,
        reason: 'manual',
      });
    else {
      h.game.dispatch({
        type: 'Foregrounded',
        runId: requireValue(h.game.read()).runId,
      });
      h.game.dispatch({
        type: 'ResumeRequested',
        runId: requireValue(h.game.read()).runId,
        reason: 'interruption',
      });
    }
  }
  const basis = h.input.movement.begin('retry-session');
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
  h.game.advance(10);
  const old = requireValue(h.game.read()).runId;
  await h.game.restart();
  expect(requireValue(h.game.read()).runId).not.toBe(old);
  expect(h.player().crouching ?? false).toBe(false);
  h.game.dispose();
});

test('crouch suppresses an existing held horizontal direction without changing the navigation body', async () => {
  const h = await harness(),
    basis = h.input.movement.begin('held-travel');
  h.game.dispatch(h.move(basis.sessionId, basis.revision));
  h.game.advance(10);
  const start = h.spatial().position;
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
  h.game.advance(100);
  expect(h.spatial().position).toEqual(start);
  expect(h.spatial().velocity).toEqual({ x: 0, y: 0, z: 0 });
  h.game.dispatch(h.crouch(false, basis.sessionId, basis.revision));
  h.game.advance(10);
  expect(h.spatial().position.x).toBeGreaterThan(start.x);
  h.game.dispose();
});

test.each([
  { height: 1.65, crouching: false, hp: 400 },
  { height: 1.65, crouching: true, hp: 500 },
  { height: 0.65, crouching: true, hp: 400 },
])(
  'same synthetic strike at $height gives $hp HP with crouching=$crouching',
  async ({ height, crouching, hp }) => {
    const h = await harness(height),
      basis = h.input.movement.begin('target');
    if (crouching) {
      h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
      h.game.advance(10);
    }
    h.game.dispatch(h.action('AttackRequested', 'blue'));
    h.game.advance(10);
    expect(h.player().hp).toBe(hp);
    expect(h.player().crouching).toBe(crouching);
    h.game.dispose();
  },
);

test('low-strike death preserves the crouch left-limit hold while clearing Core ownership', async () => {
  const h = await harness(0.65),
    basis = h.input.movement.begin('target');
  h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
  h.game.advance(10);
  for (let n = 0; n < 5; n++) {
    h.game.dispatch(h.action('AttackRequested', 'blue'));
    h.game.advance(10);
  }
  expect(h.player()).toMatchObject({ hp: 0, defeated: true, crouching: false });
  expect(h.spatial().pose).toMatchObject({
    kind: 'defeat',
    entry: { mode: 'crouch', playback: 'hold', startedAt: 0 },
  });
  expect(requireValue(h.game.read()).phase).toBe('terminal');
  h.game.advance(2500);
  expect(requireValue(h.game.read()).presentation.kind).toBe('results');
  expect(h.player().crouching).toBe(false);
  h.game.dispose();
});

test('opponent transition clears crouch and does not resurrect it for the next resident', async () => {
  const h = await harness(0.65),
    basis = h.input.movement.begin('enemy-target');
  h.game.dispatch({
    ...h.crouch(true, basis.sessionId, basis.revision),
    actorId: requireValue(requireValue(h.game.read()).actors[1]).actorId,
  });
  h.game.advance(10);
  expect(h.spatial('blue').locomotion).toBe('crouch');
  for (let n = 0; n < 5; n++) {
    h.game.dispatch(h.action('AttackRequested'));
    h.game.advance(10);
  }
  expect(requireValue(h.game.read()).currentOpponentId).toBeNull();
  expect(requireValue(requireValue(h.game.read()).actors[1]).crouching).toBe(
    false,
  );
  expect(h.spatial('blue').pose).toMatchObject({
    kind: 'defeat',
    entry: { mode: 'crouch', playback: 'hold' },
  });
  h.game.advance(1700);
  h.game.advance(0);
  expect(
    requireValue(h.game.read()).actors.find(
      (a) => a.actorId === requireValue(h.game.read()).currentOpponentId,
    )?.color,
  ).toBe('green');
  expect(requireValue(h.game.read()).actors.every((a) => !a.crouching)).toBe(
    true,
  );
  h.game.dispose();
});

test('final black knockout from crouch keeps standing Core motor and pose after an interior terminal contact', async () => {
  const h = await harness(0.65);
  try {
    for (let n = 0; n < 2000; n++) {
      const state = requireValue(h.game.read());
      const opponent = state.actors.find(
        (a) => a.actorId === state.currentOpponentId,
      );
      if (opponent?.color === 'black' && opponent.hp === 100) break;
      if (h.player().actions.punch.allowed)
        h.game.dispatch(h.action('AttackRequested'));
      h.game.advance(10);
    }
    const ready = requireValue(h.game.read());
    expect(
      ready.actors.find((a) => a.actorId === ready.currentOpponentId),
    ).toMatchObject({ color: 'black', hp: 100 });
    expect(ready.phase).toBe('running');
    const basis = h.input.movement.begin('final-crouch');
    h.game.dispatch(h.crouch(true, basis.sessionId, basis.revision));
    h.game.advance(10);
    expect(h.player().crouching).toBe(true);
    expect(h.spatial()).toMatchObject({
      locomotion: 'crouch',
      pose: { kind: 'living', living: { mode: 'crouch', playback: 'hold' } },
    });
    const before = requireValue(h.game.read()).clocks.gameTimeMs;
    h.game.dispatch(h.action('AttackRequested'));
    h.game.advance(10);
    const terminal = requireValue(h.game.read());
    expect(terminal.phase).toBe('terminal');
    expect(terminal.result?.outcome).toBe('clear');
    expect(terminal.clocks.gameTimeMs).toBeGreaterThan(before);
    expect(terminal.clocks.gameTimeMs).toBeLessThan(before + 10);
    expect(h.player()).toMatchObject({
      crouching: false,
      attack: null,
      defeated: false,
    });
    expect(h.spatial()).toMatchObject({
      locomotion: 'idle',
      pose: {
        kind: 'living',
        living: {
          mode: 'idle',
          playback: 'loop',
          startedAt: terminal.clocks.gameTimeMs,
        },
      },
    });
    const pose = h.spatial().pose;
    h.game.advance(1000);
    expect(requireValue(h.game.read()).clocks.gameTimeMs).toBe(
      terminal.clocks.gameTimeMs,
    );
    expect(
      requireValue(h.game.read()).clocks.presentationTimeMs,
    ).toBeGreaterThan(terminal.clocks.presentationTimeMs);
    expect(h.player()).toMatchObject({ crouching: false, attack: null });
    expect(h.spatial().locomotion).toBe('idle');
    expect(h.spatial().pose).toEqual(pose);
  } finally {
    h.game.dispose();
  }
});
