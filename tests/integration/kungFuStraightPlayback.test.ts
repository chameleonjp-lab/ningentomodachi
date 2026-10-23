/** DIAGNOSTIC ONLY: provisional kick-chain metadata, Core/C commands and B display.
 * Unexecuted synthetic constructor definitions satisfy the logical full roster.
 * Proxy HP is recorded, never accepted as source-accurate gameplay geometry. */
import { readFileSync, writeFileSync } from 'node:fs';
import { Group, type Object3D, Triangle, Vector3 } from 'three';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  type ActorRig,
  assertRootPolicyCompatibility,
  createActorAnimator,
  createMotionCatalog,
  createPinnedDerivedThreeAssetPack,
  type ThreeAssetPack,
} from '../../src/assets';
import {
  type ActorColor,
  type ActorId,
  type CommittedFrame,
  type CoreOutput,
  commandId,
  type DomainEvent,
  durationMs,
  type ImpactReference,
  runId,
  type SpatialActor,
  type SpatialCandidate,
  tick,
} from '../../src/contracts';
import { createCore, createRandom } from '../../src/core';
import { createParisStreetLayout, createSceneAdapter } from '../../src/scene';
import { stepCharacter } from '../../src/world/character-motor';
import {
  KUNG_FU_STRAIGHT_SOURCE_PINS,
  loadKungFuStraightDiagnostics,
} from '../../tools/assets/kungFuStraightDiagnostic';
import { fixtureCatalog } from '../core/fixtures/scenarios';
import { actor as fixtureActor, viewport } from '../world/fixtures';
import {
  deferredAssertions,
  diagnosticPatch,
  displayedBoundary,
  displayedKungFuStraightPatch,
  displayedWallVertices,
  distinctImpactSources,
  patchAttribution,
} from './fixtures/kungFuStraightAttribution';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Required diagnostic value unavailable');
  return value;
}
const entries = loadKungFuStraightDiagnostics({
  sourceBytes: readFileSync(KUNG_FU_STRAIGHT_SOURCE_PINS.sourcePath),
  manifestBytes: readFileSync(KUNG_FU_STRAIGHT_SOURCE_PINS.manifestPath),
  recipeBytes: readFileSync(
    'tests/assets/fixtures/kungfu-straight-v1/recipe.json.fixture',
  ),
  candidateBytes: readFileSync(
    'tests/assets/fixtures/kungfu-straight-v1/candidate.json.fixture',
  ),
});
let pack: ThreeAssetPack;
const reports: unknown[] = [];
const allChecks: (() => void)[] = [];
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
  if (process.env.KUNG_FU_STRAIGHT_PLAYBACK_OUTPUT)
    writeFileSync(
      process.env.KUNG_FU_STRAIGHT_PLAYBACK_OUTPUT,
      JSON.stringify(
        {
          scope:
            'grounded-posture-y finite diagnostic proxy/source observations, NOT gameplay allowance or CCD',
          reports,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
  for (const assertion of allChecks) assertion();
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

// Frozen observed counts for these four fixed paths only; not anatomy acceptance.
test('finite display metric agrees with analytical face/intersection/vertex controls', () => {
  const triangle = new Triangle(
    new Vector3(-10, 2, -10),
    new Vector3(10, 2, -10),
    new Vector3(0, 2, 10),
  );
  const face = {
    primitive: 0,
    triangleIndex: 0,
    region: 'distal-hand-hypothesis' as const,
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
      const checks: (() => void)[] = [];
      const check = deferredAssertions(checks);
      allChecks.push(() => {
        for (const assertion of checks) assertion();
      });
      check(entry.rootPolicy.mode).toBe('grounded-posture-y');
      const context = {
        runId: runId(
          `kungfu-straight-playback:${entry.descriptor.clipId}:${scenario.name}`,
        ),
        seed: 1,
        posePolicy: {
          version: 1 as const,
          mode: 'deterministic-pose-v1' as const,
        },
      };
      const placeholders = fixtureCatalog();
      // Replace one placeholder per category, preserving production roster sizes.
      const replaced = entries.map((e) =>
        required(
          placeholders.catalog
            .list()
            .find((d) => d.category === e.asset.definition.category),
        ),
      );
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
        moves[color] = {
          punches: set.punches.map(mapId),
          kicks: set.kicks.map(mapId),
        };
      }
      // Keep all12 unique punches and19 kicks. Deterministic configuration ordering lets the
      // real seeded Core picker choose this diagnostic, without replacing RNG
      // or injecting an activation. No geometry/placement outcome is searched.
      const rosterKey = 'punches' as const;
      const whiteMoves = [...moves.white[rosterKey]];
      const selectedSlot = createRandom(context.seed).pick(
        whiteMoves.map((_, i) => i),
      );
      const fixtureSlot = whiteMoves.indexOf(entry.descriptor.clipId);
      if (fixtureSlot < 0)
        throw new Error('Real diagnostic absent from full roster');
      [whiteMoves[selectedSlot], whiteMoves[fixtureSlot]] = [
        required(whiteMoves[fixtureSlot]),
        required(whiteMoves[selectedSlot]),
      ];
      moves.white = { ...moves.white, [rosterKey]: whiteMoves };
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
            check(['white', 'blue']).toContain(color);
            check(rigs.has(color)).toBe(false);
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
      let expectedSources: ImpactReference[] = [];
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
      const boundaries: unknown[] = [];
      const recovery: unknown[] = [];
      const attributionFailures: unknown[] = [];
      const readPatch = (impactIndex: number) => {
        const result = diagnosticPatch(() =>
          displayedKungFuStraightPatch(
            required(rigs.get('white')).node,
            entry,
            impactIndex,
          ),
        );
        if (result.status === 'resolved') return result.faces;
        attributionFailures.push({
          at: core.read().clocks.gameTimeMs,
          clipId: entry.descriptor.clipId,
          sourcePins: KUNG_FU_STRAIGHT_SOURCE_PINS,
          impactIndex,
          ...result,
        });
        return null;
      };
      const impacts = entry.asset.definition.impacts;
      const impact = required(impacts[0]);
      check(impacts.map((i) => i.damageShare)).toEqual([1]);
      const eligibleSteps = impacts.map(() => 0);
      const stepMs = 1000 / 60; // createGame's production default, recorded explicitly.
      const step = () => {
        const previous = frame;
        const activeImpacts = impacts.filter(
          (i) =>
            attackStart !== undefined &&
            core.read().clocks.gameTimeMs - attackStart >= i.startMs - stepMs &&
            core.read().clocks.gameTimeMs - attackStart <= i.endMs,
        );
        const previousPatches = new Map(
          activeImpacts.map((i) => [i.impactIndex, readPatch(i.impactIndex)]),
        );
        for (const i of activeImpacts) eligibleSteps[i.impactIndex]!++;
        core.present(durationMs(stepMs));
        const request = core.beginStep({ durationMs: durationMs(stepMs) });
        for (const state of request.snapshot.actors)
          if (state.attack)
            check(state.attack.clipId).toBe(entry.descriptor.clipId);
        const result = scene.step(request, catalog);
        const output = core.completeStep(result);
        render(output);
        const elapsed =
          attackStart === undefined
            ? undefined
            : core.read().clocks.gameTimeMs - attackStart;
        if (attackStart !== undefined && actor(white).attack) {
          facing ??= { ...pose(white).facing };
          check(pose(white).facing).toEqual(facing);
          const root = required(
            catalog.sampleMotion(
              entry.descriptor.clipId,
              durationMs(0),
              durationMs(
                Math.min(required(elapsed), entry.asset.definition.durationMs),
              ),
            ),
          ).rootSegments.at(-1)?.to.position;
          if (root) check(root.y).toBe(0);
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
          nativeReference ??= {
            rendered: rendered.clone(),
            raw: raw.clone(),
          };
          const error = rendered
            .clone()
            .sub(nativeReference.rendered)
            .distanceTo(new Vector3(0, raw.y - nativeReference.raw.y, 0));
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
        if (
          attackStart !== undefined &&
          elapsed !== undefined &&
          elapsed >= entry.asset.definition.durationMs - 2 * stepMs &&
          elapsed <= entry.asset.definition.durationMs + 3 * stepMs
        ) {
          const rig = required(rigs.get('white')).node;
          rig.updateWorldMatrix(true, true);
          const joints = ['root', 'hips', 'footL', 'toeL', 'footR', 'toeR'].map(
            (name) => {
              const joint = rig.getObjectByName(name);
              return {
                name,
                present: !!joint,
                local: joint?.position.toArray(),
                world: joint?.getWorldPosition(new Vector3()).toArray(),
              };
            },
          );
          boundaries.push({
            elapsed,
            attack: actor(white).attack,
            spatial: pose(white),
            joints,
            envelopes: displayedBoundary(rig),
          });
        }
        const currentPatches = new Map(
          activeImpacts.map((i) => [i.impactIndex, readPatch(i.impactIndex)]),
        );
        for (const [impactIndex, patch] of currentPatches)
          if (patch && elapsed !== undefined)
            samples.push({
              elapsedMs: elapsed,
              impactIndex,
              spatial: frame.spatial,
              attribution: patchAttribution(patch, pose(blue).position),
            });
        for (const candidate of result.candidates) {
          const eventIndex =
            candidate.kind === 'body-hit'
              ? expectedSources.findIndex(
                  (s) => s.impactId === candidate.source.impactId,
                )
              : -1;
          const previousPatch = previousPatches.get(eventIndex);
          const currentPatch = currentPatches.get(eventIndex);
          if (candidate.kind === 'body-hit') {
            bodyCandidates.push(candidate);
            check(candidate.source).toEqual(
              required(expectedSources[eventIndex]),
            );
            check(candidate.targetActorId).toBe(blue);
            check(candidate.at).toBeGreaterThanOrEqual(
              required(attackStart) + required(impacts[eventIndex]).startMs,
            );
            check(candidate.at).toBeLessThan(
              required(attackStart) + required(impacts[eventIndex]).endMs,
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
            check(event.clipId).toBe(entry.descriptor.clipId);
          if (event.type === 'HpChanged')
            check(
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
        check(animator.poseProtocol?.protocol).toBe('deterministic-pose-v1');
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
        check(
          pose(blue).position.z - pose(white).position.z,
        ).toBeLessThanOrEqual(scenario.separation);
        attackAnchor = { ...pose(white).position };
        const attack = {
          ...envelope(white),
          type: 'AttackRequested' as const,
          category: entry.asset.definition.category,
        };
        core.handleInputBatch({
          runId: context.runId,
          tick: tick(core.read().clocks.tick + 1),
          commands: [attack],
        });
        const acceptedAttack = required(actor(white).attack);
        attackStart = acceptedAttack.startedAt;
        expectedSources = distinctImpactSources(
          white,
          acceptedAttack.activationId,
          acceptedAttack.impactBindings,
        );
        check(expectedSources).toHaveLength(1);
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
        check(maximumRootErrorM).toBeLessThan(1e-10);
        check(maximumNativeRootErrorM).toBeLessThan(1e-10);
        check(nativeRootSamples.length).toBeGreaterThan(1);
        check(actor(white).attack).toBeNull();
        const releasedAnchor = { ...pose(white).position };
        for (let i = 0; i < 5; i++) step();
        check(pose(white).position).toEqual(releasedAnchor);
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
        check(maxJumpY).toBeGreaterThan(beforeJump + 1);
        check(pose(white).grounded).toBe(true);
        check(Math.abs(pose(white).position.y - beforeJump)).toBeLessThan(
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
        check(stopped.x).toBeGreaterThan(boundaryStart.x);
        check(stopped.x).toBeLessThanOrEqual(
          createParisStreetLayout().bounds.max.x,
        );
        // Full free movement would cover8m; collision must limit this path.
        check(stopped.x - boundaryStart.x).toBeLessThan(8);
        for (let i = 0; i < 5; i++) step();
        check(pose(white).position).toEqual(stopped);
        const hpEvents = events.filter((e) => e.type === 'HpChanged');
        const hpByImpact = expectedSources.map((source) =>
          hpEvents.filter(
            (hp) =>
              hp.cause.kind === 'attack' &&
              hp.cause.impactId === source.impactId,
          ),
        );
        for (const perImpact of hpByImpact)
          check(perImpact.length).toBeLessThanOrEqual(1);
        check(hpByImpact.flat().length).toBe(hpEvents.length);
        check(eligibleSteps.every((count) => count > 0)).toBe(true);
        // Observation only: never tune placement, interval, shape or facing to fit HP.
        const acceptedEvents = events.filter(
          (e) => e.type === 'AttackAccepted',
        );
        check(acceptedEvents).toHaveLength(1);
        check(acceptedEvents[0]).toMatchObject({
          actorId: white,
          activationId: required(expectedSources[0]).activationId,
          clipId: entry.descriptor.clipId,
        });
        for (const hp of hpEvents) {
          check(bodyCandidates.length).toBeGreaterThan(0);
          const expectedSource = required(
            expectedSources.find(
              (s) =>
                hp.cause.kind === 'attack' && s.impactId === hp.cause.impactId,
            ),
          );
          check(hp.actorId).toBe(blue);
          check(hp.actualHpLost).toBeGreaterThan(0);
          check(hp.cause).toEqual({
            kind: 'attack',
            ...required(expectedSource),
            category: entry.asset.definition.category,
          });
          check(hp.contact.impacts).toContainEqual(required(expectedSource));
          const candidate = required(
            bodyCandidates.find((c) => c.contactId === hp.contact.contactId),
          );
          check(candidate.source).toEqual(expectedSource);
          check(candidate.targetActorId).toBe(blue);
        }
        check([...rigs.keys()].sort()).toEqual(['blue', 'white']);
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
          boundaries,
          recovery,
          attributionFailures,
          descriptor: entry.descriptor,
          windowStatus:
            'provisional-developer-phase-derived-F25-28-end-exclusive-F29',
          expectedSources,
          eligibleSteps,
          acceptance: null,
          gameplayAllowance: null,
          geometryWarning:
            'One finite diagnostic broadphase seed is unaccepted; display attribution is NOT event-time anatomy contact',
          sourcePins: KUNG_FU_STRAIGHT_SOURCE_PINS,
          rootPolicy: entry.rootPolicy,
          poseBinding: bindings.clips.find(
            (b) => b.clipId === entry.descriptor.clipId,
          ),
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
      check(disposed.sort()).toEqual(['blue', 'white']);
      rigs.clear();
    }, 30000);

// Fixed thin wall from adversarial.test.ts. Starting clearance is fixed analytically,
// not searched against candidate geometry. This is a C motor control, not public Core.
test('fixed thin-wall versus free-space source transport, release and next jump', async () => {
  const checks: (() => void)[] = [];
  allChecks.push(() => {
    for (const assertion of checks) assertion();
  });
  const check = deferredAssertions(checks);
  const entry = required(entries[0]);
  const catalog = createMotionCatalog(async () => entries.map((e) => e.asset), {
    poseBindings: () => required(pack.poseBindings),
  });
  const wall = {
    min: { x: -5, y: 0, z: 1.99 },
    max: { x: 5, y: 4, z: 2.01 },
  };
  const layout = { ...createParisStreetLayout(), objects: [], vehicles: [] };
  const zero = { x: 0, y: 0, z: 0 };
  const initial: SpatialActor = {
    actorId: fixtureActor('white').actorId,
    position: { x: 0, y: 0, z: 1.62 },
    velocity: zero,
    facing: { x: 0, y: 0, z: 1 },
    grounded: true,
    locomotion: 'idle',
  };
  const raw: unknown[] = [];
  try {
    await catalog.prepare(new AbortController().signal);
    for (const blocked of [false, true]) {
      let current = initial;
      const rig = pack.create('white');
      const parent = new Group();
      parent.add(rig.node);
      const display: unknown[] = [];
      const attackBinding = required(
        pack.poseBindings?.clips.find(
          (b) => b.clipId === entry.descriptor.clipId,
        ),
      );
      const idleBinding = required(
        pack.poseBindings?.clips.find(
          (b) => b.clipId === pack.poseBindings?.locomotion.idle,
        ),
      );
      const observe = (
        label: string,
        at: number,
        spatial: SpatialActor,
        idle = false,
      ) => {
        parent.position.set(
          spatial.position.x,
          spatial.position.y,
          spatial.position.z,
        );
        required(rig.seekPose).call(
          rig,
          idle ? idleBinding : attackBinding,
          durationMs(idle ? 0 : at),
        );
        parent.updateWorldMatrix(true, true);
        display.push({
          label,
          at,
          spatial,
          binding: idle ? idleBinding : attackBinding,
          rootLocal: rig.node.getObjectByName('root')?.position.toArray(),
          envelopes: displayedBoundary(rig.node),
          wallVertices: displayedWallVertices(rig.node, wall),
        });
      };
      observe('before', 0, initial);
      const samples: unknown[] = [];
      const end = entry.asset.definition.durationMs;
      for (let from = 0; from < end; from += 1000 / 60) {
        const to = Math.min(end, from + 1000 / 60);
        const sample = required(
          catalog.sampleMotion(
            entry.descriptor.clipId,
            durationMs(from),
            durationMs(to),
          ),
        );
        const result = stepCharacter(
          current,
          fixtureActor('white'),
          from,
          to,
          zero,
          false,
          sample,
          0,
          layout,
          blocked ? [wall] : [],
        );
        samples.push({ from, to, sample, before: current, result });
        current = result.actor;
        if (Math.abs(to - 600) < 1e-8)
          observe('fixed-600ms-contact-window', to, current);
      }
      const final = current;
      observe('exact-source-end', end, final);
      const released = stepCharacter(
        final,
        fixtureActor('white'),
        end,
        end + 100,
        zero,
        false,
        undefined,
        0,
        layout,
        [],
      ).actor;
      const jump = stepCharacter(
        released,
        fixtureActor('white'),
        end + 100,
        end + 200,
        zero,
        true,
        undefined,
        0,
        layout,
        [],
      ).actor;
      observe('released-Idle-zero', end + 100, released, true);
      raw.push({
        blocked,
        initial,
        wall,
        final,
        released,
        jump,
        samples,
        display,
      });
      rig.dispose();
      check(released.position).toEqual(final.position);
      check(jump.position.y).toBeGreaterThan(released.position.y);
      if (blocked) check(final.position.z).toBeLessThanOrEqual(1.640001);
      else {
        check(final.position.x - initial.position.x).toBeCloseTo(
          0.010000000707805157,
          9,
        );
        check(final.position.z - initial.position.z).toBeCloseTo(
          0.07300001382827759,
          9,
        );
      }
    }
  } finally {
    reports.push({
      scenario: 'fixed-C-thin-wall-control',
      sourcePins: KUNG_FU_STRAIGHT_SOURCE_PINS,
      scope: 'C motor transport only; no public Core or anatomy acceptance',
      raw,
    });
    catalog.dispose();
  }
}, 30000);
