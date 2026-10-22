import { expect, test } from 'vitest';
import type { Object3D } from 'three';
import { createGame } from '../../src/app/createGame';
import { createCore } from '../../src/core';
import { createSceneAdapter } from '../../src/scene';
import {
  clipId,
  commandId,
  durationMs,
  type CommittedFrame,
  type ModuleFactories,
  type PoseCatalogBindings,
  type RunId,
} from '../../src/contracts';
import { fixtureCatalog } from '../core/fixtures/scenarios';
import { createFixturePorts } from '../core/fixtures/ports';

/** Actual A host/Core and C scene/timeline. B display/catalog are explicitly
 * contract doubles: no real asset, stamped B display or anatomy acceptance. */
function setup(missingDescriptor = false) {
  const synthetic = fixtureCatalog();
  const auxiliary = createFixturePorts();
  const frames: CommittedFrame[] = [];
  const bound: RunId[] = [];
  const disposed: RunId[] = [];
  const releases: Array<() => void> = [];
  const bindings: PoseCatalogBindings = {
    version: 1,
    bindingSetId: 'synthetic-real-c-readiness',
    clips: [
      ...['idle', 'walk', 'run', 'jump'].map((id) => ({
        clipId: clipId(id),
        durationMs: durationMs(1000),
        sourceBindingId: `synthetic:${id}`,
      })),
      ...synthetic.catalog.list().map((clip) => ({
        clipId: clip.clipId,
        durationMs: clip.durationMs,
        sourceBindingId: `synthetic:${clip.clipId}`,
      })),
    ],
    locomotion: {
      idle: clipId('idle'),
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
    },
  };
  const factories: ModuleFactories<Object3D> = {
    core: (context) => createCore(context, { ...synthetic, enemyAi: false }),
    catalog() {
      let prepared = false;
      return {
        ...synthetic.catalog,
        get pose() {
          return prepared && !missingDescriptor ? bindings : undefined;
        },
        prepare: () =>
          new Promise<void>((resolve) => {
            releases.push(() => {
              prepared = true;
              resolve();
            });
          }),
        sampleMotion: () => undefined,
        dispose() {},
      };
    },
    spatial(context) {
      const actual = createSceneAdapter(context, {
        onInterruption() {},
        createRenderer: () => ({
          domElement: new EventTarget() as HTMLCanvasElement,
          render() {},
          dispose() {},
          setSize() {},
          setPixelRatio() {},
        }),
      });
      const capability = actual.poseProtocol!;
      return {
        ...actual,
        poseProtocol: {
          ...capability,
          bindPreparedCatalog(value) {
            capability.bindPreparedCatalog(value);
            bound.push(context.runId);
          },
        },
        commit(output, viewport) {
          const spatial = actual.commit(output, viewport);
          frames.push({ ...output, spatial, viewport });
          return spatial;
        },
        dispose() {
          disposed.push(context.runId);
          actual.dispose();
        },
      };
    },
    animation: () => ({
      poseProtocol: { version: 1, protocol: 'deterministic-pose-v1' },
      render() {},
      dispose() {},
    }),
    ui: auxiliary.factories.ui,
    input: auxiliary.factories.input,
  };
  const game = createGame(factories, {
    sessionId: 'real-c-readiness',
    seed: 1,
    stepMs: 10,
    posePolicy: { version: 1, mode: 'deterministic-pose-v1' },
  });
  return { game, frames, bound, disposed, releases };
}

test('actual C preserves loading resident epochs and binds before first ready commit', async () => {
  const h = setup();
  try {
    const pending = h.game.start();
    expect(h.frames[0]!.snapshot.phase).toBe('loading');
    expect(h.frames[0]!.spatial.actors).toHaveLength(2);
    expect(
      h.frames[0]!.spatial.actors.every((actor) => actor.pose === undefined),
    ).toBe(true);
    h.game.advance(5000);
    expect(h.game.read()!.clocks.gameTimeMs).toBe(0);
    expect(h.bound).toEqual([]);
    h.releases[0]!();
    await pending;
    const ready = h.frames.at(-1)!;
    expect(ready.snapshot.phase).toBe('ready');
    expect(h.bound).toEqual([ready.snapshot.runId]);
    expect(ready.spatial.actors.map((actor) => actor.actorId)).toEqual(
      ready.snapshot.residentActorIds,
    );
    for (const actor of ready.spatial.actors) {
      expect(actor.pose).toMatchObject({
        kind: 'living',
        living: { mode: 'idle', startedAt: 0 },
      });
    }
  } finally {
    h.game.dispose();
  }
});

test('actual A/Core/C jump selection and pause use simulation epochs, not loading/render time', async () => {
  const h = setup();
  try {
    const pending = h.game.start();
    h.releases[0]!();
    await pending;
    const state = h.game.read()!;
    h.game.dispatch({ type: 'StartRequested', runId: state.runId });
    h.game.dispatch({
      type: 'JumpRequested',
      runId: state.runId,
      actorId: state.actors.find((actor) => actor.color === 'white')!.actorId,
      input: { commandId: commandId('jump'), sequence: 1 },
    });
    h.game.advance(10);
    const jumping = h.frames.at(-1)!.spatial.actors[0]!;
    expect(jumping.grounded).toBe(false);
    expect(jumping.pose).toMatchObject({
      kind: 'living',
      living: { mode: 'jump', startedAt: 10 },
    });
    h.game.dispatch({
      type: 'PauseRequested',
      runId: state.runId,
      reason: 'settings',
    });
    h.game.advance(1000);
    expect(h.game.read()!.clocks.gameTimeMs).toBe(10);
    expect(h.frames.at(-1)!.spatial.actors[0]!.pose).toEqual(jumping.pose);
    h.game.dispatch({
      type: 'ResumeRequested',
      runId: state.runId,
      reason: 'settings',
    });
    h.game.advance(10);
    expect(h.game.read()!.clocks.gameTimeMs).toBe(20);
    expect(h.game.lastError()).toBeNull();
  } finally {
    h.game.dispose();
  }
});

test('absent prepared descriptor cannot qualify actual C or publish ready', async () => {
  const h = setup(true);
  try {
    const pending = h.game.start();
    h.releases[0]!();
    await expect(pending).rejects.toThrow(/pose/i);
    expect(h.bound).toEqual([]);
    expect(h.frames.some((frame) => frame.snapshot.phase === 'ready')).toBe(
      false,
    );
    expect(h.disposed).toHaveLength(1);
  } finally {
    h.game.dispose();
  }
});

test('late old catalog cannot bind disposed C after successor has qualified', async () => {
  const h = setup();
  try {
    const old = h.game.start();
    const oldRun = h.game.read()!.runId;
    h.game.stop();
    const next = h.game.start();
    h.releases[1]!();
    await next;
    const nextRun = h.game.read()!.runId;
    h.releases[0]!();
    await old;
    expect(nextRun).not.toBe(oldRun);
    expect(h.bound).toEqual([nextRun]);
    expect(h.disposed).toEqual([oldRun]);
    expect(h.game.read()!.phase).toBe('ready');
    expect(
      h.frames
        .filter((frame) => frame.snapshot.phase === 'ready')
        .every((frame) => frame.snapshot.runId === nextRun),
    ).toBe(true);
    expect(
      h.frames
        .at(-1)!
        .spatial.actors.every(
          (actor) =>
            actor.pose?.kind === 'living' && actor.pose.living.startedAt === 0,
        ),
    ).toBe(true);
  } finally {
    h.game.dispose();
  }
});
