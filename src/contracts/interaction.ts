import type { GameCommand } from './commands';
import type { RunId } from './ids';
import type { Vector3 } from './motion';
import type { GameSnapshot } from './snapshot';

/** A's host is the sole revision publisher. C/D receive only this read/subscription port. */
export interface ViewportMetrics {
  readonly widthCssPx: number;
  readonly heightCssPx: number;
  readonly offsetLeftCssPx: number;
  readonly offsetTopCssPx: number;
  readonly devicePixelRatio: number;
  readonly safeAreaCssPx: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
}
export interface ViewportSnapshot extends ViewportMetrics {
  readonly revision: number;
}
export interface ViewportReader {
  read(): ViewportSnapshot;
  subscribe(listener: (viewport: ViewportSnapshot) => void): () => void;
}
/** Acquired synchronously at gesture start, even at zero displacement, never at the next tick. */
/** Held gesture basis: right maps positive screen x; depth maps screen-up/away-from-camera. */
export interface MovementBasisSnapshot {
  readonly runId: RunId;
  readonly sessionId: string;
  readonly revision: number;
  readonly right: Vector3;
  readonly depth: Vector3;
}
export type InputReleaseReason =
  | 'pointer-cancel'
  | 'pause'
  | 'viewport-change'
  | 'restart'
  | 'interruption'
  | 'terminal'
  | 'dispose';
export interface MovementSessionPort {
  begin(sessionId: string): MovementBasisSnapshot;
  end(sessionId: string, reason: 'released' | 'cancelled'): void;
  releaseAll(reason: InputReleaseReason): void;
}
export interface InputGate {
  readonly runId: RunId;
  readonly enabled: boolean;
}
export type HostPhase =
  | 'title'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'error'
  | 'results'
  | 'disposed';
export interface HostSnapshot {
  readonly revision: number;
  readonly phase: HostPhase;
  readonly runId: RunId | null;
  readonly game: GameSnapshot | null;
  readonly error: string | null;
  readonly viewport: ViewportSnapshot;
}
/** App-lifetime requests survive run failure. IDs are unique for this host; repeats are ignored. */
export type HostRequest = { readonly requestId: string } & (
  | {
      readonly type:
        | 'PrepareRequested'
        | 'RetryRequested'
        | 'StartRequested'
        | 'ReturnToTitleRequested'
        | 'CancelLoadingRequested';
    }
  | { readonly type: 'CommandRequested'; readonly command: GameCommand }
);
