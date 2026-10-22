import {
  type CoreOutput,
  type Disposable,
  type GameCommand,
  type GameplayCommand,
  type GameSnapshot,
  type HostPhase,
  type HostRequest,
  type HostSnapshot,
  type InputPort,
  type InputReleaseReason,
  type ModuleFactories,
  type MovementBasisSnapshot,
  type MovementSessionPort,
  type PauseReason,
  type RunContext,
  runId,
  tick,
  type Unsubscribe,
  type ViewportMetrics,
  type ViewportReader,
} from '../contracts';
import { createFoundationCore } from '../core/foundation';
import { createFrameLoop, type FrameLoopPorts } from './frameLoop';
import { immutableDto } from './immutableDto';
import { createViewportService } from './sharedServices';
export interface GameOptions {
  readonly sessionId: string;
  readonly seed: number;
  readonly stepMs?: number;
  readonly maxStepsPerFrame?: number;
  readonly viewport?: ViewportMetrics;
  readonly onError?: (error: unknown) => void;
  /** Give the host a scheduling/paint opportunity before explicit-start preparation.
   * A resolved Promise alone is not a responsiveness guarantee for expensive loaders. */
  readonly yieldBeforePreparation?: () => Promise<void>;
}
export interface GameController {
  start(): Promise<void>;
  restart(): Promise<void>;
  stop(): void;
  dispose(): void;
  dispatch(command: GameCommand): void;
  request(request: HostRequest): void;
  hostState(): HostSnapshot;
  readonly viewport: ViewportReader;
  updateViewport(metrics: ViewportMetrics): void;
  advance(elapsedMs: number): void;
  read(): GameSnapshot | null;
  lastError(): unknown | null;
  /** Changes on every phase/pause continuity transition, even between browser frames. */
  timingEpoch(): number;
}
interface ActiveRun {
  readonly context: RunContext;
  readonly ports: FrameLoopPorts;
  readonly input: InputPort;
  readonly movement: MovementSessionPort;
  readonly abort: AbortController;
  readonly disposables: Disposable[];
  readonly loop: ReturnType<typeof createFrameLoop>;
  readonly queue: GameplayCommand[];
  readonly seen: Set<string>;
  readonly sessions: Map<string, MovementBasisSnapshot>;
  readonly closedSessions: Set<string>;
  prepared: boolean;
  started: boolean;
  deliveredSequence: number;
  gate: boolean | null;
  unsubscribe: Unsubscribe;
}
function isGameplay(command: GameCommand): command is GameplayCommand {
  return (
    command.type === 'AttackRequested' ||
    command.type === 'JumpRequested' ||
    command.type === 'MoveRequested'
  );
}
export function createGame<Node>(
  factories: ModuleFactories<Node>,
  options: GameOptions,
): GameController {
  runId(options.sessionId);
  if (!Number.isSafeInteger(options.seed))
    throw new RangeError('Seed must be a safe integer');
  const loopOptions = {
    stepMs: options.stepMs ?? 1000 / 60,
    maxStepsPerFrame: options.maxStepsPerFrame ?? 120,
  };
  if (
    !Number.isFinite(loopOptions.stepMs) ||
    loopOptions.stepMs <= 0 ||
    !Number.isSafeInteger(loopOptions.maxStepsPerFrame) ||
    loopOptions.maxStepsPerFrame <= 0
  )
    throw new RangeError('Invalid frame loop options');
  const viewport = createViewportService(options.viewport);
  let generation = 0;
  let active: ActiveRun | null = null;
  let pending: Promise<void> | null = null;
  let disposed = false;
  let lastFailure: unknown | null = null;
  let hostRevision = 0;
  let epoch = 0;
  let continuity = '';
  let startupGeneration = 0;
  let startup: {
    generation: number;
    elapsedMs: number;
    requiredAssetsReady: boolean;
    pauses: Set<PauseReason>;
  } | null = null;
  function syncTiming(snapshot: GameSnapshot | null) {
    const next = snapshot
      ? `${snapshot.runId}|${snapshot.phase}|${snapshot.pauseReasons.join(',')}`
      : '';
    const timing = startup
      ? `startup:${startup.generation}|${[...startup.pauses].sort().join(',')}`
      : next;
    if (timing !== continuity) {
      continuity = timing;
      epoch++;
    }
  }
  let hostSnapshot: HostSnapshot = Object.freeze({
    revision: 0,
    phase: 'title',
    runId: null,
    game: null,
    error: null,
    viewport: viewport.reader.read(),
    startup: null,
  });
  const requests = new Set<string>();
  const shell = factories.host?.(viewport.reader);
  const unsubscribeHost = shell?.subscribe(request) ?? (() => {});
  function emitHost(phase?: HostPhase) {
    const game = immutableDto(active?.ports.core.read() ?? null);
    syncTiming(game);
    const derived =
      startup && !game
        ? 'loading'
        : game?.phase === 'error'
          ? 'error'
          : game?.phase === 'loading'
            ? 'loading'
            : game?.phase === 'ready'
              ? 'ready'
              : game?.presentation.kind === 'results'
                ? 'results'
                : game
                  ? 'playing'
                  : lastFailure
                    ? 'error'
                    : 'title';
    hostSnapshot = Object.freeze({
      revision: ++hostRevision,
      phase: phase ?? derived,
      runId: game?.runId ?? null,
      game,
      error:
        lastFailure instanceof Error
          ? lastFailure.message
          : lastFailure === null
            ? null
            : String(lastFailure),
      viewport: viewport.reader.read(),
      startup: startup
        ? Object.freeze({
            generation: startup.generation,
            countdown: Math.max(
              0,
              Math.ceil((3000 - startup.elapsedMs) / 1000),
            ) as 0 | 1 | 2 | 3,
            requiredAssetsReady: startup.requiredAssetsReady,
            pauseReasons: Object.freeze([...startup.pauses].sort()),
          })
        : null,
    });
    shell?.render(hostSnapshot);
  }
  function releaseInput(run: ActiveRun, reason: InputReleaseReason) {
    run.movement.releaseAll(reason);
    run.input.releaseAll();
  }
  function committed(run: ActiveRun, output: CoreOutput) {
    const enabled =
      run.prepared &&
      output.snapshot.phase === 'running' &&
      output.snapshot.pauseReasons.length === 0;
    if (run.gate !== enabled) {
      if (run.gate === true && !enabled)
        releaseInput(
          run,
          output.snapshot.phase === 'terminal' ? 'terminal' : 'pause',
        );
      run.gate = enabled;
      run.input.setGate(Object.freeze({ runId: run.context.runId, enabled }));
    }
    emitHost();
  }
  function cleanup(run: ActiveRun) {
    const errors: unknown[] = [];
    const attempt = (action: () => void) => {
      try {
        action();
      } catch (error) {
        errors.push(error);
      }
    };
    attempt(() => run.abort.abort());
    attempt(run.unsubscribe);
    attempt(() => releaseInput(run, disposed ? 'dispose' : 'restart'));
    attempt(() =>
      run.input.setGate({ runId: run.context.runId, enabled: false }),
    );
    for (const port of [...run.disposables].reverse())
      attempt(() => port.dispose());
    // These are obsolete run-owned transport caches, not shared immutable assets.
    run.queue.length = 0;
    run.seen.clear();
    run.sessions.clear();
    run.closedSessions.clear();
    run.loop.reset();
    if (errors.length)
      throw new AggregateError(errors, 'One or more ports failed to dispose');
  }
  function stop() {
    startup = null;
    startupGeneration++;
    generation++;
    pending = null;
    const previous = active;
    active = null;
    lastFailure = null;
    if (previous) {
      try {
        cleanup(previous);
      } catch (error) {
        lastFailure = error;
        emitHost('error');
        throw error;
      }
    }
    emitHost(disposed ? 'disposed' : 'title');
  }
  function flush(run: ActiveRun) {
    const queued = run.queue
      .splice(0)
      .sort(
        (first, second) =>
          first.input.sequence - second.input.sequence ||
          (first.input.commandId < second.input.commandId
            ? -1
            : first.input.commandId > second.input.commandId
              ? 1
              : 0),
      );
    const commands = queued.filter((command) => {
      if (command.type !== 'MoveRequested') return true;
      const basis = run.sessions.get(command.movementSessionId);
      return basis?.revision === command.basisRevision;
    });
    for (const command of queued)
      run.deliveredSequence = Math.max(
        run.deliveredSequence,
        command.input.sequence,
      );
    if (commands.length && run.ports.core.read().phase === 'running')
      run.ports.core.handleInputBatch(
        Object.freeze({
          runId: run.context.runId,
          tick: tick(run.ports.core.read().clocks.tick + 1),
          commands: Object.freeze(commands),
        }),
      );
  }
  function dispatch(command: GameCommand) {
    const run = active;
    if (!run || command.runId !== run.context.runId || disposed) return;
    // Runtime provenance gate also rejects serialized/internal notifications and unknown kinds.
    const publicTypes: readonly string[] = [
      'StartRequested',
      'RetryRequested',
      'PauseRequested',
      'ResumeRequested',
      'Backgrounded',
      'Foregrounded',
      'QualityChanged',
      'MovementSessionEnded',
      'InputsReleased',
      'MoveRequested',
      'JumpRequested',
      'AttackRequested',
    ];
    if (!publicTypes.includes(command.type)) return;
    if (command.type === 'StartRequested' && (!run.prepared || startup)) return;
    if (startup) {
      if (
        command.type === 'PauseRequested' ||
        command.type === 'ResumeRequested'
      ) {
        changeStartupPause(
          startup.generation,
          command.reason,
          command.type === 'PauseRequested',
        );
        return;
      }
      if (command.type === 'Backgrounded') {
        changeStartupPause(startup.generation, 'background', true);
        changeStartupPause(startup.generation, 'interruption', true);
        return;
      }
      if (command.type === 'Foregrounded') {
        changeStartupPause(startup.generation, 'background', false);
        return;
      }
    }
    if (command.type === 'RetryRequested') {
      beginStartup(true);
      return;
    }
    if (isGameplay(command)) {
      if (
        !command.input ||
        typeof command.input.commandId !== 'string' ||
        !command.input.commandId.trim() ||
        !run.prepared ||
        run.ports.core.read().phase !== 'running' ||
        !Number.isSafeInteger(command.input.sequence) ||
        command.input.sequence <= run.deliveredSequence ||
        run.seen.has(command.input.commandId)
      )
        return;
      if (
        command.type === 'MoveRequested' &&
        (!Number.isFinite(command.x) ||
          !Number.isFinite(command.z) ||
          Math.hypot(command.x, command.z) > 1 + 1e-7)
      )
        return;
      run.seen.add(command.input.commandId);
      run.queue.push(
        Object.freeze({
          ...command,
          input: Object.freeze({ ...command.input }),
        }),
      );
      return;
    }
    if (command.type === 'MovementSessionEnded') {
      run.movement.end(command.sessionId, 'released');
    } else if (command.type === 'InputsReleased') {
      releaseInput(run, 'pointer-cancel');
    } else {
      if (command.type === 'StartRequested' && !run.started) run.loop.reset();
      run.ports.core.handle(command);
      if (
        command.type === 'StartRequested' &&
        ['running', 'paused'].includes(run.ports.core.read().phase)
      )
        run.started = true;
    }
    run.loop.publish(run.ports.core.drain());
  }
  function reportAsyncError(error: unknown) {
    options.onError?.(error);
  }
  function completeStartup() {
    if (
      !startup ||
      startup.elapsedMs < 3000 ||
      !startup.requiredAssetsReady ||
      startup.pauses.size ||
      !active?.prepared
    )
      return;
    const run = active;
    const resumedReasons = [...run.ports.core.read().pauseReasons];
    startup = null;
    try {
      // The startup generation inherited these reasons and every one was explicitly
      // resumed above. Reconcile them in the same transaction before publishing;
      // some legacy Core ports can clear interruption only after entering play.
      if (!run.started) run.loop.reset();
      run.ports.core.handle({
        type: 'StartRequested',
        runId: run.context.runId,
      });
      for (const reason of resumedReasons)
        run.ports.core.handle(
          reason === 'background'
            ? { type: 'Foregrounded', runId: run.context.runId }
            : { type: 'ResumeRequested', runId: run.context.runId, reason },
        );
      if (['running', 'paused'].includes(run.ports.core.read().phase))
        run.started = true;
      run.loop.publish(run.ports.core.drain());
      emitHost();
    } catch (error) {
      let failure: unknown = error;
      try {
        stop();
      } catch (cleanupError) {
        failure = new AggregateError(
          [error, cleanupError],
          'Startup and cleanup failed',
        );
      }
      lastFailure = failure;
      emitHost('error');
      reportAsyncError(failure);
    }
  }
  function changeStartupPause(
    token: number,
    reason: PauseReason,
    paused: boolean,
  ) {
    if (!startup || startup.generation !== token) return;
    if (paused) startup.pauses.add(reason);
    else startup.pauses.delete(reason);
    emitHost();
    completeStartup();
  }
  function beginStartup(retry: boolean) {
    if (disposed || (!retry && (startup || active?.started))) return;
    if (retry) stop();
    const current = {
      generation: ++startupGeneration,
      elapsedMs: 0,
      requiredAssetsReady: active?.prepared ?? false,
      pauses: new Set<PauseReason>(
        active?.ports.core.read().pauseReasons ?? [],
      ),
    };
    startup = current;
    emitHost(active ? undefined : 'loading');
    if (current.requiredAssetsReady) return;
    const prepare = async () => {
      await (options.yieldBeforePreparation?.() ??
        new Promise<void>((resolve) => setTimeout(resolve, 0)));
      if (startup !== current || disposed) return;
      await start();
      if (startup !== current || disposed) return;
      current.requiredAssetsReady = active?.prepared ?? false;
      emitHost();
      completeStartup();
    };
    void prepare().catch((error: unknown) => {
      if (startup !== current || disposed) return;
      startup = null;
      lastFailure = error;
      emitHost('error');
      reportAsyncError(error);
    });
  }
  function request(message: HostRequest) {
    if (disposed || !message.requestId || requests.has(message.requestId))
      return;
    requests.add(message.requestId);
    switch (message.type) {
      case 'PrepareRequested':
        beginStartup(false);
        break;
      case 'RetryRequested':
        beginStartup(true);
        break;
      case 'ReturnToTitleRequested':
      case 'CancelLoadingRequested':
        stop();
        break;
      case 'StartRequested':
        beginStartup(false);
        break;
      case 'StartupPauseRequested':
      case 'StartupResumeRequested':
        changeStartupPause(
          message.startupGeneration,
          message.reason,
          message.type === 'StartupPauseRequested',
        );
        break;
      case 'CommandRequested':
        dispatch(message.command);
        break;
    }
  }
  function start(): Promise<void> {
    if (disposed) return Promise.reject(new Error('Game is disposed'));
    if (pending) return pending;
    if (active) return Promise.resolve();
    lastFailure = null;
    const token = ++generation;
    const context = Object.freeze({
      runId: runId(`${options.sessionId}:run:${token}`),
      seed: options.seed,
    });
    const moduleContext = Object.freeze({
      ...context,
      viewport: viewport.reader,
    });
    const resources: Disposable[] = [];
    const own = <T extends Disposable>(port: T): T => {
      resources.push(port);
      return port;
    };
    const abort = new AbortController();
    let run: ActiveRun | null = null;
    const initialize = async () => {
      try {
        const core = own((factories.core ?? createFoundationCore)(context));
        const catalog = own(factories.catalog(context));
        const spatial = own(factories.spatial(moduleContext));
        const animation = own(
          factories.animation(
            Object.freeze({ ...moduleContext, renderHost: spatial.renderHost }),
          ),
        );
        const sessions = new Map<string, MovementBasisSnapshot>();
        const closed = new Set<string>();
        const movement: MovementSessionPort = {
          begin: (sessionId) => {
            if (
              !run ||
              active !== run ||
              core.read().phase !== 'running' ||
              !sessionId ||
              closed.has(sessionId) ||
              sessions.has(sessionId)
            )
              throw new Error('Movement session is inactive or reused');
            const acquired = spatial.beginMovementSession(sessionId);
            if (
              acquired.runId !== context.runId ||
              acquired.sessionId !== sessionId ||
              !Number.isSafeInteger(acquired.revision) ||
              acquired.revision < 0
            )
              throw new Error('Invalid C movement basis');
            const basis = Object.freeze({
              ...acquired,
              right: Object.freeze({ ...acquired.right }),
              depth: Object.freeze({ ...acquired.depth }),
            });
            sessions.set(sessionId, basis);
            return basis;
          },
          end: (sessionId, reason) => {
            if (!run || !sessions.has(sessionId)) return;
            sessions.delete(sessionId);
            closed.add(sessionId);
            for (let i = run.queue.length - 1; i >= 0; i--) {
              const command = run.queue[i];
              if (
                command?.type === 'MoveRequested' &&
                command.movementSessionId === sessionId
              )
                run.queue.splice(i, 1);
            }
            spatial.endMovementSession(sessionId, reason);
            core.handle({
              type: 'MovementSessionEnded',
              runId: context.runId,
              sessionId,
            });
          },
          releaseAll: () => {
            if (!run) return;
            for (const command of run.queue)
              run.deliveredSequence = Math.max(
                run.deliveredSequence,
                command.input.sequence,
              );
            for (const id of [...sessions.keys()])
              movement.end(id, 'cancelled');
            run.queue.length = 0;
            core.handle({ type: 'InputsReleased', runId: context.runId });
          },
        };
        const ui = own(
          factories.ui(
            Object.freeze({
              ...moduleContext,
              request: (message: HostRequest) => {
                if (active?.context.runId === context.runId) request(message);
              },
            }),
          ),
        );
        const input = own(
          factories.input(
            Object.freeze({
              ...moduleContext,
              movement,
              readSnapshot: () =>
                active?.context.runId === context.runId
                  ? immutableDto(core.read())
                  : null,
            }),
          ),
        );
        const ports = {
          core,
          catalog,
          animation,
          spatial,
          ui,
          viewport: viewport.reader,
        };
        const created: ActiveRun = {
          context,
          ports,
          input,
          movement,
          sessions,
          closedSessions: closed,
          queue: [],
          seen: new Set(),
          prepared: false,
          started: false,
          deliveredSequence: 0,
          gate: null,
          abort,
          disposables: resources,
          loop: createFrameLoop(ports, loopOptions, {
            beforeStep: () => flush(created),
            committed: (output) => committed(created, output),
          }),
          unsubscribe: () => {},
        };
        run = created;
        active = run;
        run.unsubscribe = input.subscribe(dispatch);
        run.loop.publish(core.drain());
        await catalog.prepare(abort.signal);
        if (token !== generation || active !== run || disposed) return;
        run.prepared = true;
        core.handle({ type: 'AssetsReady', runId: context.runId });
        run.loop.publish(core.drain());
      } catch (error) {
        if (token !== generation) return;
        active = null;
        let failure: unknown = error;
        if (run) {
          try {
            cleanup(run);
          } catch (cleanupError) {
            failure = new AggregateError(
              [error, cleanupError],
              'Initialization and cleanup failed',
            );
          }
        } else {
          const errors: unknown[] = [];
          abort.abort();
          for (const port of [...resources].reverse()) {
            try {
              port.dispose();
            } catch (cleanupError) {
              errors.push(cleanupError);
            }
          }
          if (errors.length)
            failure = new AggregateError(
              [error, ...errors],
              'Initialization and cleanup failed',
            );
        }
        lastFailure = failure;
        emitHost('error');
        throw failure;
      }
    };
    const result = initialize();
    pending = result;
    void result.then(
      () => {
        if (token === generation) pending = null;
      },
      () => {
        if (token === generation) pending = null;
      },
    );
    return result;
  }
  async function restart() {
    stop();
    await start();
  }
  emitHost('title');
  return {
    start,
    restart,
    stop,
    dispatch,
    request,
    hostState: () => hostSnapshot,
    viewport: viewport.reader,
    updateViewport: (metrics) => {
      if (disposed) return;
      viewport.publish(metrics);
      if (active) {
        releaseInput(active, 'viewport-change');
        active.loop.publish(active.ports.core.drain());
      } else emitHost();
    },
    read: () => immutableDto(active?.ports.core.read() ?? null),
    timingEpoch: () => {
      syncTiming(active?.ports.core.read() ?? null);
      return epoch;
    },
    lastError: () => lastFailure,
    advance: (elapsedMs) => {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
        throw new RangeError('Elapsed time must be finite and nonnegative');
      if (startup) {
        if (!startup.pauses.size)
          startup.elapsedMs = Math.min(3000, startup.elapsedMs + elapsedMs);
        emitHost();
        completeStartup();
        return; // Startup elapsed is never also charged to gameplay/backlog clocks.
      }
      const run = active;
      if (!run?.prepared) return;
      try {
        run.loop.advance(elapsedMs);
      } catch (error) {
        lastFailure = error;
        run.ports.core.fail(
          error instanceof Error ? error.message : 'Unknown frame error',
        );
        releaseInput(run, 'interruption');
        run.loop.reset();
        run.loop.publish(run.ports.core.drain());
        throw error;
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (const action of [stop, unsubscribeHost, () => shell?.dispose()]) {
        try {
          action();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(errors, 'Game host cleanup failed');
    },
  };
}
