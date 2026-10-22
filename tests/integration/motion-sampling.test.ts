import { expect, test } from 'vitest';
import { createGame } from '../../src/app/createGame';
import {
  durationMs,
  runId as fixtureRunId,
  clipId as fixtureClipId,
  type MotionIntervalSample,
} from '../../src/contracts';
import { fixtureMotion } from '../core/fixtures/catalog';
import { createFixturePorts } from '../core/fixtures/ports';

test('C can consume deterministic actor-local moving volumes and root ownership through the public catalog port', async () => {
  const fixtures = createFixturePorts();
  const createSpatial = fixtures.factories.spatial;
  let sampled: MotionIntervalSample | undefined;
  const game = createGame(
    {
      ...fixtures.factories,
      spatial: (context) => ({
        ...createSpatial(context),
        step: (request, catalog) => {
          expect(
            catalog.sampleMotion,
            'B -> C sampling port must resolve hit shape trajectories',
          ).toBeTypeOf('function');
          sampled = catalog.sampleMotion(
            fixtureMotion.clipId,
            durationMs(100),
            durationMs(300),
          );
          return createSpatial(context).step(request, catalog);
        },
      }),
    },
    { sessionId: 'sample-boundary', seed: 42, stepMs: 20 },
  );
  await game.start();
  const snapshot = game.read();
  if (!snapshot) throw new Error('Expected active fixture run');
  game.dispatch({ type: 'StartRequested', runId: snapshot.runId });
  game.advance(20);
  expect(sampled?.clipId).toBe(fixtureMotion.clipId);
  expect(sampled?.rootSegments[0]).toMatchObject({
    horizontalOwner: 'authored-root',
    verticalOwner: 'spatial-jump',
    yawOwner: 'visual-only',
    deltaTranslation: { x: 0, y: 0, z: 0.2 },
  });
  expect(sampled?.hitVolumeSegments[0]).toMatchObject({
    impactIndex: 0,
    shapeId: 'foot',
    fromMs: 100,
    toMs: 300,
    from: { kind: 'sphere', center: { x: 0.1, y: 1, z: 0 }, radiusM: 0.1 },
    to: { kind: 'sphere', center: { x: 0.3, y: 1, z: 0 }, radiusM: 0.1 },
  });
  expect(Object.isFrozen(sampled)).toBe(true);
  game.dispose();
});

test('synthetic sampling is pure, bounds-checked, root-removed and half-open at active-window end', () => {
  const catalog = createFixturePorts().factories.catalog({
    runId: fixtureRunId('sampling-contract'),
    seed: 1,
  });
  const sample = () =>
    catalog.sampleMotion(
      fixtureMotion.clipId,
      durationMs(100),
      durationMs(300),
    );
  expect(sample()).toEqual(sample());
  expect(
    catalog.sampleMotion(fixtureMotion.clipId, durationMs(0), durationMs(1000))
      ?.rootSegments[0]?.to.visualYawRad,
  ).toBeCloseTo(2 * Math.PI, 12);
  expect(
    catalog
      .sampleMotion(fixtureMotion.clipId, durationMs(0), durationMs(1000))
      ?.rootSegments.at(-1)?.to,
  ).toEqual(fixtureMotion.rootCurve.at(-1));
  const result = sample();
  expect(result?.space).toMatchObject({
    handedness: 'right',
    up: '+Y',
    forward: '+Z',
    distanceUnit: 'metres',
    timeUnit: 'clip-milliseconds',
    hitVolumeSpace: 'actor-local-with-root-translation-removed',
  });
  expect(result?.hitVolumeSegments[0]).not.toHaveProperty('actorId');
  expect(result?.hitVolumeSegments[0]).not.toHaveProperty('impactId');
  expect(
    catalog.sampleMotion(
      fixtureClipId('missing'),
      durationMs(0),
      durationMs(1),
    ),
  ).toBeUndefined();
  expect(() =>
    catalog.sampleMotion(
      fixtureMotion.clipId,
      durationMs(300),
      durationMs(100),
    ),
  ).toThrow(RangeError);
  expect(() =>
    catalog.sampleMotion(fixtureMotion.clipId, durationMs(0), durationMs(1001)),
  ).toThrow(RangeError);
  expect(
    catalog.sampleMotion(fixtureMotion.clipId, durationMs(300), durationMs(400))
      ?.hitVolumeSegments,
  ).toEqual([]);
  const stationary = catalog.sampleMotion(
    fixtureMotion.clipId,
    durationMs(200),
    durationMs(200),
  );
  expect(stationary?.rootSegments).toEqual([]);
  expect(stationary?.hitVolumeSegments).toEqual([]);
  catalog.dispose();
});
