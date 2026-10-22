import type { ViewportMetrics } from '../contracts';
import type { ViewportSource } from './bootstrap';
/** Root bounds and safe-area values are CSS pixels; DPR is separate, never multiplied into input. */
export function createBrowserViewport(
  root: HTMLElement,
  browser: Window,
): ViewportSource & { dispose(): void } {
  const probe = root.ownerDocument.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  root.append(probe);
  const listeners = new Set<(metrics: ViewportMetrics) => void>();
  let disposed = false;
  const finitePositive = (value: number, fallback: number) =>
    Number.isFinite(value) && value > 0 ? value : fallback;
  const css = (value: string) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const read = (): ViewportMetrics => {
    const bounds = root.getBoundingClientRect(),
      style = browser.getComputedStyle(probe);
    return {
      widthCssPx: finitePositive(
        bounds.width,
        finitePositive(browser.visualViewport?.width ?? browser.innerWidth, 1),
      ),
      heightCssPx: finitePositive(
        bounds.height,
        finitePositive(
          browser.visualViewport?.height ?? browser.innerHeight,
          1,
        ),
      ),
      offsetLeftCssPx: bounds.left,
      offsetTopCssPx: bounds.top,
      devicePixelRatio: finitePositive(browser.devicePixelRatio, 1),
      safeAreaCssPx: {
        top: css(style.paddingTop),
        right: css(style.paddingRight),
        bottom: css(style.paddingBottom),
        left: css(style.paddingLeft),
      },
    };
  };
  const notify = () => {
    if (!disposed) {
      const metrics = read();
      for (const listener of listeners) listener(metrics);
    }
  };
  let observer: ResizeObserver | undefined;
  function dispose() {
    if (disposed) return;
    disposed = true;
    listeners.clear();
    const errors: unknown[] = [];
    const actions = [
      () => observer?.disconnect(),
      () => browser.removeEventListener('resize', notify),
      () => browser.removeEventListener('orientationchange', notify),
      () => browser.visualViewport?.removeEventListener('resize', notify),
      () => browser.visualViewport?.removeEventListener('scroll', notify),
      () => probe.remove(),
    ];
    for (const action of actions) {
      try {
        action();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, 'Viewport cleanup failed');
  }
  try {
    browser.addEventListener('resize', notify);
    browser.addEventListener('orientationchange', notify);
    browser.visualViewport?.addEventListener('resize', notify);
    browser.visualViewport?.addEventListener('scroll', notify);
    const Observer = (
      browser as Window & { ResizeObserver?: typeof ResizeObserver }
    ).ResizeObserver;
    observer = Observer ? new Observer(notify) : undefined;
    observer?.observe(root);
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Viewport setup and cleanup failed',
      );
    }
    throw error;
  }
  return {
    read,
    subscribe(listener) {
      if (disposed) throw new Error('Viewport source disposed');
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose,
  };
}
