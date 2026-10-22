declare const identity: unique symbol;
export type Id<Kind extends string> = string & { readonly [identity]: Kind };
/** Actor IDs never repeat within a run, including opponent switches. Run + actor identifies HUD history. */
export type ActorId = Id<'actor'>;
export type CommandId = Id<'command'>;
export type AttackActivationId = Id<'attack-activation'>;
export type ImpactId = Id<'impact'>;
export type VehicleId = Id<'vehicle'>;
export type LaunchId = Id<'launch'>;
export type ContactId = Id<'contact'>;
export type DomainEventId = Id<'event'>;
export type RunId = Id<'run'>;
export type BatchId = Id<'batch'>;
export type WorldObjectId = Id<'world-object'>;
export type ClipId = Id<'clip'>;

function id<Kind extends string>(value: string): Id<Kind> {
  if (!value.trim() || value !== value.trim())
    throw new RangeError('IDs must be nonempty and trimmed');
  return value as Id<Kind>;
}
export const actorId = (value: string): ActorId => id(value);
export const attackActivationId = (value: string): AttackActivationId =>
  id(value);
export const impactId = (value: string): ImpactId => id(value);
export const vehicleId = (value: string): VehicleId => id(value);
export const launchId = (value: string): LaunchId => id(value);
export const contactId = (value: string): ContactId => id(value);
export const domainEventId = (value: string): DomainEventId => id(value);
export const runId = (value: string): RunId => id(value);
export const batchId = (value: string): BatchId => id(value);
export const worldObjectId = (value: string): WorldObjectId => id(value);
export const clipId = (value: string): ClipId => id(value);

export const commandId = (value: string): CommandId => id(value);
