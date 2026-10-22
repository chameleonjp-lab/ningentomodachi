declare const unit: unique symbol;
export type Quantity<Unit extends string> = number & { readonly [unit]: Unit };
export type Tick = Quantity<'tick'>;
export type GameTimeMs = Quantity<'game-ms'>;
export type ActiveRealTimeMs = Quantity<'active-real-ms'>;
export type PresentationTimeMs = Quantity<'presentation-ms'>;
export type DurationMs = Quantity<'duration-ms'>;
function nonnegative<Unit extends string>(value: number): Quantity<Unit> {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError('Time must be finite and nonnegative');
  return value as Quantity<Unit>;
}
export function tick(value: number): Tick {
  if (!Number.isSafeInteger(value))
    throw new RangeError('Tick must be a safe integer');
  return nonnegative(value);
}
export const gameTimeMs = (value: number): GameTimeMs => nonnegative(value);
export const activeRealTimeMs = (value: number): ActiveRealTimeMs =>
  nonnegative(value);
export const presentationTimeMs = (value: number): PresentationTimeMs =>
  nonnegative(value);
export const durationMs = (value: number): DurationMs => nonnegative(value);
export const secondsToMilliseconds = (seconds: number): DurationMs =>
  durationMs(seconds * 1000);
export interface GameClocks {
  readonly tick: Tick;
  readonly gameTimeMs: GameTimeMs;
  readonly activeRealTimeMs: ActiveRealTimeMs;
  readonly presentationTimeMs: PresentationTimeMs;
}
export interface FixedStep {
  readonly durationMs: DurationMs;
}
