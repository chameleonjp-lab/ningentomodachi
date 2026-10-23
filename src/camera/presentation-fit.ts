import type {
  ActorId,
  PresentationLayout,
  RunId,
  Vector3,
  ViewportSnapshot,
} from '../contracts';
import type { CameraFrame } from './camera-rig';

export interface ActorPresentationBounds {
  readonly actorId: ActorId;
  readonly corners: readonly Vector3[];
  readonly kind: 'actor-proxy' | 'pose-bounds';
}
export interface PresentationCameraInput {
  readonly runId: RunId;
  readonly layout?: PresentationLayout | undefined;
  readonly bounds?: readonly ActorPresentationBounds[];
}
export interface PresentationFitDiagnostic {
  readonly status: 'unavailable' | 'bounds-clear' | 'limited' | 'unprojectable';
  readonly layoutRevision?: number;
  readonly candidateCount: number;
  readonly boundsKind: 'actor-proxy' | 'mixed-pose-bounds';
  readonly occludedActorIds: readonly ActorId[];
}
const ids = new Set([
  'player-status',
  'opponent-status',
  'settings',
  'pause',
  'punch',
  'kick',
  'jump',
  'notice',
]);
export function availableLayout(
  input: PresentationCameraInput | undefined,
  viewport: ViewportSnapshot,
): PresentationLayout | undefined {
  const layout = input?.layout;
  if (
    !layout ||
    layout.runId !== input?.runId ||
    layout.viewportRevision !== viewport.revision ||
    !Number.isSafeInteger(layout.layoutRevision) ||
    layout.layoutRevision < 0 ||
    !Array.isArray(layout.rects) ||
    layout.rects.length > 8
  )
    return undefined;
  const seen = new Set<string>();
  for (const r of layout.rects) {
    if (
      !r ||
      !ids.has(r.id) ||
      seen.has(r.id) ||
      ![r.left, r.top, r.right, r.bottom].every(Number.isFinite) ||
      r.left < 0 ||
      r.top < 0 ||
      r.right > viewport.widthCssPx ||
      r.bottom > viewport.heightCssPx ||
      r.left >= r.right ||
      r.top >= r.bottom
    )
      return undefined;
    seen.add(r.id);
  }
  return layout;
}
export function positiveSafeViewport(viewport: ViewportSnapshot): boolean {
  const { widthCssPx: w, heightCssPx: h, safeAreaCssPx: s } = viewport;
  return (
    [w, h, s.left, s.right, s.top, s.bottom].every(Number.isFinite) &&
    Math.min(s.left, s.right, s.top, s.bottom) >= 0 &&
    w > s.left + s.right &&
    h > s.top + s.bottom
  );
}
type Projection = {
  visibility: 'visible' | 'offscreen' | 'unprojectable';
  cssPoint: { x: number; y: number } | null;
};
type Fit = {
  status: 'bounds-clear' | 'limited' | 'unprojectable';
  occludedActorIds: readonly ActorId[];
};
const distance = (frame: CameraFrame) =>
  Math.hypot(
    frame.position.x - frame.target.x,
    frame.position.y - frame.target.y,
    frame.position.z - frame.target.z,
  );
// Full solved geometry, not range alone: wall corrections may change elevation.
function identity(frame: CameraFrame): string {
  return JSON.stringify([
    ...[frame.position, frame.target, frame.right, frame.depth].flatMap((p) => [
      p.x,
      p.y,
      p.z,
    ]),
    frame.fovDegrees,
    Boolean(frame.constrained),
  ]);
}
function inspect(
  frame: CameraFrame,
  viewport: ViewportSnapshot,
  layout: PresentationLayout,
  bounds: readonly ActorPresentationBounds[],
  project: (p: Vector3, frame: CameraFrame) => Projection,
): Fit {
  if (frame.constrained || !positiveSafeViewport(viewport) || !bounds.length)
    return { status: 'unprojectable', occludedActorIds: [] };
  const occluded: ActorId[] = [];
  let outside = false;
  for (const actor of bounds) {
    if (!actor.corners.length)
      return { status: 'unprojectable', occludedActorIds: [] };
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (const p of actor.corners) {
      if (![p.x, p.y, p.z].every(Number.isFinite))
        return { status: 'unprojectable', occludedActorIds: [] };
      const q = project(p, frame);
      if (
        q.visibility === 'unprojectable' ||
        !q.cssPoint ||
        !Number.isFinite(q.cssPoint.x) ||
        !Number.isFinite(q.cssPoint.y)
      )
        return { status: 'unprojectable', occludedActorIds: [] };
      left = Math.min(left, q.cssPoint.x);
      right = Math.max(right, q.cssPoint.x);
      top = Math.min(top, q.cssPoint.y);
      bottom = Math.max(bottom, q.cssPoint.y);
      if (q.visibility !== 'visible') outside = true;
    }
    const safe = viewport.safeAreaCssPx;
    if (
      left < safe.left ||
      right > viewport.widthCssPx - safe.right ||
      top < safe.top ||
      bottom > viewport.heightCssPx - safe.bottom
    )
      outside = true;
    if (
      layout.rects.some(
        (r) =>
          left < r.right + 4 &&
          right > r.left - 4 &&
          top < r.bottom + 4 &&
          bottom > r.top - 4,
      )
    )
      occluded.push(actor.actorId);
  }
  return {
    status: outside || occluded.length ? 'limited' : 'bounds-clear',
    occludedActorIds: occluded,
  };
}

/** Pure, bounded selection. No profile state changes, DOM reads or camera updates. */
export function selectPresentationFrame(options: {
  readonly baseline: CameraFrame;
  readonly layout: PresentationLayout | undefined;
  readonly viewport: ViewportSnapshot;
  readonly bounds: readonly ActorPresentationBounds[];
  readonly priorDistance: number;
  readonly minDistance: number;
  readonly project: (p: Vector3, frame: CameraFrame) => Projection;
  readonly propose: (range: number) => CameraFrame;
  readonly damp: (frame: CameraFrame) => CameraFrame;
}): CameraFrame {
  const { baseline, layout, viewport, bounds } = options;
  const boundsKind = bounds.some((b) => b.kind === 'pose-bounds')
    ? 'mixed-pose-bounds'
    : 'actor-proxy';
  const cache = new Map<string, Fit>();
  const finish = (
    frame: CameraFrame,
    fit: Fit | { status: 'unavailable'; occludedActorIds: readonly ActorId[] },
  ): CameraFrame => ({
    ...frame,
    presentationFit: {
      ...fit,
      boundsKind,
      candidateCount: cache.size,
      ...(layout ? { layoutRevision: layout.layoutRevision } : {}),
    },
  });
  if (!layout)
    return finish(baseline, { status: 'unavailable', occludedActorIds: [] });
  const evaluate = (frame: CameraFrame): Fit | undefined => {
    const key = identity(frame),
      previous = cache.get(key);
    if (previous) return previous;
    if (cache.size >= 8) return undefined;
    const fit = inspect(frame, viewport, layout, bounds, options.project);
    cache.set(key, fit);
    return fit;
  };
  const baselineFit = evaluate(baseline);
  if (!baselineFit)
    return finish(baseline, { status: 'unprojectable', occludedActorIds: [] });
  // Never describe a geometry-constrained baseline as a safe UI fallback.
  if (baselineFit.status === 'unprojectable')
    return finish(baseline, baselineFit);
  let selected = baselineFit.status === 'bounds-clear' ? baseline : undefined;
  const baseDistance = distance(baseline);
  const ranges = [
    options.priorDistance,
    ...[1.05, 1.12, 1.25, 1.5, 2].map((scale) => baseDistance * scale),
  ];
  for (const rawRange of ranges) {
    const range = Math.min(180, Math.max(options.minDistance, rawRange));
    const candidate = options.propose(range);
    const fit = evaluate(candidate);
    if (
      fit?.status === 'bounds-clear' &&
      (!selected || distance(candidate) < distance(selected))
    )
      selected = candidate;
  }
  if (!selected) return finish(baseline, baselineFit);
  // The eighth distinct evaluation is reserved for damping. Reuse only exact
  // solved camera geometry, never a same-range certificate for a different ray.
  const damped = options.damp(selected),
    dampedFit = evaluate(damped);
  if (dampedFit?.status === 'bounds-clear') return finish(damped, dampedFit);
  const selectedFit = cache.get(identity(selected));
  return selectedFit
    ? finish(selected, selectedFit)
    : finish(baseline, baselineFit);
}
