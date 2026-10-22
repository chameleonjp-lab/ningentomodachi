import type {
  AnimationModuleContext,
  AnimationPort,
  MotionCatalogPort,
} from '../contracts';
import { createActorAnimator, type AnimatorAssets } from './actorAnimator';
/** Compose B's public ports using a prepared engine asset provider and a run-scoped catalog.
 * A owns lifecycle and calls catalog.prepare before any actor render. No app/world wiring here. */
export function createAssetsModule<Node>(
  context: AnimationModuleContext<Node>,
  catalog: MotionCatalogPort,
  assets: AnimatorAssets<Node>,
): { readonly catalog: MotionCatalogPort; readonly animation: AnimationPort } {
  return { catalog, animation: createActorAnimator(context, assets) };
}
export { createActorAnimator } from './actorAnimator';
export type { ActorRig, AnimatorAssets } from './actorAnimator';
export { createMotionCatalog } from './motionCatalog';
export type { MotionAsset, ShapeCurve } from './motionCatalog';
export { bakeMotion } from './bakeMotion';
export type { BakeInput, EvaluatedPose } from './bakeMotion';
export { createThreeAssetPack } from './threeAssetPack';
export type { ThreeAssetPack, VerifiedPalette } from './threeAssetPack';
export { loadVerifiedSource } from './loadVerifiedSource';
export { inspectGlb } from './source';
export { SOURCE_PALETTES } from './sourcePalettes';
export { authorDeathClips, deathClipSeconds } from './deathAnimation';

export { createSourceEvaluator } from './evaluateSource';
export type { SourceStrikeShape } from './evaluateSource';
