import { readFileSync } from 'node:fs';
import { AnimationMixer, LoopOnce, Matrix4, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test } from 'vitest';
import {
  createSkinBounds,
  prepareSkinBounds,
} from '../../src/assets/skinBounds';

test('certified source hulls preserve all six full-surface extrema across all original 42 clips', async () => {
  const loader = new GLTFLoader(),
    loaded = [];
  for (const category of ['movement', 'jump', 'punch', 'kick']) {
    const bytes = new Uint8Array(
      readFileSync(
        `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`,
      ),
    );
    loaded.push(await loader.parseAsync(bytes.buffer, ''));
  }
  const first = loaded[0];
  if (!first) throw new Error('Missing source');
  const root = first.scene,
    plan = prepareSkinBounds(root),
    bounds = createSkinBounds(root, plan),
    mixer = new AnimationMixer(root),
    meshes: SkinnedMesh[] = [];
  root.traverse((node) => {
    if (node instanceof SkinnedMesh) meshes.push(node);
  });
  let maxError = 0,
    poses = 0,
    vertices = 0;
  const point = new Vector3(),
    inverse = new Matrix4();
  try {
    for (const clip of loaded.flatMap((item) => item.animations)) {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip);
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.paused = true;
      action.play();
      for (let sample = 0; sample <= 24; sample++) {
        action.time = (clip.duration * sample) / 24;
        mixer.update(0);
        root.position.set(sample * 0.01, -0.13, 0.2);
        root.rotation.set(0.11, 0.41, -0.08);
        root.scale.set(0.9, 1.1, 0.97);
        root.updateWorldMatrix(true, true);
        inverse.makeRotationY(sample * 0.07).setPosition(2, -3, 4);
        const actual = bounds.measure(inverse),
          min = new Vector3(Infinity, Infinity, Infinity),
          max = new Vector3(-Infinity, -Infinity, -Infinity);
        for (const mesh of meshes)
          for (
            let i = 0;
            i < mesh.geometry.getAttribute('position').count;
            i++
          ) {
            mesh
              .getVertexPosition(i, point)
              .applyMatrix4(mesh.matrixWorld)
              .applyMatrix4(inverse);
            min.min(point);
            max.max(point);
            vertices++;
          }
        for (const axis of ['x', 'y', 'z'] as const)
          maxError = Math.max(
            maxError,
            Math.abs(actual.min[axis] - min[axis]),
            Math.abs(actual.max[axis] - max[axis]),
          );
        poses++;
      }
    }
    expect(loaded.flatMap((item) => item.animations)).toHaveLength(42);
    expect(poses).toBe(1050);
    expect(plan.stats.retainedVertices).toBeLessThan(plan.stats.vertices / 2);
    expect(maxError).toBeLessThan(1e-10);
    console.log(
      JSON.stringify({
        kind: 'exact-weight-source-bounds',
        stats: plan.stats,
        poses,
        vertices,
        maxError,
      }),
    );
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    for (const item of loaded)
      item.scene.traverse((node) => {
        if (node instanceof SkinnedMesh) {
          node.geometry.dispose();
          node.skeleton.dispose();
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material])
            material.dispose();
        }
      });
  }
}, 180000);
