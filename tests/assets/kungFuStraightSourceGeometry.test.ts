import { readFileSync } from 'node:fs';
import {
  AnimationMixer,
  Group,
  LoopOnce,
  Matrix4,
  Mesh,
  SkinnedMesh,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test } from 'vitest';
import {
  ANDROID_DERIVED_PACK_V1,
  ANDROID_RUNTIME_ARTIFACT_V1,
  assertRootPolicyCompatibility,
  createMotionCatalog,
  createPinnedDerivedThreeAssetPack,
} from '../../src/assets';
import { preparePinnedSourceHead } from '../../src/assets/headSurface';
import { durationMs } from '../../src/contracts';
import {
  KUNG_FU_STRAIGHT_SOURCE_PINS,
  loadKungFuStraightDiagnostics,
} from '../../tools/assets/kungFuStraightDiagnostic';

function distanceMaximum(
  previousM: number,
  actual: Vector3,
  expected: Vector3,
): number {
  return Math.max(previousM, actual.distanceTo(expected));
}
test('metre maximum does not include unrelated vertex counters', () => {
  const observation = {
    previousM: 0,
    headVertices: 326456,
    actual: new Vector3(0, 0, 0),
    expected: new Vector3(0, 0, 0),
  };
  expect(
    distanceMaximum(
      observation.previousM,
      observation.actual,
      observation.expected,
    ),
  ).toBe(0);
  observation.actual.set(0, 0.00001, 0);
  expect(
    distanceMaximum(
      observation.previousM,
      observation.actual,
      observation.expected,
    ),
  ).toBe(0.00001);
  expect(observation.headVertices).toBe(326456);
});

test('one source-advancing grounded-posture-Y diagnostic preserve whole original source, root once, source topology and the honest finite interpolation RED', async () => {
  const sourceBytes = new Uint8Array(
    readFileSync(KUNG_FU_STRAIGHT_SOURCE_PINS.sourcePath),
  );
  const entries = loadKungFuStraightDiagnostics({
    sourceBytes,
    manifestBytes: readFileSync(KUNG_FU_STRAIGHT_SOURCE_PINS.manifestPath),
    candidateBytes: readFileSync(
      'tests/assets/fixtures/kungfu-straight-v1/candidate.json.fixture',
    ),
    recipeBytes: readFileSync(
      'tests/assets/fixtures/kungfu-straight-v1/recipe.json.fixture',
    ),
  });
  const pack = await createPinnedDerivedThreeAssetPack({
    derivedBytes: readFileSync(`public${ANDROID_DERIVED_PACK_V1.url}`),
    artifactBytes: readFileSync(`public${ANDROID_RUNTIME_ARTIFACT_V1.url}`),
    rootPolicies: entries.map((entry) => entry.rootPolicy),
    signal: new AbortController().signal,
  });
  const provider = await preparePinnedSourceHead({
    derivedBytes: readFileSync(`public${ANDROID_DERIVED_PACK_V1.url}`),
    rootPolicies: entries.map((e) => e.rootPolicy),
    signal: new AbortController().signal,
  });
  const source = await new GLTFLoader().parseAsync(sourceBytes.buffer, '');
  const rig = pack.create('white');
  const catalog = createMotionCatalog(async () =>
    entries.map((entry) => entry.asset),
  );
  const sourceMeshes: SkinnedMesh[] = [],
    runtimeMeshes: SkinnedMesh[] = [];
  source.scene.traverse((node) => {
    if (node instanceof SkinnedMesh) sourceMeshes.push(node);
  });
  rig.node.traverse((node) => {
    if (node instanceof SkinnedMesh) runtimeMeshes.push(node);
  });
  const supportMasks = sourceMeshes.map((mesh) => {
    const joints = mesh.geometry.getAttribute('skinIndex'),
      weights = mesh.geometry.getAttribute('skinWeight');
    const mask = new Uint8Array(joints.count);
    for (let vertex = 0; vertex < joints.count; vertex++)
      for (let influence = 0; influence < 4; influence++) {
        if (weights.getComponent(vertex, influence) <= 0) continue;
        const name =
          mesh.skeleton.bones[joints.getComponent(vertex, influence)]?.name;
        if (name === 'footL' || name === 'toeL')
          mask[vertex] = (mask[vertex] ?? 0) | 1;
        if (name === 'footR' || name === 'toeR')
          mask[vertex] = (mask[vertex] ?? 0) | 2;
      }
    return mask;
  });
  const baseline: {
    node: import('three').Object3D;
    position: Vector3;
    quaternion: typeof source.scene.quaternion;
    scale: Vector3;
  }[] = [];
  source.scene.traverse((node) =>
    baseline.push({
      node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    }),
  );
  const mixer = new AnimationMixer(source.scene),
    root = source.scene.getObjectByName('root');
  const base = new Group(),
    parent = new Group();
  base.position.set(3, 2, -4);
  base.rotation.y = 0.7;
  base.updateMatrixWorld(true);
  parent.add(rig.node);
  const expected = new Vector3(),
    actual = new Vector3();
  try {
    if (!root || !rig.seekPose)
      throw new Error('Required canonical source driver');
    expect(sourceMeshes).toHaveLength(5);
    expect(runtimeMeshes).toHaveLength(5);
    await catalog.prepare(new AbortController().signal);
    assertRootPolicyCompatibility(
      entries.map((entry) => ({
        asset: entry.asset,
        rootPolicy: entry.rootPolicy,
      })),
      pack,
    );
    for (const entry of entries) {
      const clip = source.animations.find(
        (clip) => clip.name === entry.descriptor.clipId,
      );
      const binding = pack.poseBindings?.clips.find(
        (binding) => binding.clipId === entry.descriptor.clipId,
      );
      if (!clip || !binding) throw new Error('Missing exact clip/binding');
      expect(binding.durationMs).toBe(entry.descriptor.durationMs);
      mixer.stopAllAction();
      for (const saved of baseline) {
        saved.node.position.copy(saved.position);
        saved.node.quaternion.copy(saved.quaternion);
        saved.node.scale.copy(saved.scale);
      }
      const action = mixer.clipAction(clip);
      action.setLoop(LoopOnce, 1);
      action.play();
      action.paused = true;
      action.time = 0;
      mixer.update(0);
      source.scene.updateMatrixWorld(true);

      const originalRootOrigin = root.getWorldPosition(new Vector3());
      const keys = entry.descriptor.sourceTimesSeconds;
      const times = [
        ...new Set([
          0,
          ...keys,
          ...keys
            .slice(1)
            .map((time, index) => (time + (keys[index] ?? 0)) / 2),
          ...entry.finiteMeasurement.map((m) => m.escapedAtMs / 1000),
        ]),
      ].sort((a, b) => a - b);
      let maxVertexErrorM = 0,
        maxRootErrorM = 0,
        vertices = 0,
        minimumSupportBottomM = Infinity,
        maximumSupportBottomM = -Infinity,
        minimumSourceBottomM = Infinity,
        maximumSourceBottomM = -Infinity,
        minimumRightSupportBottomM = Infinity,
        maximumRightSupportBottomM = -Infinity,
        maximumLeftFootVertexXZDisplacementM = 0,
        maximumRightFootVertexXZDisplacementM = 0;
      let maximumHeadErrorM = 0,
        headVertices = 0;
      const supportOrigins = new Map<number, Vector3>();
      // Observe both original foot/toe subtrees; anchored ankles do not imply every rotating foot vertex is fixed.
      // Report whole-source deviations rather than inventing a floor tolerance.
      for (const seconds of times) {
        action.time = seconds;
        mixer.update(0);
        source.scene.updateMatrixWorld(true);
        const transport = root
          .getWorldPosition(new Vector3())
          .sub(originalRootOrigin)
          .setY(0);
        const rawKey = entry.rawRootCurve.find(
          (k) => k.atMs === seconds * 1000,
        );
        if (rawKey) {
          const raw = root
            .getWorldPosition(new Vector3())
            .sub(originalRootOrigin);
          expect(
            raw.distanceTo(
              new Vector3(
                rawKey.position.x,
                rawKey.position.y,
                rawKey.position.z,
              ),
            ),
          ).toBeLessThan(1e-10);
        }
        const sampled = catalog
          .sampleMotion(
            entry.descriptor.clipId,
            durationMs(0),
            durationMs(seconds * 1000),
          )
          ?.rootSegments.at(-1)?.to.position;
        const extracted = sampled
          ? new Vector3(sampled.x, sampled.y, sampled.z)
          : new Vector3();
        maxRootErrorM = distanceMaximum(maxRootErrorM, extracted, transport);
        parent.position.copy(extracted).applyMatrix4(base.matrixWorld);
        parent.quaternion.copy(base.quaternion);
        parent.updateMatrixWorld(true);
        const physicalBefore = parent.matrixWorld.clone();
        // Poison with terminal source pose, then seek backwards and repeat:
        // arbitrary-order reconstruction must not depend on last display state.
        rig.seekPose(binding, entry.descriptor.durationMs);
        rig.seekPose(binding, durationMs(seconds * 1000));
        rig.seekPose(binding, durationMs(seconds * 1000));
        parent.updateMatrixWorld(true);
        expect(parent.matrixWorld.equals(physicalBefore)).toBe(true);
        let supportBottom = Infinity,
          rightSupportBottom = Infinity,
          sourceBottom = Infinity;
        for (let primitive = 0; primitive < sourceMeshes.length; primitive++) {
          const mesh = sourceMeshes[primitive],
            rendered = runtimeMeshes[primitive];
          if (!mesh || !rendered) throw new Error('Mesh pair');
          mesh.skeleton.update();
          rendered.skeleton.update();
          const position = mesh.geometry.getAttribute('position');
          expect(rendered.geometry.getAttribute('position').count).toBe(
            position.count,
          );
          for (let vertex = 0; vertex < position.count; vertex++) {
            mesh
              .getVertexPosition(vertex, expected)
              .applyMatrix4(mesh.matrixWorld);
            sourceBottom = Math.min(sourceBottom, expected.y);
            const support = supportMasks[primitive]?.[vertex] ?? 0;
            if (support) {
              const identity = primitive * 100_000 + vertex;
              let first = supportOrigins.get(identity);
              if (!first) {
                first = expected.clone();
                supportOrigins.set(identity, first);
              }
              const displacement = Math.hypot(
                expected.x - first.x,
                expected.z - first.z,
              );
              if (support & 1) {
                supportBottom = Math.min(supportBottom, expected.y);
                maximumLeftFootVertexXZDisplacementM = Math.max(
                  maximumLeftFootVertexXZDisplacementM,
                  displacement,
                );
              }
              if (support & 2) {
                rightSupportBottom = Math.min(rightSupportBottom, expected.y);
                maximumRightFootVertexXZDisplacementM = Math.max(
                  maximumRightFootVertexXZDisplacementM,
                  displacement,
                );
              }
            }
            expected.applyMatrix4(base.matrixWorld);
            rendered
              .getVertexPosition(vertex, actual)
              .applyMatrix4(rendered.matrixWorld);
            maxVertexErrorM = Math.max(
              maxVertexErrorM,
              expected.distanceTo(actual),
            );
            vertices++;
          }
        }
        const sampledHead = provider.evaluate(
          binding,
          durationMs(seconds * 1000),
        );
        if (sampledHead.kind !== 'transform')
          throw new Error('Grounded-posture numeric provider unavailable');
        const headMatrix = new Matrix4().fromArray(sampledHead.matrix);
        for (const vertex of provider.descriptor.vertices) {
          const mesh = sourceMeshes[vertex.primitive];
          if (!mesh) throw new Error('Head primitive');
          const original = mesh
            .getVertexPosition(vertex.vertexIndex, new Vector3())
            .applyMatrix4(mesh.matrixWorld);
          const numeric = new Vector3(
            vertex.position.x,
            vertex.position.y,
            vertex.position.z,
          ).applyMatrix4(headMatrix);
          maximumHeadErrorM = Math.max(
            maximumHeadErrorM,
            original.clone().sub(transport).distanceTo(numeric),
          );
          headVertices++;
        }
        if (
          !Number.isFinite(supportBottom) ||
          !Number.isFinite(rightSupportBottom)
        )
          throw new Error('Missing source support-foot vertices');
        minimumSupportBottomM = Math.min(minimumSupportBottomM, supportBottom);
        maximumSupportBottomM = Math.max(maximumSupportBottomM, supportBottom);
        minimumRightSupportBottomM = Math.min(
          minimumRightSupportBottomM,
          rightSupportBottom,
        );
        maximumRightSupportBottomM = Math.max(
          maximumRightSupportBottomM,
          rightSupportBottom,
        );
        minimumSourceBottomM = Math.min(minimumSourceBottomM, sourceBottom);
        maximumSourceBottomM = Math.max(maximumSourceBottomM, sourceBottom);
      }
      // Independently reproduce the signed initial finite measurement, without assuming it passes containment.
      const eventMeasurements = [];
      for (const [impactIndex, region] of entry.regions.entries()) {
        const measurement = entry.finiteMeasurement[impactIndex];
        if (!measurement) throw new Error('Missing event measurement');
        const at = measurement.escapedAtMs;
        action.time = at / 1000;
        mixer.update(0);
        source.scene.updateMatrixWorld(true);
        const transport = root
          .getWorldPosition(new Vector3())
          .sub(originalRootOrigin)
          .setY(0);
        const shape = catalog
          .sampleMotion(
            entry.descriptor.clipId,
            durationMs(at),
            durationMs(at + 0.000001),
          )
          ?.hitVolumeSegments.find(
            (segment) => segment.shapeId === region.shapeId,
          )?.from;
        if (shape?.kind !== 'sphere')
          throw new Error('Missing actual public sampled sphere');
        const center = new Vector3(
          shape.center.x,
          shape.center.y,
          shape.center.z,
        );
        let finiteEscapeM = -Infinity,
          corners = 0;
        for (const polygon of region.polygons) {
          const mesh = sourceMeshes[polygon.primitive],
            index = mesh?.geometry.getIndex();
          if (!mesh || !index) throw new Error('Source primitive/topology');
          expect(polygon.vertexIndices).toEqual([
            index.getX(polygon.triangleIndex * 3),
            index.getX(polygon.triangleIndex * 3 + 1),
            index.getX(polygon.triangleIndex * 3 + 2),
          ]);
          expect(mesh.skeleton.bones[polygon.jointIndex]?.name).toBe(
            polygon.sourceJointName.replaceAll('.', ''),
          );
          mesh.skeleton.update();
          const points = polygon.vertexIndices.map((vertex) =>
            mesh
              .getVertexPosition(vertex, new Vector3())
              .applyMatrix4(mesh.matrixWorld)
              .sub(transport),
          );
          for (const bary of polygon.barycentric) {
            const point = new Vector3();
            for (let i = 0; i < 3; i++) {
              const p = points[i],
                weight = bary[i];
              if (!p || weight === undefined)
                throw new Error('Barycentric corner');
              point.addScaledVector(p, weight);
            }
            finiteEscapeM = Math.max(
              finiteEscapeM,
              point.distanceTo(center) - shape.radiusM,
            );
            corners++;
          }
        }
        expect(corners).toBeGreaterThan(0);
        expect(
          Math.abs(finiteEscapeM - measurement.maximumFiniteSurfaceEscapeM),
        ).toBeLessThan(1e-10);
        if (measurement.maximumFiniteSurfaceEscapeM > 0)
          expect(finiteEscapeM).toBeGreaterThan(0);
        eventMeasurements.push({
          impactIndex,
          atMs: at,
          finiteEscapeM,
          corners,
        });
      }
      expect(maxVertexErrorM).toBeLessThan(1e-10);
      expect(maxRootErrorM).toBeLessThan(1e-10);
      expect(vertices).toBe(times.length * 46181);
      expect(maximumHeadErrorM).toBeLessThan(1e-10);
      console.info(
        JSON.stringify({
          clip: entry.descriptor.clipId,
          qualification:
            'finite source/runtime/root-once/topology only; sphere interpolation escapes retained, not continuous/gameplay/C-gravity acceptance',
          poses: times.length,
          vertices,
          maxVertexErrorM,
          maxRootErrorM,
          maximumHeadErrorM,
          headVertices,
          minimumSupportBottomM,
          maximumSupportBottomM,
          minimumRightSupportBottomM,
          maximumRightSupportBottomM,
          maximumLeftFootVertexXZDisplacementM,
          maximumRightFootVertexXZDisplacementM,
          sourceBindingId: binding.sourceBindingId,
          minimumSourceBottomM,
          maximumSourceBottomM,
          eventMeasurements,
        }),
      );
    }
  } finally {
    provider.dispose();
    catalog.dispose();
    rig.dispose();
    pack.dispose();
    mixer.stopAllAction();
    mixer.uncacheRoot(source.scene);
    const geometries = new Set<Mesh['geometry']>(),
      materials = new Set<import('three').Material>(),
      skeletons = new Set<SkinnedMesh['skeleton']>();
    source.scene.traverse((node) => {
      if (node instanceof Mesh) {
        geometries.add(node.geometry);
        for (const m of Array.isArray(node.material)
          ? node.material
          : [node.material])
          materials.add(m);
      }
      if (node instanceof SkinnedMesh) skeletons.add(node.skeleton);
    });
    for (const skeleton of skeletons) skeleton.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
}, 60000);
