// @vitest-environment jsdom
/** Expected RED until actual B checkpoint2 is accepted. No poseProtocol mocks.
 * Real public host/Core/C/B factories + pinned visuals; ALL attack metadata is
 * the synthetic no-contact timing fixture. CPU renderer double, not WebGL proof. */
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import {
  type AcceptedGameConfiguration,
  createIntegratedGame,
} from '../../src/app/integratedGame';
import { createPinnedDerivedThreeAssetPack } from '../../src/assets';
import type {
  ActorColor,
  DurationMs,
  PoseClipBinding,
} from '../../src/contracts';
import * as SceneModule from '../../src/scene';
import {
  createSyntheticTimingCatalog,
  syntheticTimingMoves,
} from './fixtures/syntheticPoseCatalog';

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('Required integration value unavailable');
  return value;
}

function setup() {
  const root = document.createElement('main');
  document.body.append(root);
  const lifecycle: string[] = [];
  const seeks: Array<{
    color: ActorColor;
    binding: PoseClipBinding;
    time: DurationMs;
  }> = [];
  const layout = SceneModule.createParisStreetLayout();
  const createScene = SceneModule.createSceneAdapter;
  // Observation only: actual C capabilities, binding, stepping and candidates
  // are untouched. This is not a synthetic pose producer or capability claim.
  const step = vi.fn();
  const committedPhases: string[] = [];
  const sceneSpy = vi
    .spyOn(SceneModule, 'createSceneAdapter')
    .mockImplementation((...args) => {
      const actual = createScene(...args);
      return {
        ...actual,
        commit(output, viewport) {
          committedPhases.push(output.snapshot.phase);
          return actual.commit(output, viewport);
        },
        step(request, catalog) {
          const result = actual.step(request, catalog);
          step(result);
          expect(result.candidates).toEqual([]);
          return result;
        },
      };
    });
  const configuration: AcceptedGameConfiguration = {
    moves: syntheticTimingMoves(),
    layout,
    world: {
      vehicles: layout.vehicles.map((v) => ({
        vehicleId: v.vehicleId,
        hp: 100,
      })),
      objects: layout.objects.map((o) => ({
        objectId: o.objectId,
        durability: 100,
      })),
    },
    async loadAssets(context, signal) {
      const pack = await createPinnedDerivedThreeAssetPack({
        derivedBytes: new Uint8Array(
          readFileSync('public/game-assets/android/derived-pack-v1.glb'),
        ),
        artifactBytes: new Uint8Array(
          readFileSync('public/game-assets/android/runtime-artifact-v1.json'),
        ),
        signal,
      });
      try {
        const timing = createSyntheticTimingCatalog(pack);
        const bindings = required(pack.poseBindings);
        return {
          motions: timing.motions,
          animator: {
            poseBindings: bindings,
            locomotionClips: bindings.locomotion,
            clipDuration: (id) => pack.clipDuration(id),
            create(color) {
              lifecycle.push(`create:${context.runId}:${color}`);
              const rig = pack.create(color);
              if (!rig.seekPose || !rig.seekDefeat) {
                rig.dispose();
                throw new Error('Actual pinned driver capability missing');
              }
              const seekPose = rig.seekPose.bind(rig);
              return {
                ...rig,
                seekPose(binding, time) {
                  seeks.push({ color, binding, time });
                  seekPose(binding, time);
                },
                dispose() {
                  lifecycle.push(
                    `dispose:${context.runId}:${color}:${rig.node.parent === null ? 'detached' : 'mounted'}`,
                  );
                  rig.dispose();
                },
              };
            },
            dispose() {
              lifecycle.push(`pack:${context.runId}`);
              pack.dispose();
            },
          },
        };
      } catch (error) {
        pack.dispose();
        throw error;
      }
    },
  };
  const draw = vi.fn();
  const game = createIntegratedGame(root, {
    sessionId: 'actual-stamped-integration',
    seed: 1,
    stepMs: 10,
    posePolicy: { version: 1, mode: 'deterministic-pose-v1' },
    viewport: {
      widthCssPx: 400,
      heightCssPx: 800,
      offsetLeftCssPx: 0,
      offsetTopCssPx: 0,
      devicePixelRatio: 1,
      safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    configuration,
    createRenderer: () => ({
      domElement: document.createElement('canvas'),
      render: draw,
      setSize() {},
      setPixelRatio() {},
      dispose() {},
    }),
  });
  return {
    game,
    root,
    lifecycle,
    seeks,
    step,
    committedPhases,
    draw,
    dispose() {
      game.dispose();
      sceneSpy.mockRestore();
      root.remove();
    },
  };
}

test('actual stamped consumer qualifies before ready, owns only required rigs and uses authoritative attack clocks', async () => {
  const h = setup();
  const { game, root, lifecycle, seeks, step, committedPhases, draw } = h;
  try {
    try {
      await game.start();
    } catch (error) {
      // Preserve a precise pre-consumer RED, not a loading-fixture accident or
      // transient ready state. Remove no guard when the real consumer arrives.
      expect(String(error)).toContain(
        'Required pose protocol capability is unavailable',
      );
      expect(committedPhases).toContain('loading');
      expect(committedPhases).not.toContain('ready');
      expect(seeks).toEqual([]);
      throw error;
    }
    const ready = required(game.read());
    expect(ready.phase).toBe('ready');
    expect(lifecycle).toEqual([
      `create:${ready.runId}:white`,
      `create:${ready.runId}:blue`,
    ]);
    expect(seeks.some((seek) => seek.color === 'white')).toBe(true);
    expect(seeks.some((seek) => seek.color === 'blue')).toBe(true);
    expect(draw).toHaveBeenCalled();
    game.dispatch({ type: 'StartRequested', runId: ready.runId });
    required(
      Array.from(root.querySelectorAll('button')).find(
        (button) => button.textContent === 'パンチ',
      ),
    ).click();
    game.advance(20);
    const running = required(game.read());
    const player = required(
      running.actors.find((actor) => actor.color === 'white'),
    );
    const attack = required(player.attack);
    const latest = required(
      seeks.filter((seek) => seek.color === 'white').at(-1),
    );
    expect(latest.binding.clipId).toBe(attack.clipId);
    expect(latest.time).toBe(running.clocks.gameTimeMs - attack.startedAt);
    expect(step).toHaveBeenCalled();
    expect(running.actors.map((actor) => actor.hp)).toEqual([
      500, 500, 500, 500, 700,
    ]);
    game.dispatch({
      type: 'PauseRequested',
      runId: ready.runId,
      reason: 'settings',
    });
    game.advance(1000);
    expect(game.read()?.clocks.gameTimeMs).toBe(running.clocks.gameTimeMs);
    game.dispatch({
      type: 'ResumeRequested',
      runId: ready.runId,
      reason: 'settings',
    });
    game.advance(10);
    expect(game.lastError()).toBeNull();
    game.dispose();
    expect(lifecycle.slice(-3)).toEqual([
      `dispose:${ready.runId}:white:detached`,
      `dispose:${ready.runId}:blue:detached`,
      `pack:${ready.runId}`,
    ]);
    expect(root.querySelectorAll('canvas')).toHaveLength(0);
  } finally {
    h.dispose();
  }
}, 30000);

test('public restart detaches and releases the prior real rigs and pack before successor allocation', async () => {
  const h = setup();
  try {
    await h.game.start();
    const first = required(h.game.read());
    expect(first.phase).toBe('ready');
    await h.game.restart();
    const second = required(h.game.read());
    expect(second.phase).toBe('ready');
    expect(second.runId).not.toBe(first.runId);
    expect(h.lifecycle).toEqual([
      `create:${first.runId}:white`,
      `create:${first.runId}:blue`,
      `dispose:${first.runId}:white:detached`,
      `dispose:${first.runId}:blue:detached`,
      `pack:${first.runId}`,
      `create:${second.runId}:white`,
      `create:${second.runId}:blue`,
    ]);
    h.game.dispatch({ type: 'StartRequested', runId: first.runId });
    expect(h.game.read()?.runId).toBe(second.runId);
    expect(h.game.read()?.phase).toBe('ready');
    h.game.dispose();
    h.game.dispose();
    expect(h.lifecycle.slice(-3)).toEqual([
      `dispose:${second.runId}:white:detached`,
      `dispose:${second.runId}:blue:detached`,
      `pack:${second.runId}`,
    ]);
    expect(
      h.lifecycle.filter((event) => event.startsWith('create:')),
    ).toHaveLength(4);
    expect(
      h.lifecycle.filter((event) => event.startsWith('dispose:')),
    ).toHaveLength(4);
    expect(
      h.lifecycle.filter((event) => event.startsWith('pack:')),
    ).toHaveLength(2);
    expect(h.root.querySelectorAll('canvas')).toHaveLength(0);
  } finally {
    h.dispose();
  }
}, 30000);
