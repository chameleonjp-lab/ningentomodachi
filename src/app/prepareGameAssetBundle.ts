import type { AnimatorAssets } from '../assets/actorAnimator';
import {
  capturePoseBindings,
  omitCrouchLocomotion,
} from '../assets/poseBindings';
import { decodeMotionAssetJson } from '../assets/motionAssetJson';
import {
  assertRootPolicyCompatibility,
  type ClipRootPolicy,
  copyRootPolicy,
} from '../assets/rootPolicy';
import type { ThreeAssetPack } from '../assets/threeAssetPack';
import { clipId } from '../contracts';
import type { PreparedGameAssets } from './integratedGame';

/** Structural assembly, NOT source authentication, catalog admission or readiness.
 * The caller must authenticate/review the complete catalog and retain its envelope,
 * provenance and acceptance evidence. Pass asset members only, never envelopes.
 * A successful result still requires the integrated catalog/resident readiness gates.
 * The loader owns partial resources until it resolves; this function then owns the
 * returned pack, disposing on failure or transferring ownership to the result.
 */
export async function prepareGameAssetBundle(input: {
  readonly motions: readonly {
    readonly asset: unknown;
    readonly rootPolicy: ClipRootPolicy;
  }[];
  readonly locomotionClips: AnimatorAssets<unknown>['locomotionClips'];
  readonly signal: AbortSignal;
  readonly loadVisuals: (
    rootPolicies: readonly ClipRootPolicy[],
    signal: AbortSignal,
  ) => Promise<ThreeAssetPack>;
}): Promise<PreparedGameAssets> {
  const { signal, loadVisuals } = input;
  const check = () => {
    if (signal.aborted)
      throw new DOMException('Asset bundle preparation aborted', 'AbortError');
  };
  check();
  const rows = input.motions.map(({ asset, rootPolicy }) => ({
    asset: decodeMotionAssetJson(asset),
    rootPolicy: copyRootPolicy(rootPolicy),
  }));
  const ids = new Set<string>();
  if (!rows.length) throw new Error('Missing motion assets');
  for (const row of rows) {
    const id = row.asset.definition.clipId;
    if (ids.has(id) || row.rootPolicy.clipId !== id)
      throw new Error('Duplicate or mismatched motion identity');
    ids.add(id);
  }
  const crouch = input.locomotionClips.crouch;
  if (
    'crouch' in input.locomotionClips &&
    (typeof crouch !== 'string' || !crouch.trim())
  )
    throw new Error('Invalid crouch locomotion clip');
  const locomotionClips = Object.freeze({
    idle: clipId(input.locomotionClips.idle),
    walk: clipId(input.locomotionClips.walk),
    run: clipId(input.locomotionClips.run),
    jump: clipId(input.locomotionClips.jump),
    ...(crouch !== undefined ? { crouch: clipId(crouch) } : {}),
  });
  const policies = Object.freeze(rows.map((row) => row.rootPolicy));
  let pack: ThreeAssetPack | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    pack?.dispose();
  };
  try {
    check();
    pack = await loadVisuals(policies, signal);
    check();
    const owned = pack;
    assertRootPolicyCompatibility(rows, owned);
    const duration = (id: ReturnType<typeof clipId>) => {
      const value = owned.clipDuration(id);
      if (value === undefined || !Number.isFinite(value) || value <= 0)
        throw new Error(`Unavailable animation clip: ${id}`);
      return value;
    };
    for (const id of Object.values(locomotionClips)) duration(id);
    for (const id of ['DefeatPunch', 'DefeatKick'])
      if (duration(clipId(id)) !== 500)
        throw new Error(`Death clip must be exactly 500ms: ${id}`);
    for (const { asset } of rows)
      if (duration(asset.definition.clipId) !== asset.definition.durationMs)
        throw new Error(
          `Attack animation/catalog duration mismatch: ${asset.definition.clipId}`,
        );
    const { poseBindings, recoveryCapability, startupCapability, stageActor } =
      owned;
    if (crouch !== undefined) {
      if (!poseBindings) throw new Error('Missing crouch pose bindings');
      const captured = capturePoseBindings(poseBindings);
      const binding = captured.clips.find((c) => c.clipId === crouch);
      if (
        captured.locomotion.crouch !== crouch ||
        !binding ||
        binding.durationMs !== duration(clipId(crouch))
      )
        throw new Error(
          'Crouch pose binding and visual mapping/duration differ',
        );
    }
    const effectivePoseBindings =
      crouch === undefined && poseBindings?.locomotion?.crouch !== undefined
        ? await omitCrouchLocomotion(poseBindings)
        : poseBindings;
    check();
    return {
      motions: Object.freeze(rows.map((row) => row.asset)),
      animator: {
        locomotionClips,
        ...(effectivePoseBindings
          ? { poseBindings: effectivePoseBindings }
          : {}),
        ...(recoveryCapability ? { recoveryCapability } : {}),
        ...(startupCapability ? { startupCapability } : {}),
        ...(stageActor ? { stageActor: stageActor.bind(owned) } : {}),
        create: owned.create.bind(owned),
        clipDuration: owned.clipDuration.bind(owned),
        dispose,
      },
    };
  } catch (error) {
    try {
      dispose();
    } catch {
      /* Preserve even undefined loader/validation errors. */
    }
    throw error;
  }
}
