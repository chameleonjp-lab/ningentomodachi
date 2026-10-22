import {
  activeRealTimeMs,
  domainEventId,
  gameTimeMs,
  presentationTimeMs,
  tick,
  type CoreOutput,
  type CorePort,
  type DomainEvent,
  type CoreCommand,
  type GamePhase,
  type GameSnapshot,
  type PauseReason,
  type RunContext,
} from '../contracts';

/** P0 lifecycle only. No combat, motion selection, HP, scoring or AI is implemented here. */
export function createFoundationCore(context: RunContext): CorePort {
  if (!Number.isSafeInteger(context.seed))
    throw new RangeError('Seed must be a safe integer');
  let snapshot: GameSnapshot = Object.freeze({
    contractVersion: 1,
    revision: 0,
    ...context,
    phase: 'loading',
    clocks: Object.freeze({
      tick: tick(0),
      gameTimeMs: gameTimeMs(0),
      activeRealTimeMs: activeRealTimeMs(0),
      presentationTimeMs: presentationTimeMs(0),
    }),
    pauseReasons: Object.freeze([]),
    quality: 'standard',
    actors: Object.freeze([]),
    currentOpponentId: null,
    result: null,
    presentation: Object.freeze({ kind: 'none' }),
    world: Object.freeze({
      vehicles: Object.freeze([]),
      objects: Object.freeze([]),
    }),
  });
  let events: DomainEvent[] = [];
  let sequence = 0;
  let disposed = false;
  let inStep = false;
  const reasons = new Set<PauseReason>();
  function update(change: Partial<GameSnapshot>) {
    snapshot = Object.freeze({
      ...snapshot,
      ...change,
      revision: snapshot.revision + 1,
    });
  }
  function envelope() {
    return {
      eventId: domainEventId(`${context.runId}:event:${++sequence}`),
      runId: context.runId,
      at: snapshot.clocks.gameTimeMs,
      sequence,
    };
  }
  function progress(phase: GamePhase) {
    const pauseReasons = Object.freeze([...reasons].sort());
    if (
      snapshot.phase === phase &&
      snapshot.pauseReasons.join() === pauseReasons.join()
    )
      return;
    update({ phase, pauseReasons });
    events.push(
      Object.freeze({
        ...envelope(),
        type: 'ProgressChanged',
        phase,
        pauseReasons,
      }),
    );
  }
  function drain(): CoreOutput {
    const output = Object.freeze({ snapshot, events: Object.freeze(events) });
    events = [];
    return output;
  }
  function handle(command: CoreCommand) {
    if (
      disposed ||
      command.runId !== context.runId ||
      snapshot.phase === 'error'
    )
      return;
    const playing = snapshot.phase === 'running' || snapshot.phase === 'paused';
    switch (command.type) {
      case 'AssetsReady':
        if (snapshot.phase === 'loading') progress('ready');
        break;
      case 'StartRequested':
        if (snapshot.phase === 'ready')
          progress(reasons.size ? 'paused' : 'running');
        break;
      case 'PauseRequested':
        if (playing) {
          reasons.add(command.reason);
          progress('paused');
        }
        break;
      case 'ResumeRequested':
        if (playing && command.reason !== 'background') {
          reasons.delete(command.reason);
          progress(reasons.size ? 'paused' : 'running');
        }
        break;
      case 'Backgrounded':
        reasons.add('background');
        reasons.add('interruption');
        progress(playing ? 'paused' : snapshot.phase);
        break;
      case 'Foregrounded':
        reasons.delete('background');
        progress(
          playing ? (reasons.size ? 'paused' : 'running') : snapshot.phase,
        );
        break;
      case 'QualityChanged':
        update({ quality: command.quality });
        break;
      case 'AttackRequested':
        events.push(
          Object.freeze({
            ...envelope(),
            type: 'AttackRejected',
            actorId: command.actorId,
            reason:
              snapshot.phase === 'running' ? 'not-implemented' : 'not-running',
          }),
        );
        break;
      case 'MoveRequested':
      case 'JumpRequested':
      case 'MovementSessionEnded':
      case 'InputsReleased':
      case 'RetryRequested':
        break;
    }
  }
  return {
    handle,
    handleInputBatch: (batch) => {
      if (
        batch.runId !== context.runId ||
        batch.tick !== snapshot.clocks.tick + 1
      )
        throw new Error('Input batch does not match the next fixed tick/run');
      // P0 only: explicit rejection/ignored intents. Full-set gameplay arbitration belongs to P1.
      for (const command of batch.commands) handle(command);
    },
    read: () => snapshot,
    drain,
    beginStep: (step) => {
      if (disposed || snapshot.phase !== 'running' || inStep)
        throw new Error('Core is not ready for a fixed step');
      if (!Number.isFinite(step.durationMs) || step.durationMs <= 0)
        throw new RangeError('Fixed step must be positive');
      inStep = true;
      update({
        clocks: Object.freeze({
          ...snapshot.clocks,
          tick: tick(snapshot.clocks.tick + 1),
          gameTimeMs: gameTimeMs(snapshot.clocks.gameTimeMs + step.durationMs),
        }),
      });
      return Object.freeze({ snapshot, step, intents: Object.freeze([]) });
    },
    completeStep: (result) => {
      if (
        !inStep ||
        result.snapshot.runId !== context.runId ||
        result.snapshot.tick !== snapshot.clocks.tick
      )
        throw new Error('Spatial result does not match the active step/run');
      inStep = false;
      // P0 validates wiring only. Candidate adjudication is deliberately deferred to P1.
      return drain();
    },
    present: (elapsed) => {
      if (
        !disposed &&
        elapsed > 0 &&
        snapshot.pauseReasons.length === 0 &&
        ['ready', 'running', 'terminal'].includes(snapshot.phase)
      )
        update({
          clocks: Object.freeze({
            ...snapshot.clocks,
            activeRealTimeMs: activeRealTimeMs(
              snapshot.clocks.activeRealTimeMs +
                (snapshot.phase === 'running' ? elapsed : 0),
            ),
            presentationTimeMs: presentationTimeMs(
              snapshot.clocks.presentationTimeMs + elapsed,
            ),
          }),
        });
    },
    fail: (message) => {
      if (disposed) return;
      inStep = false;
      progress('error');
      events.push(
        Object.freeze({ ...envelope(), type: 'FoundationError', message }),
      );
    },
    dispose: () => {
      if (!disposed) {
        disposed = true;
        inStep = false;
        progress('stopped');
        events = [];
      }
    },
  };
}
