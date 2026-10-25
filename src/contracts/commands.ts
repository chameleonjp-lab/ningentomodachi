import type { Tick } from './clock';
import {
  actorId,
  commandId,
  runId,
  type ActorId,
  type CommandId,
  type RunId,
} from './ids';
import type { AttackCategory } from './motion';
export type PauseReason = 'settings' | 'background' | 'manual' | 'interruption';
export type DisplayQuality = 'standard' | 'low';
export interface GuardRequested extends Envelope {
  readonly type: 'GuardRequested';
  readonly actorId: ActorId;
  readonly active: boolean;
  readonly input: InputPacket;
}
interface Envelope {
  readonly runId: RunId;
}
/** D assigns unique monotonic source sequence/identity; A buffers and orders packets at the tick.
 * Control pause/release commands are immediate and cancel queued gameplay. Arrival order never
 * selects attack-vs-jump priority. Equal sequences are invalid; A uses commandId as stable tie-break.
 */
export interface InputPacket {
  readonly commandId: CommandId;
  readonly sequence: number;
}
/** x/z are normalized held-basis components, each [-1,1], length <= 1.
 * Positive x is screen-right; positive z is screen-up/away-from-camera, not world axes.
 * C uses the acquired basis for the whole session, not the current camera. */
export type GameplayCommand = Envelope & {
  readonly input: InputPacket;
} & (
    | GuardRequested
    | {
        readonly type: 'MoveRequested';
        readonly actorId: ActorId;
        readonly x: number;
        readonly z: number;
        readonly movementSessionId: string;
        readonly basisRevision: number;
      }
    | {
        readonly type: 'CrouchRequested';
        readonly actorId: ActorId;
        readonly active: boolean;
        readonly movementSessionId: string;
        readonly basisRevision: number;
      }
    | { readonly type: 'JumpRequested'; readonly actorId: ActorId }
    | {
        readonly type: 'AttackRequested';
        readonly actorId: ActorId;
        readonly category: AttackCategory;
      }
  );
/** Compatibility export retained now that guard is a canonical gameplay command. */
export type FightingGameplayCommand = GameplayCommand | GuardRequested;
export type GameCommand =
  | GameplayCommand
  | (Envelope &
      (
        | { readonly type: 'StartRequested' }
        | { readonly type: 'RetryRequested' }
        | { readonly type: 'PauseRequested'; readonly reason: PauseReason }
        | { readonly type: 'ResumeRequested'; readonly reason: PauseReason }
        | { readonly type: 'Backgrounded' }
        | { readonly type: 'Foregrounded' }
        | { readonly type: 'QualityChanged'; readonly quality: DisplayQuality }
        | { readonly type: 'MovementSessionEnded'; readonly sessionId: string }
        | { readonly type: 'InputsReleased' }
      ));

/** Stable batch cut-off is immediately before this fixed tick. Transport order is chronological,
 * not acceptance/attack-jump priority. P1 Core arbitrates the complete competing intent set. */
export interface GameplayInputBatch {
  readonly runId: RunId;
  readonly tick: Tick;
  readonly commands: readonly GameplayCommand[];
}

/** A-only notification: never accepted from InputPort, UI or host requests. */
export type CoreCommand =
  | GameCommand
  | { readonly type: 'AssetsReady'; readonly runId: RunId };

/** Capture the semantic guard packet; no device choice or posture inference occurs here. */
export function captureGuardRequested(input: GuardRequested): GuardRequested {
  if (
    input?.type !== 'GuardRequested' ||
    typeof input.active !== 'boolean' ||
    !input.input ||
    !Number.isSafeInteger(input.input.sequence) ||
    input.input.sequence <= 0 ||
    typeof input.runId !== 'string' ||
    typeof input.actorId !== 'string' ||
    typeof input.input.commandId !== 'string'
  )
    throw new RangeError('Invalid guard request');
  return Object.freeze({
    type: 'GuardRequested',
    runId: runId(input.runId),
    actorId: actorId(input.actorId),
    active: input.active,
    input: Object.freeze({
      commandId: commandId(input.input.commandId),
      sequence: input.input.sequence,
    }),
  });
}
