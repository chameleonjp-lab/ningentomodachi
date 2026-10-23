/** Source-only sole-region authoring. No target-dependent fit or HP qualification. */
import {
  AnimationMixer,
  LoopOnce,
  Mesh,
  type Quaternion,
  SkinnedMesh,
  Vector3 as ThreeVector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeMotion } from '../../src/assets/bakeMotion';
import { extractedTranslation } from '../../src/assets/rootPolicy';
import { durationMs, type Vector3 } from '../../src/contracts';
import {
  FLYING_SOURCE_PINS,
  type FlyingSourceInput,
  readFlyingSource,
  planFlyingTimetables,
} from './flyingDiagnostic';
import {
  fitSourceAxisCapsule,
  interpolateFace,
  positiveArea,
  type SourceBarycentric,
  stretchBound,
} from './sourceContactGeometry';

import {
  clipContactTriangle,
  type SourceContactTriangle,
} from './bakeGroundedKickDiagnostics';
export const FLYING_STAGE_LIMITS = Object.freeze({
  origin: 1,
  fit: 51,
  reset: 1,
  bake: 493,
  enclosure: 201,
});
export const FLYING_STAGES = [
  'origin',
  'fit',
  'reset',
  'bake',
  'enclosure',
] as const;
export type FlyingStage = (typeof FLYING_STAGES)[number];
export interface FlyingExecutionGate {
  readonly sourceExecutionReleased: true;
  readonly attemptedMixerCalls: 747;
  readonly uniqueBakeTimes: 493;
}
export function validateFlyingExecutionGate(gate: FlyingExecutionGate) {
  if (
    gate?.sourceExecutionReleased !== true ||
    gate.attemptedMixerCalls !== 747 ||
    gate.uniqueBakeTimes !== 493
  )
    throw new Error(
      'Separate exact source execution release required before allocation',
    );
}
export interface FlyingLifecycleReceipt {
  hasPrimaryFailure: boolean;
  primaryFailure?: unknown;
  cleanupFailures: unknown[];
  attempts: { stage: FlyingStage; atMs: number }[];
}
export const createFlyingLifecycleReceipt = (): FlyingLifecycleReceipt => ({
  hasPrimaryFailure: false,
  cleanupFailures: [],
  attempts: [],
});
export function createFlyingCounter(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new Error('Finite nonnegative limit required');
  let used = 0;
  return {
    limit,
    get used() {
      return used;
    },
    charge(count = 1) {
      if (!Number.isSafeInteger(count) || count < 0 || used + count > limit)
        throw new Error('Pre-call budget exceeded');
      used += count;
    },
  };
}
export function createFlyingStageBudgets() {
  return {
    origin: createFlyingCounter(1),
    fit: createFlyingCounter(51),
    reset: createFlyingCounter(1),
    bake: createFlyingCounter(493),
    enclosure: createFlyingCounter(201),
  };
}
export function runFlyingCleanupTasks(
  tasks: readonly (() => void)[],
  receipt: FlyingLifecycleReceipt,
) {
  for (const task of tasks) {
    try {
      task();
    } catch (error) {
      receipt.cleanupFailures.push(error);
    }
  }
}
export async function runFlyingLifecycle<T>(
  body: () => Promise<T>,
  cleanup: () => void,
  receipt: FlyingLifecycleReceipt,
): Promise<T> {
  let outcome: { value: T } | undefined;
  try {
    outcome = { value: await body() };
  } catch (error) {
    receipt.hasPrimaryFailure = true;
    receipt.primaryFailure = error;
    throw error;
  } finally {
    try {
      cleanup();
    } catch (error) {
      receipt.cleanupFailures.push(error);
    }
  }
  if (!receipt.hasPrimaryFailure && receipt.cleanupFailures.length)
    throw new AggregateError(receipt.cleanupFailures, 'Flying cleanup failed');
  if (!outcome) throw new Error('Missing completed lifecycle result');
  return outcome.value;
}
export function deriveFlyingRecipe(
  descriptor: ReturnType<typeof readFlyingSource> | undefined,
) {
  if (descriptor?.clipId !== 'FlyingKick')
    throw new Error('Pinned Flying descriptor required');
  return Object.freeze({
    schemaVersion: 1,
    status: 'fixed-source-only-recipe-proposal',
    acceptance: null,
    gameplayAllowance: null,
    source: FLYING_SOURCE_PINS,
    sourceClipPointer: '/clips/14',
    sourceEventPointer: '/clips/14/attack_and_timeline_events/attack_events/0',
    region: 'sole-hypothesis',
    side: 'R',
    rule: 'Original sole only: combined foot/toe weight >= .5; bind y <= .035; original normal y <= -.35. Developer visual-inspection hypothesis, not source-authored sole; no union.',
    helperPath: descriptor.soleRegion.helperPath,
    helperSha256: descriptor.soleRegion.helperSha256,
    visualAcceptance: null,
    sourceAuthoredSubregion: false,
    inspectionProvenance: descriptor.soleRegion,
    fittedProxyCopied: false,
    regionUnion: false,
    rootPolicy: descriptor.rootPolicy,
  });
}

export function planFlyingCandidateCalls(
  descriptor: ReturnType<typeof readFlyingSource>,
) {
  const timetable = planFlyingTimetables(descriptor);
  const event = descriptor.events[0];
  if (!event) throw new Error('Required source event');
  const probes = new Set([
    event.window.startMs,
    event.window.peakMs,
    event.window.endMs,
  ]);
  for (let i = 0; i < timetable.candidateTimesMs.length; i++) {
    const a = timetable.candidateTimesMs[i],
      b = timetable.candidateTimesMs[i + 1];
    if (a === undefined) throw new Error('Missing candidate time');
    if (a >= event.window.startMs && a <= event.window.endMs) probes.add(a);
    if (b !== undefined)
      for (const fraction of [0.25, 0.5, 0.75]) {
        const t = a + (b - a) * fraction;
        if (t >= event.window.startMs && t <= event.window.endMs) probes.add(t);
      }
  }
  const enclosure = Object.freeze([...probes].sort((a, b) => a - b));
  if (enclosure.length !== 201)
    throw new Error('Frozen enclosure count mismatch');
  return Object.freeze({
    origin: Object.freeze([0]),
    fit: timetable.activeFitTimesMs,
    reset: Object.freeze([0]),
    bake: timetable.candidateTimesMs,
    enclosure,
  });
}
/** Reviewable playback schedule only; no source, pack or head preparation is invoked. */
export function planFlyingParity(
  descriptor: ReturnType<typeof readFlyingSource>,
) {
  const { parityTimesMs } = planFlyingTimetables(descriptor);
  return Object.freeze({
    timesMs: parityTimesMs,
    sourceInitialization: 1,
    sourceSeeks: 157,
    sourceEscapeReproduction: 1,
    // Per pose: terminal poison, current pose, repeat current pose. Compared only after the sequence.
    publicSeekCalls: 471,
    publicMixerUpperBound: 942,
    headPreparationClipLimit: 42,
    headQueries: 157,
    executionAuthorized: false,
    translatedParentTest: 'separate release required',
    productionOwnershipAcceptance: null,
  });
}

export interface SolePolygon {
  readonly primitive: number;
  readonly triangleIndex: number;
  readonly vertexIndices: readonly [number, number, number];
  readonly region: 'sole-hypothesis';
  readonly jointIndex: number;
  readonly sourceJointName: 'foot.R';
  readonly coverage: 'full' | 'clipped';
  readonly barycentric: readonly SourceBarycentric[];
}
export const selectFlyingSole = (face: SourceContactTriangle) =>
  clipContactTriangle(face, 'sole');
export function assertFlyingFinite(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Nonfinite returned numeric field');
  if (value && typeof value === 'object')
    for (const child of Object.values(value)) assertFlyingFinite(child);
}
/** Acquisition lives inside the primary-error boundary; cleanup ownership starts before use. */
export async function runFlyingOwnedSource<R, T>(
  acquire: () => Promise<R>,
  cleanup: (resource: R) => void,
  use: (resource: R) => Promise<T>,
  receipt: FlyingLifecycleReceipt,
): Promise<T> {
  let owned: { resource: R } | undefined;
  return runFlyingLifecycle(
    async () => {
      const resource = await acquire();
      owned = { resource };
      return use(resource);
    },
    () => {
      if (owned) cleanup(owned.resource);
    },
    receipt,
  );
}
export function createFlyingSeeker(
  descriptor: ReturnType<typeof readFlyingSource>,
  receipt: FlyingLifecycleReceipt,
  invoke: (atMs: number) => void,
  budgets = createFlyingStageBudgets(),
) {
  const plan = planFlyingCandidateCalls(descriptor);
  return (atMs: number, stage: FlyingStage) => {
    if (plan[stage][budgets[stage].used] !== atMs)
      throw new Error('Unplanned source call before mixer');
    budgets[stage].charge();
    receipt.attempts.push({ stage, atMs });
    invoke(atMs);
  };
}
/** Pure raw-quaternion observation. Roll stays separate from the catalog scalar yaw. */
export function createFlyingRotationObserver() {
  let previousYaw: number | undefined;
  let visualYawRad = 0;
  return (q: { x: number; y: number; z: number; w: number }) => {
    const { x, y, z, w } = q;
    if (
      ![x, y, z, w].every(Number.isFinite) ||
      Math.abs(2 * (y * z - x * w)) >= 0.9999999
    )
      throw new Error('Finite nonsingular native quaternion required');
    const yaw = Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y));
    if (previousYaw !== undefined) {
      let delta = yaw - previousYaw;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      visualYawRad += delta;
    }
    previousYaw = yaw;
    return { quaternion: { x, y, z, w }, visualYawRad };
  };
}
/** Shared actual bake seek body. Baseline initialization remains separately owned. */
export function createFlyingPoseWriter(
  scene: import('three').Object3D,
  mixer: AnimationMixer,
  action: import('three').AnimationAction,
  _baseline: readonly {
    node: import('three').Object3D;
    position: ThreeVector3;
    quaternion: Quaternion;
    scale: ThreeVector3;
  }[],
) {
  return (atMs: number) => {
    // Do not externally reset bound nodes: unchanged tracks may skip cached writes.
    action.time = atMs / 1000;
    mixer.update(0);
    scene.updateMatrixWorld(true);
  };
}
const plain = (v: ThreeVector3): Vector3 => ({ x: v.x, y: v.y, z: v.z });
const three = (v: Vector3) => new ThreeVector3(v.x, v.y, v.z);

/** Returns new diagnostic data only. Source bytes and existing candidates are immutable. */
export async function bakeFlyingDiagnostic(
  input: FlyingSourceInput & {
    readonly gate: FlyingExecutionGate;
    readonly receipt: FlyingLifecycleReceipt;
  },
) {
  validateFlyingExecutionGate(input.gate);
  if (
    input.receipt.hasPrimaryFailure ||
    input.receipt.cleanupFailures.length ||
    input.receipt.attempts.length
  )
    throw new Error('Fresh caller-owned receipt required');
  const descriptors = [readFlyingSource(input)];
  const budgets = createFlyingStageBudgets();
  const bytes = new Uint8Array(input.sourceBytes);
  let mixer: AnimationMixer | undefined;
  const meshes: { mesh: SkinnedMesh; primitive: number }[] = [];
  const baseline: {
    node: import('three').Object3D;
    position: ThreeVector3;
    quaternion: Quaternion;
    scale: ThreeVector3;
  }[] = [];
  const cleanup = (gltf: Awaited<ReturnType<GLTFLoader['parseAsync']>>) => {
    const tasks: (() => void)[] = [
      () => {
        mixer?.stopAllAction();
      },
      () => {
        mixer?.uncacheRoot(gltf.scene);
      },
    ];
    const resources = new Set<{ dispose(): void }>();
    // Resource discovery is isolated from stop and uncache failures.
    try {
      gltf.scene.traverse((node) => {
        if (node instanceof Mesh) {
          resources.add(node.geometry);
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material])
            resources.add(material);
        }
        if (node instanceof SkinnedMesh) resources.add(node.skeleton);
      });
    } catch (error) {
      input.receipt.cleanupFailures.push(error);
    }
    for (const resource of resources) tasks.push(() => resource.dispose());
    runFlyingCleanupTasks(tasks, input.receipt);
  };
  return runFlyingOwnedSource(
    () => new GLTFLoader().parseAsync(bytes.buffer, ''),
    cleanup,
    async (gltf) => {
      const activeMixer = new AnimationMixer(gltf.scene);
      mixer = activeMixer;
      gltf.scene.traverse((node) => {
        baseline.push({
          node,
          position: node.position.clone(),
          quaternion: node.quaternion.clone(),
          scale: node.scale.clone(),
        });
        if (node instanceof SkinnedMesh) {
          const association = gltf.parser.associations.get(node);
          if (association?.meshes !== 0 || association.primitives === undefined)
            throw new Error('Exact primitive provenance required');
          meshes.push({ mesh: node, primitive: association.primitives });
        }
      });
      const sourceMesh = meshes[0]?.mesh,
        root = gltf.scene.getObjectByName('root');
      if (!sourceMesh || !root) throw new Error('Original source rig required');
      const reset = () => {
        activeMixer.stopAllAction();
        for (const b of baseline) {
          b.node.position.copy(b.position);
          b.node.quaternion.copy(b.quaternion);
          b.node.scale.copy(b.scale);
        }
        gltf.scene.updateMatrixWorld(true);
      };
      const results = [];
      for (const descriptor of descriptors) {
        reset();
        const regions = descriptor.events.map((event) => {
          const footMatches = sourceMesh.skeleton.bones.flatMap((bone, i) =>
            bone.name === 'footR' ? [i] : [],
          );
          const toeMatches = sourceMesh.skeleton.bones.flatMap((bone, i) =>
            bone.name === 'toeR' ? [i] : [],
          );
          const footIndex = footMatches[0],
            toeIndex = toeMatches[0];
          if (
            footMatches.length !== 1 ||
            toeMatches.length !== 1 ||
            footIndex === undefined ||
            toeIndex === undefined
          )
            throw new Error('Exact source right foot/toe identities required');
          const foot = sourceMesh.skeleton.bones[footIndex],
            inverseBind = sourceMesh.skeleton.boneInverses[footIndex];
          if (!foot || !inverseBind)
            throw new Error('Exact source foot bind required');
          if (
            footIndex !== descriptor.soleRegion.footJoint ||
            toeIndex !== descriptor.soleRegion.toeJoint
          )
            throw new Error('Exact original foot/toe identities required');
          const polygons: SolePolygon[] = [];
          const coverage = [];
          for (const { mesh, primitive } of meshes) {
            if (
              !mesh.bindMatrix.equals(sourceMesh.bindMatrix) ||
              !mesh.bindMatrixInverse.equals(sourceMesh.bindMatrixInverse) ||
              !mesh.matrixWorld.equals(sourceMesh.matrixWorld) ||
              mesh.skeleton.bones[footIndex] !== foot
            )
              throw new Error(
                'Different source bind reference requires another recipe',
              );
            const geometry = mesh.geometry,
              index = geometry.index;
            const position = geometry.getAttribute('position'),
              normal = geometry.getAttribute('normal');
            const joints = geometry.getAttribute('skinIndex'),
              weights = geometry.getAttribute('skinWeight');
            if (!index || !position || !normal || !joints || !weights)
              throw new Error('Incomplete original surface');
            let full = 0,
              clipped = 0;
            for (let triangle = 0; triangle < index.count / 3; triangle++) {
              const ids: [number, number, number] = [
                index.getX(triangle * 3),
                index.getX(triangle * 3 + 1),
                index.getX(triangle * 3 + 2),
              ];
              const positions = ids.map((i) =>
                plain(new ThreeVector3().fromBufferAttribute(position, i)),
              );
              const normals = ids.map((i) =>
                plain(new ThreeVector3().fromBufferAttribute(normal, i)),
              );
              const influence = (vertex: number, joint: number) => {
                let sum = 0;
                for (let component = 0; component < 4; component++)
                  if (joints.getComponent(vertex, component) === joint)
                    sum += weights.getComponent(vertex, component);
                return sum;
              };
              const barycentric = selectFlyingSole({
                positions,
                normals,
                footWeights: ids.map((i) => influence(i, footIndex)),
                toeWeights: ids.map((i) => influence(i, toeIndex)),
              });
              if (
                !positiveArea(
                  barycentric.map((b) => interpolateFace(positions, b)),
                )
              )
                continue;
              const complete =
                barycentric.length === 3 &&
                barycentric.every(
                  (b) =>
                    b.some((v) => v === 1) &&
                    b.every((v) => v === 0 || v === 1),
                );
              if (complete) full++;
              else clipped++;
              polygons.push({
                primitive,
                triangleIndex: triangle,
                vertexIndices: ids,
                region: 'sole-hypothesis',
                jointIndex: footIndex,
                sourceJointName: 'foot.R',
                coverage: complete ? 'full' : 'clipped',
                barycentric,
              });
            }
            coverage.push({
              primitive,
              originalFaces: index.count / 3,
              full,
              clipped,
              region: 'sole-hypothesis',
            });
          }
          if (!polygons.length)
            throw new Error(
              'Empty original sole region; no fallback permitted',
            );
          const reference = () =>
            sourceMesh.matrixWorld
              .clone()
              .multiply(sourceMesh.bindMatrixInverse)
              .multiply(foot.matrixWorld)
              .multiply(inverseBind)
              .multiply(sourceMesh.bindMatrix);
          const surface = () => {
            const cache = new Map<string, Vector3>();
            return polygons.flatMap((polygon) => {
              const mesh = meshes.find(
                (m) => m.primitive === polygon.primitive,
              )?.mesh;
              if (!mesh) throw new Error('Lost original primitive');
              const vertices = polygon.vertexIndices.map((vertex) => {
                const key = `${polygon.primitive}:${vertex}`;
                let point = cache.get(key);
                if (!point) {
                  point = plain(
                    mesh
                      .getVertexPosition(vertex, new ThreeVector3())
                      .applyMatrix4(mesh.matrixWorld),
                  );
                  cache.set(key, point);
                }
                return point;
              });
              return polygon.barycentric.map((b) =>
                interpolateFace(vertices, b),
              );
            });
          };
          return { event, polygons, coverage, reference, surface };
        });
        const clip = gltf.animations.find(
          (animation) => animation.name === descriptor.clipId,
        );
        if (!clip) throw new Error('Missing original clip');
        const action = activeMixer
          .clipAction(clip)
          .reset()
          .setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
        action.paused = true;
        action.play();
        const seek = createFlyingSeeker(
          descriptor,
          input.receipt,
          createFlyingPoseWriter(gltf.scene, activeMixer, action, baseline),
          budgets,
        );
        seek(0, 'origin');
        const origin = root.getWorldPosition(new ThreeVector3());
        const timetable = planFlyingTimetables(descriptor);
        const sampleTimes = timetable.candidateTimesMs;
        const fitted = regions.map((region) => {
          const fitPoints: Vector3[] = [];
          for (const time of timetable.activeFitTimesMs) {
            if (
              time < region.event.window.startMs ||
              time > region.event.window.endMs
            )
              continue;
            seek(time, 'fit');
            const inverse = region.reference().invert();
            for (const point of region.surface())
              fitPoints.push(plain(three(point).applyMatrix4(inverse)));
          }
          const seed = fitSourceAxisCapsule(fitPoints);
          let finiteFitMaximumExcessM = -Infinity;
          for (const point of fitPoints)
            finiteFitMaximumExcessM = Math.max(
              finiteFitMaximumExcessM,
              Math.hypot(
                point.x - seed.start.x,
                point.y - seed.start.y,
                point.z - Math.max(seed.start.z, Math.min(seed.end.z, point.z)),
              ) - seed.radiusM,
            );
          return {
            ...region,
            seed,
            fitPointCount: fitPoints.length,
            finiteFitMaximumExcessM,
            shapeId: `${descriptor.clipId}:${region.event.intendedRegion}:${region.event.impactIndex}`,
          };
        });
        seek(0, 'reset');
        const observeRotation = createFlyingRotationObserver();
        const rawRootRotationCurve: {
          atMs: number;
          quaternion: { x: number; y: number; z: number; w: number };
          visualYawRad: number;
        }[] = [];
        const rawRootCurve: {
          atMs: number;
          position: Vector3;
          visualYawRad: number;
        }[] = [];
        const footMatrices: {
          atMs: number;
          impactIndex: number;
          elements: number[];
          stretchBound: number;
        }[] = [];
        const asset = bakeMotion(
          {
            clipId: descriptor.clipId,
            category: 'kick',
            durationMs: descriptor.durationMs,
            sampleRateHz: 240,
            sourceTimesMs: sampleTimes,
            impacts: fitted.map((region) => ({
              impactIndex: region.event.impactIndex,
              startMs: durationMs(region.event.window.startMs),
              endMs: durationMs(region.event.window.endMs),
              damageShare: 1 / fitted.length,
              shapeId: region.shapeId,
            })),
            ownership: [
              {
                atMs: durationMs(0),
                horizontalOwner: 'authored-root',
                verticalOwner: 'authored-root',
              },
            ],
          },
          (atMs) => {
            seek(atMs, 'bake');
            const raw = root.getWorldPosition(new ThreeVector3()).sub(origin),
              transport = extractedTranslation(raw, descriptor.rootPolicy);
            const rotation = observeRotation(root.quaternion);
            rawRootRotationCurve.push({ atMs, ...rotation });
            rawRootCurve.push({
              atMs,
              position: plain(raw),
              visualYawRad: rotation.visualYawRad,
            });
            return {
              root: {
                position: transport,
                visualYawRad: rotation.visualYawRad,
              },
              shapes: fitted.map((region) => {
                const matrix = region.reference(),
                  stretch = stretchBound(matrix);
                footMatrices.push({
                  atMs,
                  impactIndex: region.event.impactIndex,
                  elements: [...matrix.elements],
                  stretchBound: stretch,
                });
                return {
                  shapeId: region.shapeId,
                  volume: {
                    kind: 'capsule' as const,
                    start: plain(
                      three(region.seed.start)
                        .applyMatrix4(matrix)
                        .sub(three(transport)),
                    ),
                    end: plain(
                      three(region.seed.end)
                        .applyMatrix4(matrix)
                        .sub(three(transport)),
                    ),
                    radiusM: region.seed.radiusM * stretch,
                  },
                };
              }),
            };
          },
        );
        const measurements = fitted.map((region) => {
          const curve = asset.shapes.find(
            (shape) => shape.shapeId === region.shapeId,
          );
          if (!curve) throw new Error('Missing diagnostic curve');
          const probes = new Set<number>([
            region.event.window.startMs,
            region.event.window.endMs,
            region.event.window.peakMs,
          ]);
          for (let i = 0; i < curve.keys.length; i++) {
            const a = curve.keys[i],
              b = curve.keys[i + 1];
            if (!a) continue;
            if (
              a.atMs >= region.event.window.startMs &&
              a.atMs <= region.event.window.endMs
            )
              probes.add(a.atMs);
            if (b)
              for (const fraction of [0.25, 0.5, 0.75]) {
                const t = a.atMs + (b.atMs - a.atMs) * fraction;
                if (
                  t >= region.event.window.startMs &&
                  t <= region.event.window.endMs
                )
                  probes.add(t);
              }
          }
          let maximumFiniteSurfaceEscapeM = -Infinity,
            escapedAtMs = 0,
            testedCorners = 0;
          const directionalExcess = [
            { axis: '+X', direction: new ThreeVector3(1, 0, 0) },
            { axis: '-X', direction: new ThreeVector3(-1, 0, 0) },
            { axis: '+Y', direction: new ThreeVector3(0, 1, 0) },
            { axis: '-Y', direction: new ThreeVector3(0, -1, 0) },
            { axis: '+Z', direction: new ThreeVector3(0, 0, 1) },
            { axis: '-Z', direction: new ThreeVector3(0, 0, -1) },
          ].map((d) => ({ ...d, maximumM: -Infinity, atMs: 0 }));
          for (const atMs of [...probes].sort((a, b) => a - b)) {
            const before = curve.keys.filter((key) => key.atMs <= atMs).at(-1),
              after = curve.keys.find((key) => key.atMs >= atMs);
            if (
              !before ||
              !after ||
              before.volume.kind !== 'capsule' ||
              after.volume.kind !== 'capsule'
            )
              throw new Error('Invalid diagnostic capsule sample');
            const alpha =
              before === after
                ? 0
                : (atMs - before.atMs) / (after.atMs - before.atMs);
            const start = three(before.volume.start).lerp(
                three(after.volume.start),
                alpha,
              ),
              radius =
                before.volume.radiusM +
                (after.volume.radiusM - before.volume.radiusM) * alpha;
            const end = three(before.volume.end).lerp(
              three(after.volume.end),
              alpha,
            );
            const axis = end.clone().sub(start),
              lengthSquared = axis.lengthSq();
            seek(atMs, 'enclosure');
            const transport = extractedTranslation(
              root.getWorldPosition(new ThreeVector3()).sub(origin),
              descriptor.rootPolicy,
            );
            const points = region
              .surface()
              .map((point) => three(point).sub(three(transport)));
            testedCorners += points.length;
            for (const point of points) {
              const u =
                lengthSquared === 0
                  ? 0
                  : Math.max(
                      0,
                      Math.min(
                        1,
                        point.clone().sub(start).dot(axis) / lengthSquared,
                      ),
                    );
              const excess =
                point.distanceTo(start.clone().addScaledVector(axis, u)) -
                radius;
              if (excess > maximumFiniteSurfaceEscapeM) {
                maximumFiniteSurfaceEscapeM = excess;
                escapedAtMs = atMs;
              }
            }
            for (const metric of directionalExcess) {
              let surfaceSupport = -Infinity;
              for (const point of points)
                surfaceSupport = Math.max(
                  surfaceSupport,
                  point.dot(metric.direction),
                );
              const excess =
                Math.max(
                  start.dot(metric.direction),
                  end.dot(metric.direction),
                ) +
                radius -
                surfaceSupport;
              if (excess > metric.maximumM) {
                metric.maximumM = excess;
                metric.atMs = atMs;
              }
            }
          }
          return {
            impactIndex: region.event.impactIndex,
            shapeId: region.shapeId,
            probes: probes.size,
            testedCorners,
            maximumFiniteSurfaceEscapeM,
            escapedAtMs,
            directionalExcess: directionalExcess.map(
              ({ axis, maximumM, atMs }) => ({ axis, maximumM, atMs }),
            ),
            continuousClaim: false,
          };
        });
        results.push({
          descriptor,
          regions: fitted.map(
            ({
              event,
              polygons,
              coverage,
              seed,
              fitPointCount,
              finiteFitMaximumExcessM,
              shapeId,
            }) => ({
              event,
              polygons,
              coverage,
              seed,
              fitPointCount,
              finiteFitMaximumExcessM,
              shapeId,
            }),
          ),
          sampleTimes,
          rawRootCurve,
          rawRootRotationCurve,
          footMatrices,
          asset,
          finiteMeasurement: measurements,
          acceptance: null,
          continuousContainment: null,
          regionVisualAcceptance: null,
          gameplayAllowance: null,
        });
      }
      for (const stage of FLYING_STAGES) {
        if (budgets[stage].used !== FLYING_STAGE_LIMITS[stage])
          throw new Error('Incomplete frozen source call ledger');
      }
      return {
        recipe: deriveFlyingRecipe(descriptors[0]),
        schemaVersion: 1,
        status: 'DIAGNOSTIC_SOURCE_CANDIDATE_NOT_ACCEPTED' as const,
        source: FLYING_SOURCE_PINS,
        fitRule:
          'One fresh source-reference Z-axis capsule fitted to finite sole corners. No interpolation padding, target search or gameplay allowance.',
        regionRule:
          'Existing sole hypothesis applied to original right foot faces after finite visual inspection. Not source-authored sole, no union, fallback or anatomical acceptance; original clipped barycentrics preserved.',
        results,
      };
    },
    input.receipt,
  );
}
