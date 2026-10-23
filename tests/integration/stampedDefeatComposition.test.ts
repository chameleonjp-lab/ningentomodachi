/** TEST ONLY, synthetic death authority: actual C stamps/parents and B consumer/
 * pinned driver, not actual collision, physical jump trajectory or game outcome.
 * This intentionally skips ALL living/death-t0 draws. One unparented full-source
 * entry surface is the support oracle; no extra rig is allocated for that oracle. */
import { readFileSync } from 'node:fs';
import { type Object3D, SkinnedMesh, Vector3 } from 'three';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createResidentAssetStage } from '../../src/app/residentAssets';
import {
  type ActorRig,
  createActorAnimator,
  createMotionCatalog,
  createPinnedDerivedThreeAssetPack,
  type ThreeAssetPack,
} from '../../src/assets';
import {
  type ActorColor,
  activeRealTimeMs,
  batchId,
  type CommittedFrame,
  type CoreOutput,
  type DefeatPoseSupportObservation,
  domainEventId,
  durationMs,
  type GameSnapshot,
  gameTimeMs,
  presentationTimeMs,
  runId,
  type StampedDefeatSeek,
  tick,
} from '../../src/contracts';
import { createCore } from '../../src/core';
import { createParisStreetLayout, createSceneAdapter } from '../../src/scene';
import { viewport } from '../world/fixtures';
import { createSyntheticTimingCatalog } from './fixtures/syntheticPoseCatalog';

function required<T>(value: T | null | undefined): T {
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

function unparentedSurfaceBottom(node: Object3D) {
  expect(node.parent).toBeNull();
  node.updateWorldMatrix(true, true);
  let min = Infinity,
    vertices = 0;
  const point = new Vector3();
  node.traverse((mesh) => {
    if (!(mesh instanceof SkinnedMesh)) return;
    mesh.skeleton.update();
    for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      min = Math.min(min, point.y);
      vertices++;
    }
  });
  expect(vertices).toBe(46181);
  expect(Number.isFinite(min)).toBe(true);
  return min;
}

for (const victimColor of ['white', 'blue'] as const)
  test(`actual stamped ${victimColor} reconstructs skipped loop-left entry under current C parent and publishes support`, async () => {
    const context = {
      runId: runId(`stamped-death-${victimColor}`),
      seed: 1,
      posePolicy: {
        version: 1 as const,
        mode: 'deterministic-pose-v1' as const,
      },
    };
    const synthetic = createSyntheticTimingCatalog(pack);
    const bindings = required(pack.poseBindings);
    const catalog = createMotionCatalog(async () => synthetic.motions, {
      poseBindings: () => bindings,
    });
    const core = createCore(context, {
      catalog,
      moves: synthetic.moves,
      enemyAi: false,
    });
    const layout = createParisStreetLayout();
    const draw = vi.fn();
    const scene = createSceneAdapter(
      {
        ...context,
        viewport: { read: () => viewport, subscribe: () => () => {} },
      },
      {
        onInterruption() {},
        layout: {
          ...layout,
          vehicles: [],
          objects: [],
          actorSpawns: {
            ...layout.actorSpawns,
            white: { x: 0, y: victimColor === 'white' ? 2 : 0, z: 0 },
            blue: { x: 1.4, y: victimColor === 'blue' ? 2 : 0, z: 1.4 },
          },
        },
        createRenderer: () => ({
          domElement: new EventTarget() as HTMLCanvasElement,
          render: draw,
          setSize() {},
          setPixelRatio() {},
          dispose() {},
        }),
      },
    );
    const rigs = new Map<ActorColor, ActorRig<Object3D>>();
    const seeks: StampedDefeatSeek[] = [];
    const observations: DefeatPoseSupportObservation[] = [];
    const stage = createResidentAssetStage(
      core.read(),
      {
        poseBindings: bindings,
        locomotionClips: bindings.locomotion,
        clipDuration: (id) => pack.clipDuration(id),
        create(color) {
          const rig = pack.create(color);
          if (!rig.seekDefeat || !rig.seekPose) {
            rig.dispose();
            throw new Error('Real stamped driver unavailable');
          }
          rigs.set(color, rig);
          const seekDefeat = rig.seekDefeat.bind(rig);
          return {
            ...rig,
            seekDefeat(input) {
              seeks.push(input);
              seekDefeat(input);
            },
          };
        },
      },
      undefined,
      context.posePolicy,
    );
    const animator = createActorAnimator(
      {
        ...context,
        viewport: { read: () => viewport, subscribe: () => () => {} },
        renderHost: {
          ...scene.renderHost,
          publishDefeatPoseSupport(observation) {
            observations.push(observation);
            return required(scene.renderHost.publishDefeatPoseSupport).call(
              scene.renderHost,
              observation,
            );
          },
        },
      },
      stage.assets,
    );
    try {
      // Deliberately blocks the legacy consumer. No fabricated protocol getter.
      expect(animator.poseProtocol).toMatchObject({
        version: 1,
        protocol: 'deterministic-pose-v1',
      });
      scene.commit(core.drain(), viewport);
      await catalog.prepare(new AbortController().signal);
      required(scene.poseProtocol).bindPreparedCatalog(required(catalog.pose));
      await stage.prepare(new AbortController().signal);
      core.handle({ type: 'AssetsReady', runId: context.runId });
      core.handle({ type: 'StartRequested', runId: context.runId });
      const livingOutput = core.drain();
      scene.commit(livingOutput, viewport);
      const base = livingOutput.snapshot;
      const victim = required(
        base.actors.find((actor) => actor.color === victimColor),
      );
      const rig = required(rigs.get(victimColor));
      const seekPose = required(rig.seekPose).bind(rig);
      const idle = required(
        bindings.clips.find((clip) => clip.clipId === bindings.locomotion.idle),
      );
      const jump = required(
        bindings.clips.find((clip) => clip.clipId === bindings.locomotion.jump),
      );
      const deathAt = idle.durationMs;
      seekPose(idle, idle.durationMs);
      const entryBottom = unparentedSurfaceBottom(rig.node);
      // Poison prior driver state after oracle sampling: stamped reconstruction
      // must not capture this unrelated latest manual pose.
      seekPose(jump, durationMs(jump.durationMs / 2));
      const slowMs = victimColor === 'white' ? 2000 : 1500;
      const totalMs = victimColor === 'white' ? 2000 : 1625;
      let revision = base.revision;
      const snapshotAt = (elapsed: number, paused = false): GameSnapshot => ({
        ...base,
        revision: ++revision,
        phase: paused
          ? 'paused'
          : victimColor === 'white'
            ? 'terminal'
            : 'running',
        pauseReasons: paused ? ['settings'] : [],
        clocks: {
          tick: tick(Math.floor(deathAt / 10)),
          gameTimeMs: gameTimeMs(
            deathAt +
              (victimColor === 'white'
                ? 0
                : Math.min(elapsed, 1500) / 4 + Math.max(0, elapsed - 1500)),
          ),
          activeRealTimeMs: activeRealTimeMs(deathAt + elapsed),
          presentationTimeMs: presentationTimeMs(deathAt + elapsed),
        },
        actors: base.actors.map((actor) =>
          actor.actorId === victim.actorId
            ? {
                ...actor,
                hp: 0,
                defeated: true,
                attack: null,
                defeatPresentation: {
                  category: 'kick',
                  startedAt: presentationTimeMs(deathAt),
                  slowDurationMs: durationMs(slowMs),
                  playbackRate: 0.25,
                },
              }
            : actor,
        ),
        presentation: {
          kind:
            victimColor === 'white'
              ? 'defeat-slow'
              : elapsed < 1500
                ? 'opponent-defeat'
                : 'opponent-defeat-finish',
          actorId: victim.actorId,
          startedAt: presentationTimeMs(deathAt),
          endsAt: presentationTimeMs(deathAt + totalMs),
        },
      });
      const deathOutput: CoreOutput = {
        snapshot: snapshotAt(0),
        events: [
          {
            type: 'ActorDefeated',
            runId: context.runId,
            actorId: victim.actorId,
            at: gameTimeMs(deathAt),
            eventId: domainEventId(`${context.runId}:synthetic-death`),
            sequence: 1,
            batchId: batchId('synthetic-authority-only'),
          },
        ],
      };
      const atDeath = scene.commit(deathOutput, viewport);
      const physical = required(
        atDeath.actors.find((actor) => actor.actorId === victim.actorId),
      );
      expect(physical.position.y).toBe(2);
      const frozenPhysical = JSON.stringify(physical);
      const commit = (elapsed: number, paused = false): CommittedFrame => {
        const output = { snapshot: snapshotAt(elapsed, paused), events: [] };
        return { ...output, spatial: scene.commit(output, viewport), viewport };
      };
      const show = (frame: CommittedFrame, elapsed: number) => {
        const before = draw.mock.calls.length;
        stage.render(frame.snapshot, () => animator.render(frame));
        scene.render(frame);
        expect(draw.mock.calls.length).toBe(before + 1);
        const input = required(seeks.at(-1));
        expect(input.entry).toMatchObject({
          binding: idle,
          clipTime: idle.durationMs,
          sampleSide: 'left',
        });
        expect(input.defeatStartedAt).toBe(deathAt);
        const clipMs = Math.min(
          500,
          Math.min(elapsed, slowMs) / 4 + Math.max(0, elapsed - slowMs),
        );
        expect(input.deathClipTime).toBe(clipMs);
        const support = required(observations.at(-1));
        expect(support.entryLocalMinY).toBeCloseTo(entryBottom, 10);
        expect(support.tick).toBe(frame.snapshot.clocks.tick);
        expect(support.presentationTimeMs).toBe(
          frame.snapshot.clocks.presentationTimeMs,
        );
        const presentation = required(rig.node.parent),
          anchor = required(presentation.parent);
        expect(anchor.position.toArray()).toEqual([
          physical.position.x,
          physical.position.y,
          physical.position.z,
        ]);
        const expectedBottom =
          2 + entryBottom + (0.002 - (2 + entryBottom)) * (clipMs / 500);
        expect(
          presentation.getWorldPosition(new Vector3()).y +
            support.currentLocalBounds.min.y,
        ).toBeCloseTo(expectedBottom, 10);
        expect(
          JSON.stringify(
            frame.spatial.actors.find(
              (actor) => actor.actorId === victim.actorId,
            ),
          ),
        ).toBe(frozenPhysical);
        return presentation.position.y;
      };
      // No B render occurred before this delayed first death frame.
      const first = commit(100),
        originalFirst = JSON.stringify(first);
      const firstOffset = show(first, 100);
      expect(show(commit(100, true), 100)).toBe(firstOffset);
      const last = commit(totalMs);
      show(last, totalMs);
      // Recomputed skin matrices include the current C presentation parent.
      // Apply the same numeric source/world criterion used above, not a new
      // bitwise visual-transform guarantee. Authoritative frame JSON stays exact.
      expect(show(first, 100)).toBeCloseTo(firstOffset, 10);
      expect(JSON.stringify(first)).toBe(originalFirst);
      show(last, totalMs);
      expect([...rigs.keys()]).toEqual(['white', 'blue']);
    } finally {
      animator.dispose();
      stage.dispose();
      scene.dispose();
      core.dispose();
      catalog.dispose();
    }
  }, 30000);
