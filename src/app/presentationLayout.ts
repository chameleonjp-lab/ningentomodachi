import type {
  PresentationExclusionId,
  PresentationExclusionRect,
  PresentationLayout,
  RunId,
  ViewportSnapshot,
} from '../contracts';
const ids = new Set<string>([
  'player-status',
  'opponent-status',
  'settings',
  'pause',
  'punch',
  'kick',
  'jump',
  'notice',
]);
const revision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';
/** One bounded detached capture. Invalid producer DTOs never become a clear-screen claim. */
function capture(
  value: unknown,
  run: RunId,
  viewport: ViewportSnapshot,
): PresentationLayout | undefined {
  if (!record(value)) return undefined;
  const { runId, viewportRevision, layoutRevision, rects } = value;
  if (
    runId !== run ||
    !revision(viewportRevision) ||
    viewportRevision !== viewport.revision ||
    !revision(layoutRevision) ||
    !Array.isArray(rects)
  )
    return undefined;
  const length = rects.length;
  if (
    !revision(length) ||
    length > 8 ||
    !Number.isFinite(viewport.widthCssPx) ||
    !Number.isFinite(viewport.heightCssPx) ||
    viewport.widthCssPx <= 0 ||
    viewport.heightCssPx <= 0
  )
    return undefined;
  const seen = new Set<string>();
  const result: PresentationExclusionRect[] = [];
  for (let i = 0; i < length; i++) {
    const item: unknown = rects[i];
    if (!record(item)) return undefined;
    const { id, left, top, right, bottom } = item;
    if (
      typeof id !== 'string' ||
      !ids.has(id) ||
      seen.has(id) ||
      typeof left !== 'number' ||
      typeof top !== 'number' ||
      typeof right !== 'number' ||
      typeof bottom !== 'number' ||
      ![left, top, right, bottom].every(Number.isFinite) ||
      left < 0 ||
      top < 0 ||
      right > viewport.widthCssPx ||
      bottom > viewport.heightCssPx ||
      right <= left ||
      bottom <= top
    )
      return undefined;
    seen.add(id);
    result.push(
      Object.freeze({
        id: id as PresentationExclusionId,
        left,
        top,
        right,
        bottom,
      }),
    );
  }
  return Object.freeze({
    runId: run,
    viewportRevision,
    layoutRevision,
    rects: Object.freeze(result),
  });
}
/** Run-scoped revision high-water mark. Unavailable never republishes a previous descriptor. */
export function createPresentationLayoutCapture() {
  let runId: RunId | undefined;
  let previous: PresentationLayout | undefined;
  return (
    value: unknown,
    run: RunId,
    viewport: ViewportSnapshot,
  ): PresentationLayout | undefined => {
    if (run !== runId) {
      runId = run;
      previous = undefined;
    }
    let next: PresentationLayout | undefined;
    try {
      next = capture(value, run, viewport);
    } catch {
      return undefined;
    }
    if (!next) return undefined;
    if (
      previous &&
      (next.layoutRevision < previous.layoutRevision ||
        (next.layoutRevision === previous.layoutRevision &&
          JSON.stringify(next) !== JSON.stringify(previous)))
    )
      return undefined;
    previous = next;
    return next;
  };
}
