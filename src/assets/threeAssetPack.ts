import {
  type AnimationClip,
  AnimationMixer,
  Bone,
  LoopOnce,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SkinnedMesh,
  type Texture,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import {
  type ActorColor,
  resolvePoseEpoch,
  type ClipId,
  clipId,
  type DurationMs,
  durationMs,
  type PoseCatalogBindings,
  type PoseClipBinding,
  type PresentationTimeMs,
  type StampedDefeatSeek,
} from '../contracts';
import type { ActorRig, AnimatorAssets } from './actorAnimator';
import { fixedSwingTwistPath } from './entryRotation';
import { buildPoseBindings, type PoseBindingSource } from './poseBindings';
import {
  applyPoseToLayout,
  capturePose,
  type LocalPose,
} from './poseRecipeMath';
import {
  type CanonicalPoseQuery,
  samplePoseEpoch,
  captureCanonicalSnapshot,
  validateCanonicalQuery,
} from './recoveryDiagnostic';
import {
  type ClipRootPolicy,
  copyRootPolicy,
  extractedTranslation,
  verifyRootPolicySource,
} from './rootPolicy';
import {
  createSkinBounds,
  createMatrixSkinBounds,
  prepareSkinBounds,
  type SkinBoundsPlan,
} from './skinBounds';
import { inspectGlb } from './source';
import {
  createPoseFrameDriver,
  type PoseFrameRequest,
  type PoseFrameResult,
  captureDefeatSeek,
  RECOVERY_FRAME_CAPABILITY,
} from './poseFramePreparation';

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
  extends Pick<
    AnimatorAssets<Object3D>,
    | 'create'
    | 'clipDuration'
    | 'poseBindings'
    | 'recoveryCapability'
    | 'stageActor'
  > {
  clipNames(): readonly string[];
  rootPolicy(id: ClipId): ClipRootPolicy | undefined;
  dispose(): void;
}
/** Bounded private CPU transform evaluator. Never clones a Mesh, material or geometry. */
export function createPrivatePoseHierarchy(
  template: Object3D,
  plan: SkinBoundsPlan,
) {
  const mapping = new Map<Object3D, Object3D>();
  const copy = (source: Object3D): Object3D => {
    const target = source instanceof Bone ? new Bone() : new Object3D();
    target.name = source.name;
    target.position.copy(source.position);
    target.quaternion.copy(source.quaternion);
    target.scale.copy(source.scale);
    mapping.set(source, target);
    for (const child of source.children) target.add(copy(child));
    return target;
  };
  const node = copy(template),
    meshes: SkinnedMesh[] = [];
  template.traverse((part) => {
    if (part instanceof SkinnedMesh) meshes.push(part);
  });
  const bounds = createMatrixSkinBounds(plan, () =>
    meshes.map((mesh) => {
      const target = mapping.get(mesh);
      if (!target) throw Error('Missing private mesh transform');
      return {
        matrixWorld: target.matrixWorld,
        bindMatrix: mesh.bindMatrix,
        bindMatrixInverse:
          mesh.bindMode === 'attached'
            ? target.matrixWorld.clone().invert()
            : mesh.bindMatrixInverse,
        bones: mesh.skeleton.bones.map((bone, index) => {
          const mapped = mapping.get(bone),
            inverse = mesh.skeleton.boneInverses[index];
          if (!mapped || !inverse) throw Error('Missing private bone binding');
          return { world: mapped.matrixWorld, inverse };
        }),
      };
    }),
  );
  return {
    node,
    bounds,
    stats: Object.freeze({
      transformNodes: mapping.size,
      meshClones: 0,
      geometryClones: 0,
      materialClones: 0,
      sourceVertices: plan.meshes.reduce(
        (n, m) => n + m.positions.length / 3,
        0,
      ),
      retainedSupportPoints: plan.meshes.reduce(
        (n, m) => n + m.groups.reduce((a, g) => a + g.points.length, 0),
        0,
      ),
      transformNumericBytesEstimate: mapping.size * (3 + 4 + 3 + 16 + 16) * 8,
      sharedSupportNumericBytesEstimate: plan.meshes.reduce(
        (n, m) =>
          n +
          (m.positions.length +
            m.joints.length +
            m.weights.length +
            m.groups.reduce(
              (a, g) =>
                a + g.joints.length + g.weights.length + g.points.length * 3,
              0,
            )) *
            8,
        0,
      ),
    }),
    dispose: () => {
      mapping.clear();
      meshes.length = 0;
      node.clear();
    },
  };
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
    /** Internal only: the built-in verified lossless manifest retains original source identity. */
    readonly poseOrigin?: (
      name: string,
      sourceIndex: number,
      sourceClipIndex: number,
    ) => {
      readonly sourceSha256: string;
      readonly sourceClipIndex: number;
    };
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
  // Detached source-index associations, not names, authorize diagnostic correspondence.
  const diagnosticSourceNodes = new Map<Object3D, number>();
  loaded.at(0)?.parser.associations.forEach((mapping, object) => {
    if (object instanceof Object3D && mapping.nodes !== undefined)
      diagnosticSourceNodes.set(object, mapping.nodes);
  });
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
  let poseBindings: PoseCatalogBindings | undefined;
  const originalNames = new Set(
    receipts.flatMap((receipt) => receipt.clips.map((clip) => clip.name)),
  );
  try {
    if (
      ['Idle', 'Walk', 'Run', 'Jump'].every((name) => originalNames.has(name))
    ) {
      const origins: PoseBindingSource[] = [];
      for (let sourceIndex = 0; sourceIndex < receipts.length; sourceIndex++) {
        const receipt = receipts[sourceIndex],
          bytes = captured[sourceIndex];
        if (!receipt || !bytes) throw new Error('Missing pose source');
        const sourceHash = preparation?.poseOrigin
          ? undefined
          : sourceIndex === 0
            ? sourceKey
            : [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
                .map((value) => value.toString(16).padStart(2, '0'))
                .join('');
        for (let index = 0; index < receipt.clips.length; index++) {
          const sourceClip = receipt.clips[index];
          if (!sourceClip) throw new Error('Missing pose source clip');
          const clip = animations.get(sourceClip.name);
          if (!clip) throw new Error('Missing loaded pose clip');
          const origin = preparation?.poseOrigin?.(
            sourceClip.name,
            sourceIndex,
            index,
          );
          const sourceSha256 = origin?.sourceSha256 ?? sourceHash;
          if (!sourceSha256) throw new Error('Missing original pose hash');
          const policy = policyMap.get(clipId(sourceClip.name));
          origins.push({
            clipId: clipId(clip.name),
            durationMs: durationMs(clip.duration * 1000),
            sourceSha256,
            sourceClipIndex: origin?.sourceClipIndex ?? index,
            ...(policy ? { rootPolicy: policy } : {}),
          });
        }
      }
      poseBindings = await buildPoseBindings(
        origins,
        preparation ? () => preparation.checkpoint('pose:binding') : undefined,
      );
    }
  } catch (error) {
    for (const item of loaded) releaseScene(item.scene);
    throw error;
  }
  const poseById = new Map(
    poseBindings?.clips.map((binding) => [binding.clipId, binding]),
  );
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
    poseById.clear();
    diagnosticSourceNodes.clear();
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
  const evaluateFrame = (
    color: ActorColor,
    request: PoseFrameRequest,
  ): PoseFrameResult => {
    // One ephemeral, unskinned hierarchy/mixer per preparation. Disposal in
    // finally prevents abandoned/failed frames from poisoning private caches.
    const evaluator = createRig(color, true);
    try {
      if (request.kind === 'living') {
        const diagnostic = evaluator.recoveryDiagnostic;
        if (!diagnostic) throw Error('Missing private source evaluator');
        const sample = samplePoseEpoch(
          request.epoch,
          request.at,
          request.side,
          diagnostic.sampleCanonical,
        );
        return { pose: sample.pose };
      }
      evaluator.seekDefeat?.(request.input);
      const pose: LocalPose = (() => {
        const result: {
          id: string;
          parent: string | null;
          t: number[];
          q: number[];
          s: number[];
        }[] = [];
        const walk = (
          original: Object3D,
          part: Object3D,
          parent: string | null,
          path: string,
        ) => {
          const sourceIndex = diagnosticSourceNodes.get(original),
            id =
              sourceIndex === undefined
                ? `generated:${path}`
                : `gltf:${sourceIndex}`;
          if (part !== evaluator.node)
            result.push({
              id,
              parent,
              t: part.position.toArray(),
              q: part.quaternion.toArray(),
              s: part.scale.toArray(),
            });
          original.children.forEach((child, index) => {
            const target = part.children[index];
            if (!target) throw Error('Private hierarchy mismatch');
            walk(
              child,
              target,
              part === evaluator.node ? null : id,
              `${path}/${index}`,
            );
          });
        };
        walk(template, evaluator.node, null, 'scene');
        return result;
      })();
      const support = evaluator.defeatPoseSupport?.();
      return { pose, ...(support ? { support } : {}) };
    } finally {
      evaluator.dispose();
    }
  };
  const createRig = (
    color: ActorColor,
    privateTransformOnly = false,
  ): ActorRig<Object3D> => {
    if ((disposed && !privateTransformOnly) || !supportPlan)
      throw new Error('Asset pack disposed');
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
    const privateHierarchy = privateTransformOnly
      ? createPrivatePoseHierarchy(template, supportPlan)
      : undefined;
    const node = privateHierarchy?.node ?? clone(template),
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
      bone: Object3D;
      position: Object3D['position'];
      rotation: Object3D['quaternion'];
      scale: Object3D['scale'];
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
    const supportBounds =
      privateHierarchy?.bounds ?? createSkinBounds(node, supportPlan);
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
        node.parent ? node.parent.matrixWorld.clone().invert() : new Matrix4(),
      );
    };
    const baseline: typeof defeatEntry = [];
    node.traverse((part) => {
      // The outer actor container is not a glTF animation target. C parents are never captured.
      if (part !== node)
        baseline.push({
          bone: part,
          position: part.position.clone(),
          rotation: part.quaternion.clone(),
          scale: part.scale.clone(),
        });
    });
    let qualifiedUsed = false;
    let stampedIdentity: string | undefined;
    const resetSource = (switchClip: boolean) => {
      mixer.stopAllAction();
      for (const pose of baseline) {
        pose.bone.position.copy(pose.position);
        pose.bone.quaternion.copy(pose.rotation);
        pose.bone.scale.copy(pose.scale);
      }
      unblendedPose = [];
      if (switchClip) current = undefined;
    };
    const validatePose = (binding: PoseClipBinding, time: DurationMs) => {
      if (actorDisposed) throw new Error('Actor disposed');
      const known = binding && poseById.get(binding.clipId);
      if (
        !known ||
        binding.sourceBindingId !== known.sourceBindingId ||
        binding.durationMs !== known.durationMs ||
        !Number.isFinite(time) ||
        time < 0 ||
        time > known.durationMs
      )
        throw new Error('Invalid or mismatched source pose binding/time');
      return known;
    };
    const driver: Pick<ActorRig<Object3D>, 'seek'> = {
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
          } else if (saved === undefined && current !== undefined && isDeath) {
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
        } else if (policy?.mode !== 'in-place-posture-xyz') {
          root.position.copy(rootOrigin);
        }
        // Explicit in-place XYZ retains the native source root unchanged. No
        // transport or actor/parent inverse roundtrip is applied in this mode.
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
    };
    const evaluate = driver.seek;
    const sampleCanonical = (binding: PoseClipBinding, time: DurationMs) => {
      resetSource(true);
      const clip = animations.get(binding.clipId);
      if (!clip) throw new Error('Missing prepared source clip');
      evaluate(
        binding.clipId,
        time === binding.durationMs ? clip.duration : time / 1000,
      );
    };
    // Built only when explicitly requested on a dedicated diagnostic rig.
    const diagnosticLayout = () => {
      if (actorDisposed) throw new Error('Actor disposed');
      const result: { id: string; parent: string | null; part: Object3D }[] =
        [];
      const walk = (
        original: Object3D,
        part: Object3D,
        parent: string | null,
        path: string,
      ) => {
        if (
          original.name !== part.name ||
          (privateTransformOnly
            ? original instanceof Bone !== part instanceof Bone
            : original.type !== part.type) ||
          original.children.length !== part.children.length
        )
          throw new Error('Unsupported diagnostic clone correspondence');
        const sourceIndex = diagnosticSourceNodes.get(original);
        const id =
          sourceIndex === undefined
            ? `generated:${path}`
            : `gltf:${sourceIndex}`;
        if (part !== node) result.push({ id, parent, part });
        original.children.forEach((child, index) => {
          const childClone = part.children[index];
          if (!childClone) throw new Error('Missing diagnostic clone child');
          walk(
            child,
            childClone,
            part === node ? null : id,
            `${path}/${index}`,
          );
        });
      };
      walk(template, node, null, 'scene');
      return result;
    };
    const diagnosticCapture = (): LocalPose =>
      capturePose(
        diagnosticLayout().map(({ id, parent, part }) => ({
          id,
          parent,
          t: part.position.toArray(),
          q: part.quaternion.toArray(),
          s: part.scale.toArray(),
        })),
      );
    const beginQualified = () => {
      if (!qualifiedUsed) capturedEntries.clear();
      qualifiedUsed = true;
    };
    const frameDriver = privateTransformOnly
      ? undefined
      : createPoseFrameDriver(
          (request) => evaluateFrame(color, request),
          (result) => {
            const layout = diagnosticLayout();
            applyPoseToLayout(result.pose, layout, (value, index) => {
              const part = layout[index]?.part;
              if (!part) throw Error('Missing prepared target');
              part.position.fromArray(value.t);
              part.quaternion.fromArray(value.q);
              part.scale.fromArray(value.s);
            });
            beginQualified();
            observation = result.support;
            node.updateMatrixWorld(true);
          },
          () => {
            if (actorDisposed) throw Error('Actor disposed');
          },
        );
    references++;
    return {
      node,
      ...(frameDriver ? { poseFrame: frameDriver } : {}),
      recoveryDiagnostic: Object.freeze({
        sampleCanonical(query: CanonicalPoseQuery) {
          const captured = validateCanonicalQuery(query);
          const known = validatePose(captured.stamp.binding, captured.clipTime);
          // Validate complete identity/layout before touching source evaluator state.
          diagnosticCapture();
          beginQualified();
          sampleCanonical(known, captured.clipTime);
          return captureCanonicalSnapshot(
            captured,
            policyMap.get(known.clipId)?.mode ?? 'full-translation',
            diagnosticCapture(),
            `source-hierarchy:${sourceKey}`,
          );
        },
        apply(input: LocalPose) {
          if (actorDisposed) throw new Error('Actor disposed');
          const layout = diagnosticLayout();
          // Prevalidate actual raw local/world matrices before any local write.
          applyPoseToLayout(input, layout, (value, index) => {
            const entry = layout[index];
            if (!entry) throw new Error('Missing validated diagnostic entry');
            entry.part.position.fromArray(value.t);
            entry.part.quaternion.fromArray(value.q);
            entry.part.scale.fromArray(value.s);
          });
          beginQualified();
          node.updateWorldMatrix(true, true);
        },
      }),
      defeatPoseSupport: () => observation,
      seek(id, seconds, defeatStartedAt) {
        if (qualifiedUsed)
          throw new Error('Cannot mix legacy seek into a stamped rig');
        evaluate(id, seconds, defeatStartedAt);
      },
      seekPose(binding, time) {
        const known = validatePose(binding, time);
        beginQualified();
        sampleCanonical(known, time);
      },
      seekDefeat(request: StampedDefeatSeek) {
        const input = captureDefeatSeek(request);
        const composite = 'kind' in input.entry ? input.entry : undefined;
        const canonical = 'kind' in input.entry ? undefined : input.entry;
        if (actorDisposed) throw new Error('Actor disposed');
        if (
          typeof input.runId !== 'string' ||
          !input.runId.trim() ||
          typeof input.actorId !== 'string' ||
          !input.actorId.trim() ||
          !Number.isFinite(input.defeatStartedAt) ||
          input.defeatStartedAt < 0 ||
          (input.deathClipId !== 'DefeatPunch' &&
            input.deathClipId !== 'DefeatKick') ||
          !Number.isFinite(input.deathClipTime) ||
          input.deathClipTime < 0 ||
          input.deathClipTime > 500 ||
          input.entry.sampleSide !== 'left' ||
          !pelvis ||
          animations.get(input.deathClipId)?.duration !== 0.5
        )
          throw new Error('Invalid stamped defeat input');
        const binding = canonical
          ? validatePose(canonical.binding, canonical.clipTime)
          : undefined;
        if (composite) {
          validatePose(
            composite.epoch.outgoing.binding,
            composite.epoch.outgoing.binding.durationMs,
          );
          const destination = resolvePoseEpoch(
            composite.epoch.destination,
            composite.at,
            composite.at === composite.epoch.startMs ? 'right' : 'left',
          );
          if (destination.kind !== 'canonical')
            throw Error('Invalid composite destination');
          validatePose(destination.stamp.binding, destination.clipTime);
        }
        const identity = JSON.stringify([
          input.runId,
          input.actorId,
          input.defeatStartedAt,
          input.deathClipId,
          composite?.epoch.identity ?? binding?.clipId,
          binding?.durationMs,
          binding?.sourceBindingId,
          canonical?.clipTime ?? composite?.at,
          input.entry.sampleSide,
        ]);
        if (stampedIdentity !== undefined && stampedIdentity !== identity)
          throw new Error('Conflicting stamped defeat provenance');
        beginQualified();
        if (stampedIdentity === undefined) {
          if (composite) {
            const sample = samplePoseEpoch(
              composite.epoch,
              composite.at,
              'left',
              (query) => {
                const captured = validateCanonicalQuery(query),
                  known = validatePose(
                    captured.stamp.binding,
                    captured.clipTime,
                  );
                sampleCanonical(known, captured.clipTime);
                return captureCanonicalSnapshot(
                  captured,
                  policyMap.get(known.clipId)?.mode ?? 'full-translation',
                  diagnosticCapture(),
                  `source-hierarchy:${sourceKey}`,
                );
              },
            );
            const layout = diagnosticLayout();
            applyPoseToLayout(sample.pose, layout, (value, index) => {
              const part = layout[index]?.part;
              if (!part) throw Error('Missing composite target');
              part.position.fromArray(value.t);
              part.quaternion.fromArray(value.q);
              part.scale.fromArray(value.s);
            });
            node.updateMatrixWorld(true);
          } else if (binding && canonical)
            sampleCanonical(binding, canonical.clipTime);
          else throw Error('Missing defeat source');
          const floor = Math.min(0, measureSupport().floor);
          const minY = displayedBounds().min.y;
          const poses = baseline.map(({ bone }) => ({
            bone,
            position: bone.position.clone(),
            rotation: bone.quaternion.clone(),
            scale: bone.scale.clone(),
          }));
          capturedEntries.set(input.defeatStartedAt, {
            poses,
            floor,
            minY,
            pelvis: actorRotation(pelvis),
          });
          stampedIdentity = identity;
        }
        resetSource(
          current !== input.deathClipId || activation !== input.defeatStartedAt,
        );
        evaluate(
          input.deathClipId,
          input.deathClipTime / 1000,
          input.defeatStartedAt,
        );
      },
      setEmissiveEnabled(enabled) {
        if (actorDisposed) return;
        for (const [material, original] of emission)
          material.emissive.copy(original).multiplyScalar(enabled ? 1 : 0);
      },
      dispose() {
        if (actorDisposed) return;
        actorDisposed = true;
        frameDriver?.dispose();
        observation = undefined;
        capturedEntries.clear();
        baseline.length = 0;
        defeatEntry = [];
        defeatBase = [];
        unblendedPose = [];
        canonicalFall = undefined;
        entryFall = undefined;
        stampedIdentity = undefined;
        mixer.stopAllAction();
        mixer.uncacheRoot(node);
        const skeletons = new Set<SkinnedMesh['skeleton']>();
        node.traverse((part) => {
          if (part instanceof SkinnedMesh) skeletons.add(part.skeleton);
        });
        for (const skeleton of skeletons) skeleton.dispose();
        for (const material of materials) material.dispose();
        privateHierarchy?.dispose();
        references--;
        release();
      },
    };
  };
  return {
    recoveryCapability: RECOVERY_FRAME_CAPABILITY,
    stageActor(color) {
      if (disposed || !supportPlan) throw Error('Asset pack disposed');
      references++;
      let closed = false,
        transferred = false,
        rig: ActorRig<Object3D> | undefined,
        support: PoseFrameResult['support'];
      const driver = createPoseFrameDriver(
        (request) => evaluateFrame(color, request),
        (result) => {
          if (!rig?.recoveryDiagnostic)
            throw Error('Staged actor not materialized');
          rig.recoveryDiagnostic.apply(result.pose);
          rig.node.updateMatrixWorld(true);
          support = result.support;
        },
        () => {
          if (closed) throw Error('CPU stage disposed');
        },
      );
      const releaseStage = () => {
        references--;
        release();
      };
      return {
        poseFrame: driver,
        materialize() {
          if (closed || transferred) throw Error('CPU stage already consumed');
          const visible = createRig(color);
          rig = visible;
          transferred = true;
          releaseStage();
          return {
            ...visible,
            poseFrame: driver,
            defeatPoseSupport: () => support,
            dispose() {
              if (closed) return;
              closed = true;
              driver.dispose();
              support = undefined;
              visible.dispose();
            },
          };
        },
        dispose() {
          if (closed || transferred) return;
          closed = true;
          driver.dispose();
          releaseStage();
        },
      };
    },
    ...(poseBindings ? { poseBindings } : {}),
    rootPolicy: (id) => policyMap.get(id),
    clipNames: () => Object.freeze([...animations.keys()]),
    clipDuration: (id) => {
      const clip = animations.get(id);
      return clip ? durationMs(clip.duration * 1000) : undefined;
    },
    create: createRig,
    dispose() {
      if (disposed) return;
      disposed = true;
      release();
    },
  };
}
