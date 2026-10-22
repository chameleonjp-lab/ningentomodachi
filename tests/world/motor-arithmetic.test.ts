import { expect, test } from 'vitest';
import { durationMs, gameTimeMs, type SpatialActor } from '../../src/contracts';
import { stepCharacter } from '../../src/world/character-motor';
import { createSpatialEngine } from '../../src/world/spatial-engine';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { actor, catalog, run, state } from './fixtures';

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const layout = { ...createParisStreetLayout(), objects: [], vehicles: [] };
const white = actor('white');
const pose: SpatialActor = {
  actorId: white.actorId,
  position: v(),
  velocity: v(),
  facing: v(0, 0, 1),
  grounded: true,
  locomotion: 'idle',
};
for (const duration of [1e160, Number.MAX_VALUE]) {
  test(`motor rejects overflowing integration at ${duration}`, () => {
    expect(() =>
      stepCharacter(
        pose,
        white,
        0,
        duration,
        v(),
        false,
        undefined,
        0,
        layout,
        [],
      ),
    ).toThrow(RangeError);
  });
  test(`rejected public step at ${duration} leaves residency/tick state and retry unchanged`, () => {
    const engine = createSpatialEngine(run, layout),
      control = createSpatialEngine(run, layout);
    const initial = state(0, {
      residentActorIds: [white.actorId, actor('blue').actorId],
    });
    engine.commit({ snapshot: initial, events: [] });
    control.commit({ snapshot: initial, events: [] });
    const bad = state(1, { residentActorIds: [white.actorId] });
    expect(() =>
      engine.step(
        {
          snapshot: {
            ...bad,
            clocks: { ...bad.clocks, gameTimeMs: gameTimeMs(duration) },
          },
          step: { durationMs: durationMs(duration) },
          intents: [],
        },
        catalog(),
      ),
    ).toThrow(RangeError);
    expect(engine.isRetired(actor('blue').actorId)).toBe(false);
    const valid = {
      snapshot: state(1, {
        residentActorIds: [white.actorId, actor('blue').actorId],
      }),
      step: { durationMs: durationMs(20) },
      intents: [],
    };
    expect(engine.step(valid, catalog())).toEqual(
      control.step(valid, catalog()),
    );
  });
}
for (const duration of [1e6, 1e12])
  test(`finite coarse duration ${duration} retains its endpoint`, () => {
    const result = stepCharacter(
      pose,
      white,
      0,
      duration,
      v(),
      false,
      undefined,
      0,
      layout,
      [],
    );
    expect(result.path.at(-1)?.at).toBe(duration);
    for (const key of result.path)
      for (const x of Object.values(key.position))
        expect(Number.isFinite(x)).toBe(true);
    for (const x of Object.values(result.actor.velocity))
      expect(Number.isFinite(x)).toBe(true);
  });
