/** Diagnostic actual-source qualification, NOT an accepted attack catalogue.
 * A-owned synthetic authority records isolate B/C presentation; real source root
 * curves drive C's actual motor. No source metadata WIP or production fallback. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { type Camera, type Object3D, SkinnedMesh, Vector3 } from 'three';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  type ActorRig,
  assertRootPolicyCompatibility,
  authorDeathClips,
  bakeMotion,
  createActorAnimator,
  createMotionCatalog,
  createSourceEvaluator,
  createThreeAssetPack,
  deathClipSeconds,
  inspectGlb,
  PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES,
  SOURCE_PALETTES,
  type ThreeAssetPack,
} from '../../src/assets';
import {
  type ActorColor,
  attackActivationId,
  type CommittedFrame,
  clipId,
  commandId,
  durationMs,
  type GameSnapshot,
  gameTimeMs,
  impactId,
  type MotionCatalogPort,
  presentationTimeMs,
} from '../../src/contracts';
import { createParisStreetLayout, createSceneAdapter } from '../../src/scene';
import { actor, run, state, viewport } from '../world/fixtures';
import {
  loadPinnedRepresentatives,
  PINNED_REPRESENTATIVE_SHA256,
  regeneratePinnedRepresentatives,
} from './fixtures/pinnedRepresentatives';
import { createRawSourceOracle } from './fixtures/rawSourceOracle';
import { exportWorldPose } from './fixtures/worldPoseExport';

const sources = new Map<string, Uint8Array>();
let pack: ThreeAssetPack;
let derivedBytes: Uint8Array;
let representatives: ReturnType<typeof loadPinnedRepresentatives>;
const reports: unknown[] = [];
function present<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null)
    throw new Error(`Missing ${label}`);
  return value;
}
beforeAll(async () => {
  const lock = JSON.parse(
    readFileSync('tools/assets/source-lock.json', 'utf8'),
  );
  for (const category of ['movement', 'jump', 'punch', 'kick']) {
    const path = `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`;
    const bytes = new Uint8Array(readFileSync(path));
    const receipt = lock.sources.find((s: { path: string }) => s.path === path);
    expect(bytes.length).toBe(receipt.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      receipt.sha256,
    );
    sources.set(category, bytes);
  }
  const original = await createThreeAssetPack([...sources.values()]);
  const seed = original.create('white');
  try {
    seed.seek(clipId('Idle'), 0);
    pack = await createThreeAssetPack(
      [...sources.values()],
      SOURCE_PALETTES,
      authorDeathClips(seed.node),
      PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES,
    );
    derivedBytes = process.env.DIAGNOSTIC_ARTIFACT_INPUT_FILE
      ? new Uint8Array(readFileSync(process.env.DIAGNOSTIC_ARTIFACT_INPUT_FILE))
      : await regeneratePinnedRepresentatives();
    representatives = loadPinnedRepresentatives(derivedBytes, pack);
    if (process.env.DIAGNOSTIC_ARTIFACT_OUTPUT_FILE)
      writeFileSync(process.env.DIAGNOSTIC_ARTIFACT_OUTPUT_FILE, derivedBytes, {
        flag: 'wx',
      });
  } finally {
    seed.dispose();
    original.dispose();
  }
}, 180000);
afterAll(() => {
  pack?.dispose();
  const output = process.env.QUALIFICATION_OUTPUT_FILE;
  if (output)
    writeFileSync(
      output,
      JSON.stringify(
        {
          runtime: process.version,
          cpu: cpus()[0]?.model,
          scope:
            'CPU geometry only; two hash-pinned provisional grounded clips, other clips unqualified authored-root diagnostics',
          derivedArtifactSha256: PINNED_REPRESENTATIVE_SHA256,
          reports,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
});
function surface(node: Object3D) {
  node.updateWorldMatrix(true, true);
  const p = new Vector3();
  let min = Infinity,
    max = -Infinity,
    vertices = 0;
  const boundsMin = new Vector3(Infinity, Infinity, Infinity),
    boundsMax = new Vector3(-Infinity, -Infinity, -Infinity);
  node.traverse((mesh) => {
    if (!(mesh instanceof SkinnedMesh)) return;
    mesh.skeleton.update();
    const count = mesh.geometry.getAttribute('position').count;
    vertices += count;
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
      min = Math.min(min, p.y);
      max = Math.max(max, p.y);
      boundsMin.min(p);
      boundsMax.max(p);
    }
  });
  return { min, max, vertices, bounds: { min: boundsMin, max: boundsMax } };
}
async function harness(category: string, name: string, color: ActorColor) {
  const bytes = present(sources.get(category), 'source category');
  const source = present(
    inspectGlb(bytes).clips.find((c) => c.name === name),
    'source clip',
  );
  const representative = representatives.find(
    (r) => r.candidate.definition.clipId === name,
  );
  const evaluator = representative
    ? undefined
    : await createSourceEvaluator(bytes, name, []);
  const layout = { ...createParisStreetLayout(), vehicles: [], objects: [] };
  const initial = actor(color);
  let snapshot = state(0, { actors: [initial] });
  let drawn = 0;
  let drawnCamera: Camera | undefined;
  const context = {
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
  };
  const scene = createSceneAdapter(context, {
    layout,
    onInterruption() {},
    createRenderer: () => ({
      domElement: new EventTarget() as HTMLCanvasElement,
      render(s, c) {
        drawn++;
        s.updateMatrixWorld(true);
        c.updateMatrixWorld(true);
        drawnCamera = c;
      },
      dispose() {},
      setPixelRatio() {},
      setSize() {},
    }),
  });
  const initialSpatial = scene.commit({ snapshot, events: [] }, viewport);
  let createdRig: ActorRig<Object3D> | undefined;
  const animation = createActorAnimator(
    { ...context, renderHost: scene.renderHost },
    {
      create(actorColor) {
        if (createdRig)
          throw new Error('Diagnostic expects exactly one real rig');
        createdRig = pack.create(actorColor);
        return createdRig;
      },
      clipDuration: (id) => pack.clipDuration(id),
      locomotionClips: {
        idle: clipId('Idle'),
        walk: clipId('Walk'),
        run: clipId('Run'),
        jump: clipId('Jump'),
      },
    },
  );
  // Actual B public adapter mounts/seeks/publishes; tests never synthesize pose support.
  animation.render({ snapshot, spatial: initialSpatial, events: [], viewport });
  const rig = present(createdRig, 'public animator rig');
  // Cross/Front use the complete hash-pinned real two-clip diagnostic catalog. Only other,
  // unqualified aerial diagnostics retain synthetic terminal-only geometry; no targets exist.
  const total = durationMs(source.durationSeconds * 1000);
  const motion =
    representative?.candidate ??
    bakeMotion(
      {
        clipId: clipId(name),
        category: category === 'punch' ? 'punch' : 'kick',
        durationMs: total,
        sampleRateHz: 120,
        sourceTimesMs: source.sampleTimes.map((t) => t * 1000),
        impacts: [
          {
            impactIndex: 0,
            startMs: durationMs(total - 0.001),
            endMs: total,
            damageShare: 1,
            shapeId: 'TEST-ONLY:inactive-diagnostic',
          },
        ],
        ownership: [
          {
            atMs: durationMs(0),
            horizontalOwner: 'authored-root',
            verticalOwner: 'authored-root',
          },
        ],
      },
      (time) => ({
        root: present(evaluator, 'unqualified diagnostic evaluator').sample(
          time,
        ).root,
        shapes: [
          {
            shapeId: 'TEST-ONLY:inactive-diagnostic',
            volume: {
              kind: 'sphere',
              center: { x: 0, y: 1, z: 0 },
              radiusM: 0.001,
            },
          },
        ],
      }),
    );
  const prepared = createMotionCatalog(async () => {
    if (!representative) return [motion];
    // Complete loaded set, never a per-clip compatibility shortcut or synthetic substitute.
    assertRootPolicyCompatibility(
      representatives.map((r) => ({
        asset: r.candidate,
        rootPolicy: r.rootPolicy,
      })),
      pack,
    );
    return representatives.map((r) => r.candidate);
  });
  await prepared.prepare(new AbortController().signal);
  let lastRoot = { x: 0, y: 0, z: 0 };
  const catalog: MotionCatalogPort = {
    ...prepared,
    sampleMotion(id, from, to) {
      const result = prepared.sampleMotion(id, from, to);
      const last = result?.rootSegments.at(-1);
      if (last) lastRoot = last.to.position;
      return result;
    },
  };
  let elapsed = 0,
    n = 0;
  let attackComplete = false,
    jumpRequested = false;
  function advance(to: number) {
    const delta = to - elapsed;
    n++;
    snapshot = state(n, {
      actors: [
        {
          ...initial,
          attack:
            category === 'jump' || attackComplete
              ? null
              : {
                  activationId: attackActivationId('diagnostic-only'),
                  clipId: clipId(name),
                  category: category === 'punch' ? 'punch' : 'kick',
                  startedAt: gameTimeMs(0),
                  consumedImpacts: [],
                  impactBindings: [
                    { impactIndex: 0, impactId: impactId('diagnostic-impact') },
                  ],
                },
        },
      ],
      clocks: {
        ...snapshot.clocks,
        tick: n as GameSnapshot['clocks']['tick'],
        gameTimeMs: gameTimeMs(to),
        presentationTimeMs: presentationTimeMs(to),
      },
    });
    scene.step(
      {
        snapshot,
        step: { durationMs: durationMs(delta) },
        intents:
          (category === 'jump' && elapsed === 0) || jumpRequested
            ? [
                {
                  type: 'JumpRequested',
                  runId: run,
                  actorId: initial.actorId,
                  input: {
                    sequence: 1,
                    commandId: commandId('qualification-jump'),
                  },
                },
              ]
            : [],
      },
      catalog,
    );
    if (category === 'jump')
      catalog.sampleMotion(clipId(name), durationMs(elapsed), durationMs(to));
    jumpRequested = false;
    elapsed = to;
    const spatial = scene.commit({ snapshot, events: [] }, viewport);
    const frame = { snapshot, spatial, events: [], viewport };
    animation.render(frame);
    scene.render(frame);
    return {
      physical: present(spatial.actors[0], 'spatial actor'),
      root: { ...lastRoot },
      surface: surface(rig.node),
    };
  }
  function advanceTo(to: number) {
    let result: ReturnType<typeof advance> | undefined;
    const keys = new Set([
      to,
      ...source.sampleTimes.map((s) => s * 1000).filter((t) => t > 0 && t < to),
    ]);
    for (let t = 1000 / 120; t < to; t += 1000 / 120) keys.add(t);
    for (const t of [...keys].sort((a, b) => a - b)) result = advance(t);
    if (!result) throw Error('No entry');
    return result;
  }
  return {
    rig,
    scene,
    animate: (frame: CommittedFrame) => animation.render(frame),
    advance,
    advanceTo,
    jumpAfterAttack(to: number) {
      attackComplete = true;
      jumpRequested = true;
      return advance(to);
    },
    source,
    get snapshot() {
      return snapshot;
    },
    get camera() {
      return present(drawnCamera, 'drawn camera');
    },
    get draws() {
      return drawn;
    },
    projectedBounds(bounds: ReturnType<typeof surface>['bounds']) {
      if (!drawnCamera) throw new Error('No scene draw');
      const points = [];
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z])
            points.push(new Vector3(x, y, z).project(drawnCamera));
      return {
        maxXY: Math.max(
          ...points.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]),
        ),
        minDepth: Math.min(...points.map((p) => p.z)),
        maxDepth: Math.max(...points.map((p) => p.z)),
      };
    },
    dispose() {
      animation.dispose();
      scene.dispose();
      prepared.dispose();
      evaluator?.dispose();
    },
  };
}
const entries = [
  ['kick', 'FrontKick', 0.55],
  ['kick', 'CartwheelKick', 0.9],
  ['kick', 'ChineseCartwheelKick', 1.04],
  ['kick', 'ButterflyKick', 0.94],
  ['punch', 'DivingLunge', 0.6611110925674438],
  ['jump', 'Jump', 0.4],
] as const;
for (const [sourceCategory, name, entry] of entries)
  for (const category of ['punch', 'kick'] as const)
    for (const color of ['white', 'blue'] as const)
      test(`${name}/${category}/${color}: actual source world support follows its entry-to-ground trajectory and stays framed`, async () => {
        const h = await harness(sourceCategory, name, color);
        try {
          const entered = h.advanceTo(entry * 1000);
          const death = {
            category,
            startedAt: presentationTimeMs(entry * 1000),
            slowDurationMs: durationMs(color === 'white' ? 2000 : 1500),
            playbackRate: 0.25 as const,
          };
          const authority: GameSnapshot = {
            ...h.snapshot,
            actors: h.snapshot.actors.map((a) => ({
              ...a,
              attack: null,
              defeated: true,
              hp: 0,
              defeatPresentation: death,
            })),
          };
          const rows: unknown[] = [];
          const costs: number[] = [];
          let worst = Infinity,
            peak = -Infinity,
            maxSupportErrorM = 0,
            maxProjectedXY = 0,
            minProjectedDepth = Infinity,
            maxProjectedDepth = -Infinity;
          const physical = entered.physical.position;
          for (let i = 0; i <= 120; i++) {
            const seconds = i / 240;
            const real =
              seconds <= death.slowDurationMs * 0.00025
                ? seconds * 4000
                : death.slowDurationMs +
                  (seconds - death.slowDurationMs * 0.00025) * 1000;
            const snapshot = {
              ...authority,
              clocks: {
                ...authority.clocks,
                presentationTimeMs: presentationTimeMs(death.startedAt + real),
              },
            };
            const spatial = h.scene.commit({ snapshot, events: [] }, viewport);
            const clock = deathClipSeconds(
              death,
              snapshot.clocks.presentationTimeMs,
            );
            const started = performance.now();
            const frame: CommittedFrame = {
              snapshot,
              spatial,
              events: [],
              viewport,
            };
            h.animate(frame);
            costs.push(performance.now() - started);
            const draws = h.draws;
            h.scene.render(frame);
            expect(h.draws).toBe(draws + 1);
            const measured = surface(h.rig.node);
            if (
              process.env.WORLD_POSE_EXPORT_DIRECTORY &&
              ['ChineseCartwheelKick', 'DivingLunge'].includes(name) &&
              [0, 24, 60, 90, 120].includes(i)
            )
              exportWorldPose(
                process.env.WORLD_POSE_EXPORT_DIRECTORY,
                `${name}-${category}-${color}-${i}`,
                h.rig.node,
                h.camera,
                {
                  sourceCategory,
                  name,
                  category,
                  color,
                  entry,
                  clipSeconds: clock,
                  presentationElapsedMs: real,
                  physical,
                  sourceRoot: entered.root,
                  initialSupportY: entered.surface.min,
                  measuredSupportY: measured.min,
                  viewport,
                  death,
                },
              );
            worst = Math.min(worst, measured.min);
            peak = Math.max(peak, measured.min);
            expect(
              present(spatial.actors[0], 'spatial actor').position,
            ).toEqual(physical);
            const presentationParent = present(
              h.rig.node.parent,
              'presentation parent',
            );
            expect(
              present(presentationParent.parent, 'physical parent').position.y,
            ).toBe(physical.y);
            const desiredSupport =
              entered.surface.min * (1 - clock / 0.5) + 0.002 * (clock / 0.5);
            maxSupportErrorM = Math.max(
              maxSupportErrorM,
              Math.abs(measured.min - desiredSupport),
            );
            const projected = h.projectedBounds(measured.bounds);
            maxProjectedXY = Math.max(maxProjectedXY, projected.maxXY);
            minProjectedDepth = Math.min(minProjectedDepth, projected.minDepth);
            maxProjectedDepth = Math.max(maxProjectedDepth, projected.maxDepth);
            rows.push({
              seconds: clock,
              presentationElapsed: real,
              ...measured,
              desiredSupport,
              projected,
              physicalY: physical.y,
              offsetY: presentationParent.position.y,
            });
          }
          const sorted = costs.slice(1).sort((a, b) => a - b);
          reports.push({
            kind: 'death-floor',
            publicAnimator: true,
            name,
            category,
            color,
            entry,
            sourceRoot: entered.root,
            physical,
            initial: entered.surface,
            worst,
            peak,
            maxSupportErrorM,
            maxProjectedXY,
            minProjectedDepth,
            maxProjectedDepth,
            publicAnimationCpuMs: {
              cold: costs[0],
              median: sorted[Math.floor(sorted.length * 0.5)],
              p95: sorted[Math.floor(sorted.length * 0.95)],
              max: Math.max(...sorted),
            },
            rows,
          });
          expect(
            worst,
            `initial ${entered.surface.min}, worst ${worst}`,
          ).toBeGreaterThanOrEqual(Math.min(0, entered.surface.min) - 0.003);
          expect
            .soft(
              maxSupportErrorM,
              'measured world support must follow the declared trajectory, not just avoid penetration',
            )
            .toBeLessThanOrEqual(0.00001);
          expect(
            maxProjectedXY,
            'all eight actual displayed bounds corners must remain framed',
          ).toBeLessThanOrEqual(1);
          expect(minProjectedDepth).toBeGreaterThanOrEqual(-1);
          expect(maxProjectedDepth).toBeLessThanOrEqual(1);
        } finally {
          h.dispose();
        }
      }, 120000);
for (const [category, name] of [
  ['punch', 'Cross'],
  ['kick', 'FrontKick'],
] as const)
  test(`${name}: live root extraction preserves authored vertical crouch independently of death`, async () => {
    const h = await harness(category, name, 'white');
    const oracle = await createRawSourceOracle(
      present(sources.get(category), 'source category'),
      name,
    );
    try {
      const rows: unknown[] = [];
      let maxError = 0,
        maxAnchorError = 0,
        allGrounded = true;
      const keys = new Set(
        h.source.sampleTimes.map((t) => t * 1000).filter((t) => t > 0),
      );
      for (
        let t = 1000 / 120;
        t < h.source.durationSeconds * 1000;
        t += 1000 / 120
      )
        keys.add(t);
      for (const time of [...keys].sort((a, b) => a - b)) {
        const a = h.advance(time);
        const comparison = oracle.compare(h.rig.node, time / 1000);
        const error = comparison.maxErrorM;
        maxError = Math.max(maxError, Math.abs(error));
        maxAnchorError = Math.max(
          maxAnchorError,
          Math.abs(a.physical.position.y),
        );
        allGrounded &&= a.physical.grounded;
        rows.push({
          time,
          rootY: a.root.y,
          physicalY: a.physical.position.y,
          actualWorldMin: a.surface.min,
          sourceExpectedWorldMin: comparison.expectedMinY,
          comparison,
          translationError: error,
        });
      }
      reports.push({
        kind: 'live-root',
        name,
        maxError,
        maxAnchorError,
        allGrounded,
        rows,
      });
      expect(
        maxError,
        'every runtime world vertex must match untouched original source pose with source translation applied once',
      ).toBeLessThanOrEqual(0.00001);
      expect(
        maxAnchorError,
        'retained posture must not move the physical anchor',
      ).toBeLessThanOrEqual(1e-12);
      expect(allGrounded).toBe(true);
    } finally {
      oracle.dispose();
      h.dispose();
    }
  }, 120000);

test('diagnostic loader rejects changed artifact bytes before consulting visuals', () => {
  const altered = new Uint8Array(derivedBytes);
  altered[0] = (altered[0] ?? 0) ^ 1;
  let queried = false;
  expect(() =>
    loadPinnedRepresentatives(altered, {
      rootPolicy() {
        queried = true;
        return undefined;
      },
    }),
  ).toThrow(/artifact hash/);
  expect(queried).toBe(false);
});
test('diagnostic loader refuses source/manifest substitutions and mixed visual policy', () => {
  expect(() =>
    loadPinnedRepresentatives(derivedBytes, pack, () => new Uint8Array([0])),
  ).toThrow(/binding mismatch/);
  expect(() =>
    loadPinnedRepresentatives(derivedBytes, {
      rootPolicy(id) {
        const policy = pack.rootPolicy(id);
        return policy ? { ...policy, mode: 'full-translation' } : undefined;
      },
    }),
  ).toThrow(/Incompatible visual\/baked root policy/);
});

for (const [category, name] of [
  ['punch', 'Cross'],
  ['kick', 'FrontKick'],
] as const)
  test(`${name}: retained posture leaves subsequent spatial jump and gravity intact`, async () => {
    const h = await harness(category, name, 'white');
    try {
      const end = h.source.durationSeconds * 1000;
      const standing = h.advanceTo(end);
      expect(standing.physical.grounded).toBe(true);
      expect(standing.physical.position.y).toBeCloseTo(0, 12);
      const jumped = h.jumpAfterAttack(end + 20);
      expect(jumped.physical.grounded).toBe(false);
      expect(jumped.physical.position.y).toBeGreaterThan(0);
      expect(jumped.physical.velocity.y).toBeGreaterThan(0);
      const rising = h.advance(end + 40);
      expect(rising.physical.position.y).toBeGreaterThan(
        jumped.physical.position.y,
      );
      expect(rising.physical.velocity.y).toBeLessThan(
        jumped.physical.velocity.y,
      );
      let landed = rising;
      for (let offset = 60; offset <= 2000; offset += 20)
        landed = h.advance(end + offset);
      expect(landed.physical.grounded).toBe(true);
      expect(landed.physical.position.y).toBeCloseTo(0, 12);
      expect(landed.physical.velocity.y).toBe(0);
    } finally {
      h.dispose();
    }
  }, 120000);

for (const color of ['white', 'blue'] as const)
  test(`CartwheelKick/${color}: skipped first death draw, paused frame and saved-frame replay retain the real entry`, async () => {
    const h = await harness('kick', 'CartwheelKick', color);
    try {
      const entry = h.advanceTo(900);
      const death = {
        category: 'kick' as const,
        startedAt: presentationTimeMs(900),
        slowDurationMs: durationMs(color === 'white' ? 2000 : 1500),
        playbackRate: 0.25 as const,
      };
      const authority: GameSnapshot = {
        ...h.snapshot,
        actors: h.snapshot.actors.map((a) => ({
          ...a,
          attack: null,
          defeated: true,
          hp: 0,
          defeatPresentation: death,
        })),
      };
      const makeFrame = (elapsed: number, paused = false): CommittedFrame => {
        const snapshot: GameSnapshot = {
          ...authority,
          phase: paused ? 'paused' : authority.phase,
          pauseReasons: paused ? ['manual'] : [],
          clocks: {
            ...authority.clocks,
            presentationTimeMs: presentationTimeMs(death.startedAt + elapsed),
          },
        };
        return {
          snapshot,
          spatial: h.scene.commit({ snapshot, events: [] }, viewport),
          events: [],
          viewport,
        };
      };
      const draw = (frame: CommittedFrame) => {
        const before = h.draws;
        h.animate(frame);
        h.scene.render(frame);
        expect(h.draws).toBe(before + 1);
        expect(frame.spatial.actors[0]?.position).toEqual(
          entry.physical.position,
        );
        const result = surface(h.rig.node);
        expect(h.projectedBounds(result.bounds).maxXY).toBeLessThanOrEqual(1);
        return result;
      };
      const middleFrame = makeFrame(1000);
      const middle = draw(middleFrame);
      expect.soft(middle.min).toBeCloseTo(entry.surface.min * 0.5 + 0.001, 5);
      const paused = draw(makeFrame(1000, true));
      for (const edge of ['min', 'max'] as const)
        for (const axis of ['x', 'y', 'z'] as const)
          expect(paused.bounds[edge][axis]).toBeCloseTo(
            middle.bounds[edge][axis],
            12,
          );
      const terminal = draw(makeFrame(color === 'white' ? 2000 : 1625));
      expect.soft(terminal.min).toBeCloseTo(0.002, 5);
      // Deliberately replay without rewinding C.commit: exact supplied frame must win.
      const replayed = draw(middleFrame);
      // Matrix multiplication can differ by one ULP after a backward seek. This sub-picometre
      // comparison is independent of the 10-micrometre world-trajectory acceptance bound.
      for (const edge of ['min', 'max'] as const)
        for (const axis of ['x', 'y', 'z'] as const)
          expect(replayed.bounds[edge][axis]).toBeCloseTo(
            middle.bounds[edge][axis],
            12,
          );
      reports.push({
        kind: 'public-animation-lifecycle',
        color,
        initial: entry.surface,
        middle,
        paused,
        terminal,
        replayed,
      });
    } finally {
      h.dispose();
    }
  }, 120000);
