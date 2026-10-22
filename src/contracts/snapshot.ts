import type { GameClocks, PresentationTimeMs } from './clock';
import type { ActorState, TerminalResult, WorldState } from './combat';
import type { DisplayQuality, PauseReason } from './commands';
import type { GamePhase } from './events';
import type { ActorId, RunId } from './ids';
/** Real-time, pause-stable display clock. Core owns all transitions and deadlines;
 * result/score/heat are already frozen while terminal visuals continue. UI never starts its own timer. */
export type PresentationState =
  | { readonly kind: 'none' }
  | { readonly kind: 'results' }
  | {
      readonly kind:
        | 'opponent-defeat'
        | 'opponent-defeat-finish'
        | 'defeat-slow'
        | 'clear-slow'
        | 'fade';
      readonly actorId: ActorId | null;
      readonly startedAt: PresentationTimeMs;
      readonly endsAt: PresentationTimeMs;
    };
export interface GameSnapshot {
  /** Strictly increasing for every state change, including no-tick settings/presentation changes. */
  readonly revision: number;
  readonly contractVersion: 1;
  readonly runId: RunId;
  readonly phase: GamePhase;
  readonly clocks: GameClocks;
  readonly seed: number;
  readonly pauseReasons: readonly PauseReason[];
  readonly quality: DisplayQuality;
  readonly actors: readonly ActorState[];
  /** A-owned complete robot residency, separate from the retained logical roster.
   * Production emits white plus current/dying opponent only. Undefined is legacy-only.
   * Removal retires that ID for this run: no rig/pose resurrection by historical replay. */
  readonly residentActorIds?: readonly ActorId[];
  readonly currentOpponentId: ActorId | null;
  readonly result: TerminalResult | null;
  readonly presentation: PresentationState;
  readonly world: WorldState;
}
