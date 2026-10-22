import type { Unsubscribe, ViewportMetrics } from '../contracts';
import type { GameController } from './createGame';
export type BrowserLifecycleEvent = 'hidden' | 'visible' | 'blur';
export interface ViewportSource {
  read(): ViewportMetrics;
  subscribe(listener: (metrics: ViewportMetrics) => void): Unsubscribe;
}
export interface BrowserHost {
  readonly viewport?: ViewportSource;
  requestFrame(listener: (nowMs: number) => void): number;
  cancelFrame(id: number): void;
  subscribe(listener: (event: BrowserLifecycleEvent) => void): Unsubscribe;
}
/** Browser services are injected so bootstrap and interruption behavior remain headless-testable. */
export function bootstrap(
  game: GameController,
  host: BrowserHost,
  onError: (error: unknown) => void = () => {},
  options: { readonly autoPrepare?: boolean } = {},
) {
  let stopped = false;
  let frameId: number | null = null;
  let previous: number | null = null;
  let hidden = false;
  let previousRun: string | null = null;
  let previousEpoch = game.timingEpoch();
  if (host.viewport) game.updateViewport(host.viewport.read());
  const unsubscribeViewport =
    host.viewport?.subscribe((metrics) => {
      if (stopped) return;
      previous = null;
      game.updateViewport(metrics);
    }) ?? (() => {});
  const unsubscribe = host.subscribe((event) => {
    if (stopped) return;
    previous = null;
    const wasHidden = hidden;
    if (event === 'hidden') hidden = true;
    if (event === 'visible') hidden = false;
    const snapshot = game.read();
    if (!snapshot) return;
    if (event === 'hidden')
      game.dispatch({ type: 'Backgrounded', runId: snapshot.runId });
    else if (event === 'visible') {
      // A retry may have created this run while hidden, without receiving the original event.
      if (wasHidden)
        game.dispatch({ type: 'Backgrounded', runId: snapshot.runId });
      game.dispatch({ type: 'Foregrounded', runId: snapshot.runId });
    } else
      game.dispatch({
        type: 'PauseRequested',
        runId: snapshot.runId,
        reason: 'interruption',
      });
  });
  function dispose() {
    if (stopped) return;
    stopped = true;
    const errors: unknown[] = [];
    const actions = [
      () => {
        if (frameId !== null) host.cancelFrame(frameId);
      },
      unsubscribe,
      unsubscribeViewport,
      () => game.dispose(),
    ];
    for (const action of actions) {
      try {
        action();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, 'Browser binding cleanup failed');
  }
  function frame(nowMs: number) {
    frameId = null;
    if (stopped) return;
    if (!Number.isFinite(nowMs)) {
      previous = null;
      onError(new RangeError('Frame timestamp must be finite'));
      if (!stopped) frameId = host.requestFrame(frame);
      return;
    }
    // Keep a non-simulating pump during errors so a successful game.restart can recover.
    const snapshot = game.read();
    const epoch = game.timingEpoch();
    if (epoch !== previousEpoch) {
      previous = null;
      previousEpoch = epoch;
    }
    if (snapshot?.runId !== previousRun) {
      previous = null;
      previousRun = snapshot?.runId ?? null;
      if (hidden && snapshot)
        game.dispatch({ type: 'Backgrounded', runId: snapshot.runId });
    }
    if (
      !hidden &&
      snapshot &&
      !['error', 'loading', 'stopped'].includes(snapshot.phase)
    ) {
      if (previous !== null) {
        try {
          game.advance(Math.max(0, nowMs - previous));
        } catch (error) {
          previous = null;
          onError(error);
          if (!stopped) frameId = host.requestFrame(frame);
          return;
        }
      }
      previous = nowMs;
      previousEpoch = game.timingEpoch();
    } else {
      previous = null;
    }
    if (!stopped) frameId = host.requestFrame(frame);
  }
  // The shell/RAF/listeners survive an initial load failure and title/cancel transitions.
  frameId = host.requestFrame(frame);
  const ready = (
    options.autoPrepare === false ? Promise.resolve() : game.start()
  )
    .then(() => {
      const snapshot = game.read();
      if (!stopped && hidden && snapshot)
        game.dispatch({ type: 'Backgrounded', runId: snapshot.runId });
    })
    .catch((error: unknown) => {
      onError(error);
      throw error;
    });
  return { ready, dispose };
}
export function createBrowserHost(
  browserWindow: Window,
  browserDocument: Document,
  viewport?: ViewportSource,
): BrowserHost {
  return {
    ...(viewport ? { viewport } : {}),
    requestFrame: (listener) => browserWindow.requestAnimationFrame(listener),
    cancelFrame: (id) => browserWindow.cancelAnimationFrame(id),
    subscribe: (listener) => {
      const visibility = () =>
        listener(browserDocument.hidden ? 'hidden' : 'visible');
      const blur = () => listener('blur');
      const pagehide = () => listener('hidden');
      browserDocument.addEventListener('visibilitychange', visibility);
      browserWindow.addEventListener('blur', blur);
      browserWindow.addEventListener('pagehide', pagehide);
      browserWindow.addEventListener('pageshow', visibility);
      visibility();
      return () => {
        browserDocument.removeEventListener('visibilitychange', visibility);
        browserWindow.removeEventListener('blur', blur);
        browserWindow.removeEventListener('pagehide', pagehide);
        browserWindow.removeEventListener('pageshow', visibility);
      };
    },
  };
}
