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
  GROUNDED_PUNCH_SOURCE_PINS,
  type GroundedPunchSourceInput,
  readGroundedPunchSources,
} from './groundedPunchDiagnostic';
import {
  clipBarycentricTriangle,
  fitSourceSphere,
  interpolateFace,
  positiveArea,
  type SourceBarycentric,
  stretchBound,
} from './sourceContactGeometry';

export interface SourceHandContactTriangle {
  readonly positions: readonly Vector3[];
  readonly normals: readonly Vector3[];
  readonly weights: readonly number[];
}
export type HandContactRegion =
  | 'distal-hand'
  | 'proximal-finger'
  | 'palmar-heel';
/** Bone-bind local scalar predicates, not a claim of anatomical/visible acceptance.
 * The original crossing triangle is retained via barycentrics, never vertex-only.
 * A proximal-finger face crossing only the arbitrary20mm upper cut is restored
 * whole, as in the independently inspected prior source-rim topology decision. */
export function clipHandContactTriangle(
  face: SourceHandContactTriangle,
  region: HandContactRegion,
): readonly SourceBarycentric[] {
  if (
    [face.positions, face.normals, face.weights].some((a) => a.length !== 3) ||
    [...face.positions, ...face.normals].some(
      (point) => ![point.x, point.y, point.z].every(Number.isFinite),
    ) ||
    face.weights.some(
      (weight) => !Number.isFinite(weight) || weight < 0 || weight > 1,
    )
  )
    throw new Error('Finite original triangle attributes required');
  const values = (fn: (index: number) => number): SourceBarycentric => [
    fn(0),
    fn(1),
    fn(2),
  ];
  const owned = values((i) => (face.weights[i] ?? 0) - 0.5);
  const fields =
    region === 'distal-hand'
      ? [
          owned,
          values((i) => (face.positions[i]?.y ?? 0) - 0.06),
          values((i) => (face.normals[i]?.y ?? 0) - 0.25),
        ]
      : region === 'palmar-heel'
        ? [
            owned,
            values((i) => face.positions[i]?.y ?? 0),
            values((i) => 0.04 - (face.positions[i]?.y ?? 0)),
            values((i) => (face.positions[i]?.z ?? 0) - 0.015),
            values((i) => (face.normals[i]?.z ?? 0) - 0.35),
          ]
        : [
            owned,
            values((i) => (face.positions[i]?.y ?? 0) + 0.012),
            values((i) => -0.003 - (face.positions[i]?.z ?? 0)),
            values((i) => -0.25 - (face.normals[i]?.z ?? 0)),
          ];
  if (region === 'proximal-finger') {
    const upper = values((i) => 0.02 - (face.positions[i]?.y ?? 0));
    const restoredCrossing =
      fields.every((field) => field.every((value) => value >= 0)) &&
      upper.some((value) => value > 0) &&
      upper.some((value) => value < 0);
    if (!restoredCrossing) fields.push(upper);
  }
  return clipBarycentricTriangle(fields);
}

export interface GroundedHandPolygon {
  readonly primitive: number;
  readonly triangleIndex: number;
  readonly vertexIndices: readonly [number, number, number];
  readonly region: HandContactRegion;
  readonly jointIndex: number;
  readonly sourceJointName: string;
  readonly coverage: 'full' | 'clipped';
  readonly restoredLeadingRim: boolean;
  readonly barycentric: readonly SourceBarycentric[];
}
const plain = (v: ThreeVector3): Vector3 => ({ x: v.x, y: v.y, z: v.z });
const three = (v: Vector3) => new ThreeVector3(v.x, v.y, v.z);

/** Returns new diagnostic data only. Source bytes and existing candidates are immutable. */
export async function bakeGroundedPunchDiagnostics(
  input: GroundedPunchSourceInput,
) {
  const descriptors = readGroundedPunchSources(input);
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
        const names =
          event.intendedRegion === 'proximal-palmar-heel'
            ? [`hand.${event.side}`]
            : [
                `hand.${event.side}`,
                ...[1, 2, 3, 4].map(
                  (n) =>
                    `finger_${String(n).padStart(2, '0')}.01.${event.side}`,
                ),
              ];
        const handIndex = event.side === 'L' ? 10 : 29;
        const hand = sourceMesh.skeleton.bones[handIndex],
          handInverse = sourceMesh.skeleton.boneInverses[handIndex];
        if (!hand || !handInverse || hand.name !== `hand${event.side}`)
          throw new Error('Exact source hand identity required');
        const polygons: GroundedHandPolygon[] = [];
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
            const region: HandContactRegion =
              event.intendedRegion === 'proximal-palmar-heel'
                ? 'palmar-heel'
                : sourceJointName.startsWith('hand.')
                  ? 'distal-hand'
                  : 'proximal-finger';
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
              const barycentric = clipHandContactTriangle(face, region);
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
                region === 'proximal-finger' &&
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
      source: GROUNDED_PUNCH_SOURCE_PINS,
      fitRule:
        'One source-reference AABB midpoint sphere per event, maximum distance over finite active source corners plus 1e-7m CPU arithmetic guard. No interpolation padding or gameplay allowance.',
      regionRule:
        'Original faces clipped in bone-bind coordinates; distal hand y>=.060,normal.y>=.25; proximal fingers y>=-.012,y<=.020,z<=-.003,normal.z<=-.25 with whole-face restoration only across the sole upper-y exclusion; palmar heel 0<=y<=.040,z>=.015,normal.z>=.35; eligible original joint influence>=.5. No welding or dominant-weight skinning.',
      results,
    };
  } finally {
    cleanup();
  }
}
