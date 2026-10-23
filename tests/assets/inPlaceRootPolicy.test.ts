import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  AnimationMixer,
  Group,
  LoopOnce,
  Mesh,
  type Object3D,
  SkinnedMesh,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test } from 'vitest';
import {
  ANDROID_DERIVED_PACK_V1,
  ANDROID_RUNTIME_ARTIFACT_V1,
  createPinnedDerivedThreeAssetPack,
  createSourceEvaluator,
  inspectGlb,
} from '../../src/assets';
import { buildPoseBindings } from '../../src/assets/poseBindings';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { selectSkinSurface } from '../../src/assets/skinSurface';
import {
  actorId,
  clipId,
  durationMs,
  presentationTimeMs,
  runId,
} from '../../src/contracts';

const directory = 'assets/android/motions/completed42-speed15/kick';
const sourceHash =
  '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd';
const manifestHash =
  'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed';
const recipes = [
  { name: 'RoundhouseKick', index: 2, support: 'support', peak: 31 },
  { name: 'SideThrustKick', index: 9, support: 'support_contacts', peak: 36 },
  { name: 'LowSweep', index: 3, support: 'support_contacts', peak: 29 },
] as const;
const policies = recipes.map(({ name, index, support }) =>
  copyRootPolicy({
    version: 1,
    clipId: clipId(name),
    sourceSha256: sourceHash,
    mode: 'in-place-posture-xyz',
    provenance: {
      manifestSha256: manifestHash,
      clipPointer: `/clips/${index}`,
      supportPointer: `/clips/${index}/support_contacts/${support}`,
    },
  }),
);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing pinned source fixture');
  return value;
}
function bytes() {
  const source = new Uint8Array(readFileSync(`${directory}/android_kick.glb`));
  expect(createHash('sha256').update(source).digest('hex')).toBe(sourceHash);
  expect(
    createHash('sha256')
      .update(readFileSync(`${directory}/manifest.json`))
      .digest('hex'),
  ).toBe(manifestHash);
  return source;
}
async function prepare() {
  return createPinnedDerivedThreeAssetPack({
    derivedBytes: new Uint8Array(
      readFileSync(`public${ANDROID_DERIVED_PACK_V1.url}`),
    ),
    artifactBytes: new Uint8Array(
      readFileSync(`public${ANDROID_RUNTIME_ARTIFACT_V1.url}`),
    ),
    rootPolicies: policies,
    signal: new AbortController().signal,
  });
}
function disposeSource(scene: Object3D, mixer: AnimationMixer) {
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  const geometries = new Set<Mesh['geometry']>();
  const materials = new Set<Exclude<Mesh['material'], unknown[]>>();
  const skeletons = new Set<SkinnedMesh['skeleton']>();
  scene.traverse((part) => {
    if (part instanceof Mesh) {
      geometries.add(part.geometry);
      for (const material of Array.isArray(part.material)
        ? part.material
        : [part.material])
        materials.add(material);
    }
    if (part instanceof SkinnedMesh) skeletons.add(part.skeleton);
  });
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

test('pinned native-XYZ driver retains Roundhouse root instead of silently using full extraction', async () => {
  const source = await new GLTFLoader().parseAsync(bytes().buffer, '');
  const mixer = new AnimationMixer(source.scene);
  const action = mixer.clipAction(
    required(source.animations.find((clip) => clip.name === 'RoundhouseKick')),
  );
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.paused = true;
  action.play();
  const pack = await prepare();
  const rig = pack.create('white');
  try {
    const binding = required(
      required(pack.poseBindings).clips.find(
        (clip) => clip.clipId === 'RoundhouseKick',
      ),
    );
    action.time = 0.7;
    mixer.update(0);
    source.scene.updateMatrixWorld(true);
    required(rig.seekPose).call(rig, binding, durationMs(700));
    const expected = required(
      source.scene.getObjectByName('root'),
    ).getWorldPosition(new Vector3());
    const actual = rig.node.worldToLocal(
      required(rig.node.getObjectByName('root')).getWorldPosition(
        new Vector3(),
      ),
    );
    expect(actual.distanceTo(expected)).toBeLessThan(1e-10);
  } finally {
    rig.dispose();
    pack.dispose();
    disposeSource(source.scene, mixer);
  }
});

test('three in-place source curves, every surface vertex and stamped entry retain native XYZ with root applied zero times', async () => {
  const sourceBytes = bytes();
  const inspection = inspectGlb(sourceBytes);
  const original = await new GLTFLoader().parseAsync(
    sourceBytes.slice().buffer,
    '',
  );
  const mixer = new AnimationMixer(original.scene);
  const baseline: {
    node: Object3D;
    p: Vector3;
    q: Object3D['quaternion'];
    s: Vector3;
  }[] = [];
  original.scene.traverse((node) =>
    baseline.push({
      node,
      p: node.position.clone(),
      q: node.quaternion.clone(),
      s: node.scale.clone(),
    }),
  );
  const sampleOriginal = (name: string, seconds: number) => {
    mixer.stopAllAction();
    for (const { node, p, q, s } of baseline) {
      node.position.copy(p);
      node.quaternion.copy(q);
      node.scale.copy(s);
    }
    const action = mixer.clipAction(
      required(original.animations.find((clip) => clip.name === name)),
    );
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.paused = true;
    action.time = seconds;
    action.play();
    mixer.update(0);
    original.scene.updateMatrixWorld(true);
  };
  const pack = await prepare();
  const rig = pack.create('white');
  const parent = new Group();
  parent.position.set(3, 2, -5);
  parent.rotation.set(0.13, 0.6, -0.07);
  parent.scale.set(0.7, 1.3, 1.1);
  parent.add(rig.node);
  parent.updateMatrixWorld(true);
  const parentBefore = parent.matrixWorld.clone();
  const meshes = (node: Object3D) => {
    const found: SkinnedMesh[] = [];
    node.traverse((part) => {
      if (part instanceof SkinnedMesh) found.push(part);
    });
    return found;
  };
  const expectedMeshes = meshes(original.scene),
    actualMeshes = meshes(rig.node);
  const sourceRoot = required(original.scene.getObjectByName('root'));
  const leftFoot = selectSkinSurface(
    original.scene,
    required(original.scene.getObjectByName('footL')),
  );
  let checked = 0,
    maximum = 0;
  const compare = () => {
    const inverse = rig.node.matrixWorld.clone().invert();
    expect(actualMeshes).toHaveLength(expectedMeshes.length);
    let minY = Infinity;
    for (let m = 0; m < expectedMeshes.length; m++) {
      const a = required(expectedMeshes[m]),
        b = required(actualMeshes[m]);
      a.skeleton.update();
      b.skeleton.update();
      expect(b.geometry.getAttribute('position').count).toBe(
        a.geometry.getAttribute('position').count,
      );
      for (let v = 0; v < a.geometry.getAttribute('position').count; v++) {
        const expected = a
          .getVertexPosition(v, new Vector3())
          .applyMatrix4(a.matrixWorld);
        const actual = b
          .getVertexPosition(v, new Vector3())
          .applyMatrix4(b.matrixWorld)
          .applyMatrix4(inverse);
        maximum = Math.max(maximum, actual.distanceTo(expected));
        minY = Math.min(minY, expected.y);
        checked++;
      }
    }
    expect(parent.matrixWorld.equals(parentBefore)).toBe(true);
    return minY;
  };
  try {
    const descriptor = required(pack.poseBindings);
    const records = ANDROID_DERIVED_PACK_V1.clips.map((origin) => ({
      clipId: clipId(origin.name),
      durationMs: required(
        descriptor.clips.find((b) => b.clipId === origin.name),
      ).durationMs,
      sourceSha256: origin.sourceSha256,
      sourceClipIndex: origin.sourceClipIndex,
    }));
    const legacy = await buildPoseBindings(records);
    const grounded = await buildPoseBindings(
      records.map((record) => {
        const policy = policies.find((p) => p.clipId === record.clipId);
        return policy
          ? {
              ...record,
              rootPolicy: copyRootPolicy({
                ...policy,
                mode: 'grounded-posture-y',
              }),
            }
          : record;
      }),
    );
    const poison = required(descriptor.clips.find((b) => b.clipId === 'Jump'));
    for (const [index, recipe] of recipes.entries()) {
      required(rig.seekPose).call(rig, poison, durationMs(300));
      const policy = required(policies[index]);
      const binding = required(
        descriptor.clips.find((b) => b.clipId === recipe.name),
      );
      expect(binding.sourceBindingId).not.toBe(
        required(legacy.clips.find((b) => b.clipId === recipe.name))
          .sourceBindingId,
      );
      expect(binding.sourceBindingId).not.toBe(
        required(grounded.clips.find((b) => b.clipId === recipe.name))
          .sourceBindingId,
      );
      expect(pack.rootPolicy(binding.clipId)).toEqual(policy);
      const inspected = required(
        inspection.clips.find((clip) => clip.name === recipe.name),
      );
      const times = [
        ...new Set([
          0,
          ...inspected.sampleTimes,
          ...inspected.sampleTimes
            .slice(1)
            .map((t, i) => (t + required(inspected.sampleTimes[i])) / 2),
        ]),
      ].sort((a, b) => a - b);
      sampleOriginal(recipe.name, 0);
      const origin = sourceRoot.getWorldPosition(new Vector3());
      const evaluator = await createSourceEvaluator(
        sourceBytes,
        recipe.name,
        [{ shapeId: 'foot-origin-diagnostic', bone: 'foot.R', radiusM: 0.01 }],
        policy,
      );
      let rawX = 0,
        rawY = 0,
        sourceFloor = Infinity,
        soleMin = Infinity,
        soleMax = -Infinity;
      try {
        for (const seconds of times) {
          sampleOriginal(recipe.name, seconds);
          const raw = sourceRoot.getWorldPosition(new Vector3()).sub(origin);
          const sample = evaluator.sample(durationMs(seconds * 1000));
          expect(sample.root.position).toEqual({ x: 0, y: 0, z: 0 });
          expect(
            new Vector3(
              sample.rawRoot.position.x,
              sample.rawRoot.position.y,
              sample.rawRoot.position.z,
            ).distanceTo(raw),
          ).toBeLessThan(1e-10);
          rawX = Math.max(rawX, Math.abs(raw.x));
          rawY = Math.max(rawY, Math.abs(raw.y));
          required(rig.seekPose).call(rig, binding, durationMs(seconds * 1000));
          sourceFloor = Math.min(sourceFloor, compare());
          let bottom = Infinity;
          for (const { mesh, vertexIndices } of leftFoot)
            for (const v of vertexIndices)
              bottom = Math.min(
                bottom,
                mesh
                  .getVertexPosition(v, new Vector3())
                  .applyMatrix4(mesh.matrixWorld).y,
              );
          soleMin = Math.min(soleMin, bottom);
          soleMax = Math.max(soleMax, bottom);
        }
      } finally {
        evaluator.dispose();
      }
      for (const seconds of [binding.durationMs / 1000, 0, 0.7, 0.7, 0.1]) {
        sampleOriginal(recipe.name, seconds);
        required(rig.seekPose).call(rig, binding, durationMs(seconds * 1000));
        compare();
      }
      expect(rawX).toBeGreaterThan(0.1);
      expect(rawY).toBeGreaterThan(0.01);
      console.info(
        JSON.stringify({
          clip: recipe.name,
          poses: times.length,
          rawX,
          rawY,
          sourceFloor,
          leftFootSurfaceMin: soleMin,
          leftFootSurfaceMax: soleMax,
          supportScope:
            'finite source foot-subtree, not clipped-sole or continuous contact acceptance',
        }),
      );
    }
    // Delayed first defeat reconstructs source, not the last displayed unrelated clip.
    required(rig.seekPose).call(rig, poison, durationMs(500));
    const entry = required(
      descriptor.clips.find((b) => b.clipId === 'LowSweep'),
    );
    const request = {
      runId: runId('in-place-proof'),
      actorId: actorId('white'),
      defeatStartedAt: presentationTimeMs(100),
      deathClipId: clipId('DefeatKick'),
      deathClipTime: durationMs(0),
      entry: {
        binding: entry,
        clipTime: durationMs(600),
        sampleSide: 'left' as const,
      },
    };
    required(rig.seekDefeat).call(rig, {
      ...request,
      deathClipTime: durationMs(200),
    });
    required(rig.seekDefeat).call(rig, request);
    sampleOriginal('LowSweep', 0.6);
    const entryMin = compare();
    const observation = required(required(rig.defeatPoseSupport).call(rig));
    expect(Math.abs(observation.entryLocalMinY - entryMin)).toBeLessThan(1e-10);
    const before = required(rig.node.getObjectByName('root')).position.clone();
    expect(() =>
      required(rig.seekDefeat).call(rig, {
        ...request,
        entry: {
          ...request.entry,
          binding: required(
            grounded.clips.find((b) => b.clipId === 'LowSweep'),
          ),
        },
      }),
    ).toThrow();
    expect(
      required(rig.node.getObjectByName('root')).position.equals(before),
    ).toBe(true);
    expect(checked).toBeGreaterThan(17_000_000);
    expect(maximum).toBeLessThan(1e-10);
    expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(
      sourceHash,
    );
    console.info(
      JSON.stringify({
        checked,
        maximum,
        sourceEquivalenceM: 1e-10,
        scope:
          'finite CPU source equivalence, no gameplay/head-provider qualification',
      }),
    );
  } finally {
    rig.dispose();
    pack.dispose();
    disposeSource(original.scene, mixer);
  }
}, 60_000);
