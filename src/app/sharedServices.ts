import type {
  ViewportMetrics,
  ViewportReader,
  ViewportSnapshot,
} from '../contracts';
export const DEFAULT_VIEWPORT: ViewportMetrics = Object.freeze({
  widthCssPx: 1,
  heightCssPx: 1,
  offsetLeftCssPx: 0,
  offsetTopCssPx: 0,
  devicePixelRatio: 1,
  safeAreaCssPx: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
});
/** A/browser publishes; C/D receive the reader object, which has no mutation method. */
export function createViewportService(
  initial: ViewportMetrics = DEFAULT_VIEWPORT,
) {
  let revision = -1;
  let snapshot: ViewportSnapshot;
  const listeners = new Set<(viewport: ViewportSnapshot) => void>();
  function publish(metrics: ViewportMetrics) {
    if (
      ![
        metrics.widthCssPx,
        metrics.heightCssPx,
        metrics.devicePixelRatio,
      ].every((value) => Number.isFinite(value) && value > 0) ||
      ![metrics.offsetLeftCssPx, metrics.offsetTopCssPx].every(
        Number.isFinite,
      ) ||
      !Object.values(metrics.safeAreaCssPx).every(
        (value) => Number.isFinite(value) && value >= 0,
      )
    )
      throw new RangeError('Invalid CSS viewport metrics');
    snapshot = Object.freeze({
      ...metrics,
      safeAreaCssPx: Object.freeze({ ...metrics.safeAreaCssPx }),
      revision: ++revision,
    });
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  }
  publish(initial);
  const reader: ViewportReader = Object.freeze({
    read: () => snapshot,
    subscribe: (listener: (viewport: ViewportSnapshot) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  return { reader, publish };
}
