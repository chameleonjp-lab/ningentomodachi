/** Deterministic offline source geometry operations, never target-driven fitting. */
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
import { durationMs, type Vector3 } from '../../src/contracts';
import { bakeMotion } from '../../src/assets/bakeMotion';
import { extractedTranslation } from '../../src/assets/rootPolicy';
import {
  GROUNDED_KICK_SOURCE_PINS,
  readGroundedKickSources,
  type GroundedKickSourceInput,
} from './groundedKickDiagnostic';

import {
  clipBarycentricTriangle,
  fitSourceAxisCapsule,
  interpolateFace,
  positiveArea,
  stretchBound,
  type SourceBarycentric,
} from './sourceContactGeometry';
export { fitSourceAxisCapsule, type SourceBarycentric } from './sourceContactGeometry';

export interface SourceContactTriangle {
  readonly positions: readonly Vector3[];
  readonly normals: readonly Vector3[];
  readonly footWeights: readonly number[];
  readonly toeWeights: readonly number[];
}
/** Clip the ORIGINAL face, not just its already-selected vertices. Numeric cuts
 * are developer-authored anatomy seeds; normal fields are source vertex normals,
 * not a claim that the smoothly interpolated field is a geometric face normal. */
export function clipContactTriangle(
  face: SourceContactTriangle,
  region: 'heel' | 'sole',
): readonly SourceBarycentric[] {
  if (
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
    throw new Error('Invalid original triangle attributes');
  const values = (fn: (index: number) => number): SourceBarycentric => [
    fn(0),
    fn(1),
    fn(2),
  ];
  const fields =
    region === 'heel'
      ? [
          values((i) => (face.footWeights[i] ?? 0) - 0.5),
          values((i) => -0.035 - (face.positions[i]?.z ?? 0)),
          values((i) => 0.12 - (face.positions[i]?.y ?? 0)),
          values((i) => -0.25 - (face.normals[i]?.z ?? 0)),
        ]
      : [
          values(
            (i) => (face.footWeights[i] ?? 0) + (face.toeWeights[i] ?? 0) - 0.5,
          ),
          values((i) => 0.035 - (face.positions[i]?.y ?? 0)),
          values((i) => -0.35 - (face.normals[i]?.y ?? 0)),
        ];
  return clipBarycentricTriangle(fields);
}

export interface GroundedContactPolygon {
  readonly primitive: number;
  readonly triangleIndex: number;
  readonly vertexIndices: readonly [number, number, number];
  readonly region: 'heel' | 'sole';
  readonly coverage: 'full' | 'clipped';
  readonly barycentric: readonly SourceBarycentric[];
}
const plain = (v: ThreeVector3): Vector3 => ({ x: v.x, y: v.y, z: v.z });
const three = (v: Vector3) => new ThreeVector3(v.x, v.y, v.z);
/** One source-only fit per clip, using exact keys plus a declared 240Hz finite grid.
 * No continuous certificate or gameplay acceptance is implied by this generator.
 * It returns data only; the caller must write NEW files and pin the final bytes. */
export async function bakeGroundedKickDiagnostics(
  input: GroundedKickSourceInput,
) {
  const descriptors = readGroundedKickSources(input);
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

    if (meshes.length !== 5)
      throw new Error('Expected exact five source primitives');
    meshes.sort((a, b) => a.primitive - b.primitive);
    const sourceMesh = meshes[0]?.mesh;
    const root = gltf.scene.getObjectByName('root');
    if (!sourceMesh || !root) throw new Error('Missing source rig');
    const results = [];
    for (const descriptor of descriptors) {
      mixer.stopAllAction();
      for (const b of baseline) {
        b.node.position.copy(b.position);
        b.node.quaternion.copy(b.quaternion);
        b.node.scale.copy(b.scale);
      }
      gltf.scene.updateMatrixWorld(true);
      const footIndex = descriptor.side === 'L' ? 47 : 51;
      const toeIndex = descriptor.side === 'L' ? 48 : 52;
      const foot = sourceMesh.skeleton.bones[footIndex];
      const toe = sourceMesh.skeleton.bones[toeIndex];
      const inverseBind = sourceMesh.skeleton.boneInverses[footIndex];
      if (
        !foot ||
        !toe ||
        !inverseBind ||
        foot.name !== `foot${descriptor.side}` ||
        toe.name !== `toe${descriptor.side}`
      )
        throw new Error('Exact source foot/toe joint identity mismatch');
      const polygons: GroundedContactPolygon[] = [];
      const coverage = [];
      for (const { mesh, primitive } of meshes) {
        if (
          !mesh.bindMatrix.equals(sourceMesh.bindMatrix) ||
          !mesh.bindMatrixInverse.equals(sourceMesh.bindMatrixInverse) ||
          !mesh.matrixWorld.equals(sourceMesh.matrixWorld)
        )
          throw new Error(
            'Different primitive bind reference requires another recipe',
          );
        const geometry = mesh.geometry,
          index = geometry.index;
        const position = geometry.getAttribute('position'),
          normal = geometry.getAttribute('normal');
        const joints = geometry.getAttribute('skinIndex'),
          weights = geometry.getAttribute('skinWeight');
        if (!index || !position || !normal || !joints || !weights)
          throw new Error('Incomplete source surface');
        let full = 0,
          clipped = 0,
          overlapFaces = 0,
          selectedFaces = 0;
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
          const face = {
            positions,
            normals,
            footWeights: ids.map((i) => influence(i, footIndex)),
            toeWeights: ids.map((i) => influence(i, toeIndex)),
          };
          let selectedRegions = 0;
          for (const region of ['heel', 'sole'] as const) {
            const barycentric = clipContactTriangle(face, region);
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
                  b.filter((w) => w === 1).length === 1 &&
                  b.every((w) => w === 0 || w === 1),
              );
            polygons.push({
              primitive,
              triangleIndex: triangle,
              vertexIndices: ids,
              region,
              coverage: complete ? 'full' : 'clipped',
              barycentric,
            });
            if (complete) full++;
            else clipped++;
            selectedRegions++;
          }
          if (selectedRegions) selectedFaces++;
          if (selectedRegions === 2) overlapFaces++;
        }
        coverage.push({
          primitive,
          originalFaces: index.count / 3,
          selectedFaces,
          fullRegionPolygons: full,
          clippedRegionPolygons: clipped,
          facesWithBothRegionPolygons: overlapFaces,
        });
      }
      if (
        !polygons.some((p) => p.region === 'heel') ||
        !polygons.some((p) => p.region === 'sole')
      )
        throw new Error('Empty source heel/sole region');
      const clip = gltf.animations.find((a) => a.name === descriptor.clipId);
      if (!clip) throw new Error('Missing original source animation');
      const action = mixer.clipAction(clip);
      action.reset().setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.paused = true;
      action.play();
      const seek = (ms: number) => {
        action.time = ms / 1000;
        mixer.update(0);
        gltf.scene.updateMatrixWorld(true);
      };
      seek(0);
      const origin = root.getWorldPosition(new ThreeVector3());
      const footReference = () =>
        sourceMesh.matrixWorld
          .clone()
          .multiply(sourceMesh.bindMatrixInverse)
          .multiply(foot.matrixWorld)
          .multiply(inverseBind)
          .multiply(sourceMesh.bindMatrix);
      const surfacePoints = () => {
        const cache = new Map<string, Vector3>();
        return polygons.flatMap((polygon) => {
          const mesh = meshes.find(
            (m) => m.primitive === polygon.primitive,
          )?.mesh;
          if (!mesh) throw new Error('Lost original primitive');
          const vertices = polygon.vertexIndices.map((index) => {
            const key = `${polygon.primitive}:${index}`;
            let point = cache.get(key);
            if (!point) {
              const v = mesh
                .getVertexPosition(index, new ThreeVector3())
                .applyMatrix4(mesh.matrixWorld);
              point = plain(v);
              cache.set(key, point);
            }
            return point;
          });
          return polygon.barycentric.map((b) => interpolateFace(vertices, b));
        });
      };
      const times = new Set([
        0,
        descriptor.durationMs,
        descriptor.window.startMs,
        descriptor.window.endMs,
        descriptor.window.peakMs,
        ...descriptor.sourceTimesSeconds.map((t) => t * 1000),
      ]);
      for (let i = 1; (i * 1000) / 240 < descriptor.durationMs; i++)
        times.add((i * 1000) / 240);
      const sampleTimes = [...times].sort((a, b) => a - b);
      const fitPoints: Vector3[] = [];
      for (const time of sampleTimes) {
        if (time < descriptor.window.startMs || time > descriptor.window.endMs)
          continue;
        seek(time);
        const inverse = footReference().invert();
        for (const point of surfacePoints())
          fitPoints.push(plain(three(point).applyMatrix4(inverse)));
      }
      const seed = fitSourceAxisCapsule(fitPoints);
      let finiteFitMaximumExcessM = -Infinity;
      for (const p of fitPoints) {
        const z = Math.max(seed.start.z, Math.min(seed.end.z, p.z));
        finiteFitMaximumExcessM = Math.max(
          finiteFitMaximumExcessM,
          Math.hypot(p.x - seed.start.x, p.y - seed.start.y, p.z - z) -
            seed.radiusM,
        );
      }
      seek(0);
      let previousYaw = new Euler().setFromQuaternion(
        root.getWorldQuaternion(new Quaternion()),
        'YXZ',
      ).y;
      let yaw = 0;
      const rawRootCurve: {
        atMs: number;
        position: Vector3;
        visualYawRad: number;
      }[] = [];
      const footMatrices: {
        atMs: number;
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
          impacts: [
            {
              impactIndex: 0,
              startMs: durationMs(descriptor.window.startMs),
              endMs: durationMs(descriptor.window.endMs),
              damageShare: 1,
              shapeId: `${descriptor.clipId}:heel-sole:0`,
            },
          ],
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
          const raw = root.getWorldPosition(new ThreeVector3()).sub(origin);
          const transport = extractedTranslation(raw, descriptor.rootPolicy);
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
          const matrix = footReference();
          const stretch = stretchBound(matrix);
          footMatrices.push({
            atMs,
            elements: [...matrix.elements],
            stretchBound: stretch,
          });
          return {
            root: { position: transport, visualYawRad: yaw },
            shapes: [
              {
                shapeId: `${descriptor.clipId}:heel-sole:0`,
                volume: {
                  kind: 'capsule',
                  start: plain(
                    three(seed.start)
                      .applyMatrix4(matrix)
                      .sub(three(transport)),
                  ),
                  end: plain(
                    three(seed.end).applyMatrix4(matrix).sub(three(transport)),
                  ),
                  radiusM: seed.radiusM * stretch,
                },
              },
            ],
          };
        },
      );
      const curve = asset.shapes[0];
      if (!curve) throw new Error('Missing candidate curve');
      const probes = new Set<number>();
      for (let i = 1; i < sampleTimes.length; i++) {
        const a = sampleTimes[i - 1],
          b = sampleTimes[i];
        if (
          a === undefined ||
          b === undefined ||
          a < descriptor.window.startMs ||
          b > descriptor.window.endMs
        )
          continue;
        for (const fraction of [0, 0.25, 0.5, 0.75, 1])
          probes.add(a + (b - a) * fraction);
      }
      const directions = [
        { name: '+X', vector: new ThreeVector3(1, 0, 0) },
        { name: '-X', vector: new ThreeVector3(-1, 0, 0) },
        { name: '+Y', vector: new ThreeVector3(0, 1, 0) },
        { name: '-Y', vector: new ThreeVector3(0, -1, 0) },
        { name: '+Z', vector: new ThreeVector3(0, 0, 1) },
        { name: '-Z', vector: new ThreeVector3(0, 0, -1) },
      ];
      const directionalExcess = directions.map((d) => ({
        direction: d.name,
        maximumM: -Infinity,
        atMs: 0,
      }));
      let maximumFiniteSurfaceEscapeM = -Infinity,
        escapedAtMs = 0,
        testedCorners = 0;
      for (const atMs of [...probes].sort((a, b) => a - b)) {
        seek(atMs);
        const transport = three(
          extractedTranslation(
            root.getWorldPosition(new ThreeVector3()).sub(origin),
            descriptor.rootPolicy,
          ),
        );
        const points = surfacePoints().map((p) => three(p).sub(transport));
        let right = curve.keys.findIndex((k) => k.atMs >= atMs);
        if (right < 0) right = curve.keys.length - 1;
        const b = curve.keys[right],
          a = curve.keys[Math.max(0, right - 1)];
        if (
          !a ||
          !b ||
          a.volume.kind !== 'capsule' ||
          b.volume.kind !== 'capsule'
        )
          throw new Error('Missing capsule interpolation keys');
        const t = a.atMs === b.atMs ? 0 : (atMs - a.atMs) / (b.atMs - a.atMs);
        const start = three(a.volume.start).lerp(three(b.volume.start), t);
        const end = three(a.volume.end).lerp(three(b.volume.end), t);
        const radius =
          a.volume.radiusM + (b.volume.radiusM - a.volume.radiusM) * t;
        const axis = end.clone().sub(start),
          lengthSquared = axis.lengthSq();
        for (const p of points) {
          const u =
            lengthSquared === 0
              ? 0
              : Math.max(
                  0,
                  Math.min(1, p.clone().sub(start).dot(axis) / lengthSquared),
                );
          const residual =
            p.distanceTo(start.clone().addScaledVector(axis, u)) - radius;
          if (residual > maximumFiniteSurfaceEscapeM) {
            maximumFiniteSurfaceEscapeM = residual;
            escapedAtMs = atMs;
          }
          testedCorners++;
        }
        for (let i = 0; i < directions.length; i++) {
          const d = directions[i],
            metric = directionalExcess[i];
          if (!d || !metric) throw new Error('Missing measurement direction');
          const support =
            Math.max(start.dot(d.vector), end.dot(d.vector)) + radius;
          let surfaceSupport = -Infinity;
          for (const p of points)
            surfaceSupport = Math.max(surfaceSupport, p.dot(d.vector));
          if (support - surfaceSupport > metric.maximumM) {
            metric.maximumM = support - surfaceSupport;
            metric.atMs = atMs;
          }
        }
      }
      results.push({
        descriptor,
        polygons,
        coverage,
        seed,
        fitPointCount: fitPoints.length,
        finiteFitMaximumExcessM,
        sampleTimes,
        rawRootCurve,
        footMatrices,
        asset,
        finiteMeasurement: {
          probes: probes.size,
          testedCorners,
          maximumFiniteSurfaceEscapeM,
          escapedAtMs,
          directionalExcess,
          continuousClaim: false,
        },
        acceptance: null,
        continuousContainment: null,
        regionVisualAcceptance: null,
        gameplayAllowance: null,
      });
    }
    return {
      schemaVersion: 1,
      status: 'DIAGNOSTIC_SOURCE_CANDIDATE_NOT_ACCEPTED' as const,
      source: GROUNDED_KICK_SOURCE_PINS,
      fitRule:
        'mesh-bind +Z axis in foot bind-reference; XY bounds midpoint; maximum radial distance plus 1e-7m CPU guard; shortest feasible segment at fixed radius; one fit over finite active source points',
      regionRule:
        'heel: foot influence>=.5,z<=-.035,y<=.120,normal.z<=-.25; sole: foot+toe influence>=.5,y<=.035,normal.y<=-.35; original faces clipped in barycentrics; overlapping region polygons retained and separately counted',
      results,
    };
  } finally {
    cleanup();
  }
}
