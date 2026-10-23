/** Actual pinned B driver + actual Core/C simulation timing. Manual diagnostic
 * seeks are NOT the production B animator, render readiness or anatomy approval. */
import { readFileSync } from 'node:fs';
import type { Object3D } from 'three';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createResidentAssetStage } from '../../src/app/residentAssets';
import {
  type ActorRig,
  createMotionCatalog,
  createPinnedDerivedThreeAssetPack,
  type ThreeAssetPack,
} from '../../src/assets';
import {
  type ActorColor,
  type CommittedFrame,
  commandId,
  durationMs,
  poseClipTime,
  runId,
  tick,
} from '../../src/contracts';
import { createCore } from '../../src/core';
import { createSceneAdapter } from '../../src/scene';
import { viewport } from '../world/fixtures';
import { createSyntheticTimingCatalog } from './fixtures/syntheticPoseCatalog';

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('Required diagnostic value unavailable');
  return value;
}
let pack: ThreeAssetPack;
beforeAll(async () => {
  pack = await createPinnedDerivedThreeAssetPack({
    derivedBytes: new Uint8Array(
      readFileSync('public/game-assets/android/derived-pack-v1.glb'),
    ),
    artifactBytes: new Uint8Array(
      readFileSync('public/game-assets/android/runtime-artifact-v1.json'),
    ),
    signal: new AbortController().signal,
  });
}, 30000);
afterAll(() => pack?.dispose());

function matrices(node: Object3D) {
  node.updateWorldMatrix(true, true);
  const values: number[] = [];
  node.traverse((child) => values.push(...child.matrixWorld.elements));
  expect(values.length).toBeGreaterThan(16);
  expect(values.every(Number.isFinite)).toBe(true);
  return values;
}
async function diagnostic(name: string) {
  const context = {
    runId: runId(name),
    seed: 1,
    posePolicy: { version: 1 as const, mode: 'deterministic-pose-v1' as const },
  };
  const synthetic = createSyntheticTimingCatalog(pack);
  const catalog = createMotionCatalog(async () => synthetic.motions, {
    poseBindings: () => pack.poseBindings,
  });
  const core = createCore(context, {
    catalog,
    moves: synthetic.moves,
    enemyAi: false,
  });
  const scene = createSceneAdapter(
    {
      ...context,
      viewport: { read: () => viewport, subscribe: () => () => {} },
    },
    {
      onInterruption() {},
      createRenderer: () => ({
        domElement: new EventTarget() as HTMLCanvasElement,
        render() {
          throw new Error('Manual driver test must not claim a render');
        },
        dispose() {},
        setSize() {},
        setPixelRatio() {},
      }),
    },
  );
  const rigs = new Map<ActorColor, ActorRig<Object3D>>();
  const bindings = required(pack.poseBindings);
  const stage = createResidentAssetStage(
    core.read(),
    {
      poseBindings: bindings,
      locomotionClips: bindings.locomotion,
      clipDuration: (id) => pack.clipDuration(id),
      create: (color) => pack.create(color),
    },
    undefined,
    context.posePolicy,
  );
  let frame: CommittedFrame;
  const commit = () => {
    const output = core.drain();
    frame = { ...output, spatial: scene.commit(output, viewport), viewport };
    expect(
      output.events.some((event) =>
        [
          'HpChanged',
          'ClashResolved',
          'VehicleLaunchApproved',
          'DestructionCounted',
        ].includes(event.type),
      ),
    ).toBe(false);
    expect(output.snapshot.actors.map((actor) => actor.hp)).toEqual([
      500, 500, 500, 500, 700,
    ]);
    return frame;
  };
  try {
    commit(); // Loading commit precedes prepared bindings; C retains pending epochs.
    await catalog.prepare(new AbortController().signal);
    expect(catalog.list()).toHaveLength(31);
    expect(required(catalog.pose).clips).toHaveLength(42);
    required(scene.poseProtocol).bindPreparedCatalog(required(catalog.pose));
    await stage.prepare(new AbortController().signal);
    core.handle({ type: 'AssetsReady', runId: context.runId });
    commit();
    stage.render(core.read(), () => {
      for (const actor of core.read().actors)
        if (required(core.read().residentActorIds).includes(actor.actorId))
          rigs.set(actor.color, stage.assets.create(actor.color));
    });
    core.handle({ type: 'StartRequested', runId: context.runId });
    commit();
  } catch (error) {
    for (const rig of rigs.values()) rig.dispose();
    stage.dispose();
    scene.dispose();
    core.dispose();
    catalog.dispose();
    throw error;
  }
  const advance = () => {
    core.present(durationMs(10));
    const request = core.beginStep({ durationMs: durationMs(10) });
    const result = scene.step(request, catalog);
    expect(result.candidates).toEqual([]);
    const output = core.completeStep(result);
    frame = { ...output, spatial: scene.commit(output, viewport), viewport };
    expect(output.events.some((event) => event.type === 'HpChanged')).toBe(
      false,
    );
    expect(core.read().actors.map((actor) => actor.hp)).toEqual([
      500, 500, 500, 500, 700,
    ]);
    return frame;
  };
  const seek = (from: CommittedFrame, color: ActorColor = 'white') => {
    const actor = required(
      from.snapshot.actors.find((item) => item.color === color),
    );
    const stamp = required(
      required(
        from.spatial.actors.find((item) => item.actorId === actor.actorId),
      ).pose,
    );
    if (stamp.kind !== 'living') throw new Error('Living diagnostic expected');
    const time = poseClipTime(stamp.living, from.snapshot.clocks.gameTimeMs);
    const rig = required(rigs.get(color));
    if (!rig.seekPose) throw new Error('Actual driver capability missing');
    rig.seekPose(stamp.living.binding, time);
    return { stamp: stamp.living, time, matrices: matrices(rig.node) };
  };
  return {
    core,
    rigs,
    commit,
    advance,
    seek,
    read: () => frame,
    dispose() {
      for (const rig of rigs.values()) rig.dispose();
      stage.dispose();
      scene.dispose();
      core.dispose();
      catalog.dispose();
    },
  };
}

test('full synthetic timing catalog binds real driver clocks to actual C attack stamps without contacts', async () => {
  const h = await diagnostic('driver-attack-clock');
  try {
    const initial = h.read(),
      idle = h.seek(initial);
    const state = h.core.read();
    const player = required(
      state.actors.find((actor) => actor.color === 'white'),
    );
    h.core.handleInputBatch({
      runId: state.runId,
      tick: tick(state.clocks.tick + 1),
      commands: [
        {
          type: 'AttackRequested',
          runId: state.runId,
          actorId: player.actorId,
          category: 'punch',
          input: { commandId: commandId('diagnostic-attack'), sequence: 1 },
        },
      ],
    });
    const frame = h.advance(),
      sampled = h.seek(frame);
    const attack = required(
      required(
        h.core.read().actors.find((actor) => actor.actorId === player.actorId),
      ).attack,
    );
    expect(sampled.stamp).toMatchObject({
      mode: 'attack',
      startedAt: attack.startedAt,
      activationId: attack.activationId,
      binding: { clipId: attack.clipId },
    });
    expect(sampled.time).toBe(10);
    expect(sampled.matrices).not.toEqual(idle.matrices);
    expect(h.seek(initial).matrices).toEqual(idle.matrices);
    expect(h.seek(frame).matrices).toEqual(sampled.matrices);
    expect(h.read()).toBe(frame);
    expect([...h.rigs.keys()]).toEqual(['white', 'blue']);
  } finally {
    h.dispose();
  }
}, 30000);

test('real driver jump source time follows discrete C selection and pauses, independent of manual seek order', async () => {
  const h = await diagnostic('driver-jump-clock');
  try {
    const state = h.core.read(),
      player = required(state.actors.find((actor) => actor.color === 'white'));
    h.core.handleInputBatch({
      runId: state.runId,
      tick: tick(state.clocks.tick + 1),
      commands: [
        {
          type: 'JumpRequested',
          runId: state.runId,
          actorId: player.actorId,
          input: { commandId: commandId('diagnostic-jump'), sequence: 1 },
        },
      ],
    });
    const first = h.seek(h.advance());
    expect(first.stamp).toMatchObject({ mode: 'jump', startedAt: 10 });
    expect(first.time).toBe(0);
    h.core.handle({
      type: 'PauseRequested',
      runId: state.runId,
      reason: 'settings',
    });
    h.core.present(durationMs(1000));
    const paused = h.commit();
    expect(paused.snapshot.clocks.gameTimeMs).toBe(10);
    expect(h.seek(paused).matrices).toEqual(first.matrices);
    h.core.handle({
      type: 'ResumeRequested',
      runId: state.runId,
      reason: 'settings',
    });
    const resumed = h.seek(h.advance());
    expect(resumed.stamp.startedAt).toBe(10);
    expect(resumed.time).toBe(10);
    // Original Jump begins at 22.2222227603 ms: t0 and t10 must hold
    // its first key, not shift the source animation to start at zero.
    expect(resumed.matrices).toEqual(first.matrices);
    h.advance();
    const beyondFirstKey = h.seek(h.advance());
    expect(beyondFirstKey.time).toBe(30);
    expect(beyondFirstKey.matrices).not.toEqual(first.matrices);
  } finally {
    h.dispose();
  }
}, 30000);
