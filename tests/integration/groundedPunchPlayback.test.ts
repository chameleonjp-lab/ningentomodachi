/** DIAGNOSTIC ONLY: real selected punch metadata, Core/C commands and B display.
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
  GROUNDED_PUNCH_SOURCE_PINS,
  loadGroundedPunchDiagnostics,
} from '../../tools/assets/groundedPunchDiagnostic';
import { fixtureCatalog } from '../core/fixtures/scenarios';
import { viewport } from '../world/fixtures';
import {
  displayedPunchPatch,
  patchAttribution,
} from './fixtures/groundedPunchAttribution';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Required diagnostic value unavailable');
  return value;
}
const entries = loadGroundedPunchDiagnostics({
  sourceBytes: readFileSync(GROUNDED_PUNCH_SOURCE_PINS.sourcePath),
  manifestBytes: readFileSync(GROUNDED_PUNCH_SOURCE_PINS.manifestPath),
  recipeBytes: readFileSync(
    'tests/assets/fixtures/grounded-punches-v1/recipe.json.fixture',
  ),
  candidateBytes: readFileSync(
    'tests/assets/fixtures/grounded-punches-v1/candidate.json.fixture',
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
  if (process.env.GROUNDED_PUNCH_PLAYBACK_OUTPUT)
    writeFileSync(
      process.env.GROUNDED_PUNCH_PLAYBACK_OUTPUT,
      JSON.stringify(
        {
          scope:
            'finite diagnostic proxy/source observations, NOT gameplay allowance or CCD',
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

// Observed fixed diagnostic paths, preserved before these assertions were added.
// This locks regression outcomes, not source-accurate or production damage approval.
const expectedHpByImpact: Readonly<
  Record<string, Readonly<Record<string, readonly (0 | 1)[]>>>
> = {
  PunchCombo4: {
    near: [1, 1, 0, 0],
    far: [0, 0, 0, 0],
    'post-activation-left': [0, 0, 0, 0],
    'post-activation-right': [1, 0, 0, 0],
  },
  PalmStrike: {
    near: [1],
    far: [0],
    'post-activation-left': [1],
    'post-activation-right': [0],
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
    region: 'distal-hand' as const,
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
      const context = {
        runId: runId(
          `punch-playback:${entry.descriptor.clipId}:${scenario.name}`,
        ),
        seed: 1,
        posePolicy: {
          version: 1 as const,
          mode: 'deterministic-pose-v1' as const,
        },
      };
      const placeholders = fixtureCatalog();
      // Replace, rather than append to, two synthetic punch slots. Black still has
      // exactly19 distinct logical kicks; no synthetic slot may execute here.
      const replaced = placeholders.catalog
        .list()
        .filter((d) => d.category === 'punch')
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
        moves[color] = { punches: set.punches.map(mapId), kicks: set.kicks };
      }
      // Keep all12 unique punches and19 unique kicks. Deterministic configuration ordering lets the
      // real seeded Core picker choose this diagnostic, without replacing RNG
      // or injecting an activation. No geometry/placement outcome is searched.
      const whitePunches = [...moves.white.punches];
      const selectedSlot = createRandom(context.seed).pick(
        whitePunches.map((_, i) => i),
      );
      const fixtureSlot = whitePunches.indexOf(entry.descriptor.clipId);
      if (fixtureSlot < 0)
        throw new Error('Real punch absent from full roster');
      [whitePunches[selectedSlot], whitePunches[fixtureSlot]] = [
        required(whitePunches[fixtureSlot]),
        required(whitePunches[selectedSlot]),
      ];
      moves.white = { ...moves.white, punches: whitePunches };
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
      const expectedSources = new Map<number, ImpactReference>();
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
      let maximumRootErrorM = 0;
      const impact = required(entry.asset.definition.impacts[0]);
      const stepMs = 1000 / 60; // createGame's production default, recorded explicitly.
      const step = () => {
        const previous = frame;
        const previousPatches = new Map<
          number,
          ReturnType<typeof displayedPunchPatch>
        >();
        if (attackStart !== undefined) {
          const local = core.read().clocks.gameTimeMs - attackStart;
          for (const event of entry.asset.definition.impacts)
            if (local >= event.startMs - stepMs && local <= event.endMs)
              previousPatches.set(
                event.impactIndex,
                displayedPunchPatch(
                  required(rigs.get('white')).node,
                  entry,
                  event.impactIndex,
                ),
              );
        }
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
        const currentPatches = new Map<
          number,
          ReturnType<typeof displayedPunchPatch>
        >();
        for (const [impactIndex] of previousPatches) {
          const patch = displayedPunchPatch(
            required(rigs.get('white')).node,
            entry,
            impactIndex,
          );
          currentPatches.set(impactIndex, patch);
          samples.push({
            impactIndex,
            elapsedMs: elapsed,
            spatial: frame.spatial,
            attribution: patchAttribution(patch, pose(blue).position),
          });
        }
        for (const candidate of result.candidates) {
          if (candidate.kind !== 'body-hit') {
            contacts.push({
              candidate,
              previousSpatial: previous.spatial,
              displayedSpatial: frame.spatial,
            });
            continue;
          }
          bodyCandidates.push(candidate);
          const match = required(
            [...expectedSources].find(
              ([, source]) => source.impactId === candidate.source.impactId,
            ),
          );
          const [impactIndex, source] = match;
          const definition = required(
            entry.asset.definition.impacts.find(
              (item) => item.impactIndex === impactIndex,
            ),
          );
          expect(candidate.source).toEqual(source);
          expect(candidate.targetActorId).toBe(blue);
          expect(candidate.at).toBeGreaterThanOrEqual(
            required(attackStart) + definition.startMs,
          );
          expect(candidate.at).toBeLessThan(
            required(attackStart) + definition.endMs,
          );
          const previousPatch = required(previousPatches.get(impactIndex));
          const currentPatch = required(currentPatches.get(impactIndex));
          contacts.push({
            candidate,
            impactIndex,
            region: required(entry.regions[impactIndex]).event,
            previousSpatial: previous.spatial,
            displayedSpatial: frame.spatial,
            displayGameTimeMs: frame.snapshot.clocks.gameTimeMs,
            previousDisplayAttribution: patchAttribution(
              previousPatch,
              required(previous.spatial.actors.find((a) => a.actorId === blue))
                .position,
              candidate.point,
            ),
            currentDisplayAttribution: patchAttribution(
              currentPatch,
              pose(blue).position,
              candidate.point,
            ),
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
          category: 'punch' as const,
        };
        core.handleInputBatch({
          runId: context.runId,
          tick: tick(core.read().clocks.tick + 1),
          commands: [attack],
        });
        const acceptedAttack = required(actor(white).attack);
        attackStart = acceptedAttack.startedAt;
        expect(acceptedAttack.impactBindings).toHaveLength(
          entry.asset.definition.impacts.length,
        );
        for (const event of entry.asset.definition.impacts) {
          expect(event.damageShare).toBe(
            1 / entry.asset.definition.impacts.length,
          );
          expectedSources.set(
            event.impactIndex,
            Object.freeze({
              actorId: white,
              activationId: acceptedAttack.activationId,
              impactId: required(
                acceptedAttack.impactBindings.find(
                  (binding) => binding.impactIndex === event.impactIndex,
                ),
              ).impactId,
            }),
          );
        }
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
        const hpEvents = events.filter((e) => e.type === 'HpChanged');
        const acceptedEvents = events.filter(
          (e) => e.type === 'AttackAccepted',
        );
        expect(acceptedEvents).toHaveLength(1);
        expect(acceptedEvents[0]).toMatchObject({
          actorId: white,
          activationId: required(expectedSources.get(0)).activationId,
          clipId: entry.descriptor.clipId,
        });
        const expectedCounts = required(
          expectedHpByImpact[entry.descriptor.clipId]?.[scenario.name],
        );
        expect(expectedCounts).toHaveLength(expectedSources.size);
        expect(hpEvents).toHaveLength(
          expectedCounts.reduce<number>((total, count) => total + count, 0),
        );
        for (const [impactIndex, source] of expectedSources) {
          const hits = hpEvents.filter(
            (hp) =>
              hp.cause.kind === 'attack' &&
              hp.cause.impactId === source.impactId,
          );
          expect(hits).toHaveLength(required(expectedCounts[impactIndex]));
          expect(hits.length).toBeLessThanOrEqual(1);
          for (const hp of hits) {
            expect(hp.actorId).toBe(blue);
            expect(hp.actualHpLost).toBeGreaterThan(0);
            expect(hp.cause).toEqual({
              kind: 'attack',
              ...source,
              category: 'punch',
            });
            expect(hp.contact.impacts).toContainEqual(source);
            const candidate = required(
              bodyCandidates.find((c) => c.contactId === hp.contact.contactId),
            );
            expect(candidate.source).toEqual(source);
            expect(candidate.targetActorId).toBe(blue);
          }
          expect(required(entry.regions[impactIndex]).event.impactIndex).toBe(
            impactIndex,
          );
        }
        for (const hp of hpEvents)
          expect(
            [...expectedSources.values()].some(
              (source) =>
                hp.cause.kind === 'attack' &&
                hp.cause.impactId === source.impactId,
            ),
          ).toBe(true);
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
          descriptor: entry.descriptor,
          finiteMeasurement: entry.finiteMeasurement,
          commands,
          contacts,
          samples,
          events,
          expectedSources: [...expectedSources],
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
