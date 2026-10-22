import {
  AnimationMixer,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
  type AnimationClip,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { durationMs, type ActorColor, type ClipId } from '../contracts';
import type { ActorRig, AnimatorAssets } from './actorAnimator';
import { inspectGlb } from './source';
export interface VerifiedPalette {
  readonly armorRgb: readonly [number, number, number];
  readonly emissiveRgb: readonly [number, number, number];
  readonly inlayBaseRgb: readonly [number, number, number];
  readonly emissiveStrength: number;
  readonly sourceSha256: string;
}
export interface ThreeAssetPack
  extends Pick<AnimatorAssets<Object3D>, 'create' | 'clipDuration'> {
  clipNames(): readonly string[];
  dispose(): void;
}
/** Sources must be hash-verified by the transport first. White source is authoritative, nonwhite
 * palettes must come from source materials, never guessed color names. No renderer is created. */
export async function createThreeAssetPack(
  sources: readonly Uint8Array[],
  palettes: Partial<Record<ActorColor, VerifiedPalette>> = {},
  extraClips: readonly AnimationClip[] = [],
): Promise<ThreeAssetPack> {
  if (!sources.length) throw new Error('No source GLBs');
  const receipts = sources.map(inspectGlb);
  if (new Set(receipts.map((source) => source.skeletonSignature)).size !== 1)
    throw new Error('Incompatible skeleton/bind pose');
  const names = new Set<string>();
  for (const receipt of receipts)
    for (const clip of receipt.clips) {
      if (names.has(clip.name)) throw new Error('Duplicate clip');
      names.add(clip.name);
    }
  // Validate a private snapshot before allocating scenes. Later caller edits cannot
  // introduce a duplicate after asynchronous parsing has started.
  const derived = extraClips.map((clip) => clip.clone());
  for (const clip of derived) {
    if (names.has(clip.name)) throw new Error('Duplicate derived clip');
    names.add(clip.name);
  }
  const loader = new GLTFLoader();
  const loaded: Awaited<ReturnType<GLTFLoader['parseAsync']>>[] = [];
  const releaseScene = (scene: Object3D) => {
    scene.traverse((node) => {
      if (node instanceof Mesh) {
        node.geometry.dispose();
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          material.dispose();
      }
    });
  };
  try {
    for (const bytes of sources)
      loaded.push(await loader.parseAsync(new Uint8Array(bytes).buffer, ''));
  } catch (error) {
    for (const item of loaded) releaseScene(item.scene);
    throw error;
  }
  const template = loaded[0]?.scene;
  if (!template) throw new Error('No template');
  const animations = new Map<string, AnimationClip>();
  for (const item of loaded)
    for (const clip of item.animations) animations.set(clip.name, clip);
  for (const clip of derived) {
    animations.set(clip.name, clip);
  }
  // Other category meshes never enter the scene. Their clips are compatible by validated signature.
  for (const item of loaded.slice(1)) releaseScene(item.scene);
  let disposed = false,
    references = 0,
    released = false;
  const release = () => {
    if (!disposed || references || released) return;
    released = true;
    const textures = new Set<Texture>();
    template.traverse((node) => {
      if (node instanceof Mesh)
        for (const mat of Array.isArray(node.material)
          ? node.material
          : [node.material])
          if (mat instanceof MeshStandardMaterial)
            for (const texture of [
              mat.map,
              mat.normalMap,
              mat.roughnessMap,
              mat.metalnessMap,
              mat.emissiveMap,
              mat.aoMap,
            ])
              if (texture) textures.add(texture);
    });
    releaseScene(template);
    for (const texture of textures) texture.dispose();
  };
  return {
    clipNames: () => Object.freeze([...animations.keys()]),
    clipDuration: (id) => {
      const clip = animations.get(id);
      return clip ? durationMs(clip.duration * 1000) : undefined;
    },
    create(color): ActorRig<Object3D> {
      if (disposed) throw new Error('Asset pack disposed');
      const palette = palettes[color];
      if (color !== 'white' && !palette)
        throw new Error(`Missing verified palette: ${color}`);
      if (
        palette &&
        (!/^[a-f0-9]{64}$/.test(palette.sourceSha256) ||
          [
            ...palette.armorRgb,
            ...palette.emissiveRgb,
            ...palette.inlayBaseRgb,
            palette.emissiveStrength,
          ].some((n) => !Number.isFinite(n) || n < 0))
      )
        throw new Error('Invalid verified palette');
      const node = clone(template),
        materials = new Set<Material>();
      const emission = new Map<
        MeshStandardMaterial,
        MeshStandardMaterial['emissive']
      >();
      node.traverse((part) => {
        if (part instanceof Mesh) {
          const copy = (original: Material) => {
            const material = original.clone();
            materials.add(material);
            if (material instanceof MeshStandardMaterial) {
              if (palette && material.name.startsWith('01 |'))
                material.color.setRGB(...palette.armorRgb);
              if (palette && material.name.startsWith('04 |')) {
                material.emissive.setRGB(...palette.emissiveRgb);
                material.color.setRGB(...palette.inlayBaseRgb);
                material.emissiveIntensity = palette.emissiveStrength;
              }
              emission.set(material, material.emissive.clone());
            }
            return material;
          };
          part.material = Array.isArray(part.material)
            ? part.material.map(copy)
            : copy(part.material);
        }
      });
      const root = node.getObjectByName('root');
      if (!root) {
        for (const material of materials) material.dispose();
        throw new Error('Missing authored root');
      }
      const rootOrigin = root.position.clone();
      const mixer = new AnimationMixer(node);
      let current: ClipId | undefined;
      let actorDisposed = false;
      references++;
      return {
        node,
        seek(id, seconds) {
          if (actorDisposed) throw new Error('Actor disposed');
          const clip = animations.get(id);
          if (!clip) throw new Error(`Unknown clip: ${id}`);
          if (
            !Number.isFinite(seconds) ||
            seconds < 0 ||
            seconds > clip.duration + 1e-7
          )
            throw new RangeError('Invalid animation seek');
          const switching = current !== id;
          if (switching) {
            mixer.stopAllAction();
            current = id;
          }
          const action = mixer.clipAction(clip);
          action.setLoop(LoopOnce, 1);
          action.clampWhenFinished = true;
          action.enabled = true;
          action.paused = true;
          action.setEffectiveTimeScale(1);
          action.setEffectiveWeight(1);
          action.play();
          if (switching) {
            // Same origin as the offline evaluator: retain the authored pose at clip zero,
            // remove only displacement from it. C applies that displacement once.
            action.time = 0;
            mixer.update(0);
            rootOrigin.copy(root.position);
          }
          action.time = Math.min(clip.duration, seconds);
          mixer.update(0);
          root.position.copy(rootOrigin);
          node.updateMatrixWorld(true);
        },
        setEmissiveEnabled(enabled) {
          if (actorDisposed) return;
          for (const [material, original] of emission)
            material.emissive.copy(original).multiplyScalar(enabled ? 1 : 0);
        },
        dispose() {
          if (actorDisposed) return;
          actorDisposed = true;
          mixer.stopAllAction();
          mixer.uncacheRoot(node);
          const skeletons = new Set<SkinnedMesh['skeleton']>();
          node.traverse((part) => {
            if (part instanceof SkinnedMesh) skeletons.add(part.skeleton);
          });
          for (const skeleton of skeletons) skeleton.dispose();
          for (const material of materials) material.dispose();
          references--;
          release();
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      release();
    },
  };
}
