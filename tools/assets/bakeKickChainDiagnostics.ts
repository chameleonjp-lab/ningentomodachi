/** Source-only four-event kick chain authoring. No target-dependent fit or HP qualification. */
import {
  AnimationMixer,
  Euler,
  LoopOnce,
  Mesh,
  Quaternion,
  SkinnedMesh,
  Vector3 as ThreeVector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeMotion } from '../../src/assets/bakeMotion';
import { extractedTranslation } from '../../src/assets/rootPolicy';
import { durationMs, type Vector3 } from '../../src/contracts';
import { clipContactTriangle } from './bakeGroundedKickDiagnostics';
import {
  KICK_CHAIN_SOURCE_PINS,
  type KickChainSourceInput,
  readKickChainSource,
  validateKickChainRecipe,
} from './kickChainDiagnostic';
import {
  clipBarycentricTriangle,
  fitSourceAxisCapsule,
  interpolateFace,
  positiveArea,
  type SourceBarycentric,
  stretchBound,
} from './sourceContactGeometry';

export { fitSourceAxisCapsule as fitKickChainCapsule } from './sourceContactGeometry';

export interface SourceKickChainTriangle {
  readonly positions: readonly Vector3[];
  readonly normals: readonly Vector3[];
  readonly footWeights: readonly number[];
  readonly toeWeights: readonly number[];
}
export type KickChainRegion =
  | 'heel-hypothesis'
  | 'sole-hypothesis'
  | 'left-outer-foot-edge-hypothesis';
export function kickChainRegions(index: number): readonly KickChainRegion[] {
  if (index === 0 || index === 1) return ['heel-hypothesis', 'sole-hypothesis'];
  if (index === 2) return ['left-outer-foot-edge-hypothesis'];
  if (index === 3) return ['heel-hypothesis'];
  throw new Error('Exactly four original event indices required');
}
export function clipKickChainTriangle(
  face: SourceKickChainTriangle,
  region: KickChainRegion,
  footOriginX: number,
): readonly SourceBarycentric[] {
  if (
    !Number.isFinite(footOriginX) ||
    [face.positions, face.normals, face.footWeights, face.toeWeights].some(
      (a) => a.length !== 3,
    ) ||
    [...face.positions, ...face.normals].some(
      (p) => ![p.x, p.y, p.z].every(Number.isFinite),
    ) ||
    [...face.footWeights, ...face.toeWeights].some(
      (w) => !Number.isFinite(w) || w < 0 || w > 1,
    )
  )
    throw new Error('Finite original face attributes required');
  if (region === 'heel-hypothesis' || region === 'sole-hypothesis')
    return clipContactTriangle(
      face,
      region === 'heel-hypothesis' ? 'heel' : 'sole',
    );
  if (region !== 'left-outer-foot-edge-hypothesis')
    throw new Error('Unknown chain region');
  const values = (fn: (i: number) => number): SourceBarycentric => [
    fn(0),
    fn(1),
    fn(2),
  ];
  return clipBarycentricTriangle([
    values((i) => (face.footWeights[i] ?? 0) + (face.toeWeights[i] ?? 0) - 0.5),
    values((i) => (face.positions[i]?.x ?? 0) - footOriginX - 0.04),
    values((i) => 0.115 - (face.positions[i]?.y ?? 0)),
    values((i) => (face.normals[i]?.x ?? 0) - 0.35),
  ]);
}

export interface KickChainPolygon {
  readonly primitive: number;
  readonly triangleIndex: number;
  readonly vertexIndices: readonly [number, number, number];
  readonly region: KickChainRegion;
  readonly jointIndex: number;
  readonly sourceJointName: string;
  readonly coverage: 'full' | 'clipped';
  readonly restoredLeadingRim: boolean;
  readonly barycentric: readonly SourceBarycentric[];
}
const plain = (v: ThreeVector3): Vector3 => ({ x: v.x, y: v.y, z: v.z });
const three = (v: Vector3) => new ThreeVector3(v.x, v.y, v.z);

/** Returns new diagnostic data only. Source bytes and existing candidates are immutable. */
export async function bakeKickChainDiagnostics(
  input: KickChainSourceInput & { readonly recipeBytes: Uint8Array },
) {
  validateKickChainRecipe(input.recipeBytes);
  const descriptors = [readKickChainSource(input)];
  const bytes = new Uint8Array(input.sourceBytes);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
  const mixer = new AnimationMixer(gltf.scene);
  const meshes: { mesh: SkinnedMesh; primitive: number }[] = [];
  const baseline: {
    node: import('three').Object3D;
    position: ThreeVector3;
    quaternion: Quaternion;
    scale: ThreeVector3;
  }[] = [];
  const cleanup = () => {
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
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
    for (const skeleton of skeletons) skeleton.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  };
  try {
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
      mixer.stopAllAction();
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
        const footIndex = event.side === 'L' ? 47 : 51,
          toeIndex = event.side === 'L' ? 48 : 52;
        const hand = sourceMesh.skeleton.bones[footIndex],
          handInverse = sourceMesh.skeleton.boneInverses[footIndex];
        if (
          !hand ||
          !handInverse ||
          hand.name !== `foot${event.side}` ||
          sourceMesh.skeleton.bones[toeIndex]?.name !== `toe${event.side}`
        )
          throw new Error('Exact sided foot/toe identity required');
        const footOriginX = new ThreeVector3().setFromMatrixPosition(
          handInverse.clone().invert(),
        ).x;
        const polygons: KickChainPolygon[] = [];
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
            index = geometry.index,
            position = geometry.getAttribute('position'),
            normal = geometry.getAttribute('normal'),
            joints = geometry.getAttribute('skinIndex'),
            weights = geometry.getAttribute('skinWeight');
          if (!index || !position || !normal || !joints || !weights)
            throw new Error('Incomplete original surface');
          for (const region of kickChainRegions(event.impactIndex)) {
            let full = 0,
              clipped = 0,
              rejected = 0,
              eligible = 0;
            const restDegenerateFaces: {
              triangleIndex: number;
              vertexIndices: readonly number[];
            }[] = [];
            for (let triangle = 0; triangle < index.count / 3; triangle++) {
              const ids: [number, number, number] = [
                index.getX(triangle * 3),
                index.getX(triangle * 3 + 1),
                index.getX(triangle * 3 + 2),
              ];
              const influence = (vertex: number, joint: number) => {
                let value = 0;
                for (let c = 0; c < 4; c++)
                  if (joints.getComponent(vertex, c) === joint)
                    value += weights.getComponent(vertex, c);
                return value;
              };
              const footWeights = ids.map((v) => influence(v, footIndex)),
                toeWeights = ids.map((v) => influence(v, toeIndex));
              if (
                ids.every(
                  (_, i) =>
                    (footWeights[i] ?? 0) +
                      (region === 'heel-hypothesis'
                        ? 0
                        : (toeWeights[i] ?? 0)) <
                    0.5,
                )
              )
                continue;
              eligible++;
              const original = ids.map((vertex) =>
                plain(new ThreeVector3().fromBufferAttribute(position, vertex)),
              );
              if (!positiveArea(original))
                restDegenerateFaces.push({
                  triangleIndex: triangle,
                  vertexIndices: ids,
                });
              const face = {
                positions: original,
                normals: ids.map((vertex) =>
                  plain(new ThreeVector3().fromBufferAttribute(normal, vertex)),
                ),
                footWeights,
                toeWeights,
              };
              const barycentric = clipKickChainTriangle(
                face,
                region,
                footOriginX,
              );
              if (
                !positiveArea(
                  barycentric.map((b) => interpolateFace(original, b)),
                )
              ) {
                rejected++;
                continue;
              }
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
                region,
                jointIndex: footIndex,
                sourceJointName: `foot.${event.side}`,
                coverage: complete ? 'full' : 'clipped',
                restoredLeadingRim: false,
                barycentric,
              });
            }
            coverage.push({
              primitive,
              region,
              footIndex,
              toeIndex,
              eligible,
              full,
              clipped,
              rejected,
              restDegenerateFaces,
              restoredLeadingRim: 0,
            });
          }
        }
        if (!polygons.length)
          throw new Error('Empty intended region; hold authoring, no fallback');
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
      const action = mixer.clipAction(clip).reset().setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.paused = true;
      action.play();
      const seek = (atMs: number) => {
        action.time = atMs / 1000;
        mixer.update(0);
        gltf.scene.updateMatrixWorld(true);
      };
      seek(0);
      const origin = root.getWorldPosition(new ThreeVector3());
      const times = new Set<number>([
        0,
        descriptor.durationMs,
        ...descriptor.sourceTimesSeconds.map((s) => s * 1000),
        ...descriptor.events.flatMap((event) => [
          event.window.startMs,
          event.window.endMs,
          event.window.peakMs,
        ]),
      ]);
      for (let i = 1; (i * 1000) / 240 < descriptor.durationMs; i++)
        times.add((i * 1000) / 240);
      const sampleTimes = [...times].sort((a, b) => a - b);
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
        const seed = fitSourceAxisCapsule(fitPoints);
        let finiteFitMaximumExcessM = -Infinity;
        for (const point of fitPoints) {
          const z = Math.max(seed.start.z, Math.min(seed.end.z, point.z));
          finiteFitMaximumExcessM = Math.max(
            finiteFitMaximumExcessM,
            Math.hypot(
              point.x - seed.start.x,
              point.y - seed.start.y,
              point.z - z,
            ) - seed.radiusM,
          );
        }
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
      const referenceMatrices: {
        atMs: number;
        impactIndex: number;
        elements: number[];
        stretchBound: number;
      }[] = [];
      const asset = bakeMotion(
        {
          clipId: descriptor.clipId,
          category: descriptor.category,
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
              referenceMatrices.push({
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
            end = three(before.volume.end).lerp(three(after.volume.end), alpha);
          const radius =
            before.volume.radiusM +
            (after.volume.radiusM - before.volume.radiusM) * alpha;
          const axis = end.clone().sub(start),
            lengthSquared = axis.lengthSq();
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
              point.distanceTo(start.clone().addScaledVector(axis, u)) - radius;
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
              Math.max(start.dot(metric.direction), end.dot(metric.direction)) +
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
        referenceMatrices,
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
      source: KICK_CHAIN_SOURCE_PINS,
      fitRule:
        'One fixed source-reference +Z capsule per event, XY midpoint and maximum radial extent over finite active source corners plus 1e-7m CPU arithmetic guard; shortest feasible segment. No interpolation padding or gameplay allowance.',
      regionRule:
        'Four source events: sided heel/sole, NEW left edge hypothesis, and right heel-only. No restoration or fallback; original clipped barycentrics and weights preserved.',
      results,
    };
  } finally {
    cleanup();
  }
}
