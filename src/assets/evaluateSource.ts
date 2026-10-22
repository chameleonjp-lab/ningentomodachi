import {
  AnimationMixer,
  Euler,
  LoopOnce,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { DurationMs } from '../contracts';
import type { EvaluatedPose } from './bakeMotion';
import { inspectGlb } from './source';
export interface SourceStrikeShape {
  readonly shapeId: string;
  readonly bone: string;
  readonly radiusM: number;
}
/** Offline source evaluator: ascending exact accessor/fixed sample keys required for yaw unwrapping.
 * Joint origins/radii are explicit annotation inputs; they are not visually accepted hit surfaces.
 * Uses glTF's complete hierarchy once, yielding +Y-up/+Z-forward metres. */
export async function createSourceEvaluator(
  bytes: Uint8Array,
  clipName: string,
  shapes: readonly SourceStrikeShape[],
): Promise<{
  sample: (atMs: DurationMs) => EvaluatedPose;
  dispose: () => void;
}> {
  const inspection = inspectGlb(bytes);
  if (!inspection.clips.some((clip) => clip.name === clipName))
    throw new Error('Unknown source clip');
  if (
    new Set(shapes.map((shape) => shape.shapeId)).size !== shapes.length ||
    shapes.some(
      (shape) => !Number.isFinite(shape.radiusM) || shape.radiusM <= 0,
    )
  )
    throw new Error('Invalid strike annotations');
  const gltf = await new GLTFLoader().parseAsync(
    new Uint8Array(bytes).buffer,
    '',
  );
  const cleanup = () => {
    gltf.scene.traverse((node) => {
      if (node instanceof Mesh) {
        node.geometry.dispose();
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          material.dispose();
      }
    });
  };
  const clip = gltf.animations.find((clip) => clip.name === clipName),
    root = gltf.scene.getObjectByName('root');
  const joints = shapes.map((shape) => ({
    shape,
    node:
      gltf.scene.getObjectByName(shape.bone) ??
      gltf.scene.getObjectByName(shape.bone.replace(/[[\].:/]/g, '')),
  }));
  if (!clip || !root || joints.some((joint) => !joint.node)) {
    cleanup();
    throw new Error('Missing source clip/root/strike joint');
  }
  const mixer = new AnimationMixer(gltf.scene),
    action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.paused = true;
  action.play();
  action.time = 0;
  mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  const origin = root.getWorldPosition(new Vector3());
  let lastTime = -1,
    previousYaw = new Euler().setFromQuaternion(
      root.getWorldQuaternion(new Quaternion()),
      'YXZ',
    ).y,
    unwrapped = 0,
    disposed = false;
  return {
    sample(atMs) {
      if (
        disposed ||
        atMs < lastTime ||
        atMs > clip.duration * 1000 ||
        !Number.isFinite(atMs) ||
        atMs < 0
      )
        throw new RangeError(
          'Offline evaluator requires ascending valid sample times',
        );
      lastTime = atMs;
      action.time = atMs / 1000;
      mixer.update(0);
      gltf.scene.updateMatrixWorld(true);
      const position = root.getWorldPosition(new Vector3()).sub(origin);
      const yaw = new Euler().setFromQuaternion(
        root.getWorldQuaternion(new Quaternion()),
        'YXZ',
      ).y;
      let delta = yaw - previousYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      unwrapped += delta;
      previousYaw = yaw;
      return {
        root: {
          position: { x: position.x, y: position.y, z: position.z },
          visualYawRad: unwrapped,
        },
        shapes: joints.map(({ shape, node }) => {
          if (!node) throw new Error('Missing joint');
          const point = node.getWorldPosition(new Vector3()).sub(position);
          return {
            shapeId: shape.shapeId,
            volume: {
              kind: 'sphere',
              center: { x: point.x, y: point.y, z: point.z },
              radiusM: shape.radiusM,
            },
          };
        }),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      cleanup();
    },
  };
}
