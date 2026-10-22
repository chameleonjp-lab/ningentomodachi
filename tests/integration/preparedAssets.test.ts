/** Actual pinned visual factory and public adapters; synthetic authority is NOT a production catalog. */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { Object3D } from 'three';
import {
  createPinnedDerivedThreeAssetPack,
  createActorAnimator,
  type ActorRig,
  type ThreeAssetPack,
} from '../../src/assets';
import { createResidentAssetStage } from '../../src/app/residentAssets';
import { createCore } from '../../src/core';
import { createSceneAdapter, createParisStreetLayout } from '../../src/scene';
import {
  clipId,
  runId,
  type ActorColor,
  type CommittedFrame,
} from '../../src/contracts';
import { fixtureCatalog } from '../core/fixtures/scenarios';
import { viewport } from '../world/fixtures';
import {
  createDuelWorld,
  worldSurface,
  projectedWorldBounds,
} from './fixtures/twoResidentWorld';

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

test('the actual pinned pack stages only Core-issued residents and transfers them to B/C once', async () => {
  const context = {
    runId: runId('real-pinned-stage'),
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
  };
  const core = createCore(
    { runId: context.runId, seed: context.seed },
    { ...fixtureCatalog(), enemyAi: false },
  );
  const rigs = new Map<ActorColor, ActorRig<Object3D>>();
  const events: string[] = [];
  const stage = createResidentAssetStage(core.read(), {
    create(color) {
      const rig = pack.create(color);
      expect(typeof rig.defeatPoseSupport).toBe('function');
      expect(rig.defeatPoseSupport?.()).toBeUndefined();
      rigs.set(color, rig);
      events.push(`create:${color}`);
      setTimeout(() => events.push(`task:${color}`), 0);
      return {
        ...rig,
        dispose() {
          events.push(`dispose:${color}`);
          rig.dispose();
        },
      };
    },
    clipDuration: (id) => pack.clipDuration(id),
    locomotionClips: {
      idle: clipId('Idle'),
      walk: clipId('Walk'),
      run: clipId('Run'),
      jump: clipId('Jump'),
    },
  });
  let draws = 0;
  const scene = createSceneAdapter(context, {
    layout: createParisStreetLayout(),
    onInterruption() {},
    createRenderer: () => ({
      domElement: new EventTarget() as HTMLCanvasElement,
      render() {
        draws++;
      },
      dispose() {},
      setPixelRatio() {},
      setSize() {},
    }),
  });
  const animation = createActorAnimator(
    { ...context, renderHost: scene.renderHost },
    stage.assets,
  );
  try {
    await stage.prepare(new AbortController().signal);
    expect(core.read().phase).toBe('loading');
    expect(events.slice(0, 3)).toEqual([
      'create:white',
      'task:white',
      'create:blue',
    ]);
    expect([...rigs.keys()]).toEqual(['white', 'blue']);
    for (const rig of rigs.values()) expect(rig.node.parent).toBeNull();
    core.handle({ type: 'AssetsReady', runId: context.runId });
    const output = core.drain();
    const frame: CommittedFrame = {
      ...output,
      spatial: scene.commit(output, viewport),
      viewport,
    };
    for (let i = 0; i < 2; i++) {
      stage.render(frame.snapshot, () => animation.render(frame));
      scene.render(frame);
    }
    expect(draws).toBe(2);
    expect(events.filter((event) => event.startsWith('create:'))).toEqual([
      'create:white',
      'create:blue',
    ]);
    expect(frame.spatial.actors.map((actor) => actor.actorId)).toEqual(
      core.read().residentActorIds,
    );
    for (const rig of rigs.values()) expect(rig.node.parent).not.toBeNull();
  } finally {
    animation.dispose();
    stage.dispose();
    scene.dispose();
    core.dispose();
  }
  expect(events.filter((event) => event.startsWith('dispose:'))).toEqual([
    'dispose:white',
    'dispose:blue',
  ]);
}, 30000);

test.each(['white', 'blue'] as const)(
  'derived visuals preserve actual C world support for %s without changing frozen physics',
  async (victim) => {
    const h = await createDuelWorld(
      pack,
      new Uint8Array(
        readFileSync(
          'assets/android/motions/completed42-speed15/kick/android_kick.glb',
        ),
      ),
      'ChineseCartwheelKick',
      victim,
      viewport,
    );
    try {
      h.advanceTo(1.04);
      const rig = h.rigs.get(victim)!;
      const entry = worldSurface(rig.node);
      h.beginDeath('kick');
      const physical = h.frame.spatial.actors.map((actor) => ({
        id: actor.actorId,
        position: actor.position,
      }));
      const end = victim === 'white' ? 2000 : 1625;
      for (const elapsed of [0, 750, 1500, end]) {
        const frame = h.presentDeath(elapsed);
        const progress =
          Math.min(
            0.5,
            Math.min(elapsed, victim === 'white' ? 2000 : 1500) / 4000 +
              Math.max(0, elapsed - (victim === 'white' ? 2000 : 1500)) / 1000,
          ) / 0.5;
        const surface = worldSurface(rig.node);
        expect(surface.vertices).toBe(46181);
        expect(surface.min.y).toBeCloseTo(
          entry.min.y + (0.002 - entry.min.y) * progress,
          5,
        );
        expect(
          frame.spatial.actors.map((actor) => ({
            id: actor.actorId,
            position: actor.position,
          })),
        ).toEqual(physical);
        for (const resident of h.rigs.values())
          expect(
            projectedWorldBounds(worldSurface(resident.node), h.camera).maxXY,
          ).toBeLessThanOrEqual(1.000001);
      }
      if (victim === 'blue') {
        h.retireBlue();
        expect([...h.rigs.keys()]).toEqual(['white', 'green']);
        expect(h.events.indexOf('dispose:blue:detached')).toBeLessThan(
          h.events.indexOf('create:green'),
        );
      }
    } finally {
      h.dispose();
    }
  },
  30000,
);
