import type { DurationMs, FixedStep } from './clock';
import type {
  CoreCommand,
  GameCommand,
  GameplayCommand,
  GameplayInputBatch,
} from './commands';
import type { DomainEvent } from './events';
import type { ClipId, RunId } from './ids';
import type {
  HostRequest,
  HostSnapshot,
  InputGate,
  MovementBasisSnapshot,
  MovementSessionPort,
  ViewportReader,
  ViewportSnapshot,
} from './interaction';
import type { MotionDefinition, MotionIntervalSample } from './motion';
import type { ActorRenderHostPort } from './render';
import type { GameSnapshot } from './snapshot';
import type { Projection, SpatialCandidate, SpatialSnapshot } from './spatial';
export type Unsubscribe = () => void;
export interface Disposable {
  dispose(): void;
}
export interface RunContext {
  readonly runId: RunId;
  readonly seed: number;
}
export interface ModuleContext extends RunContext {
  readonly viewport: ViewportReader;
}
export interface AnimationModuleContext<Node> extends ModuleContext {
  readonly renderHost: ActorRenderHostPort<Node>;
}
export interface InputModuleContext extends ModuleContext {
  readonly movement: MovementSessionPort;
  readSnapshot(): GameSnapshot | null;
}
export interface UiModuleContext extends ModuleContext {
  request(message: HostRequest): void;
}
export interface CoreOutput {
  readonly snapshot: GameSnapshot;
  readonly events: readonly DomainEvent[];
}
/** All adapters read one committed frame; B never guesses C's collision-resolved transform. */
export interface CommittedFrame extends CoreOutput {
  readonly spatial: SpatialSnapshot;
  readonly viewport: ViewportSnapshot;
}
export interface SpatialStepRequest {
  readonly snapshot: GameSnapshot;
  readonly step: FixedStep;
  readonly intents: readonly GameplayCommand[];
}
export interface SpatialStepResult {
  readonly snapshot: SpatialSnapshot;
  readonly candidates: readonly SpatialCandidate[];
}
export interface CorePort extends Disposable {
  handle(command: CoreCommand): void;
  handleInputBatch(batch: GameplayInputBatch): void;
  beginStep(step: FixedStep): SpatialStepRequest;
  completeStep(result: SpatialStepResult): CoreOutput;
  present(elapsed: DurationMs): void;
  read(): GameSnapshot;
  drain(): CoreOutput;
  fail(message: string): void;
}
export interface MotionCatalogPort extends Disposable {
  /** Complete validated pack only, including resolvable shape samples. */
  prepare(signal: AbortSignal): Promise<void>;
  get(clipId: ClipId): MotionDefinition | undefined;
  list(): readonly MotionDefinition[];
  sampleMotion(
    clipId: ClipId,
    fromMs: DurationMs,
    toMs: DurationMs,
  ): MotionIntervalSample | undefined;
}
export interface AnimationPort extends Disposable {
  render(frame: CommittedFrame): void;
}
export interface SpatialPort extends Disposable {
  step(
    request: SpatialStepRequest,
    catalog: MotionCatalogPort,
  ): SpatialStepResult;
  /** Apply A's authoritative actor/world state (and deduplicated launch events), then expose C pose.
   * This does not run another simulation step. Render/animation never change Core HP or durability. */
  commit(output: CoreOutput, viewport: ViewportSnapshot): SpatialSnapshot;
  beginMovementSession(sessionId: string): MovementBasisSnapshot;
  endMovementSession(sessionId: string, reason: 'released' | 'cancelled'): void;
  render(frame: CommittedFrame): void;
  project(frame: CommittedFrame): readonly Projection[];
}
export interface SpatialModule<Node> extends SpatialPort {
  readonly renderHost: ActorRenderHostPort<Node>;
}
export interface UiPort extends Disposable {
  render(frame: CommittedFrame, projections: readonly Projection[]): void;
}
export interface InputPort extends Disposable {
  subscribe(listener: (command: GameCommand) => void): Unsubscribe;
  setGate(gate: InputGate): void;
  /** Release D's pointer state only; do not echo new commands during an A-requested release. */
  releaseAll(): void;
}
/** Persistent D shell: title/loading/error/retry/results survives every run-scoped disposal. */
export interface HostPort extends Disposable {
  subscribe(listener: (request: HostRequest) => void): Unsubscribe;
  render(state: HostSnapshot): void;
}
export interface ModuleFactories<Node = never> {
  readonly catalog: (context: RunContext) => MotionCatalogPort;
  readonly animation: (context: AnimationModuleContext<Node>) => AnimationPort;
  readonly spatial: (context: ModuleContext) => SpatialModule<Node>;
  readonly ui: (context: UiModuleContext) => UiPort;
  readonly input: (context: InputModuleContext) => InputPort;
  readonly host?: (viewport: ViewportReader) => HostPort;
  readonly core?: (context: RunContext) => CorePort;
}
