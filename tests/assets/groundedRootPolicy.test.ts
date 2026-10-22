import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
import { clipId, durationMs } from '../../src/contracts';
import {
  createSourceEvaluator,
  createThreeAssetPack,
  inspectGlb,
  PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES,
} from '../../src/assets';
import { selectSkinSurface } from '../../src/assets/skinSurface';
for (const [category, name, bone] of [
  ['punch', 'Cross', 'hand.R'],
  ['kick', 'FrontKick', 'foot.R'],
] as const) {
  test(`${name} retains grounded posture in every rendered vertex and evaluator, with raw source transport preserved separately`, async () => {
    const bytes = new Uint8Array(
      readFileSync(
        `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`,
      ),
    );
    const manifest = readFileSync(
      `assets/android/motions/completed42-speed15/${category}/manifest.json`,
    );
    const policy = PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES.find(
      (item) => item.clipId === name,
    );
    const inspected = inspectGlb(bytes).clips.find(
      (item) => item.name === name,
    );
    if (!policy || !inspected) throw new Error('Missing source policy');
    expect(createHash('sha256').update(manifest).digest('hex')).toBe(
      policy.provenance.manifestSha256,
    );
    const original = bytes.slice();
    const source = await new GLTFLoader().parseAsync(bytes.slice().buffer, '');
    const clip = source.animations.find((item) => item.name === name);
    const sourceRoot = source.scene.getObjectByName('root');
    if (!clip || !sourceRoot) throw new Error('Missing source clip/root');
    const mixer = new AnimationMixer(source.scene),
      action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.paused = true;
    action.play();
    mixer.update(0);
    source.scene.updateMatrixWorld(true);
    const origin = sourceRoot.getWorldPosition(new Vector3());
    const pack = await createThreeAssetPack([bytes], {}, [], [policy]),
      rig = pack.create('white');
    const parent = new Group();
    parent.position.set(4, 3, -2);
    parent.rotation.y = 0.7;
    parent.add(rig.node);
    parent.updateMatrixWorld(true);
    const parentBefore = parent.matrixWorld.clone();
    const evaluator = await createSourceEvaluator(
      bytes,
      name,
      [{ shapeId: 'contact', bone, surface: 'dominant-skin-subtree' }],
      policy,
    );
    const sourceMeshes: SkinnedMesh[] = [],
      runtimeMeshes: SkinnedMesh[] = [];
    source.scene.traverse((node) => {
      if (node instanceof SkinnedMesh) sourceMeshes.push(node);
    });
    rig.node.traverse((node) => {
      if (node instanceof SkinnedMesh) runtimeMeshes.push(node);
    });
    const foot = rig.node.getObjectByName('footL');
    if (!foot) throw new Error('Missing support foot');
    const sole = selectSkinSurface(rig.node, foot);
    const sourceFoot = source.scene.getObjectByName('footL');
    if (!sourceFoot) throw new Error('Missing source support foot');
    const sourceSole = selectSkinSurface(source.scene, sourceFoot);
    const times = [
      ...new Set([
        0,
        ...inspected.sampleTimes,
        ...inspected.sampleTimes
          .slice(1)
          .map((time, i) => (time + (inspected.sampleTimes[i] ?? 0)) / 2),
      ]),
    ].sort((a, b) => a - b);
    let maxError = 0,
      maxSoleError = 0,
      maxSoleDifference = 0,
      minimumRawY = 0,
      vertices = 0;
    try {
      for (const seconds of times) {
        action.time = seconds;
        mixer.update(0);
        source.scene.updateMatrixWorld(true);
        const raw = sourceRoot.getWorldPosition(new Vector3()).sub(origin);
        const sample = evaluator.sample(durationMs(seconds * 1000));
        rig.seek(clipId(name), seconds);
        expect(sample.rawRoot.position.y).toBeCloseTo(raw.y, 10);
        expect(sample.root.position.y).toBe(0);
        minimumRawY = Math.min(minimumRawY, raw.y);
        const inverse = rig.node.matrixWorld.clone().invert();
        for (let meshIndex = 0; meshIndex < sourceMeshes.length; meshIndex++) {
          const a = sourceMeshes[meshIndex],
            b = runtimeMeshes[meshIndex];
          if (!a || !b) throw new Error('Mesh mismatch');
          a.skeleton.update();
          b.skeleton.update();
          for (let i = 0; i < a.geometry.getAttribute('position').count; i++) {
            const expected = a
              .getVertexPosition(i, new Vector3())
              .applyMatrix4(a.matrixWorld)
              .sub(
                new Vector3(sample.root.position.x, 0, sample.root.position.z),
              );
            const actual = b
              .getVertexPosition(i, new Vector3())
              .applyMatrix4(b.matrixWorld)
              .applyMatrix4(inverse);
            maxError = Math.max(maxError, expected.distanceTo(actual));
            vertices++;
          }
        }
        let minimum = Infinity;
        for (const { mesh, vertexIndices } of sole)
          for (const index of vertexIndices)
            minimum = Math.min(
              minimum,
              mesh
                .getVertexPosition(index, new Vector3())
                .applyMatrix4(mesh.matrixWorld)
                .applyMatrix4(inverse).y,
            );
        let originalMinimum = Infinity;
        for (const { mesh, vertexIndices } of sourceSole)
          for (const index of vertexIndices)
            originalMinimum = Math.min(
              originalMinimum,
              mesh
                .getVertexPosition(index, new Vector3())
                .applyMatrix4(mesh.matrixWorld).y,
            );
        maxSoleDifference = Math.max(
          maxSoleDifference,
          Math.abs(minimum - originalMinimum),
        );
        maxSoleError = Math.max(maxSoleError, Math.abs(minimum));
        expect(parent.matrixWorld.equals(parentBefore)).toBe(true);
      }
      for (const seconds of [0.5, 0.5, 0.1, 0.8]) {
        action.time = seconds;
        mixer.update(0);
        source.scene.updateMatrixWorld(true);
        rig.seek(clipId(name), seconds);
        const renderedRoot = rig.node.getObjectByName('root');
        if (!renderedRoot) throw new Error('Missing rendered root');
        const expected = sourceRoot.getWorldPosition(new Vector3());
        expected.x = origin.x;
        expected.z = origin.z;
        expect(
          rig.node
            .worldToLocal(renderedRoot.getWorldPosition(new Vector3()))
            .distanceTo(expected),
        ).toBeLessThan(1e-8);
      }
      expect(vertices).toBeGreaterThan(4_000_000);
      expect(maxError).toBeLessThan(1e-6);
      expect(maxSoleDifference).toBeLessThan(1e-6);
      console.info(
        JSON.stringify({
          name,
          vertices,
          maxError,
          maxSoleDifference,
          preservedSourceSoleDeviationM: maxSoleError,
        }),
      );
      expect(minimumRawY).toBeLessThan(-0.002);
      expect(pack.rootPolicy(clipId(name))).toEqual(policy);
      expect(bytes).toEqual(original);
    } finally {
      evaluator.dispose();
      rig.dispose();
      pack.dispose();
      mixer.stopAllAction();
      mixer.uncacheRoot(source.scene);
      source.scene.traverse((node) => {
        if (node instanceof Mesh) {
          node.geometry.dispose();
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material])
            material.dispose();
        }
      });
    }
  }, 60_000);
}

test('source-bound policy rejects altered bytes/clip bindings and snapshots caller receipts', async () => {
  const policy = PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES[0];
  if (!policy) throw new Error('Missing policy');
  const bytes = new Uint8Array(
    readFileSync(
      'assets/android/motions/completed42-speed15/punch/android_punch.glb',
    ),
  );
  await expect(
    createThreeAssetPack(
      [bytes],
      {},
      [],
      [{ ...policy, sourceSha256: '0'.repeat(64) }],
    ),
  ).rejects.toThrow('source mismatch');
  await expect(createSourceEvaluator(bytes, 'Jab', [], policy)).rejects.toThrow(
    'clip mismatch',
  );
  await expect(
    createThreeAssetPack([bytes], {}, [], [policy, policy]),
  ).rejects.toThrow('Duplicate root policy');
  const caller = { ...policy, provenance: { ...policy.provenance } };
  const pending = createThreeAssetPack([bytes], {}, [], [caller]);
  caller.mode = 'full-translation';
  caller.provenance.manifestSha256 = '0'.repeat(64);
  bytes.fill(0);
  const pack = await pending;
  try {
    expect(pack.rootPolicy(policy.clipId)).toEqual(policy);
  } finally {
    pack.dispose();
  }
});

test('retained posture enters both existing canonical deaths without changing any t0 vertex or C parent', async () => {
  const { authorDeathClips } = await import('../../src/assets/deathAnimation');
  const movement = new Uint8Array(
    readFileSync(
      'assets/android/motions/completed42-speed15/movement/android_movement.glb',
    ),
  );
  const seedPack = await createThreeAssetPack([movement]),
    seed = seedPack.create('white');
  seed.seek(clipId('Idle'), 0);
  const deaths = authorDeathClips(seed.node);
  seed.dispose();
  seedPack.dispose();
  for (const [category, name, seconds] of [
    ['punch', 'Cross', 7 / 45],
    ['kick', 'FrontKick', 8 / 45],
  ] as const) {
    const bytes = new Uint8Array(
      readFileSync(
        `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`,
      ),
    );
    const policy = PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES.find(
      (item) => item.clipId === name,
    );
    if (!policy) throw new Error('Missing policy');
    const pack = await createThreeAssetPack([bytes], {}, deaths, [policy]);
    try {
      for (const death of deaths) {
        const rig = pack.create('white'),
          parent = new Group();
        parent.position.set(2, 4, -1);
        parent.rotation.y = 0.8;
        parent.add(rig.node);
        const vertices = () => {
          rig.node.updateWorldMatrix(true, true);
          const points: Vector3[] = [];
          rig.node.traverse((mesh) => {
            if (mesh instanceof SkinnedMesh) {
              mesh.skeleton.update();
              for (
                let i = 0;
                i < mesh.geometry.getAttribute('position').count;
                i++
              )
                points.push(
                  mesh
                    .getVertexPosition(i, new Vector3())
                    .applyMatrix4(mesh.matrixWorld),
                );
            }
          });
          return points;
        };
        try {
          rig.seek(clipId(name), seconds);
          const before = vertices(),
            parentBefore = parent.matrixWorld.clone();
          rig.seek(clipId(death.name), 0);
          const after = vertices();
          expect(
            Math.max(
              ...after.map((point, i) =>
                point.distanceTo(before[i] ?? new Vector3(Infinity, 0, 0)),
              ),
            ),
          ).toBeLessThan(1e-6);
          expect(parent.matrixWorld.equals(parentBefore)).toBe(true);
        } finally {
          rig.dispose();
        }
      }
    } finally {
      pack.dispose();
    }
  }
}, 60_000);
