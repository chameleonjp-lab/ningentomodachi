import { requireValue } from '../../src/core/invariant';
import { expect, test } from 'vitest';
import { actorId, clipId, runId } from '../../src/contracts';
import type {
  FightingActualRecipeGeometrySample,
  FightingActualRecipeSamplerFactory,
  FightingActualRecipeSamplerPort,
  FightingGeometryManifestContext,
  FightingGeometrySourcePin,
} from '../../src/contracts/fighting';
import * as admission from '../../src/qualification/fightingAdmission';

// Explicit structural fixture. These made-up pins/regions have NO actual-source qualification.
function fixture() {
  const run = runId('structural-preparation-run'),
    actor = actorId('core-issued-fixture-actor');
  const clip = clipId('structural-ready');
  const source: FightingGeometrySourcePin = {
    sourceBindingId: 'structural-source',
    clipId: clip,
    durationMs: 1000,
    rootPolicy: 'grounded-posture-y',
    provenance: {
      sourceSha256: '1'.repeat(64),
      evaluatorSha256: '2'.repeat(64),
      calibrationSha256: '3'.repeat(64),
      mappingSha256: '4'.repeat(64),
      sourceClosureSha256: '5'.repeat(64),
      qualificationEvidenceSha256: '6'.repeat(64),
    },
    poseNames: Array.from({ length: 53 }, (_, i) => `structural-bone:${i}`),
    primitives: [{ primitive: 0, vertexCount: 2 }],
    soles: (
      [
        { side: 'L', vertex: 0 },
        { side: 'R', vertex: 1 },
      ] as const
    ).map((s) => ({
      side: s.side,
      surfaceId: `structural-sole:${s.side}`,
      sourceBindingId: 'structural-source',
      members: [{ primitive: 0, vertexIndex: s.vertex }],
    })),
    shapeIds: [],
  };
  const manifestContext: FightingGeometryManifestContext = {
    bindingSetId: 'structural-preparation',
    sourcePins: [structuredClone(source)],
    limits: {
      maxSources: 1,
      maxVariants: 1,
      maxPrimitivesPerSource: 1,
      maxSolePoints: 1,
      maxShapes: 0,
      maxImpacts: 0,
    },
  };
  const geometryManifest = {
    schema: 'actual-geometry-manifest-v1' as const,
    bindingSetId: manifestContext.bindingSetId,
    sources: [source],
    variants: [
      {
        geometryBindingId: 'structural-ready-variant',
        sourceBindingId: source.sourceBindingId,
        clipId: clip,
        phase: 'neutral' as const,
        posture: 'standing' as const,
        coverage: { kind: 'finite' as const, fromMs: 0 as const, toMs: 1000 },
      },
    ],
  };
  const query = {
    clipId: clip,
    phase: 'neutral' as const,
    posture: 'standing' as const,
    atMs: 0,
    acceptedRoot: { x: 0, z: 0 },
    groundClearanceM: 0,
  };
  const expectation = {
    selectedGeometryBindingId: 'structural-ready-variant',
    impacts: [],
    expectedHurtProxy: {
      kind: 'posture-capsule-proxy-v1' as const,
      posture: 'standing' as const,
      volume: {
        kind: 'capsule' as const,
        start: { x: 0, y: 0.35, z: 0 },
        end: { x: 0, y: 1.5, z: 0 },
        radiusM: 0.35,
      },
    },
  };
  const sample: FightingActualRecipeGeometrySample = {
    recipeVersion: 'actual53-ik-surface-v1',
    clipId: clip,
    atMs: 0,
    pose: source.poseNames.map((name) => ({
      name,
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    })),
    support: (['L', 'R'] as const).map((side) => ({
      side,
      planted: true,
      local: [0, 0, 0],
      worldRotation: [0, 0, 0, 1],
      desiredWorld: [0, 0, 0],
      errorM: 0,
      world: [0, 0, 0],
    })),
    durationMs: 1000,
    active: false,
    intendedRoot: { x: 0, y: 0, z: 0 },
    acceptedRoot: { x: 0, y: 0, z: 0 },
    shape: null,
    geometryProtocol: 'actual-geometry-v1',
    geometryBindingId: expectation.selectedGeometryBindingId,
    soles: source.soles.map((s) => ({
      side: s.side,
      surfaceId: s.surfaceId,
      points: s.members.map((m) => ({ ...m, local: { x: 0, y: 0, z: 0 } })),
      normal: { x: 0, y: -1, z: 0 },
    })),
    hurt: structuredClone(expectation.expectedHurtProxy),
    hitShapes: [],
  };
  const events: string[] = [];
  let onCreate = () => {},
    onSample = () => {};
  const raw: FightingActualRecipeSamplerPort = {
    runId: run,
    actorId: actor,
    bindingSetId: geometryManifest.bindingSetId,
    sample(q) {
      expect(this).toBe(raw);
      events.push('sample');
      onSample();
      expect(q).toEqual(query);
      return sample;
    },
    dispose() {
      expect(this).toBe(raw);
      events.push('dispose');
    },
  };
  const factory: FightingActualRecipeSamplerFactory = {
    runId: run,
    bindingSetId: geometryManifest.bindingSetId,
    geometryManifest,
    create(id) {
      expect(this).toBe(factory);
      expect(id).toBe(actor);
      events.push('create');
      onCreate();
      return raw;
    },
  };
  const controller = new AbortController();
  const options = {
    runId: run,
    actorIds: [actor],
    manifestContext,
    normalLengthTolerance: 0,
    budgets: {
      maxConcurrentLeases: 1,
      maxTotalLeases: 2,
      maxSamplesPerLease: 2,
      maxDataNodes: 10000,
    },
    signal: controller.signal,
  };
  return {
    run,
    actor,
    query,
    expectation,
    sample,
    raw,
    factory,
    options,
    events,
    controller,
    setCreate: (fn: () => void) => {
      onCreate = fn;
    },
    setSample: (fn: () => void) => {
      onSample = fn;
    },
  };
}

const prepare = (f = fixture()) =>
  admission.createFightingPointPreparation(f.factory, f.options);

test('lazy structural point scope captures independent context and original methods without granting production capability', () => {
  const f = fixture(),
    scope = prepare(f);
  expect(scope.level).toBe('point-structure-only');
  expect(Reflect.get(scope, 'bindPrepared')).toBeUndefined();
  expect(f.events).toEqual([]);
  const lease = scope.lease(f.actor);
  const result = lease.sample(f.query, f.expectation);
  expect(result).toEqual(f.sample);
  expect(result).not.toBe(f.sample);
  expect(Object.isFrozen(result.soles[0]?.points)).toBe(true);
  Reflect.set(
    requireValue(f.options.manifestContext.sourcePins[0]).provenance,
    'sourceSha256',
    'f'.repeat(64),
  );
  Reflect.set(f.raw, 'sample', () => {
    throw new Error('late replacement');
  });
  expect(lease.sample(f.query, f.expectation)).toEqual(result);
  scope.dispose();
  scope.dispose();
  lease.dispose();
  expect(f.events).toEqual(['create', 'sample', 'sample', 'dispose']);
  expect(() => lease.sample(f.query, f.expectation)).toThrow(/closed/);
  expect(() => scope.lease(f.actor)).toThrow(/closed/);
});

test('actor/run/binding mismatches fail before reuse and dispose a returned invalid lease once', () => {
  const f = fixture(),
    scope = prepare(f);
  expect(() => scope.lease(actorId('foreign-actor'))).toThrow(/roster/);
  expect(f.events).toEqual([]);
  Reflect.set(f.raw, 'runId', runId('old-run'));
  expect(() => scope.lease(f.actor)).toThrow(/identity/);
  expect(f.events).toEqual(['create', 'dispose']);
  scope.dispose();
  expect(f.events).toEqual(['create', 'dispose']);
});

test('explicit finite resource budgets bound concurrent and lifetime allocations and producer samples', () => {
  const f = fixture();
  const originalCreate = f.factory.create;
  let created = 0;
  Reflect.set(f.factory, 'create', (id: typeof f.actor) => {
    const raw = Reflect.apply(originalCreate, f.factory, [id]);
    return created++ === 0
      ? raw
      : {
          ...raw,
          dispose: () => {
            f.events.push('dispose');
          },
        };
  });
  const scope = prepare(f),
    lease = scope.lease(f.actor);
  expect(() => scope.lease(f.actor)).toThrow(/lease/);
  lease.sample(f.query, f.expectation);
  lease.sample(f.query, f.expectation);
  expect(() => lease.sample(f.query, f.expectation)).toThrow(/budget/);
  expect(f.events.filter((e) => e === 'sample')).toHaveLength(2);
  lease.dispose();
  scope.lease(f.actor).dispose();
  expect(() => scope.lease(f.actor)).toThrow(/budget/);
  scope.dispose();
});

test('abort during creation cleans the late lease without returning stale authority', () => {
  const f = fixture(),
    scope = prepare(f);
  f.setCreate(() => f.controller.abort());
  expect(() => scope.lease(f.actor)).toThrow(/closed/);
  expect(f.events).toEqual(['create', 'dispose']);
});

test('abort during sample defers cleanup until producer exits and rejects the late result', () => {
  const f = fixture(),
    scope = prepare(f),
    lease = scope.lease(f.actor);
  f.setSample(() => {
    f.controller.abort();
    expect(f.events).toEqual(['create', 'sample']);
  });
  expect(() => lease.sample(f.query, f.expectation)).toThrow(/closed/);
  expect(f.events).toEqual(['create', 'sample', 'dispose']);
});

test('reentrant create/sample is rejected without an extra allocation or producer call', () => {
  const f = fixture(),
    scope = prepare(f);
  f.setCreate(() => expect(() => scope.lease(f.actor)).toThrow(/reentrant/));
  const lease = scope.lease(f.actor);
  f.setSample(() =>
    expect(() => lease.sample(f.query, f.expectation)).toThrow(/reentrant/),
  );
  lease.sample(f.query, f.expectation);
  expect(f.events).toEqual(['create', 'sample']);
  scope.dispose();
});

test('invalid geometry closes only its lease, preserves primary failure and exposes cleanup errors', () => {
  const f = fixture();
  const cleanup = new Error('cleanup failure');
  Reflect.set(f.raw, 'dispose', () => {
    f.events.push('dispose');
    throw cleanup;
  });
  const scope = prepare(f),
    lease = scope.lease(f.actor);
  Reflect.set(
    requireValue(requireValue(f.sample.soles[0]).points[0]).local,
    'y',
    NaN,
  );
  expect(() => lease.sample(f.query, f.expectation)).toThrow();
  expect(f.events).toEqual(['create', 'sample', 'dispose']);
  expect(scope.cleanupErrors()).toEqual([cleanup]);
  expect(() => lease.sample(f.query, f.expectation)).toThrow(/closed/);
  expect(() => scope.dispose()).toThrow(AggregateError);
});

test('query/expectation is detached before callback; source cannot rewrite its expected proxy', () => {
  const f = fixture(),
    scope = prepare(f),
    lease = scope.lease(f.actor);
  f.setSample(() => {
    f.expectation.expectedHurtProxy.volume.radiusM = 9;
  });
  const result = lease.sample(f.query, f.expectation);
  expect(result.hurt.volume.radiusM).toBe(0.35);
  scope.dispose();
});

test.each([0, -1, Infinity, NaN, 1.5])(
  'invalid explicit budget %s allocates nothing',
  (value) => {
    const f = fixture();
    f.options.budgets.maxTotalLeases = value;
    expect(() => prepare(f)).toThrow(/budget/);
    expect(f.events).toEqual([]);
  },
);

test('rejects missing normal policy, oversized DTO, accessor and malformed query before producer', () => {
  const f = fixture();
  f.options.normalLengthTolerance = NaN;
  expect(() => prepare(f)).toThrow(/normal/);
  f.options.normalLengthTolerance = 0;
  const scope = prepare(f),
    lease = scope.lease(f.actor);
  let reads = 0;
  const q = { ...f.query };
  Object.defineProperty(q, 'atMs', {
    enumerable: true,
    get() {
      reads++;
      return 0;
    },
  });
  expect(() => lease.sample(q, f.expectation)).toThrow(/data/);
  expect(reads).toBe(0);
  expect(f.events).toEqual(['create', 'dispose']);
  scope.dispose();
  const g = fixture();
  g.options.budgets.maxDataNodes = 2;
  expect(() => prepare(g)).toThrow(/budget/);
  expect(g.events).toEqual([]);
});

test('late abort while observing result DTO never returns a captured stale point', () => {
  const f = fixture(),
    scope = prepare(f),
    lease = scope.lease(f.actor);
  const result = new Proxy(f.sample, {
    ownKeys(target) {
      f.controller.abort();
      return Reflect.ownKeys(target);
    },
  });
  Reflect.set(f.raw, 'sample', () => result);
  // A fresh scope captures that method; the original scope remains separately owned.
  const g = prepare(f),
    l = g.lease(f.actor);
  expect(() => l.sample(f.query, f.expectation)).toThrow(/closed/);
  expect(() => lease.sample(f.query, f.expectation)).toThrow(/closed/);
  g.dispose();
  scope.dispose();
});

test('output DTO is bounded and accessor-free before contextual capture, then lease is cleaned', () => {
  const f = fixture();
  const oversized = {
    ...f.sample,
    pose: Array.from({ length: 10001 }, () => requireValue(f.sample.pose[0])),
  };
  Reflect.set(f.raw, 'sample', () => oversized);
  const scope = prepare(f),
    lease = scope.lease(f.actor);
  expect(() => lease.sample(f.query, f.expectation)).toThrow(/budget/);
  expect(f.events).toEqual(['create', 'dispose']);
  scope.dispose();
});

test('scope cleanup retires all actors in reverse acquisition order despite a disposer failure', () => {
  const f = fixture(),
    other = actorId('other-core-issued-fixture');
  f.options.actorIds.push(other);
  f.options.budgets.maxConcurrentLeases = 2;
  const cleanup = new Error('second disposal failed');
  Reflect.set(f.factory, 'create', (id: typeof other) => ({
    ...f.raw,
    actorId: id,
    dispose() {
      f.events.push(`dispose:${id}`);
      if (id === other) throw cleanup;
    },
  }));
  const scope = prepare(f);
  scope.lease(f.actor);
  scope.lease(other);
  expect(() => scope.dispose()).toThrow(AggregateError);
  expect(f.events).toEqual([`dispose:${other}`, `dispose:${f.actor}`]);
  expect(scope.cleanupErrors()).toEqual([cleanup]);
});

test('unknown query fields cannot shadow context and malformed query never calls producer', () => {
  const f = fixture(),
    scope = prepare(f),
    lease = scope.lease(f.actor);
  expect(() =>
    lease.sample({ ...f.query, atMs: NaN }, f.expectation),
  ).toThrow();
  expect(f.events).toEqual(['create', 'dispose']);
  scope.dispose();
  const g = fixture(),
    s = prepare(g),
    l = s.lease(g.actor);
  expect(() =>
    l.sample(g.query, {
      ...g.expectation,
      query: g.query,
    } as typeof g.expectation),
  ).toThrow(/fields/);
  expect(g.events).toEqual(['create', 'dispose']);
  s.dispose();
});

test('a factory cannot recycle an already retired raw lease object into a fresh lifetime', () => {
  const f = fixture(),
    scope = prepare(f),
    lease = scope.lease(f.actor);
  lease.dispose();
  expect(() => scope.lease(f.actor)).toThrow(/reused/);
  expect(f.events).toEqual(['create', 'dispose', 'create']);
  scope.dispose();
});

test('abort during input snapshot prevents a producer callback after cancellation', () => {
  const f = fixture(),
    scope = prepare(f),
    lease = scope.lease(f.actor);
  const query = new Proxy(f.query, {
    ownKeys(target) {
      f.controller.abort();
      return Reflect.ownKeys(target);
    },
  });
  expect(() => lease.sample(query, f.expectation)).toThrow(/closed/);
  expect(f.events).toEqual(['create', 'dispose']);
  scope.dispose();
});

function cleanupReentryFixture() {
  const f = fixture(),
    other = actorId('second-cleanup-reentry-actor');
  f.options.actorIds.push(other);
  f.options.budgets.maxConcurrentLeases = 2;
  const callbacks = new Map<typeof f.actor, () => void>();
  Reflect.set(f.factory, 'create', (id: typeof f.actor) => {
    const resource = {
      ...f.raw,
      actorId: id,
      sample() {
        f.events.push(`sample:${id}`);
        return f.sample;
      },
      dispose() {
        expect(this).toBe(resource);
        f.events.push(`dispose:${id}`);
        callbacks.get(id)?.();
      },
    };
    return resource;
  });
  const scope = prepare(f),
    first = scope.lease(f.actor),
    second = scope.lease(other);
  return {
    f,
    other,
    scope,
    first,
    second,
    onDispose: (id: typeof f.actor, fn: () => void) => callbacks.set(id, fn),
  };
}

test('cleanup reentry closes and drains an already visited sibling before the outer dispose returns', () => {
  const h = cleanupReentryFixture();
  h.onDispose(h.f.actor, () => h.scope.dispose());
  h.first.dispose();
  expect(h.f.events).toEqual([`dispose:${h.f.actor}`, `dispose:${h.other}`]);
  expect(() => h.second.sample(h.f.query, h.f.expectation)).toThrow(/closed/);
  h.scope.dispose();
  h.first.dispose();
  h.second.dispose();
  expect(h.f.events).toHaveLength(2);
});

test('cleanup reentry drains sibling retirement without an unrelated future scope operation', () => {
  const h = cleanupReentryFixture();
  h.onDispose(h.f.actor, () => h.second.dispose());
  h.first.dispose();
  expect(h.f.events).toEqual([`dispose:${h.f.actor}`, `dispose:${h.other}`]);
  h.scope.dispose();
  expect(h.f.events).toHaveLength(2);
});

test('abort from cleanup drains every newly retired owned resource exactly once', () => {
  const h = cleanupReentryFixture();
  h.onDispose(h.f.actor, () => h.f.controller.abort());
  h.first.dispose();
  expect(h.f.events).toEqual([`dispose:${h.f.actor}`, `dispose:${h.other}`]);
  expect(() => h.scope.lease(h.other)).toThrow(/closed/);
  h.scope.dispose();
  expect(h.f.events).toHaveLength(2);
});

test('new sibling retirement is drained even when the initiating cleanup throws', () => {
  const h = cleanupReentryFixture(),
    failure = new Error('cleanup failed after sibling retirement');
  h.onDispose(h.f.actor, () => {
    h.second.dispose();
    throw failure;
  });
  h.first.dispose();
  expect(h.f.events).toEqual([`dispose:${h.f.actor}`, `dispose:${h.other}`]);
  expect(h.scope.cleanupErrors()).toEqual([failure]);
  expect(() => h.scope.dispose()).toThrow(AggregateError);
  expect(() => h.scope.dispose()).toThrow(AggregateError);
  expect(h.f.events).toHaveLength(2);
});

test('mutually reentrant cleanup cannot reopen or repeatedly retire already cleaned resources', () => {
  const h = cleanupReentryFixture();
  h.onDispose(h.f.actor, () => {
    h.second.dispose();
    h.scope.dispose();
  });
  h.onDispose(h.other, () => {
    h.first.dispose();
    h.second.dispose();
    h.scope.dispose();
  });
  h.first.dispose();
  expect(h.f.events).toEqual([`dispose:${h.f.actor}`, `dispose:${h.other}`]);
  expect(h.scope.cleanupErrors()).toEqual([]);
  h.scope.dispose();
});

test('primary sample validation error survives cleanup reentry and later disposer failure', () => {
  const h = cleanupReentryFixture(),
    failure = new Error('cleanup sentinel');
  h.onDispose(h.f.actor, () => {
    h.scope.dispose();
    throw failure;
  });
  expect(() =>
    h.first.sample({ ...h.f.query, atMs: NaN }, h.f.expectation),
  ).toThrow(/Invalid preparation data/);
  expect(h.f.events).toEqual([`dispose:${h.f.actor}`, `dispose:${h.other}`]);
  expect(h.scope.cleanupErrors()).toEqual([failure]);
  expect(() => h.scope.dispose()).toThrow(AggregateError);
});

test('scope-wide cleanup keeps normal reverse acquisition order under repeated close callbacks', () => {
  const h = cleanupReentryFixture();
  h.onDispose(h.other, () => {
    h.first.dispose();
    h.scope.dispose();
  });
  h.onDispose(h.f.actor, () => h.scope.dispose());
  h.scope.dispose();
  expect(h.f.events).toEqual([`dispose:${h.other}`, `dispose:${h.f.actor}`]);
  h.scope.dispose();
  expect(h.f.events).toHaveLength(2);
});
