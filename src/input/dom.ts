import type { InputReleaseReason } from '../contracts';
import type { ControlAction, PointerInput } from './PointerInput';
export type ControlElements = Readonly<Record<ControlAction, HTMLElement>>;
/** Listeners and browser-default suppression are scoped to game controls, not the page. */
export function bindPointerControls(
  input: PointerInput,
  elements: ControlElements,
  document: Document,
) {
  const cleanup: (() => void)[] = [];
  let disposed = false;
  let accessibilityPointer = -1;
  const captured = new Map<number, HTMLElement>();
  const release = (id: number) => {
    const element = captured.get(id);
    captured.delete(id);
    try {
      if (element?.hasPointerCapture?.(id)) element.releasePointerCapture(id);
    } catch {
      /* OS capture may already be gone. */
    }
  };
  const releaseAll = () => {
    for (const id of [...captured.keys()]) release(id);
  };
  const cancel = (reason: InputReleaseReason) => {
    releaseAll();
    input.cancel(reason);
  };
  const listen = (
    target: EventTarget,
    type: string,
    listener: EventListener,
  ) => {
    // A failed remover may leave a listener installed, but never active.
    const guarded: EventListener = (event) => {
      if (!disposed) listener(event);
    };
    cleanup.push(() => target.removeEventListener(type, guarded));
    target.addEventListener(type, guarded);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    let failed = false;
    let firstError: unknown;
    const attempt = (action: () => void) => {
      try {
        action();
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    };
    for (const remove of cleanup.splice(0)) attempt(remove);
    attempt(releaseAll);
    attempt(() => input.cancel('dispose'));
    if (failed) throw firstError;
  };
  try {
    for (const [name, element] of Object.entries(elements)) {
      const action = name as ControlAction;
      listen(element, 'pointerdown', (event) => {
        const e = event as PointerEvent;
        if (e.button !== 0) return;
        e.preventDefault();
        captured.set(e.pointerId, element);
        input.pointerDown(e.pointerId, action, e.clientX, e.clientY);
        try {
          element.setPointerCapture?.(e.pointerId);
        } catch {
          /* A cancelled OS pointer may already have vanished. */
        }
      });
      listen(element, 'lostpointercapture', (event) => {
        const id = (event as PointerEvent).pointerId;
        if (!captured.has(id)) return;
        captured.delete(id);
        input.pointerUp(id, true);
      });
      for (const type of ['contextmenu', 'selectstart', 'dragstart'])
        listen(element, type, (event) => event.preventDefault());
      if (action !== 'move') {
        // Native click detail=0 covers keyboard and assistive activation. Pointer click detail>0 is already handled.
        listen(element, 'click', (event) => {
          if ((event as MouseEvent).detail !== 0) return;
          const id = accessibilityPointer--;
          input.pointerDown(id, action, 0, 0);
          input.pointerUp(id);
        });
        listen(element, 'keydown', (event) => {
          const key = event as KeyboardEvent;
          if (key.repeat && (key.key === ' ' || key.key === 'Enter'))
            key.preventDefault();
        });
      }
    }
    listen(document, 'pointermove', (event) => {
      const e = event as PointerEvent;
      if (!captured.has(e.pointerId)) return;
      e.preventDefault();
      input.pointerMove(e.pointerId, e.clientX, e.clientY);
    });
    listen(document, 'pointerup', (event) => {
      const e = event as PointerEvent;
      if (!captured.has(e.pointerId)) return;
      e.preventDefault();
      release(e.pointerId);
      input.pointerUp(e.pointerId);
    });
    listen(document, 'pointercancel', (event) => {
      if (captured.has((event as PointerEvent).pointerId))
        cancel('pointer-cancel');
    });
    const window = document.defaultView;
    if (window) {
      listen(window, 'blur', () => cancel('interruption'));
      listen(window, 'pagehide', () => cancel('interruption'));
    }
    listen(document, 'visibilitychange', () => {
      if (document.hidden) cancel('interruption');
    });
  } catch (error) {
    try {
      dispose();
    } catch {
      // Startup failure is primary; rollback must not replace it.
    }
    throw error;
  }
  return { releaseAll, dispose };
}
