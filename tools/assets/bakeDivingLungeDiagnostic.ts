/** Source-only hand-region authoring. No target-dependent fit or HP qualification. */
import {
  AnimationMixer,
  Euler,
  LoopOnce,
  Matrix3,
  Mesh,
  Quaternion,
  SkinnedMesh,
  Vector3 as ThreeVector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeMotion } from '../../src/assets/bakeMotion';
import { extractedTranslation } from '../../src/assets/rootPolicy';
import { durationMs, type Vector3 } from '../../src/contracts';
import {
  DIVING_LUNGE_SOURCE_PINS,
  type DivingLungeSourceInput,
  readDivingLungeSource,
  planDivingLungeTimetables,
} from './divingLungeDiagnostic';
import {
  fitSourceSphere,
  interpolateFace,
  positiveArea,
  type SourceBarycentric,
  stretchBound,
} from './sourceContactGeometry';

import { clipSingleHandTriangle, type SingleHandRegion } from './bakeSingleHandDiagnostics';
export const DIVING_LUNGE_STAGE_LIMITS = Object.freeze({ origin: 1, fit: 45, reset: 1, bake: 538, enclosure: 177 });
export const DIVING_LUNGE_STAGES = ['origin', 'fit', 'reset', 'bake', 'enclosure'] as const;
export type DivingLungeStage = typeof DIVING_LUNGE_STAGES[number];
export interface DivingLungeExecutionGate {
  readonly sourceExecutionReleased: true;
  readonly attemptedMixerCalls: 762;
  readonly uniqueBakeTimes: 538;
}
export function validateDivingLungeExecutionGate(gate: DivingLungeExecutionGate) {
  if (!gate || gate.sourceExecutionReleased !== true || gate.attemptedMixerCalls !== 762 || gate.uniqueBakeTimes !== 538)
    throw new Error('Separate exact source execution release required before allocation');
}
export interface DivingLungeLifecycleReceipt {
  hasPrimaryFailure: boolean;
  primaryFailure?: unknown;
  cleanupFailures: unknown[];
  attempts: { stage: DivingLungeStage; atMs: number }[];
}
export const createDivingLungeLifecycleReceipt = (): DivingLungeLifecycleReceipt => ({ hasPrimaryFailure: false, cleanupFailures: [], attempts: [] });
export function createDivingLungeCounter(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Finite nonnegative limit required');
  let used = 0;
  return { limit, get used() { return used; }, charge(count = 1) {
    if (!Number.isSafeInteger(count) || count < 0 || used + count > limit) throw new Error('Pre-call budget exceeded');
    used += count;
  } };
}
export function createDivingLungeStageBudgets() {
  return { origin: createDivingLungeCounter(1), fit: createDivingLungeCounter(45), reset: createDivingLungeCounter(1),
    bake: createDivingLungeCounter(538), enclosure: createDivingLungeCounter(177) };
}
export function runDivingLungeCleanupTasks(tasks: readonly (() => void)[], receipt: DivingLungeLifecycleReceipt) {
  for (const task of tasks) { try { task(); } catch (error) { receipt.cleanupFailures.push(error); } }
}
export async function runDivingLungeLifecycle<T>(body: () => Promise<T>, cleanup: () => void, receipt: DivingLungeLifecycleReceipt): Promise<T> {
  try { return await body(); }
  catch (error) { receipt.hasPrimaryFailure = true; receipt.primaryFailure = error; throw error; }
  finally {
    try { cleanup(); } catch (error) { receipt.cleanupFailures.push(error); }
    if (!receipt.hasPrimaryFailure && receipt.cleanupFailures.length) throw new AggregateError(receipt.cleanupFailures, 'DivingLunge cleanup failed');
  }
}
export function deriveDivingLungeRecipe(descriptor: ReturnType<typeof readDivingLungeSource> | undefined) {
  if (!descriptor || descriptor.clipId !== 'DivingLunge') throw new Error('Pinned DivingLunge descriptor required');
  return Object.freeze({ schemaVersion: 1, status: 'fixed-source-only-recipe-proposal', acceptance: null, gameplayAllowance: null,
    source: DIVING_LUNGE_SOURCE_PINS, sourceClipPointer: '/clips/6', sourceEventPointer: '/clips/6/attack_and_timeline_events/attack_events/0',
    region: 'distal-hand-proximal-finger-rim-hypothesis', side: 'R',
    rule: 'Existing clipSingleHandTriangle predicates: distal-hand and proximal-finger only; same .5 influence/.06 distal/.25 normal and proximal restored-rim rules; no dorsal or whole-hand fallback.',
    helperPath: 'tools/assets/bakeSingleHandDiagnostics.ts',
    helperSha256: '4038222788254ed4f33ad2f1ea1822af750a1f4e8b01644c78f52e1a4399207c',
    visualAcceptance: null, fittedProxyCopied: false, rootPolicy: descriptor.rootPolicy });
}

export function planDivingLungeCandidateCalls(descriptor: ReturnType<typeof readDivingLungeSource>) {
  const timetable = planDivingLungeTimetables(descriptor);
  const event = descriptor.events[0];
  if (!event) throw new Error('Required source event');
  const probes = new Set([event.window.startMs, event.window.peakMs, event.window.endMs]);
  for (let i = 0; i < timetable.candidateTimesMs.length; i++) {
    const a = timetable.candidateTimesMs[i], b = timetable.candidateTimesMs[i + 1];
    if (a === undefined) throw new Error('Missing candidate time');
    if (a >= event.window.startMs && a <= event.window.endMs) probes.add(a);
    if (b !== undefined) for (const fraction of [0.25, 0.5, 0.75]) {
      const t = a + (b - a) * fraction;
      if (t >= event.window.startMs && t <= event.window.endMs) probes.add(t);
    }
  }
  const enclosure = Object.freeze([...probes].sort((a,b) => a-b));
  if (enclosure.length !== 177) throw new Error('Frozen enclosure count mismatch');
  return Object.freeze({ origin: Object.freeze([0]), fit: timetable.activeFitTimesMs, reset: Object.freeze([0]),
    bake: timetable.candidateTimesMs, enclosure });
}
/** Reviewable playback schedule only; no source, pack or head preparation is invoked. */
export function planDivingLungeParity(descriptor: ReturnType<typeof readDivingLungeSource>) {
  const { parityTimesMs } = planDivingLungeTimetables(descriptor);
  return Object.freeze({ timesMs: parityTimesMs, sourceInitialization: 1, sourceSeeks: 171, sourceEscapeReproduction: 1,
    // Per pose: terminal poison, current pose, repeat current pose. Compared only after the sequence.
    publicSeekCalls: 513, publicMixerUpperBound: 1026,
    headPreparationClipLimit: 42, headQueries: 171,
    executionAuthorized: false, translatedParentTest: 'separate release required',
    productionOwnershipAcceptance: null });
}

export interface SingleHandPolygon {
  readonly primitive: number;
  readonly triangleIndex: number;
  readonly vertexIndices: readonly [number, number, number];
  readonly region: SingleHandRegion;
  readonly jointIndex: number;
  readonly sourceJointName: string;
  readonly coverage: 'full' | 'clipped';
  readonly restoredLeadingRim: boolean;
  readonly barycentric: readonly SourceBarycentric[];
}
const plain = (v: ThreeVector3): Vector3 => ({ x: v.x, y: v.y, z: v.z });
const three = (v: Vector3) => new ThreeVector3(v.x, v.y, v.z);

/** Returns new diagnostic data only. Source bytes and existing candidates are immutable. */
export async function bakeDivingLungeDiagnostic(
  input: DivingLungeSourceInput & { readonly gate: DivingLungeExecutionGate; readonly receipt: DivingLungeLifecycleReceipt },
) {
  validateDivingLungeExecutionGate(input.gate);
  if (input.receipt.hasPrimaryFailure || input.receipt.cleanupFailures.length || input.receipt.attempts.length)
    throw new Error('Fresh caller-owned receipt required');
  const descriptors = [readDivingLungeSource(input)];
  const budgets = createDivingLungeStageBudgets();
  const bytes = new Uint8Array(input.sourceBytes);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
  let mixer: AnimationMixer | undefined;
  const meshes: { mesh: SkinnedMesh; primitive: number }[] = [];
  const baseline: {
    node: import('three').Object3D;
    position: ThreeVector3;
    quaternion: Quaternion;
    scale: ThreeVector3;
  }[] = [];
  const cleanup = () => {
    const tasks: (() => void)[] = [
      () => { mixer?.stopAllAction(); },
      () => { mixer?.uncacheRoot(gltf.scene); },
    ];
    const resources = new Set<{ dispose(): void }>();
    // Resource discovery is isolated from stop and uncache failures.
    try {
      gltf.scene.traverse((node) => {
        if (node instanceof Mesh) {
          resources.add(node.geometry);
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) resources.add(material);
        }
        if (node instanceof SkinnedMesh) resources.add(node.skeleton);
      });
    } catch (error) { input.receipt.cleanupFailures.push(error); }
    for (const resource of resources) tasks.push(() => resource.dispose());
    runDivingLungeCleanupTasks(tasks, input.receipt);
  };
  return runDivingLungeLifecycle(async () => {
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
        const names = [
          `hand.${event.side}`,
          ...[1, 2, 3, 4].map(
            (n) => `finger_${String(n).padStart(2, '0')}.01.${event.side}`,
          ),
        ];
        const handIndex = 29;
        const hand = sourceMesh.skeleton.bones[handIndex],
          handInverse = sourceMesh.skeleton.boneInverses[handIndex];
        if (!hand || !handInverse || hand.name !== `hand${event.side}`)
          throw new Error('Exact source hand identity required');
        const polygons: SingleHandPolygon[] = [];
        const coverage = [];
        for (const { mesh, primitive } of meshes) {
          if (
            !mesh.bindMatrix.equals(sourceMesh.bindMatrix) ||
            !mesh.bindMatrixInverse.equals(sourceMesh.bindMatrixInverse) ||
            !mesh.matrixWorld.equals(sourceMesh.matrixWorld)
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
          for (const sourceJointName of names) {
            const matches = sourceMesh.skeleton.bones.flatMap((bone, i) =>
              bone.name === sourceJointName.replaceAll('.', '') ? [i] : [],
            );
            const jointIndex = matches[0],
              inverse =
                jointIndex === undefined
                  ? undefined
                  : sourceMesh.skeleton.boneInverses[jointIndex];
            if (matches.length !== 1 || jointIndex === undefined || !inverse)
              throw new Error('Exact source joint required');
            const normalMatrix = new Matrix3().getNormalMatrix(inverse);
            const region: SingleHandRegion = sourceJointName.startsWith('hand.')
              ? 'distal-hand-hypothesis'
              : 'proximal-finger-hypothesis';
            let full = 0,
              clipped = 0,
              restored = 0;
            for (let triangle = 0; triangle < index.count / 3; triangle++) {
              const ids: [number, number, number] = [
                index.getX(triangle * 3),
                index.getX(triangle * 3 + 1),
                index.getX(triangle * 3 + 2),
              ];
              const influence = ids.map((vertex) => {
                let value = 0;
                for (let c = 0; c < 4; c++)
                  if (joints.getComponent(vertex, c) === jointIndex)
                    value += weights.getComponent(vertex, c);
                return value;
              });
              if (influence.every((value) => value < 0.5)) continue;
              const original = ids.map((vertex) =>
                plain(new ThreeVector3().fromBufferAttribute(position, vertex)),
              );
              const face = {
                positions: original.map((point) =>
                  plain(three(point).applyMatrix4(inverse)),
                ),
                normals: ids.map((vertex) =>
                  plain(
                    new ThreeVector3()
                      .fromBufferAttribute(normal, vertex)
                      .applyMatrix3(normalMatrix),
                  ),
                ),
                weights: influence,
              };
              const barycentric = clipSingleHandTriangle(face, region);
              if (
                !positiveArea(
                  barycentric.map((b) => interpolateFace(original, b)),
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
              const restoredLeadingRim =
                region === 'proximal-finger-hypothesis' &&
                complete &&
                face.positions.some((p) => p.y > 0.02);
              if (complete) full++;
              else clipped++;
              if (restoredLeadingRim) restored++;
              polygons.push({
                primitive,
                triangleIndex: triangle,
                vertexIndices: ids,
                region,
                jointIndex,
                sourceJointName,
                coverage: complete ? 'full' : 'clipped',
                restoredLeadingRim,
                barycentric,
              });
            }
            coverage.push({
              primitive,
              sourceJointName,
              jointIndex,
              region,
              full,
              clipped,
              restoredLeadingRim: restored,
            });
          }
        }
        if (!polygons.length)
          throw new Error(
            'Empty intended hand region; point-only authoring required',
          );
        const reference = () =>
          sourceMesh.matrixWorld
            .clone()
            .multiply(sourceMesh.bindMatrixInverse)
            .multiply(hand.matrixWorld)
            .multiply(handInverse)
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
            return polygon.barycentric.map((b) => interpolateFace(vertices, b));
          });
        };
        return { event, polygons, coverage, reference, surface };
      });
      const clip = gltf.animations.find(
        (animation) => animation.name === descriptor.clipId,
      );
      if (!clip) throw new Error('Missing original clip');
      const action = activeMixer.clipAction(clip).reset().setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.paused = true;
      action.play();
      const callPlan = planDivingLungeCandidateCalls(descriptor);
      const seek = (atMs: number, stage: DivingLungeStage) => {
        if (callPlan[stage][budgets[stage].used] !== atMs) throw new Error('Unplanned source call before mixer');
        budgets[stage].charge();
        input.receipt.attempts.push({ stage, atMs });
        action.time = atMs / 1000;
        activeMixer.update(0);
        gltf.scene.updateMatrixWorld(true);
      };
      seek(0, 'origin');
      const origin = root.getWorldPosition(new ThreeVector3());
      const timetable = planDivingLungeTimetables(descriptor);
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
        const seed = fitSourceSphere(fitPoints);
        let finiteFitMaximumExcessM = -Infinity;
        for (const point of fitPoints)
          finiteFitMaximumExcessM = Math.max(
            finiteFitMaximumExcessM,
            three(point).distanceTo(three(seed.center)) - seed.radiusM,
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
      let previousYaw = new Euler().setFromQuaternion(
          root.getWorldQuaternion(new Quaternion()),
          'YXZ',
        ).y,
        yaw = 0;
      const rawRootCurve: {
        atMs: number;
        position: Vector3;
        visualYawRad: number;
      }[] = [];
      const handMatrices: {
        atMs: number;
        impactIndex: number;
        elements: number[];
        stretchBound: number;
      }[] = [];
      const asset = bakeMotion(
        {
          clipId: descriptor.clipId,
          category: 'punch',
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
          const currentYaw = new Euler().setFromQuaternion(
            root.getWorldQuaternion(new Quaternion()),
            'YXZ',
          ).y;
          let delta = currentYaw - previousYaw;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          yaw += delta;
          previousYaw = currentYaw;
          rawRootCurve.push({ atMs, position: plain(raw), visualYawRad: yaw });
          return {
            root: { position: transport, visualYawRad: yaw },
            shapes: fitted.map((region) => {
              const matrix = region.reference(),
                stretch = stretchBound(matrix);
              handMatrices.push({
                atMs,
                impactIndex: region.event.impactIndex,
                elements: [...matrix.elements],
                stretchBound: stretch,
              });
              return {
                shapeId: region.shapeId,
                volume: {
                  kind: 'sphere' as const,
                  center: plain(
                    three(region.seed.center)
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
            before.volume.kind !== 'sphere' ||
            after.volume.kind !== 'sphere'
          )
            throw new Error('Invalid diagnostic sphere sample');
          const alpha =
            before === after
              ? 0
              : (atMs - before.atMs) / (after.atMs - before.atMs);
          const center = three(before.volume.center).lerp(
              three(after.volume.center),
              alpha,
            ),
            radius =
              before.volume.radiusM +
              (after.volume.radiusM - before.volume.radiusM) * alpha;
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
            const excess = point.distanceTo(center) - radius;
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
              center.dot(metric.direction) + radius - surfaceSupport;
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
        handMatrices,
        asset,
        finiteMeasurement: measurements,
        acceptance: null,
        continuousContainment: null,
        regionVisualAcceptance: null,
        gameplayAllowance: null,
      });
    }
    for (const stage of DIVING_LUNGE_STAGES) {
      if (budgets[stage].used !== DIVING_LUNGE_STAGE_LIMITS[stage]) throw new Error('Incomplete frozen source call ledger');
    }
    return {
      recipe: deriveDivingLungeRecipe(descriptors[0]),
      schemaVersion: 1,
      status: 'DIAGNOSTIC_SOURCE_CANDIDATE_NOT_ACCEPTED' as const,
      source: DIVING_LUNGE_SOURCE_PINS,
      fitRule:
        'One source-reference AABB midpoint sphere per event, maximum distance over finite active source corners plus 1e-7m CPU arithmetic guard. No interpolation padding or gameplay allowance.',
      regionRule:
        'Existing distal-hand/proximal-finger-restored-rim hypothesis applied only to source right fist. No dorsal substitution, whole-hand fallback or anatomical acceptance; original clipped barycentrics and weights preserved.',
      results,
    };
  }, cleanup, input.receipt);
}
