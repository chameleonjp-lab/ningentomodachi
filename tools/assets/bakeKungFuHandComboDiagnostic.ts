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
  clipSingleHandTriangle,
  type SourceHandContactTriangle,
} from './bakeSingleHandDiagnostics';
import { clipHandContactTriangle } from './bakeGroundedPunchDiagnostics';
import { clipElbowCrescentTriangle } from './bakeElbowCrescentDiagnostics';
import {
  KUNG_FU_HAND_COMBO_SOURCE_PINS,
  type KungFuHandComboSourceInput,
  readKungFuHandComboSources,
  validateKungFuHandComboRecipes,
} from './kungFuHandComboDiagnostic';
import {
  fitSourceSphere,
  interpolateFace,
  positiveArea,
  type SourceBarycentric,
  stretchBound,
} from './sourceContactGeometry';
export interface HandComboLifecycleReceipt {
  hasPrimaryFailure: boolean;
  primaryFailure?: unknown;
  cleanupFailures: unknown[];
}
export const createHandComboLifecycleReceipt = (): HandComboLifecycleReceipt => ({
  hasPrimaryFailure: false, cleanupFailures: [],
});
/** Preserve even primitive/undefined primary failures; caller retains secondary evidence. */
export async function runHandComboLifecycle<T>(
  body: () => Promise<T>,
  cleanup: readonly (() => void)[],
  receipt: HandComboLifecycleReceipt,
): Promise<T> {
  try {
    return await body();
  } catch (error) {
    receipt.hasPrimaryFailure = true;
    receipt.primaryFailure = error;
    throw error;
  } finally {
    for (const dispose of [...cleanup].reverse()) {
      try { dispose(); } catch (error) { receipt.cleanupFailures.push(error); }
    }
    if (!receipt.hasPrimaryFailure && receipt.cleanupFailures.length)
      throw new AggregateError(receipt.cleanupFailures, 'Hand combo cleanup failed');
  }
}
export function createHandComboCounter(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Finite nonnegative budget required');
  let used = 0;
  const charge = (count = 1) => {
    if (!Number.isSafeInteger(count) || count < 0 || used + count > limit)
      throw new Error('Hand combo pre-call budget exceeded');
    used += count;
  };
  return {
    get used() { return used; }, limit, charge,
    run<T>(action: () => T, count = 1): T { charge(count); return action(); },
  };
}
export type KungFuHandComboRegion =
  | 'distal-hand-hypothesis' | 'proximal-finger-hypothesis'
  | 'dorsal-hand-hypothesis' | 'palmar-heel-hypothesis'
  | 'posterior-elbow-band-hypothesis';
export function clipKungFuHandComboTriangle(face: SourceHandContactTriangle, region: KungFuHandComboRegion) {
  if (region === 'palmar-heel-hypothesis') return clipHandContactTriangle(face, 'palmar-heel');
  if (region === 'posterior-elbow-band-hypothesis') return clipElbowCrescentTriangle(face, region, 0);
  return clipSingleHandTriangle(face, region);
}
export function kungFuHandComboTimetable(descriptor: ReturnType<typeof readKungFuHandComboSources>[number]) {
  const bake = new Set<number>([0, ...descriptor.sourceTimesSeconds.map((s) => s * 1000)]);
  const measurement = new Set<number>();
  for (const event of descriptor.events) {
    for (let frame = event.peakFrame - 1; frame <= event.peakFrame + 1; frame++) {
      const x = descriptor.sourceTimesSeconds[frame - 1], y = descriptor.sourceTimesSeconds[frame];
      if (x === undefined || y === undefined) throw new Error('Missing frozen source cell');
      const a = x * 1000, b = y * 1000;
      for (const q of [1, 2, 3]) bake.add(a + ((b - a) * q) / 4);
      for (const q of [1, 3, 5, 7]) measurement.add(a + ((b - a) * q) / 8);
    }
  }
  for (let seconds = 1; seconds * 1000 < descriptor.durationMs; seconds++)
    if (!bake.has(seconds * 1000)) throw new Error('Base lattice would add an unbudgeted key');
  const bakeTimesMs = [...bake].sort((a,b) => a-b);
  const measurementOnlyTimesMs = [...measurement].filter((t) => !bake.has(t)).sort((a,b) => a-b);
  const sourceEvaluationTimesMs = [...new Set([...bakeTimesMs, ...measurementOnlyTimesMs])].sort((a,b) => a-b);
  if (bakeTimesMs.length !== 191 || measurementOnlyTimesMs.length !== 60 || sourceEvaluationTimesMs.length !== 251)
    throw new Error('Frozen candidate source budget mismatch');
  return { bakeTimesMs, measurementOnlyTimesMs, sourceEvaluationTimesMs };
}

export interface KungFuHandComboPolygon {
  readonly primitive: number;
  readonly triangleIndex: number;
  readonly vertexIndices: readonly [number, number, number];
  readonly region: KungFuHandComboRegion;
  readonly jointIndex: number;
  readonly sourceJointName: string;
  readonly coverage: 'full' | 'clipped';
  readonly restoredLeadingRim: boolean;
  readonly barycentric: readonly SourceBarycentric[];
}
const plain = (v: ThreeVector3): Vector3 => ({ x: v.x, y: v.y, z: v.z });
const three = (v: Vector3) => new ThreeVector3(v.x, v.y, v.z);

/** Returns new diagnostic data only. Source bytes and existing candidates are immutable. */
export async function bakeKungFuHandComboDiagnostic(
  input: KungFuHandComboSourceInput & { readonly recipeBytes: Uint8Array; readonly lifecycleReceipt: HandComboLifecycleReceipt },
) {
  if (!input.lifecycleReceipt || input.lifecycleReceipt.hasPrimaryFailure ||
      !Array.isArray(input.lifecycleReceipt.cleanupFailures) || input.lifecycleReceipt.cleanupFailures.length)
    throw new Error('Fresh caller-owned lifecycle receipt required before source allocation');
  validateKungFuHandComboRecipes(input.recipeBytes);
  const descriptors = readKungFuHandComboSources(input);
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
    const failures: unknown[] = [];
    try { mixer?.stopAllAction(); } catch (error) { failures.push(error); }
    try { mixer?.uncacheRoot(gltf.scene); } catch (error) { failures.push(error); }
    const geometries = new Set<import('three').BufferGeometry>();
    const materials = new Set<import('three').Material>();
    const skeletons = new Set<import('three').Skeleton>();
    gltf.scene.traverse((node) => {
      if (node instanceof Mesh) {
        geometries.add(node.geometry);
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          materials.add(material);
      }
      if (node instanceof SkinnedMesh) skeletons.add(node.skeleton);
    });
    for (const resource of [...skeletons, ...geometries, ...materials]) {
      try { resource.dispose(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Candidate source cleanup failed');
  };
  return runHandComboLifecycle(async () => {
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
        const elbow = event.boneName === 'forearm.R';
        const palm = event.intendedRegion === 'palmar-heel-hypothesis';
        const names = elbow || palm ? [event.boneName] : [
          event.boneName,
          ...[1,2,3,4].map((n) => `finger_${String(n).padStart(2, '0')}.01.${event.side}`),
        ];
        const handIndex = sourceMesh.skeleton.bones.findIndex((bone) => bone.name === event.boneName.replaceAll('.', ''));
        const hand = sourceMesh.skeleton.bones[handIndex], handInverse = sourceMesh.skeleton.boneInverses[handIndex];
        if (!hand || !handInverse || handIndex < 0) throw new Error('Exact source reference required');
        const elbowIndices = elbow ? ['upper_armR', 'forearmR'].map((name) => sourceMesh.skeleton.bones.findIndex((b) => b.name === name)) : [];
        if (elbowIndices.some((i) => i < 0)) throw new Error('Exact elbow influence identity required');
        const polygons: KungFuHandComboPolygon[] = [];
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
            const region: KungFuHandComboRegion = elbow ? 'posterior-elbow-band-hypothesis'
              : palm ? 'palmar-heel-hypothesis'
              : sourceJointName.startsWith('hand.')
                ? event.impactIndex === 2 ? 'dorsal-hand-hypothesis' : 'distal-hand-hypothesis'
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
                  if (elbow ? elbowIndices.includes(joints.getComponent(vertex, c)) : joints.getComponent(vertex, c) === jointIndex)
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
              const barycentric = clipKungFuHandComboTriangle(face, region);
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
      const timetable = kungFuHandComboTimetable(descriptor);
      const recipe = validateKungFuHandComboRecipes(input.recipeBytes)[0];
      if (!recipe || !recipe.timetable) throw new Error('Missing frozen recipe');
      const declared = recipe.timetable as { bakeTimesMs: number[]; measurementOnlyTimesMs: number[]; sourceEvaluationTimesMs: number[] };
      for (const key of ['bakeTimesMs', 'measurementOnlyTimesMs', 'sourceEvaluationTimesMs'] as const)
        if (JSON.stringify(declared[key]) !== JSON.stringify(timetable[key])) throw new Error('Frozen timetable recipe mismatch');
      // Cache exact evaluated local transforms, never synthesize a source pose.
      // Subsequent restores update matrices only; no AnimationMixer evaluation occurs.
      const poses = new Map<number, { position: ThreeVector3; quaternion: Quaternion; scale: ThreeVector3 }[]>();
      const sourceBudget = createHandComboCounter(251);
      for (const atMs of timetable.sourceEvaluationTimesMs) {
        if (poses.has(atMs) || sourceBudget.used >= 251) throw new Error('Candidate source budget exceeded');
        action.time = atMs / 1000;
        sourceBudget.run(() => activeMixer.update(0));
        poses.set(atMs, baseline.map(({node}) => ({ position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() })));
      }
      if (sourceBudget.used !== 251) throw new Error('Incomplete source timetable');
      const seek = (atMs: number) => {
        const pose = poses.get(atMs);
        if (!pose) throw new Error('Unbudgeted source pose request');
        baseline.forEach(({node}, i) => {
          const saved = pose[i];
          if (!saved) throw new Error('Incomplete source pose snapshot');
          node.position.copy(saved.position); node.quaternion.copy(saved.quaternion); node.scale.copy(saved.scale);
        });
        gltf.scene.updateMatrixWorld(true);
      };
      seek(0);
      const origin = root.getWorldPosition(new ThreeVector3());
      const sampleTimes = timetable.bakeTimesMs;
      const fitted = regions.map((region) => {
        const fitPoints: Vector3[] = [];
        for (const time of sampleTimes) {
          if (
            time < region.event.window.startMs ||
            time > region.event.window.endMs
          )
            continue;
          seek(time);
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
      seek(0);
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
          sampleRateHz: 1,
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
              verticalOwner: 'spatial-jump',
            },
          ],
        },
        (atMs) => {
          seek(atMs);
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
        for (const atMs of timetable.sourceEvaluationTimesMs)
          if (atMs >= region.event.window.startMs && atMs <= region.event.window.endMs) probes.add(atMs);
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
          seek(atMs);
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
        sourceEvaluationLedger: { sourcePacks: 1, mixerUpdates: sourceBudget.used, uniqueTimes: poses.size, cacheRestoresAreNotSourceEvaluation: true },
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
    return {
      schemaVersion: 1,
      status: 'DIAGNOSTIC_SOURCE_CANDIDATE_NOT_ACCEPTED' as const,
      source: KUNG_FU_HAND_COMBO_SOURCE_PINS,
      fitRule:
        'One source-reference AABB midpoint sphere per event, maximum distance over finite active source corners plus 1e-7m CPU arithmetic guard. No interpolation padding or gameplay allowance.',
      regionRule:
        'Fixed recipe hash binds five event-specific distal hand, finger rim, palm heel, dorsal hand and posterior elbow hypotheses. No whole-hand fallback; original clipped barycentrics and weights preserved.',
      results,
    };
  }, [cleanup], input.lifecycleReceipt);
}
