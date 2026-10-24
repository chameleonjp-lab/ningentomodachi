import {
  AnimationMixer,
  Euler,
  LoopOnce,
  Mesh,
  SkinnedMesh,
  Texture,
  Quaternion,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { DurationMs } from '../contracts';
import type { EvaluatedPose } from './bakeMotion';
import { inspectGlb } from './source';
import {
  copyRootPolicy,
  extractedTranslation,
  verifyRootPolicySource,
  type ClipRootPolicy,
} from './rootPolicy';
import { measureSkinSurface, selectSkinSurface } from './skinSurface';
export type SourceStrikeShape = {
  readonly shapeId: string;
  readonly bone: string;
} & (
  | {
      readonly radiusM: number;
      readonly surface?: never;
    }
  | {
      readonly surface: 'dominant-skin-subtree';
      readonly radiusM?: never;
    }
);
export interface SourceEvaluationExecution {
  readonly beforeUpdate: (event: {
    stage: 'startup' | 'sample';
    atMs: number;
  }) => void;
  readonly observeRootQuaternion?: (event: {
    stage: 'startup' | 'sample';
    atMs: number;
    quaternion: readonly [number, number, number, number];
  }) => void;
  readonly recordCleanupError?: (error: unknown) => void;
}
export type SourceEvaluator = Awaited<ReturnType<typeof createSourceEvaluator>>;
export type EvaluatedSourcePose = ReturnType<SourceEvaluator['sample']>;
/** Offline source evaluator: ascending exact accessor/fixed sample keys required for yaw unwrapping.
 * Joint origins/radii are explicit annotation inputs; they are not visually accepted hit surfaces.
 * Uses glTF's complete hierarchy once, yielding +Y-up/+Z-forward metres. */
export async function createSourceEvaluator(
  bytes: Uint8Array,
  clipName: string,
  shapes: readonly SourceStrikeShape[],
  rootPolicy?: ClipRootPolicy,
  execution?: SourceEvaluationExecution,
): Promise<{
  sample: (
    atMs: DurationMs,
  ) => EvaluatedPose & { readonly rawRoot: EvaluatedPose['root'] };
  surfaceSelections: readonly {
    readonly shapeId: string;
    readonly bone: string;
    readonly meshes: readonly {
      readonly meshName: string;
      readonly sourceMeshIndex: number | undefined;
      readonly sourcePrimitiveIndex: number | undefined;
      readonly vertexIndices: readonly number[];
    }[];
  }[];
  dispose: () => void;
}> {
  const captured = new Uint8Array(bytes);
  const policy = rootPolicy ? copyRootPolicy(rootPolicy) : undefined;
  if (policy) await verifyRootPolicySource(policy, captured, clipName);
  const inspection = inspectGlb(captured);
  if (!inspection.clips.some((clip) => clip.name === clipName))
    throw new Error('Unknown source clip');
  if (
    new Set(shapes.map((shape) => shape.shapeId)).size !== shapes.length ||
    shapes.some((shape) =>
      shape.surface === 'dominant-skin-subtree'
        ? shape.radiusM !== undefined
        : shape.surface !== undefined ||
          !Number.isFinite(shape.radiusM) ||
          shape.radiusM <= 0,
    )
  )
    throw new Error('Invalid strike annotations');
  const gltf = await new GLTFLoader().parseAsync(captured.buffer, '');
  // A rejected parser exposes no scene: only successfully returned resources are owned here.
  const resources = new Set<{ dispose: () => void }>();
  const mixerCleanup: (() => void)[] = [];
  let disposed = false;
  const cleanup = () => {
    if (disposed) return [];
    disposed = true;
    const errors: unknown[] = [];
    for (const release of [
      ...mixerCleanup,
      ...[...resources].map((resource) => () => resource.dispose()),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
        try {
          execution?.recordCleanupError?.(error);
        } catch (observerError) {
          errors.push(observerError);
        }
      }
    }
    return errors;
  };
  try {
    for (const scene of new Set([gltf.scene, ...(gltf.scenes ?? [])]))
      scene.traverse((node) => {
        if (node instanceof Mesh) {
          resources.add(node.geometry);
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material]) {
            resources.add(material);
            for (const value of Object.values(material))
              if (value instanceof Texture) resources.add(value);
          }
        }
        if (node instanceof SkinnedMesh && node.skeleton)
          resources.add(node.skeleton);
      });
    const clip = gltf.animations.find((clip) => clip.name === clipName),
      root = gltf.scene.getObjectByName('root');
    const joints = shapes.map((shape) => ({
      shape,
      node:
        gltf.scene.getObjectByName(shape.bone) ??
        gltf.scene.getObjectByName(shape.bone.replace(/[[\].:/]/g, '')),
    }));
    if (!clip || !root || joints.some((joint) => !joint.node)) {
      throw new Error('Missing source clip/root/strike joint');
    }
    const surfaces = new Map<string, ReturnType<typeof selectSkinSurface>>();
    for (const { shape, node } of joints) {
      if (shape.surface === 'dominant-skin-subtree' && node)
        surfaces.set(shape.shapeId, selectSkinSurface(gltf.scene, node));
    }
    const mixer = new AnimationMixer(gltf.scene);
    mixerCleanup.push(
      () => {
        mixer.stopAllAction();
      },
      () => {
        mixer.uncacheRoot(gltf.scene);
      },
    );
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.paused = true;
    action.play();
    execution?.beforeUpdate({ stage: 'startup', atMs: 0 });
    action.time = 0;
    mixer.update(0);
    gltf.scene.updateMatrixWorld(true);
    const origin = root.getWorldPosition(new Vector3());
    const initialQuaternion = root.getWorldQuaternion(new Quaternion());
    execution?.observeRootQuaternion?.({
      stage: 'startup',
      atMs: 0,
      quaternion: initialQuaternion.toArray(),
    });
    let lastTime = -1,
      previousYaw = new Euler().setFromQuaternion(initialQuaternion, 'YXZ').y,
      unwrapped = 0;
    return {
      surfaceSelections: joints.flatMap(({ shape }) => {
        const parts = surfaces.get(shape.shapeId);
        return parts
          ? [
              {
                shapeId: shape.shapeId,
                bone: shape.bone,
                meshes: parts.map(({ mesh, vertexIndices }) => ({
                  meshName: mesh.name,
                  sourceMeshIndex: gltf.parser.associations.get(mesh)?.meshes,
                  sourcePrimitiveIndex:
                    gltf.parser.associations.get(mesh)?.primitives,
                  vertexIndices: [...vertexIndices],
                })),
              },
            ]
          : [];
      }),
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
        try {
          execution?.beforeUpdate({ stage: 'sample', atMs });
          lastTime = atMs;
          action.time = atMs / 1000;
          mixer.update(0);
          gltf.scene.updateMatrixWorld(true);
          const rawPosition = root.getWorldPosition(new Vector3()).sub(origin);
          const extracted = extractedTranslation(rawPosition, policy);
          const position = new Vector3(extracted.x, extracted.y, extracted.z);
          const quaternion = root.getWorldQuaternion(new Quaternion());
          execution?.observeRootQuaternion?.({
            stage: 'sample',
            atMs,
            quaternion: quaternion.toArray(),
          });
          const yaw = new Euler().setFromQuaternion(quaternion, 'YXZ').y;
          let delta = yaw - previousYaw;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          unwrapped += delta;
          previousYaw = yaw;
          return {
            rawRoot: {
              position: {
                x: rawPosition.x,
                y: rawPosition.y,
                z: rawPosition.z,
              },
              visualYawRad: unwrapped,
            },
            root: {
              position: { x: position.x, y: position.y, z: position.z },
              visualYawRad: unwrapped,
            },
            shapes: joints.map(({ shape, node }) => {
              if (!node) throw new Error('Missing joint');
              const parts = surfaces.get(shape.shapeId);
              const measured = parts ? measureSkinSurface(parts) : undefined;
              const point = (
                measured?.center ?? node.getWorldPosition(new Vector3())
              ).sub(position);
              const radiusM = measured?.radiusM ?? shape.radiusM;
              if (radiusM === undefined)
                throw new Error('Missing contact radius');
              return {
                shapeId: shape.shapeId,
                volume: {
                  kind: 'sphere',
                  center: { x: point.x, y: point.y, z: point.z },
                  radiusM,
                },
              };
            }),
          };
        } catch (error) {
          cleanup();
          throw error;
        }
      },
      dispose() {
        const errors = cleanup();
        if (errors.length)
          throw new AggregateError(errors, 'Source evaluator cleanup failed');
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
