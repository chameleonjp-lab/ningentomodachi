import {
  type AnimationClip,
  AnimationMixer,
  Bone,
  LoopOnce,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  SkinnedMesh,
  type Texture,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import {
  type ActorColor,
  type ClipId,
  durationMs,
  type PresentationTimeMs,
} from '../contracts';
import type { ActorRig, AnimatorAssets } from './actorAnimator';
import { fixedSwingTwistPath } from './entryRotation';
import {
  type ClipRootPolicy,
  copyRootPolicy,
  extractedTranslation,
  verifyRootPolicySource,
} from './rootPolicy';
import {
  createSkinBounds,
  prepareSkinBounds,
  type SkinBoundsPlan,
} from './skinBounds';
import { inspectGlb } from './source';

// Bounded immutable numeric plans only. No actor, scene, GPU or skeleton resources.
const supportPlans = new Map<string, SkinBoundsPlan>();
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
  rootPolicy(id: ClipId): ClipRootPolicy | undefined;
  dispose(): void;
}
/** Sources must be hash-verified by the transport first. White source is authoritative, nonwhite
 * palettes must come from source materials, never guessed color names. No renderer is created. */
export async function createThreeAssetPack(
  sources: readonly Uint8Array[],
  palettes: Partial<Record<ActorColor, VerifiedPalette>> = {},
  extraClips: readonly AnimationClip[] = [],
  rootPolicies: readonly ClipRootPolicy[] = [],
): Promise<ThreeAssetPack> {
  return prepareThreeAssetPack(sources, palettes, extraClips, rootPolicies);
}
/** Internal shared parser. The public pinned factory supplies verified offline data;
 * ordinary createThreeAssetPack remains the offline/qualification certifier. */
export async function prepareThreeAssetPack(
  sources: readonly Uint8Array[],
  palettes: Partial<Record<ActorColor, VerifiedPalette>>,
  extraClips: readonly AnimationClip[],
  rootPolicies: readonly ClipRootPolicy[],
  preparation?: {
    readonly checkpoint: (stage: string) => Promise<void>;
    readonly support: (template: Object3D) => Promise<SkinBoundsPlan>;
    /** Trusted derived factory binds original policy provenance to its pinned
     * lossless source map; legacy callers still hash original source bytes. */
    readonly verifyPolicy?: (policy: ClipRootPolicy) => Promise<void>;
    /** Trusted preparation strategy only; source authorization remains in the factory. */
    readonly inspect?: (
      bytes: Uint8Array,
      index: number,
    ) => Promise<ReturnType<typeof inspectGlb>>;
    readonly parse?: (
      bytes: Uint8Array,
      index: number,
    ) => ReturnType<GLTFLoader['parseAsync']>;
  },
): Promise<ThreeAssetPack> {
  if (!sources.length) throw new Error('No source GLBs');
  const captured = sources.map((bytes) => new Uint8Array(bytes));
  const policies = rootPolicies.map(copyRootPolicy);
  const derived = extraClips.map((clip) => clip.clone());
  const policyMap = new Map(policies.map((policy) => [policy.clipId, policy]));
  if (policyMap.size !== policies.length)
    throw new Error('Duplicate root policy');
  const receipts: ReturnType<typeof inspectGlb>[] = [];
  for (let index = 0; index < captured.length; index++) {
    const bytes = captured[index];
    if (!bytes) throw new Error('Missing source GLB');
    await preparation?.checkpoint(`inspect:${index}:before`);
    receipts.push(
      preparation?.inspect
        ? await preparation.inspect(bytes, index)
        : inspectGlb(bytes),
    );
    await preparation?.checkpoint(`inspect:${index}:after`);
  }
  for (const policy of policies) {
    const index = receipts.findIndex((receipt) =>
      receipt.clips.some((clip) => clip.name === policy.clipId),
    );
    const bytes = captured[index];
    if (!bytes) throw new Error('Unknown root policy clip');
    if (preparation?.verifyPolicy) await preparation.verifyPolicy(policy);
    else await verifyRootPolicySource(policy, bytes, policy.clipId);
    await preparation?.checkpoint(`policy:${policy.clipId}`);
  }
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
  for (const clip of derived) {
    if (names.has(clip.name)) throw new Error('Duplicate derived clip');
    names.add(clip.name);
  }
  const sourceKey = [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', captured[0] ?? new Uint8Array()),
    ),
  ]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  await preparation?.checkpoint('hash:template');
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
    for (let index = 0; index < captured.length; index++) {
      const bytes = captured[index];
      if (!bytes) throw new Error('Missing source GLB');
      await preparation?.checkpoint(`parse:${index}:before`);
      loaded.push(
        preparation?.parse
          ? await preparation.parse(bytes, index)
          : await loader.parseAsync(new Uint8Array(bytes).buffer, ''),
      );
      await preparation?.checkpoint(`parse:${index}:after`);
    }
  } catch (error) {
    for (const item of loaded) releaseScene(item.scene);
    throw error;
  }
  const template = loaded[0]?.scene;
  if (!template) throw new Error('No template');
  // Certify while the pack is being prepared, never on the first displayed frame.
  let supportPlan: SkinBoundsPlan | undefined;
  try {
    const cached = preparation ? undefined : supportPlans.get(sourceKey);
    supportPlan = preparation
      ? await preparation.support(template)
      : (cached ?? prepareSkinBounds(template));
    if (!preparation && !cached) {
      if (supportPlans.size >= 4) {
        const oldest = supportPlans.keys().next().value;
        if (oldest !== undefined) supportPlans.delete(oldest);
      }
      supportPlans.set(sourceKey, supportPlan);
    }
  } catch (error) {
    for (const item of loaded) releaseScene(item.scene);
    throw error;
  }
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
    supportPlan = undefined;
    animations.clear();
    policyMap.clear();
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
    rootPolicy: (id) => policyMap.get(id),
    clipNames: () => Object.freeze([...animations.keys()]),
    clipDuration: (id) => {
      const clip = animations.get(id);
      return clip ? durationMs(clip.duration * 1000) : undefined;
    },
    create(color): ActorRig<Object3D> {
      if (disposed || !supportPlan) throw new Error('Asset pack disposed');
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
      const actorRootOrigin = new Vector3();
      const unextractedRoot = root.position.clone();
      const mixer = new AnimationMixer(node);
      let current: ClipId | undefined;
      let actorDisposed = false;
      let defeatEntry: {
        bone: Bone;
        position: Bone['position'];
        rotation: Bone['quaternion'];
        scale: Bone['scale'];
      }[] = [];

      let unblendedPose: typeof defeatEntry = [];
      let defeatBase: typeof defeatEntry = [];
      const pelvis = node.getObjectByName('pelvis');
      let entryPelvis = new Quaternion();
      let startPelvis = new Quaternion();
      let endPelvis = new Quaternion();
      let canonicalFall: ReturnType<typeof fixedSwingTwistPath> | undefined;
      let entryFall: ReturnType<typeof fixedSwingTwistPath> | undefined;
      const actorRotation = (part: Object3D) =>
        node
          .getWorldQuaternion(new Quaternion())
          .invert()
          .multiply(part.getWorldQuaternion(new Quaternion()))
          .normalize();
      const supportBounds = createSkinBounds(node, supportPlan);
      let defeatEntryFloor = 0;
      let entryLocalMinY: number | undefined;
      let observation: ReturnType<
        NonNullable<ActorRig<Object3D>['defeatPoseSupport']>
      >;
      let activation: PresentationTimeMs | undefined;
      const capturedEntries = new Map<
        PresentationTimeMs,
        {
          poses: typeof defeatEntry;
          floor: number;
          minY: number;
          pelvis: Quaternion;
        } | null
      >();
      const measureSupport = () => {
        node.updateWorldMatrix(true, true);
        const actorInverse = node.matrixWorld.clone().invert();
        return {
          floor: supportBounds.measure(actorInverse).min.y,
          actorInverse,
        };
      };
      const displayedBounds = () => {
        node.updateWorldMatrix(true, true);
        return supportBounds.measure(
          node.parent
            ? node.parent.matrixWorld.clone().invert()
            : new Matrix4(),
        );
      };
      references++;
      return {
        node,
        defeatPoseSupport: () => observation,
        seek(id, seconds, defeatStartedAt) {
          observation = undefined;
          if (actorDisposed) throw new Error('Actor disposed');
          const clip = animations.get(id);
          if (!clip) throw new Error(`Unknown clip: ${id}`);
          if (
            !Number.isFinite(seconds) ||
            seconds < 0 ||
            seconds > clip.duration + 1e-7
          )
            throw new RangeError('Invalid animation seek');
          const isDeath = id === 'DefeatPunch' || id === 'DefeatKick';
          const switching =
            current !== id || (isDeath && activation !== defeatStartedAt);
          if (switching) {
            defeatEntry = [];
            defeatBase = [];
            entryLocalMinY = undefined;
            const saved =
              isDeath && defeatStartedAt !== undefined
                ? capturedEntries.get(defeatStartedAt)
                : undefined;
            if (saved) {
              defeatEntry = saved.poses;
              defeatEntryFloor = saved.floor;
              entryLocalMinY = saved.minY;
              entryPelvis = saved.pelvis.clone();
            } else if (
              saved === undefined &&
              current !== undefined &&
              isDeath
            ) {
              defeatEntryFloor = Math.min(0, measureSupport().floor);
              entryLocalMinY = displayedBounds().min.y;
              if (!pelvis) throw new Error('Missing defeated pelvis');
              entryPelvis = actorRotation(pelvis);
              node.traverse((bone) => {
                if (bone instanceof Bone)
                  defeatEntry.push({
                    bone,
                    position: bone.position.clone(),
                    rotation: bone.quaternion.clone(),
                    scale: bone.scale.clone(),
                  });
              });
            }
            if (
              isDeath &&
              defeatStartedAt !== undefined &&
              !capturedEntries.has(defeatStartedAt)
            )
              capturedEntries.set(
                defeatStartedAt,
                entryLocalMinY === undefined
                  ? null
                  : {
                      poses: defeatEntry,
                      floor: defeatEntryFloor,
                      minY: entryLocalMinY,
                      pelvis: entryPelvis.clone(),
                    },
              );
            activation = isDeath ? defeatStartedAt : undefined;
            mixer.stopAllAction();
            current = id;
          }
          if (!switching)
            for (const pose of unblendedPose) {
              pose.bone.position.copy(pose.position);
              pose.bone.quaternion.copy(pose.rotation);
              pose.bone.scale.copy(pose.scale);
            }
          unblendedPose = [];
          if (!switching && policyMap.get(id)?.mode === 'grounded-posture-y')
            root.position.copy(unextractedRoot);
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
            if (policyMap.get(id)?.mode === 'grounded-posture-y') {
              node.updateWorldMatrix(true, true);
              actorRootOrigin.copy(
                node.worldToLocal(root.getWorldPosition(new Vector3())),
              );
            }
            if (defeatEntry.length && pelvis) {
              defeatBase = defeatEntry.map(({ bone }) => ({
                bone,
                position: bone.position.clone(),
                rotation: bone.quaternion.clone(),
                scale: bone.scale.clone(),
              }));
              node.updateWorldMatrix(true, true);
              startPelvis = actorRotation(pelvis);
              action.time = clip.duration;
              mixer.update(0);
              node.updateWorldMatrix(true, true);
              endPelvis = actorRotation(pelvis);
              const localUp = new Vector3(0, 1, 0).applyQuaternion(
                startPelvis.clone().invert(),
              );
              canonicalFall = fixedSwingTwistPath(
                startPelvis,
                endPelvis,
                localUp,
              );
              entryFall = fixedSwingTwistPath(entryPelvis, endPelvis, localUp);
            }
          }
          action.time = Math.min(clip.duration, seconds);
          mixer.update(0);
          const policy = policyMap.get(id);
          if (policy?.mode === 'grounded-posture-y') {
            unextractedRoot.copy(root.position);
            // Partition in actor-local coordinates, then return through the bone parent.
            // Neither the actor node nor C's physical/presentation parents are written.
            node.updateWorldMatrix(true, true);
            if (!root.parent) throw new Error('Missing root parent');
            const current = node.worldToLocal(
              root.getWorldPosition(new Vector3()),
            );
            const raw = current.clone().sub(actorRootOrigin);
            const transport = extractedTranslation(raw, policy);
            current.sub(new Vector3(transport.x, transport.y, transport.z));
            root.position.copy(
              root.parent.worldToLocal(node.localToWorld(current)),
            );
          } else root.position.copy(rootOrigin);
          node.updateWorldMatrix(true, true);
          const canonicalPelvis = pelvis ? actorRotation(pelvis) : undefined;
          // Defeated visual pose only: blend from the actual last displayed pose,
          // not a reset guard. This never changes C's actor/physical anchor.
          // Mixer bindings skip writes for unchanged keys. Restore this unblended
          // pose on the next seek so presentation blending cannot contaminate them.
          unblendedPose = defeatEntry.map(({ bone }) => ({
            bone,
            position: bone.position.clone(),
            rotation: bone.quaternion.clone(),
            scale: bone.scale.clone(),
          }));
          const fraction = Math.min(1, seconds / 0.1);
          const blend = fraction * fraction * (3 - 2 * fraction);
          for (let index = 0; index < defeatEntry.length; index++) {
            const entry = defeatEntry[index],
              base = defeatBase[index];
            if (!entry || !base) throw new Error('Missing defeat entry basis');
            entry.bone.position.add(
              entry.position
                .clone()
                .sub(base.position)
                .multiplyScalar(1 - blend),
            );
            // Both endpoints of this slerp are fixed. Interpolating directly from
            // entry to a MOVING target flips paths when their dot crosses zero.
            const offset = entry.rotation
              .clone()
              .multiply(base.rotation.clone().invert())
              .normalize();
            entry.bone.quaternion.premultiply(
              new Quaternion().slerp(offset, 1 - blend),
            );
            entry.bone.scale.add(
              entry.scale
                .clone()
                .sub(base.scale)
                .multiplyScalar(1 - blend),
            );
          }
          if (
            defeatEntry.length &&
            pelvis &&
            canonicalPelvis &&
            canonicalFall &&
            entryFall
          ) {
            const progress = Math.min(1, seconds / clip.duration);
            const fall = progress * progress * (3 - 2 * progress);
            const baseline = canonicalFall(fall);
            const path = entryFall(fall);
            // Actor-local composition: canonical deviation * entry-specific fall.
            // Identical start poses reproduce the canonical motion exactly; no
            // upright classification threshold or early standing reset is used.
            const desired = canonicalPelvis
              .multiply(baseline.invert())
              .multiply(path)
              .normalize();
            node.updateWorldMatrix(true, true);
            const world = node
              .getWorldQuaternion(new Quaternion())
              .multiply(desired);
            pelvis.quaternion.copy(
              pelvis.parent
                ? pelvis.parent
                    .getWorldQuaternion(new Quaternion())
                    .invert()
                    .multiply(world)
                : world,
            );
          }
          // t0 is the exact retained displayed pose, not a quaternion round-trip
          // through potentially scaled B ancestors. C's entry identity is exact.
          if (seconds === 0)
            for (const pose of defeatEntry) {
              pose.bone.position.copy(pose.position);
              pose.bone.quaternion.copy(pose.rotation);
              pose.bone.scale.copy(pose.scale);
            }
          node.updateMatrixWorld(true);
          // Defeated-only local support throughout the entry-aware fall. The
          // inherited floor clears continuously; this is not a world collision
          // assertion. Never move the node, C parent, or physical anchor.
          if (defeatEntry.length && seconds > 0 && seconds < clip.duration) {
            const { floor, actorInverse } = measureSupport();
            const lift = Math.max(
              0,
              defeatEntryFloor * (1 - blend) +
                0.002 * Math.min(1, seconds / 0.02) -
                floor,
            );
            if (pelvis && Number.isFinite(lift) && lift > 0) {
              const target = pelvis
                .getWorldPosition(new Vector3())
                .applyMatrix4(actorInverse);
              target.y += lift;
              target.applyMatrix4(node.matrixWorld);
              pelvis.position.copy(
                pelvis.parent ? pelvis.parent.worldToLocal(target) : target,
              );
              node.updateMatrixWorld(true);
            }
          }
          if (isDeath && entryLocalMinY !== undefined)
            observation = {
              entryLocalMinY,
              currentLocalBounds: displayedBounds(),
            };
        },
        setEmissiveEnabled(enabled) {
          if (actorDisposed) return;
          for (const [material, original] of emission)
            material.emissive.copy(original).multiplyScalar(enabled ? 1 : 0);
        },
        dispose() {
          if (actorDisposed) return;
          actorDisposed = true;
          observation = undefined;
          capturedEntries.clear();
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
