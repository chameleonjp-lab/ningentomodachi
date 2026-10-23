/** DIAGNOSTIC ONLY: real selected kick metadata, Core/C commands and B display.
 * Unexecuted synthetic constructor definitions satisfy the logical full roster.
 * Proxy HP is recorded, never accepted as source-accurate gameplay geometry. */
import { readFileSync, writeFileSync } from 'node:fs';
import { type Object3D, Triangle, Vector3 } from 'three';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  type ActorRig,
  type ThreeAssetPack,
  assertRootPolicyCompatibility,
  createActorAnimator,
  createMotionCatalog,
  createPinnedDerivedThreeAssetPack,
} from '../../src/assets';
import {
  type ActorColor,
  type ActorId,
  type CommittedFrame,
  type CoreOutput,
  type DomainEvent,
  type ImpactReference,
  type SpatialCandidate,
  commandId,
  durationMs,
  runId,
  tick,
} from '../../src/contracts';
import { createCore, createRandom } from '../../src/core';
import { createParisStreetLayout, createSceneAdapter } from '../../src/scene';
import {
  GROUNDED_SWEEP_SOURCE_PINS,
  loadGroundedSweepDiagnostics,
} from '../../tools/assets/groundedSweepDiagnostic';
import { fixtureCatalog } from '../core/fixtures/scenarios';
import { viewport } from '../world/fixtures';
import {
  displayedNativeKickPatch,
  patchAttribution,
} from './fixtures/nativeKickAttribution';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Required diagnostic value unavailable');
  return value;
}
const entries = loadGroundedSweepDiagnostics({
  sourceBytes: readFileSync(GROUNDED_SWEEP_SOURCE_PINS.sourcePath),
  manifestBytes: readFileSync(GROUNDED_SWEEP_SOURCE_PINS.manifestPath),
  recipeBytes: readFileSync(
    'tests/assets/fixtures/grounded-sweeps-v1/recipe.json.fixture',
  ),
  candidateBytes: readFileSync(
    'tests/assets/fixtures/grounded-sweeps-v1/candidate.json.fixture',
  ),
});
let pack: ThreeAssetPack;
const reports: unknown[] = [];
beforeAll(async () => {
  pack = await createPinnedDerivedThreeAssetPack({
    derivedBytes: readFileSync(
      'public/game-assets/android/derived-pack-v1.glb',
    ),
    artifactBytes: readFileSync(
      'public/game-assets/android/runtime-artifact-v1.json',
    ),
    rootPolicies: entries.map((entry) => entry.rootPolicy),
    signal: new AbortController().signal,
  });
  assertRootPolicyCompatibility(
    entries.map((entry) => ({
      asset: entry.asset,
      rootPolicy: entry.rootPolicy,
    })),
    pack,
  );
}, 30000);
afterAll(() => {
  pack?.dispose();
  if (process.env.NATIVE_KICK_PLAYBACK_OUTPUT)
    writeFileSync(
      process.env.NATIVE_KICK_PLAYBACK_OUTPUT,
      JSON.stringify(
        {
          scope:
            'native-XYZ finite diagnostic proxy/source observations, NOT gameplay allowance or CCD',
          reports,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
});

interface PlaybackCase {
  readonly name: string;
  readonly separation: number;
  readonly targetX: number;
  readonly targetZ?: number;
  readonly startStep?: number;
  readonly durationSteps?: number;
}
const cases: readonly PlaybackCase[] = [
  { name: 'near', separation: 1, targetX: 0 },
  { name: 'far', separation: 1.8, targetX: 0 },
  { name: 'post-activation-left', separation: 1, targetX: -0.75 },
  { name: 'post-activation-right', separation: 1, targetX: 0.75 },
] as const;

// Fixed observed diagnostic outcomes, not anatomy/HP geometry acceptance.
// SideThrust's four misses do not establish universal inability to connect.
const expectedHpEvents: Readonly<
  Record<string, Readonly<Record<string, 0 | 1>>>
> = {
  RoundhouseKick: {
    near: 1,
    far: 0,
    'post-activation-left': 1,
    'post-activation-right': 1,
  },
  SideThrustKick: {
    near: 0,
    far: 0,
    'post-activation-left': 0,
    'post-activation-right': 0,
  },
};

test('finite display metric agrees with analytical face/intersection/vertex controls', () => {
  const triangle = new Triangle(
    new Vector3(-10, 2, -10),
    new Vector3(10, 2, -10),
    new Vector3(0, 2, 10),
  );
  const face = {
    primitive: 0,
    triangleIndex: 0,
    region: 'sole-hypothesis' as const,
    triangle,
  };
  const above = patchAttribution(
    [face],
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 3, z: 0 },
  );
  expect(Math.abs(above.regionGapM - 0.15)).toBeLessThan(1e-10);
  expect(above.candidatePointToPatchM).toBe(1);
  const intersects = patchAttribution([face], { x: 0, y: 1, z: 0 });
  expect(Math.abs(intersects.regionGapM + 0.35)).toBeLessThan(1e-10);
  const vertex = patchAttribution([face], { x: 0, y: 0, z: 12 });
  expect(
    Math.abs(vertex.regionGapM - (Math.hypot(2, 0.5) - 0.35)),
  ).toBeLessThan(1e-10);
});

for (const entry of entries)
  for (const scenario of cases)
    test(`${entry.descriptor.clipId} ${scenario.name}: actual facing, proxy contact and intended patch remain distinct`, async () => {
      expect(entry.rootPolicy.mode).toBe('in-place-posture-xyz');
      const context = {
        runId: runId(
          `native-kick-playback:${entry.descriptor.clipId}:${scenario.name}`,
        ),
        seed: 1,
        posePolicy: {
          version: 1 as const,
          mode: 'deterministic-pose-v1' as const,
        },
      };
      const placeholders = fixtureCatalog();
      // Replace, rather than append to, two synthetic kick slots. Black still has
      // exactly19 distinct logical kicks; no synthetic slot may execute here.
      const replaced = placeholders.catalog
        .list()
        .filter((d) => d.category === 'kick')
        .slice(0, 2);
      const mapId = (id: (typeof replaced)[number]['clipId']) => {
        const index = replaced.findIndex((d) => d.clipId === id);
        return index < 0 ? id : required(entries[index]).descriptor.clipId;
      };
      const definitions = placeholders.catalog.list().map((d) => {
        const index = replaced.findIndex((r) => r.clipId === d.clipId);
        return index < 0 ? d : required(entries[index]).asset.definition;
      });
      const moves = { ...placeholders.moves };
      for (const color of [
        'white',
        'blue',
        'green',
        'yellow',
        'black',
      ] as const) {
        const set = placeholders.moves[color];
        moves[color] = { punches: set.punches, kicks: set.kicks.map(mapId) };
      }
      // Keep all19 unique kicks. Deterministic configuration ordering lets the
      // real seeded Core picker choose this diagnostic, without replacing RNG
      // or injecting an activation. No geometry/placement outcome is searched.
      const whiteKicks = [...moves.white.kicks];
      const selectedSlot = createRandom(context.seed).pick(
        whiteKicks.map((_, i) => i),
      );
      const fixtureSlot = whiteKicks.indexOf(entry.descriptor.clipId);
      if (fixtureSlot < 0) throw new Error('Real kick absent from full roster');
      [whiteKicks[selectedSlot], whiteKicks[fixtureSlot]] = [
        required(whiteKicks[fixtureSlot]),
        required(whiteKicks[selectedSlot]),
      ];
      moves.white = { ...moves.white, kicks: whiteKicks };
      const core = createCore(context, {
        catalog: {
          list: () => definitions,
          get: (id) => definitions.find((d) => d.clipId === id),
        },
        moves,
        enemyAi: false,
      });
      const bindings = required(pack.poseBindings);
      const catalog = createMotionCatalog(
        async () => entries.map((e) => e.asset),
        { poseBindings: () => bindings },
      );
      const scene = createSceneAdapter(
        {
          ...context,
          viewport: { read: () => viewport, subscribe: () => () => {} },
        },
        {
          layout: createParisStreetLayout(),
          onInterruption() {
            throw new Error('Unexpected context interruption');
          },
          createRenderer: () => ({
            domElement: new EventTarget() as HTMLCanvasElement,
            render() {},
            dispose() {},
            setSize() {},
            setPixelRatio() {},
          }),
        },
      );
      const rigs = new Map<ActorColor, ActorRig<Object3D>>(),
        disposed: ActorColor[] = [];
      const animator = createActorAnimator(
        {
          ...context,
          viewport: { read: () => viewport, subscribe: () => () => {} },
          renderHost: scene.renderHost,
        },
        {
          poseBindings: bindings,
          locomotionClips: bindings.locomotion,
          clipDuration: (id) => pack.clipDuration(id),
          create(color) {
            expect(['white', 'blue']).toContain(color);
            expect(rigs.has(color)).toBe(false);
            const rig = pack.create(color);
            rigs.set(color, rig);
            return {
              ...rig,
              dispose() {
                disposed.push(color);
                rig.dispose();
              },
            };
          },
        },
      );
      let frame: CommittedFrame,
        sequence = 0;
      const events: DomainEvent[] = [],
        commands: unknown[] = [],
        contacts: unknown[] = [],
        samples: unknown[] = [];
      const bodyCandidates: Extract<SpatialCandidate, { kind: 'body-hit' }>[] =
        [];
      let expectedSource: ImpactReference | undefined;
      const actors = core.read().actors;
      const white = required(actors.find((a) => a.color === 'white')).actorId;
      const blue = required(actors.find((a) => a.color === 'blue')).actorId;
      const actor = (id: ActorId) =>
        required(core.read().actors.find((a) => a.actorId === id));
      const pose = (id: ActorId) =>
        required(frame.spatial.actors.find((a) => a.actorId === id));
      const envelope = (actorId: ActorId) => ({
        runId: context.runId,
        actorId,
        input: {
          sequence: ++sequence,
          commandId: commandId(`${context.runId}:${sequence}`),
        },
      });
      const render = (output: CoreOutput) => {
        frame = {
          ...output,
          spatial: scene.commit(output, viewport),
          viewport,
        };
        animator.render(frame);
        scene.render(frame);
        events.push(...output.events);
      };
      let attackStart: number | undefined,
        facing: { x: number; y: number; z: number } | undefined;
      let attackAnchor: { x: number; y: number; z: number } | undefined;
      let maximumRootErrorM = 0,
        maximumNativeRootErrorM = 0;
      let nativeReference: { rendered: Vector3; raw: Vector3 } | undefined;
      const nativeRootSamples: unknown[] = [];
      const recovery: unknown[] = [];
      const impact = required(entry.asset.definition.impacts[0]);
      const stepMs = 1000 / 60; // createGame's production default, recorded explicitly.
      const step = () => {
        const previous = frame;
        const previousPatch =
          attackStart !== undefined &&
          core.read().clocks.gameTimeMs - attackStart >=
            impact.startMs - stepMs &&
          core.read().clocks.gameTimeMs - attackStart <= impact.endMs
            ? displayedNativeKickPatch(required(rigs.get('white')).node, entry)
            : null;
        core.present(durationMs(stepMs));
        const request = core.beginStep({ durationMs: durationMs(stepMs) });
        for (const state of request.snapshot.actors)
          if (state.attack)
            expect(state.attack.clipId).toBe(entry.descriptor.clipId);
        const result = scene.step(request, catalog);
        const output = core.completeStep(result);
        render(output);
        const elapsed =
          attackStart === undefined
            ? undefined
            : core.read().clocks.gameTimeMs - attackStart;
        if (attackStart !== undefined && actor(white).attack) {
          facing ??= { ...pose(white).facing };
          expect(pose(white).facing).toEqual(facing);
          const root = required(
            catalog.sampleMotion(
              entry.descriptor.clipId,
              durationMs(0),
              durationMs(
                Math.min(required(elapsed), entry.asset.definition.durationMs),
              ),
            ),
          ).rootSegments.at(-1)?.to.position;
          if (root) expect(root).toEqual({ x: 0, y: 0, z: 0 });
          const rawKeys = entry.rawRootCurve;
          const localTime = Math.min(
            required(elapsed),
            entry.asset.definition.durationMs,
          );
          const right = rawKeys.findIndex((key) => key.atMs >= localTime);
          const b = required(rawKeys[right < 0 ? rawKeys.length - 1 : right]);
          const a = required(rawKeys[Math.max(0, right - 1)]);
          const t =
            a.atMs === b.atMs ? 0 : (localTime - a.atMs) / (b.atMs - a.atMs);
          const raw = new Vector3(
            a.position.x,
            a.position.y,
            a.position.z,
          ).lerp(new Vector3(b.position.x, b.position.y, b.position.z), t);
          const rendered = required(
            required(rigs.get('white')).node.getObjectByName('root'),
          ).position.clone();
          nativeReference ??= { rendered: rendered.clone(), raw: raw.clone() };
          const error = rendered
            .clone()
            .sub(nativeReference.rendered)
            .distanceTo(raw.clone().sub(nativeReference.raw));
          maximumNativeRootErrorM = Math.max(maximumNativeRootErrorM, error);
          nativeRootSamples.push({
            at: frame.snapshot.clocks.gameTimeMs,
            localTime,
            raw: raw.toArray(),
            rendered: rendered.toArray(),
            errorM: error,
          });
          if (root && attackAnchor)
            maximumRootErrorM = Math.max(
              maximumRootErrorM,
              Math.hypot(
                pose(white).position.x -
                  attackAnchor.x -
                  root.x * facing.z -
                  root.z * facing.x,
                pose(white).position.y - attackAnchor.y,
                pose(white).position.z -
                  attackAnchor.z +
                  root.x * facing.x -
                  root.z * facing.z,
              ),
            );
        }
        const currentPatch = previousPatch
          ? displayedNativeKickPatch(required(rigs.get('white')).node, entry)
          : null;
        if (currentPatch && elapsed !== undefined)
          samples.push({
            elapsedMs: elapsed,
            spatial: frame.spatial,
            attribution: patchAttribution(currentPatch, pose(blue).position),
          });
        for (const candidate of result.candidates) {
          if (candidate.kind === 'body-hit') {
            bodyCandidates.push(candidate);
            expect(candidate.source).toEqual(required(expectedSource));
            expect(candidate.targetActorId).toBe(blue);
            expect(candidate.at).toBeGreaterThanOrEqual(
              required(attackStart) + impact.startMs,
            );
            expect(candidate.at).toBeLessThan(
              required(attackStart) + impact.endMs,
            );
          }
          contacts.push({
            candidate,
            previousSpatial: previous.spatial,
            displayedSpatial: frame.spatial,
            displayGameTimeMs: frame.snapshot.clocks.gameTimeMs,
            previousDisplayAttribution: previousPatch
              ? patchAttribution(
                  previousPatch,
                  required(
                    previous.spatial.actors.find((a) => a.actorId === blue),
                  ).position,
                  candidate.point,
                )
              : null,
            currentDisplayAttribution: currentPatch
              ? patchAttribution(
                  currentPatch,
                  pose(blue).position,
                  candidate.point,
                )
              : null,
          });
        }
        for (const event of output.events) {
          if (event.type === 'AttackAccepted')
            expect(event.clipId).toBe(entry.descriptor.clipId);
          if (event.type === 'HpChanged')
            expect(
              result.candidates.some(
                (c: SpatialCandidate) =>
                  c.contactId === event.contact.contactId,
              ),
            ).toBe(true);
        }
      };
      const beginMove = (id: ActorId, x: number, z: number, label: string) => {
        const session = `${context.runId}:${label}`,
          basis = scene.beginMovementSession(session);
        const command = {
          ...envelope(id),
          type: 'MoveRequested' as const,
          x: x * basis.right.x + z * basis.right.z,
          z: x * basis.depth.x + z * basis.depth.z,
          movementSessionId: session,
          basisRevision: basis.revision,
        };
        commands.push({
          at: core.read().clocks.gameTimeMs,
          command,
          issuedBasis: basis,
        });
        core.handleInputBatch({
          runId: context.runId,
          tick: tick(core.read().clocks.tick + 1),
          commands: [command],
        });
        return session;
      };
      const release = (session: string) => {
        const command = {
          type: 'MovementSessionEnded',
          runId: context.runId,
          sessionId: session,
        } as const;
        commands.push({ at: core.read().clocks.gameTimeMs, command });
        core.handle(command);
        scene.endMovementSession(session, 'released');
      };
      try {
        scene.commit(core.drain(), viewport);
        await catalog.prepare(new AbortController().signal);
        required(scene.poseProtocol).bindPreparedCatalog(
          required(catalog.pose),
        );
        expect(animator.poseProtocol?.protocol).toBe('deterministic-pose-v1');
        core.handle({ type: 'AssetsReady', runId: context.runId });
        core.handle({ type: 'StartRequested', runId: context.runId });
        render(core.drain());
        const approach = beginMove(white, 0, 0.75, 'approach');
        for (
          let i = 0;
          i < 400 &&
          pose(blue).position.z - pose(white).position.z > scenario.separation;
          i++
        )
          step();
        release(approach);
        step();
        expect(
          pose(blue).position.z - pose(white).position.z,
        ).toBeLessThanOrEqual(scenario.separation);
        attackAnchor = { ...pose(white).position };
        const attack = {
          ...envelope(white),
          type: 'AttackRequested' as const,
          category: 'kick' as const,
        };
        core.handleInputBatch({
          runId: context.runId,
          tick: tick(core.read().clocks.tick + 1),
          commands: [attack],
        });
        const acceptedAttack = required(actor(white).attack);
        attackStart = acceptedAttack.startedAt;
        expectedSource = Object.freeze({
          actorId: white,
          activationId: acceptedAttack.activationId,
          impactId: required(
            acceptedAttack.impactBindings.find(
              (binding) => binding.impactIndex === impact.impactIndex,
            ),
          ).impactId,
        });
        commands.push({ at: attackStart, command: attack });
        let targetSession: string | undefined,
          targetStarted = Infinity,
          targetReleased = false;
        let attackStep = 0,
          targetStartStep = -1;
        while (
          core.read().clocks.gameTimeMs - attackStart <=
          entry.asset.definition.durationMs + stepMs
        ) {
          const elapsed = core.read().clocks.gameTimeMs - attackStart;
          if (
            (scenario.targetX || scenario.targetZ) &&
            !targetSession &&
            (scenario.startStep === undefined
              ? elapsed >= impact.startMs - 150
              : attackStep >= scenario.startStep)
          ) {
            targetSession = beginMove(
              blue,
              scenario.targetX,
              scenario.targetZ ?? 0,
              'post-activation-target',
            );
            targetStarted = elapsed;
            targetStartStep = attackStep;
          }
          if (
            targetSession &&
            !targetReleased &&
            (scenario.durationSteps === undefined
              ? elapsed >= targetStarted + 200
              : attackStep - targetStartStep >= scenario.durationSteps)
          ) {
            release(targetSession);
            targetReleased = true;
          }
          step();
          attackStep++;
        }
        if (targetSession && !targetReleased) release(targetSession);
        expect(maximumRootErrorM).toBeLessThan(1e-10);
        expect(maximumNativeRootErrorM).toBeLessThan(1e-10);
        expect(nativeRootSamples.length).toBeGreaterThan(1);
        expect(actor(white).attack).toBeNull();
        const beforeJump = pose(white).position.y;
        const jump = { ...envelope(white), type: 'JumpRequested' as const };
        core.handleInputBatch({
          runId: context.runId,
          tick: tick(core.read().clocks.tick + 1),
          commands: [jump],
        });
        let maxJumpY = beforeJump;
        for (let i = 0; i < 120; i++) {
          step();
          maxJumpY = Math.max(maxJumpY, pose(white).position.y);
        }
        expect(maxJumpY).toBeGreaterThan(beforeJump + 1);
        expect(pose(white).grounded).toBe(true);
        expect(Math.abs(pose(white).position.y - beforeJump)).toBeLessThan(
          1e-10,
        );
        // Ordinary post-recovery boundary movement, not a new attack placement.
        const boundarySession = beginMove(
          white,
          1,
          0,
          'post-recovery-boundary',
        );
        const boundaryStart = { ...pose(white).position };
        for (let i = 0; i < 120; i++) {
          step();
          recovery.push({
            at: core.read().clocks.gameTimeMs,
            pose: pose(white),
          });
        }
        release(boundarySession);
        const stopped = { ...pose(white).position };
        expect(stopped.x).toBeGreaterThan(boundaryStart.x);
        expect(stopped.x).toBeLessThanOrEqual(
          createParisStreetLayout().bounds.max.x,
        );
        // Full free movement would cover8m; collision must limit this path.
        expect(stopped.x - boundaryStart.x).toBeLessThan(8);
        for (let i = 0; i < 5; i++) step();
        expect(pose(white).position).toEqual(stopped);
        const hpEvents = events.filter((e) => e.type === 'HpChanged');
        expect(hpEvents).toHaveLength(
          required(expectedHpEvents[entry.descriptor.clipId]?.[scenario.name]),
        );
        const acceptedEvents = events.filter(
          (e) => e.type === 'AttackAccepted',
        );
        expect(acceptedEvents).toHaveLength(1);
        expect(acceptedEvents[0]).toMatchObject({
          actorId: white,
          activationId: required(expectedSource).activationId,
          clipId: entry.descriptor.clipId,
        });
        if (hpEvents.length === 1) {
          expect(bodyCandidates.length).toBeGreaterThan(0);
          const hp = required(hpEvents[0]);
          expect(hp.actorId).toBe(blue);
          expect(hp.actualHpLost).toBeGreaterThan(0);
          expect(hp.cause).toEqual({
            kind: 'attack',
            ...required(expectedSource),
            category: 'kick',
          });
          expect(hp.contact.impacts).toContainEqual(required(expectedSource));
          const candidate = required(
            bodyCandidates.find((c) => c.contactId === hp.contact.contactId),
          );
          expect(candidate.source).toEqual(required(expectedSource));
          expect(candidate.targetActorId).toBe(blue);
        }
        expect([...rigs.keys()].sort()).toEqual(['blue', 'white']);
      } finally {
        reports.push({
          clipId: entry.descriptor.clipId,
          scenario,
          stepMs,
          attackStart,
          attackAnchor,
          facing,
          maximumRootErrorM,
          maximumNativeRootErrorM,
          nativeRootSamples,
          recovery,
          descriptor: entry.descriptor,
          finiteMeasurement: entry.finiteMeasurement,
          commands,
          contacts,
          samples,
          events,
          finalAuthority: core.read(),
          scope:
            'real public low-level path; unexecuted constructor placeholders; proxy HP is NOT source-contact acceptance',
        });
        animator.dispose();
        scene.dispose();
        catalog.dispose();
        core.dispose();
      }
      expect(disposed.sort()).toEqual(['blue', 'white']);
      rigs.clear();
    }, 30000);
