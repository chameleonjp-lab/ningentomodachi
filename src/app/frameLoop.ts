import {
  durationMs,
  type AnimationPort,
  type CoreOutput,
  type CorePort,
  type MotionCatalogPort,
  type SpatialPort,
  type UiPort,
  type ViewportReader,
} from '../contracts';
import { immutableDto } from './immutableDto';
export interface FrameLoopPorts {
  readonly core: CorePort;
  readonly catalog: MotionCatalogPort;
  readonly animation: AnimationPort;
  readonly spatial: SpatialPort;
  readonly ui: UiPort;
  readonly viewport: ViewportReader;
}
export interface FrameLoopOptions {
  readonly stepMs: number;
  readonly maxStepsPerFrame: number;
}
/** Sole fixed-step ordering: core prepare -> spatial sweep -> core resolve -> presentation. */
export function createFrameLoop(
  ports: FrameLoopPorts,
  options: FrameLoopOptions,
  hooks: {
    readonly beforeStep?: () => void;
    readonly committed?: (output: CoreOutput) => void;
  } = {},
) {
  if (!Number.isFinite(options.stepMs) || options.stepMs <= 0)
    throw new RangeError('stepMs must be positive');
  if (
    !Number.isSafeInteger(options.maxStepsPerFrame) ||
    options.maxStepsPerFrame <= 0
  )
    throw new RangeError('maxStepsPerFrame must be a positive integer');
  let accumulator = 0;
  function publish(original: CoreOutput) {
    const output = immutableDto(original);
    const viewport = ports.viewport.read();
    const spatial = immutableDto(ports.spatial.commit(output, viewport));
    if (
      spatial.runId !== output.snapshot.runId ||
      spatial.tick !== output.snapshot.clocks.tick
    )
      throw new Error('Committed spatial frame does not match Core');
    const frame = Object.freeze({ ...output, spatial, viewport });
    hooks.committed?.(output);
    ports.animation.render(frame);
    ports.spatial.render(frame);
    ports.ui.render(frame, ports.spatial.project(frame));
  }
  return {
    publish,
    reset: () => {
      accumulator = 0;
    },
    advance: (elapsedMs: number) => {
      durationMs(elapsedMs);
      ports.core.present(durationMs(elapsedMs));
      if (ports.core.read().phase !== 'running') {
        publish(ports.core.drain());
        return;
      }
      accumulator += elapsedMs;
      let steps = 0;
      while (
        accumulator + 1e-7 >= options.stepMs &&
        steps < options.maxStepsPerFrame &&
        ports.core.read().phase === 'running'
      ) {
        hooks.beforeStep?.();
        if (ports.core.read().phase !== 'running') break;
        const request = ports.core.beginStep(
          Object.freeze({ durationMs: durationMs(options.stepMs) }),
        );
        const candidates = ports.spatial.step(request, ports.catalog);
        publish(ports.core.completeStep(candidates));
        accumulator = Math.max(0, accumulator - options.stepMs);
        steps++;
      }
      if (steps === 0) publish(ports.core.drain());
      // Budget overflow is retained, never silently skipped or retroactively hit-tested.
    },
  };
}
