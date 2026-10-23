import { readFileSync } from 'node:fs';
import {
  AnimationMixer,
  Group,
  LoopOnce,
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
import { durationMs } from '../../src/contracts';
import {
  GROUNDED_KICK_SOURCE_PINS,
  loadGroundedKickDiagnostics,
} from '../../tools/assets/groundedKickDiagnostic';

test('two kick diagnostics preserve whole original source, root once, source topology and the honest finite interpolation RED', async () => {
  const sourceBytes = new Uint8Array(
    readFileSync(GROUNDED_KICK_SOURCE_PINS.sourcePath),
  );
  const entries = loadGroundedKickDiagnostics({
    sourceBytes,
    manifestBytes: readFileSync(GROUNDED_KICK_SOURCE_PINS.manifestPath),
    candidateBytes: readFileSync(
      'tests/assets/fixtures/grounded-kicks-v1/candidate.json.fixture',
    ),
    recipeBytes: readFileSync(
      'tests/assets/fixtures/grounded-kicks-v1/recipe.json.fixture',
    ),
  });
  const pack = await createPinnedDerivedThreeAssetPack({
    derivedBytes: readFileSync(`public${ANDROID_DERIVED_PACK_V1.url}`),
    artifactBytes: readFileSync(`public${ANDROID_RUNTIME_ARTIFACT_V1.url}`),
    rootPolicies: entries.map((entry) => entry.rootPolicy),
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
      const origin = root.getWorldPosition(new Vector3());
      const keys = entry.descriptor.sourceTimesSeconds;
      const times = [
        ...new Set([
          0,
          ...keys,
          ...keys
            .slice(1)
            .map((time, index) => (time + (keys[index] ?? 0)) / 2),
          entry.finiteMeasurement.escapedAtMs / 1000,
        ]),
      ].sort((a, b) => a - b);
      let maxVertexErrorM = 0,
        maxRootErrorM = 0,
        vertices = 0,
        minimumSupportBottomM = Infinity,
        maximumSupportBottomM = -Infinity,
        minimumSourceBottomM = Infinity,
        maximumSourceBottomM = -Infinity;
      const supportNames =
        entry.descriptor.supportSide === 'L'
          ? ['footL', 'toeL']
          : ['footR', 'toeR'];
      for (const seconds of times) {
        action.time = seconds;
        mixer.update(0);
        source.scene.updateMatrixWorld(true);
        const raw = root.getWorldPosition(new Vector3()).sub(origin),
          transport = new Vector3(raw.x, 0, raw.z);
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
        maxRootErrorM = Math.max(
          maxRootErrorM,
          extracted.distanceTo(transport),
        );
        parent.position.copy(extracted).applyMatrix4(base.matrixWorld);
        parent.quaternion.copy(base.quaternion);
        parent.updateMatrixWorld(true);
        const physicalBefore = parent.matrixWorld.clone();
        rig.seekPose(binding, durationMs(seconds * 1000));
        parent.updateMatrixWorld(true);
        expect(parent.matrixWorld.equals(physicalBefore)).toBe(true);
        let supportBottom = Infinity,
          sourceBottom = Infinity;
        for (let primitive = 0; primitive < sourceMeshes.length; primitive++) {
          const mesh = sourceMeshes[primitive],
            rendered = runtimeMeshes[primitive];
          if (!mesh || !rendered) throw new Error('Mesh pair');
          mesh.skeleton.update();
          rendered.skeleton.update();
          const position = mesh.geometry.getAttribute('position'),
            joints = mesh.geometry.getAttribute('skinIndex'),
            weights = mesh.geometry.getAttribute('skinWeight');
          expect(rendered.geometry.getAttribute('position').count).toBe(
            position.count,
          );
          for (let vertex = 0; vertex < position.count; vertex++) {
            mesh
              .getVertexPosition(vertex, expected)
              .applyMatrix4(mesh.matrixWorld);
            sourceBottom = Math.min(sourceBottom, expected.y);
            for (let influence = 0; influence < 4; influence++) {
              if (
                weights.getComponent(vertex, influence) > 0 &&
                supportNames.includes(
                  mesh.skeleton.bones[joints.getComponent(vertex, influence)]
                    ?.name ?? '',
                )
              ) {
                supportBottom = Math.min(supportBottom, expected.y);
                break;
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
        if (!Number.isFinite(supportBottom))
          throw new Error('Missing source support-foot vertices');
        minimumSupportBottomM = Math.min(minimumSupportBottomM, supportBottom);
        maximumSupportBottomM = Math.max(maximumSupportBottomM, supportBottom);
        minimumSourceBottomM = Math.min(minimumSourceBottomM, sourceBottom);
        maximumSourceBottomM = Math.max(maximumSourceBottomM, sourceBottom);
      }
      // Retain and independently reproduce the known finite interpolation escape.
      const at = entry.finiteMeasurement.escapedAtMs;
      action.time = at / 1000;
      mixer.update(0);
      source.scene.updateMatrixWorld(true);
      const raw = root.getWorldPosition(new Vector3()).sub(origin),
        transport = new Vector3(raw.x, 0, raw.z);
      const shape = catalog.sampleMotion(
        entry.descriptor.clipId,
        durationMs(at),
        durationMs(at + 0.000001),
      )?.hitVolumeSegments[0]?.from;
      if (!shape || shape.kind !== 'capsule')
        throw new Error('Missing actual public sampled capsule');
      const start = new Vector3(shape.start.x, shape.start.y, shape.start.z),
        end = new Vector3(shape.end.x, shape.end.y, shape.end.z),
        axis = end.clone().sub(start);
      let finiteEscapeM = -Infinity,
        corners = 0;
      for (const polygon of entry.polygons) {
        const mesh = sourceMeshes[polygon.primitive],
          index = mesh?.geometry.getIndex();
        if (!mesh || !index) throw new Error('Source primitive/topology');
        expect(polygon.vertexIndices).toEqual([
          index.getX(polygon.triangleIndex * 3),
          index.getX(polygon.triangleIndex * 3 + 1),
          index.getX(polygon.triangleIndex * 3 + 2),
        ]);
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
          const u =
            axis.lengthSq() === 0
              ? 0
              : Math.max(
                  0,
                  Math.min(
                    1,
                    point.clone().sub(start).dot(axis) / axis.lengthSq(),
                  ),
                );
          finiteEscapeM = Math.max(
            finiteEscapeM,
            point.distanceTo(start.clone().addScaledVector(axis, u)) -
              shape.radiusM,
          );
          corners++;
        }
      }
      expect(maxVertexErrorM).toBeLessThan(1e-10);
      expect(maxRootErrorM).toBeLessThan(1e-10);
      expect(vertices).toBeGreaterThan(4_000_000);
      expect(corners).toBeGreaterThan(400);
      expect(finiteEscapeM).toBeGreaterThan(0);
      expect(
        Math.abs(
          finiteEscapeM - entry.finiteMeasurement.maximumFiniteSurfaceEscapeM,
        ),
      ).toBeLessThan(1e-10);
      console.info(
        JSON.stringify({
          clip: entry.descriptor.clipId,
          qualification:
            'finite source/runtime/root-once/topology only; capsule interpolation RED, not continuous/gameplay/C-gravity acceptance',
          poses: times.length,
          vertices,
          maxVertexErrorM,
          maxRootErrorM,
          minimumSupportBottomM,
          maximumSupportBottomM,
          minimumSourceBottomM,
          maximumSourceBottomM,
          finiteEscapeM,
          corners,
        }),
      );
    }
  } finally {
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
