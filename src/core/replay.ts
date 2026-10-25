import type {
  CoreCommand,
  CoreOutput,
  CorePort,
  DurationMs,
  FixedStep,
  GameplayInputBatch,
  SpatialStepResult,
  FightingSpatialTranscript,
  FightingSpatialTranscriptInteraction,
  FightingCallOutcome,
  FightingDiagnostic,
  FightingSpatialTransactionHeader,
  FightingSpatialTransactionResult,
} from '../contracts';
import {
  isFightingSpatialTransactionResult,
  captureFightingSpatialTranscript,
} from '../contracts/fighting';
import { immutableDto } from '../app/immutableDto';
type OrdinaryReplayEntry =
  | { readonly kind: 'command'; readonly value: CoreCommand }
  | { readonly kind: 'input'; readonly value: GameplayInputBatch }
  | { readonly kind: 'present'; readonly value: DurationMs }
  | { readonly kind: 'begin'; readonly value: FixedStep }
  | { readonly kind: 'complete'; readonly value: SpatialStepResult }
  | { readonly kind: 'drain' }
  | { readonly kind: 'fail'; readonly value: string }
  | { readonly kind: 'dispose' };
export type ReplayEntry =
  | OrdinaryReplayEntry
  | { readonly kind: 'transaction'; readonly value: FightingSpatialTranscript }
  | {
      readonly kind: 'failed';
      readonly operation: OrdinaryReplayEntry;
      readonly diagnostic: FightingDiagnostic;
    };
function diagnostic(error: unknown): FightingDiagnostic {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message:
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Non-Error transaction failure',
  };
}
type FailureObservation = {
  readonly error: unknown;
  readonly diagnostic: FightingDiagnostic;
};
type FailureObservationScope = { propagated: FailureObservation | null };
// Synchronous call-stack handoff, not an Error-identity cache. Only the most
// recent failing child invocation can supply its parent's diagnostic. Every
// invocation gets a fresh frame; returns and replacement errors do not carry it.
let failureObservationScope: FailureObservationScope | null = null;
function observeFailure<T>(
  operation: () => T,
  recordFailure: (value: FightingDiagnostic) => void,
): T {
  const parent = failureObservationScope;
  const scope: FailureObservationScope = { propagated: null };
  if (parent) parent.propagated = null;
  failureObservationScope = scope;
  try {
    return operation();
  } catch (error) {
    const observed =
      scope.propagated && Object.is(scope.propagated.error, error)
        ? scope.propagated
        : { error, diagnostic: immutableDto(diagnostic(error)) };
    recordFailure(observed.diagnostic);
    if (parent) parent.propagated = observed;
    throw error;
  } finally {
    failureObservationScope = parent;
  }
}
function recordedError(value: FightingDiagnostic): Error {
  const error = new Error(value.message);
  error.name = value.name;
  return error;
}
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameData(v, b[i]))
    );
  const aa = Object.entries(a).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
    bb = Object.entries(b).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  return (
    aa.length === bb.length &&
    aa.every(
      ([key, value], i) => key === bb[i]?.[0] && sameData(value, bb[i]?.[1]),
    )
  );
}
/** Record public resources by decorating operations; capabilities never enter the pure tape. */
export function recordCore(original: CorePort) {
  const entries: ReplayEntry[] = [],
    outputs: CoreOutput[] = [];
  let recording = false;
  // Admission/preparation callbacks are just as reentrant as project/finish.
  // Reads remain available, but no nested mutation may create a tape entry.
  function exclusive<T>(operation: () => T): T {
    if (recording) throw new Error('Recorder busy recording a Core operation');
    recording = true;
    try {
      return operation();
    } finally {
      recording = false;
    }
  }
  const output = (value: CoreOutput) => outputs.push(immutableDto(value));
  function record<E extends OrdinaryReplayEntry, T>(
    entry: E,
    operation: (entry: E) => T,
    accept?: (result: T) => void,
  ): T {
    const captured = immutableDto(entry);
    const result = observeFailure(
      () => operation(captured),
      (failure) => {
        // Preserve failed invocations: preparation can reserve epochs, and a
        // failed begin can already have consumed an external AI decision.
        entries.push(
          immutableDto({
            kind: 'failed',
            operation: captured,
            diagnostic: failure,
          }),
        );
      },
    );
    entries.push(captured);
    accept?.(result);
    return result;
  }
  const ordinary = <E extends OrdinaryReplayEntry, T>(
    entry: E,
    operation: (entry: E) => T,
    accept?: (result: T) => void,
  ) => exclusive(() => record(entry, operation, accept));
  function transaction(value: FightingSpatialTransactionResult) {
    const port = value.transaction;
    const project = port.project,
      finish = port.finish,
      abort = port.abort;
    const header: FightingSpatialTransactionHeader = {
      version: port.version,
      transactionId: port.transactionId,
      runId: port.runId,
      stepTick: port.stepTick,
      fromGameMs: port.fromGameMs,
      toGameMs: port.toGameMs,
    };
    const proposal = immutableDto({
        snapshot: value.snapshot,
        candidates: value.candidates,
      }),
      initialPrefix = immutableDto(value.initialPrefix);
    let interactions: readonly FightingSpatialTranscriptInteraction[] = [];
    const append = (interaction: FightingSpatialTranscriptInteraction) => {
      const captured = captureFightingSpatialTranscript({
        header,
        proposal,
        initialPrefix,
        interactions: [...interactions, interaction],
        terminal: { kind: 'aborted' },
      });
      interactions = captured.interactions;
    };
    const invoke = <T>(
      operation: () => T,
      save: (outcome: FightingCallOutcome<T>) => void,
    ): T => {
      let result: T;
      try {
        result = operation();
      } catch (error) {
        save({ kind: 'threw', diagnostic: diagnostic(error) });
        throw error;
      }
      try {
        save({ kind: 'returned', value: result });
      } catch {
        const error = recordedError({
          name: 'UnrecordableFightingReturn',
          message: 'Fighting transaction returned a non-recordable DTO',
        });
        save({ kind: 'unrecordable-return', diagnostic: diagnostic(error) });
        throw error;
      }
      return result;
    };
    const decorated: FightingSpatialTransactionResult = {
      kind: 'fighting-spatial-transaction-v1',
      snapshot: proposal.snapshot,
      candidates: proposal.candidates,
      initialPrefix,
      transaction: {
        ...header,
        project(input) {
          const query = immutableDto(input);
          return invoke(
            () => project.call(port, input),
            (outcome) => append({ kind: 'project', input: query, outcome }),
          );
        },
        finish(input) {
          const query = immutableDto(input);
          return invoke(
            () => finish.call(port, input),
            (outcome) => append({ kind: 'finish', input: query, outcome }),
          );
        },
        abort() {
          invoke(
            () => {
              abort.call(port);
              return null;
            },
            (outcome) => append({ kind: 'abort', outcome }),
          );
        },
      },
    };
    try {
      const output = original.completeStep(decorated),
        last = interactions.at(-1);
      if (last?.kind !== 'finish' || last.outcome.kind !== 'returned')
        throw new Error(
          'Successful transaction did not prepare a recorded receipt',
        );
      entries.push({
        kind: 'transaction',
        value: captureFightingSpatialTranscript({
          header,
          proposal,
          initialPrefix,
          interactions,
          terminal: {
            kind: 'success',
            receiptId: last.outcome.value.receiptId,
          },
        }),
      });
      outputs.push(immutableDto(output));
      return output;
    } catch (error) {
      entries.push({
        kind: 'transaction',
        value: captureFightingSpatialTranscript({
          header,
          proposal,
          initialPrefix,
          interactions,
          terminal: { kind: 'aborted', diagnostic: diagnostic(error) },
        }),
      });
      throw error;
    }
  }
  const core: CorePort = {
    read: () => original.read(),
    handle(value) {
      ordinary({ kind: 'command', value }, (entry) =>
        original.handle(entry.value),
      );
    },
    handleInputBatch(value) {
      ordinary({ kind: 'input', value }, (entry) =>
        original.handleInputBatch(entry.value),
      );
    },
    present(value) {
      ordinary({ kind: 'present', value }, (entry) =>
        original.present(entry.value),
      );
    },
    beginStep(value) {
      return ordinary({ kind: 'begin', value }, (entry) =>
        original.beginStep(entry.value),
      );
    },
    completeStep(value) {
      return exclusive(() => {
        if (isFightingSpatialTransactionResult(value))
          return transaction(value);
        if ('kind' in value && value.kind === 'fighting-spatial-transaction-v1')
          throw new Error(
            'Invalid fighting transaction envelope cannot be recorded',
          );
        return record(
          { kind: 'complete', value },
          (entry) => original.completeStep(entry.value),
          output,
        );
      });
    },
    drain() {
      return ordinary({ kind: 'drain' }, () => original.drain(), output);
    },
    fail(value) {
      ordinary({ kind: 'fail', value }, (entry) => original.fail(entry.value));
    },
    dispose() {
      ordinary({ kind: 'dispose' }, () => original.dispose());
    },
  };
  return {
    core,
    read: () => immutableDto(entries),
    outputs: () => immutableDto(outputs),
  };
}
function replayTransaction(
  core: CorePort,
  source: FightingSpatialTranscript,
): CoreOutput | null {
  const tape = captureFightingSpatialTranscript(source);
  let index = 0,
    mismatch: Error | null = null;
  const next = (
    kind: FightingSpatialTranscriptInteraction['kind'],
    input?: unknown,
  ) => {
    const entry = tape.interactions[index++];
    if (
      !entry ||
      entry.kind !== kind ||
      ('input' in entry && !sameData(entry.input, input))
    ) {
      mismatch = new Error('Fighting replay operation/query mismatch');
      throw mismatch;
    }
    return entry;
  };
  const outcome = <T>(value: FightingCallOutcome<T>): T => {
    if (value.kind !== 'returned') throw recordedError(value.diagnostic);
    return immutableDto(value.value);
  };
  const envelope: FightingSpatialTransactionResult = {
    kind: 'fighting-spatial-transaction-v1',
    snapshot: tape.proposal.snapshot,
    candidates: tape.proposal.candidates,
    initialPrefix: tape.initialPrefix,
    transaction: {
      ...tape.header,
      project(input) {
        const entry = next('project', input);
        if (entry.kind !== 'project')
          throw new Error('Replay project kind mismatch');
        return outcome(entry.outcome);
      },
      finish(input) {
        const entry = next('finish', input);
        if (entry.kind !== 'finish')
          throw new Error('Replay finish kind mismatch');
        return outcome(entry.outcome);
      },
      abort() {
        const entry = next('abort');
        if (entry.kind !== 'abort')
          throw new Error('Replay abort kind mismatch');
        outcome(entry.outcome);
      },
    },
  };
  let result: CoreOutput | null = null,
    failure: unknown;
  try {
    result = core.completeStep(envelope);
  } catch (error) {
    failure = error;
  }
  if (mismatch) throw mismatch;
  if (index !== tape.interactions.length)
    throw new Error('Fighting replay has unused/leftover operations');
  if (tape.terminal.kind === 'success') {
    if (failure !== undefined || !result)
      throw new Error('Fighting replay terminal success mismatch', {
        cause: failure,
      });
    const receiptId = tape.terminal.receiptId;
    if (
      result.snapshot.actors.some(
        (a) =>
          result?.snapshot.residentActorIds?.includes(a.actorId) &&
          a.fightingPose?.commitId !== receiptId,
      )
    )
      throw new Error('Fighting replay receipt mismatch');
    return result;
  }
  if (
    failure === undefined ||
    (tape.terminal.diagnostic &&
      !sameData(diagnostic(failure), tape.terminal.diagnostic))
  )
    throw new Error('Fighting replay terminal failure mismatch', {
      cause: failure,
    });
  return null;
}
function replayOrdinary(
  core: CorePort,
  entry: OrdinaryReplayEntry,
): CoreOutput | null {
  switch (entry.kind) {
    case 'command':
      core.handle(entry.value);
      break;
    case 'input':
      core.handleInputBatch(entry.value);
      break;
    case 'present':
      core.present(entry.value);
      break;
    case 'begin':
      core.beginStep(entry.value);
      break;
    case 'complete':
      return core.completeStep(entry.value);
    case 'drain':
      return core.drain();
    case 'fail':
      core.fail(entry.value);
      break;
    case 'dispose':
      core.dispose();
      break;
  }
  return null;
}
export function replayCore(core: CorePort, entries: readonly ReplayEntry[]) {
  const outputs: CoreOutput[] = [];
  for (const entry of entries) {
    if (entry.kind === 'failed') {
      let threw = false,
        failure: unknown;
      try {
        replayOrdinary(core, entry.operation);
      } catch (error) {
        threw = true;
        failure = error;
      }
      if (!threw || !sameData(diagnostic(failure), entry.diagnostic))
        throw new Error('Ordinary replay failure mismatch', { cause: failure });
    } else {
      const output =
        entry.kind === 'transaction'
          ? replayTransaction(core, entry.value)
          : replayOrdinary(core, entry);
      if (output) outputs.push(output);
    }
  }
  return immutableDto({ snapshot: core.read(), outputs });
}
/** Successful legacy AI tapes remain arrays; failed decisions are explicit pure outcomes. */
export type ReplayIntentEntry =
  | readonly import('../contracts').GameplayCommand[]
  | { readonly kind: 'threw'; readonly diagnostic: FightingDiagnostic };
/** Record AI's public commands too: its held camera basis is an external input. */
export function recordIntentProvider(
  provider: Exclude<
    import('./createCore').CoreOptions['enemyAi'],
    false | undefined
  >,
) {
  const entries: ReplayIntentEntry[] = [];
  return {
    decide: ((snapshot, spatial) => {
      return observeFailure(
        () => {
          const commands = immutableDto(provider(snapshot, spatial));
          entries.push(commands);
          return commands;
        },
        (failure) =>
          entries.push(immutableDto({ kind: 'threw', diagnostic: failure })),
      );
    }) as Exclude<
      import('./createCore').CoreOptions['enemyAi'],
      false | undefined
    >,
    read: () => immutableDto(entries),
  };
}
type IntentProvider = Exclude<
  import('./createCore').CoreOptions['enemyAi'],
  false | undefined
>;
export function replayIntentProvider(
  entries: readonly ReplayIntentEntry[],
): IntentProvider & { assertConsumed(): void; readConsumed(): number } {
  const tape = immutableDto(entries);
  let index = 0;
  const decide: IntentProvider = () => {
    const commands = tape[index];
    if (!commands) throw new Error('Recorded AI input tape exhausted');
    index++;
    if ('kind' in commands) throw recordedError(commands.diagnostic);
    return commands;
  };
  return Object.assign(decide, {
    readConsumed: () => index,
    assertConsumed() {
      if (index !== tape.length)
        throw new Error('Recorded AI input tape has unused surplus decisions');
    },
  });
}
