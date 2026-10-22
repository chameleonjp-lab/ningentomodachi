/** Independent test oracle: pose the untouched GLTF with Three's mixer. No B extraction,
 * root-policy receipt, baked curve or runtime support implementation is used here. */
import {
  AnimationMixer,
  LoopOnce,
  Mesh,
  type Object3D,
  SkinnedMesh,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function meshes(node: Object3D): SkinnedMesh[] {
  const result: SkinnedMesh[] = [];
  node.traverse((part) => {
    if (part instanceof SkinnedMesh) result.push(part);
  });
  return result;
}
export async function createRawSourceOracle(
  bytes: Uint8Array,
  clipName: string,
) {
  const loaded = await new GLTFLoader().parseAsync(
    new Uint8Array(bytes).buffer,
    '',
  );
  const clip = loaded.animations.find(
    (candidate) => candidate.name === clipName,
  );
  if (!clip) throw new Error(`Missing untouched source clip ${clipName}`);
  const mixer = new AnimationMixer(loaded.scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.paused = true;
  action.play();
  const expectedMeshes = meshes(loaded.scene);
  const a = new Vector3(),
    b = new Vector3();
  let verified: Object3D | undefined;
  return {
    compare(actual: Object3D, seconds: number) {
      const actualMeshes = meshes(actual);
      if (verified !== actual) {
        if (actualMeshes.length !== expectedMeshes.length)
          throw new Error('Source/runtime mesh count differs');
        for (let m = 0; m < expectedMeshes.length; m++) {
          const source = expectedMeshes[m],
            runtime = actualMeshes[m];
          if (!source || !runtime) throw new Error('Missing comparison mesh');
          if (source.name !== runtime.name)
            throw new Error('Source/runtime mesh order differs');
          for (const attribute of ['position', 'skinIndex', 'skinWeight']) {
            const x = source.geometry.getAttribute(attribute),
              y = runtime.geometry.getAttribute(attribute);
            if (
              x.itemSize !== y.itemSize ||
              x.count !== y.count ||
              x.array.length !== y.array.length ||
              !Array.from(x.array).every(
                (value, index) => value === y.array[index],
              )
            )
              throw new Error(
                `Source/runtime ${source.name} ${attribute} differs`,
              );
          }
        }
        verified = actual;
      }
      action.time = seconds;
      mixer.update(0);
      loaded.scene.updateWorldMatrix(true, true);
      actual.updateWorldMatrix(true, true);
      let maxErrorM = 0,
        vertices = 0,
        expectedMinY = Infinity,
        actualMinY = Infinity;
      for (let m = 0; m < expectedMeshes.length; m++) {
        const source = expectedMeshes[m],
          runtime = actualMeshes[m];
        if (!source || !runtime) throw new Error('Missing comparison mesh');
        source.skeleton.update();
        runtime.skeleton.update();
        for (
          let i = 0;
          i < source.geometry.getAttribute('position').count;
          i++
        ) {
          source.getVertexPosition(i, a).applyMatrix4(source.matrixWorld);
          runtime.getVertexPosition(i, b).applyMatrix4(runtime.matrixWorld);
          maxErrorM = Math.max(maxErrorM, a.distanceTo(b));
          expectedMinY = Math.min(expectedMinY, a.y);
          actualMinY = Math.min(actualMinY, b.y);
          vertices++;
        }
      }
      return { maxErrorM, vertices, expectedMinY, actualMinY };
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(loaded.scene);
      loaded.scene.traverse((node) => {
        if (node instanceof Mesh) {
          node.geometry.dispose();
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material])
            material.dispose();
        }
      });
    },
  };
}
