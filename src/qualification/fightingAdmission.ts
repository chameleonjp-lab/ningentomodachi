import { actorId, runId, type ActorId, type RunId } from '../contracts';
import {
  captureFightingActualRecipeGeometrySample,
  captureFightingActualRecipeSamplerFactory,
  captureFightingActualRecipeSamplerPort,
  captureFightingRecipeEntry,
  type FightingActualRecipeSamplerFactory,
  type FightingActualRecipeSamplerPort,
  type FightingGeometryManifestContext,
  type FightingGeometrySampleContext,
  type FightingRecipeQuery,
} from '../contracts/fighting';

export interface FightingPointPreparationOptions {
  readonly runId: RunId;
  /** The caller supplies its actual Core-issued roster; no actor ID synthesis here. */
  readonly actorIds: readonly ActorId[];
  /** Independently supplied caller authority, NOT authenticated by structural capture. */
  readonly manifestContext: FightingGeometryManifestContext;
  readonly normalLengthTolerance: number;
  readonly budgets: {
    readonly maxConcurrentLeases: number;
    readonly maxTotalLeases: number;
    readonly maxSamplesPerLease: number;
    readonly maxDataNodes: number;
  };
  readonly signal: AbortSignal;
}
export type FightingPointExpectation = Pick<
  FightingGeometrySampleContext,
  'selectedGeometryBindingId' | 'impacts' | 'expectedHurtProxy'
>;

function positiveBudget(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError('Invalid explicit preparation budget');
  return value;
}
function exactDataFields(
  input: object,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const keys = Object.keys(input);
  if (
    required.some((key) => !Object.hasOwn(input, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new RangeError('Unexpected preparation data fields');
}
function dataValue(input: object, key: string): unknown {
  const property = Object.getOwnPropertyDescriptor(input, key);
  if (!property || !('value' in property))
    throw new RangeError('Preparation requires own data properties');
  return property.value;
}
/** Bounded descriptor-only snapshot: no getters/iterators, functions or resource DTOs. */
function snapshot<T>(input: T, budget: number): T {
  let remaining = budget;
  const ancestors = new Set<object>();
  function copy(value: unknown): unknown {
    if (--remaining < 0)
      throw new RangeError('Preparation data budget exceeded');
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || ancestors.has(value))
      throw new RangeError('Invalid preparation data');
    const array = Array.isArray(value),
      prototype = Object.getPrototypeOf(value);
    if (
      prototype !== (array ? Array.prototype : Object.prototype) &&
      !(prototype === null && !array)
    )
      throw new RangeError('Invalid preparation data prototype');
    ancestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    let result: unknown;
    if (array) {
      const length = descriptors.length?.value;
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > remaining ||
        Reflect.ownKeys(descriptors).length !== length + 1
      )
        throw new RangeError('Invalid preparation array/data budget');
      const list: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
          throw new RangeError('Invalid preparation array data');
        list.push(copy(descriptor.value));
      }
      result = Object.freeze(list);
    } else {
      const record: Record<string, unknown> = {};
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string')
          throw new RangeError('Invalid preparation data symbol');
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
          throw new RangeError('Invalid preparation data property');
        Object.defineProperty(record, key, {
          value: copy(descriptor.value),
          enumerable: true,
        });
      }
      result = Object.freeze(record);
    }
    ancestors.delete(value);
    return result;
  }
  return copy(input) as T;
}

/** Useful actor-private POINT preparation only. This intentionally cannot be handed to
 * D's production bindPrepared: no interval operation, geometryAdmission or create port.
 * The caller must authenticate source bytes/regions/normal policy separately. No
 * self-declared digest, synthetic fixture or matching bindingSetId grants that authority.
 * Shared pack ownership stays with the caller, after all these leases are disposed. */
export function createFightingPointPreparation(
  input: FightingActualRecipeSamplerFactory,
  options: FightingPointPreparationOptions,
) {
  const signal = options.signal;
  if (signal.aborted) throw new Error('Point preparation closed by abort');
  const rawBudgets = dataValue(
    options,
    'budgets',
  ) as FightingPointPreparationOptions['budgets'];
  const fixedBudgets = {
    maxConcurrentLeases: positiveBudget(
      dataValue(rawBudgets, 'maxConcurrentLeases') as number,
    ),
    maxTotalLeases: positiveBudget(
      dataValue(rawBudgets, 'maxTotalLeases') as number,
    ),
    maxSamplesPerLease: positiveBudget(
      dataValue(rawBudgets, 'maxSamplesPerLease') as number,
    ),
    maxDataNodes: positiveBudget(
      dataValue(rawBudgets, 'maxDataNodes') as number,
    ),
  };
  const maxDataNodes = fixedBudgets.maxDataNodes;
  const normalLengthTolerance = dataValue(
    options,
    'normalLengthTolerance',
  ) as number;
  if (
    !Number.isFinite(normalLengthTolerance) ||
    normalLengthTolerance < 0 ||
    normalLengthTolerance >= 1
  )
    throw new RangeError('Invalid explicit normal policy');
  const captured = snapshot(
    {
      runId: dataValue(options, 'runId'),
      actorIds: dataValue(options, 'actorIds'),
      manifestContext: dataValue(options, 'manifestContext'),
      normalLengthTolerance,
      budgets: fixedBudgets,
    },
    maxDataNodes,
  ) as Omit<FightingPointPreparationOptions, 'signal'>;
  const budgets = captured.budgets;
  for (const value of Object.values(budgets)) positiveBudget(value);
  const run = runId(captured.runId);
  const roster = new Set(captured.actorIds.map(actorId));
  if (!roster.size || roster.size !== captured.actorIds.length)
    throw new RangeError('Invalid preparation roster');
  if (
    !Number.isFinite(captured.normalLengthTolerance) ||
    captured.normalLengthTolerance < 0 ||
    captured.normalLengthTolerance >= 1
  )
    throw new RangeError('Invalid explicit normal policy');
  const factoryMetadata = snapshot(
    {
      runId: dataValue(input, 'runId'),
      bindingSetId: dataValue(input, 'bindingSetId'),
      geometryManifest: dataValue(input, 'geometryManifest'),
    },
    maxDataNodes,
  ) as Pick<
    FightingActualRecipeSamplerFactory,
    'runId' | 'bindingSetId' | 'geometryManifest'
  >;
  const create = dataValue(input, 'create');
  if (typeof create !== 'function')
    throw new RangeError('Invalid point factory create capability');
  const factory = captureFightingActualRecipeSamplerFactory(
    {
      ...factoryMetadata,
      create: (id) => Reflect.apply(create, input, [id]),
    },
    { runId: run, manifestContext: captured.manifestContext },
  );
  interface LeaseRecord {
    readonly actor: ActorId;
    readonly cleanup: () => void;
    retired: boolean;
    cleaned: boolean;
    samples: number;
  }
  const seenResources = new WeakSet<object>();
  const records: LeaseRecord[] = [],
    pendingCleanup: LeaseRecord[] = [],
    active = new Map<ActorId, LeaseRecord>();
  const failures: unknown[] = [];
  let closed = false,
    busy = false,
    allocations = 0;
  const check = () => {
    if (closed || signal.aborted) throw new Error('Point preparation closed');
  };
  const enter = () => {
    if (busy) throw new Error('reentrant point preparation operation');
    check();
    busy = true;
  };
  function retire(record: LeaseRecord) {
    if (!record.retired) {
      record.retired = true;
      pendingCleanup.push(record);
    }
    if (active.get(record.actor) === record) active.delete(record.actor);
  }
  function flush() {
    if (busy) return;
    busy = true;
    try {
      // Each acquired record enters this LIFO worklist at most once. Cleanup
      // callbacks may retire a previously visited sibling; the outer drain must
      // consume that new work before returning, even after another callback throws.
      while (pendingCleanup.length) {
        const record = pendingCleanup.pop();
        if (!record || record.cleaned) continue;
        record.cleaned = true;
        try {
          record.cleanup();
        } catch (error) {
          failures.push(error);
        }
      }
    } finally {
      busy = false;
    }
  }
  function close() {
    closed = true;
    signal.removeEventListener('abort', close);
    for (const record of records) retire(record);
    flush();
  }
  signal.addEventListener('abort', close, { once: true });
  if (signal.aborted) {
    close();
    check();
  }
  return Object.freeze({
    level: 'point-structure-only' as const,
    runId: run,
    geometryManifest: factory.geometryManifest,
    cleanupErrors: () => Object.freeze([...failures]),
    lease(id: ActorId) {
      enter();
      let record: LeaseRecord | undefined;
      try {
        if (!roster.has(id))
          throw new RangeError('Actor not in preparation roster');
        if (active.has(id) || active.size >= budgets.maxConcurrentLeases)
          throw new RangeError('Concurrent point lease budget exceeded');
        if (allocations >= budgets.maxTotalLeases)
          throw new RangeError('Total point lease budget exceeded');
        allocations++;
        const raw = factory.create(id);
        if (seenResources.has(raw))
          throw new RangeError('Point lease resource reused');
        seenResources.add(raw);
        // Capture cleanup before identity validation, so malformed returned identity
        // cannot leak an otherwise valid resource. Never invoke a cleanup getter.
        const cleanup = dataValue(raw, 'dispose');
        if (typeof cleanup !== 'function')
          throw new RangeError('Missing point lease cleanup capability');
        record = {
          actor: id,
          cleanup: () => Reflect.apply(cleanup, raw, []),
          retired: false,
          cleaned: false,
          samples: 0,
        };
        records.push(record);
        const port: FightingActualRecipeSamplerPort =
          captureFightingActualRecipeSamplerPort(raw, {
            runId: run,
            actorId: id,
            bindingSetId: factory.bindingSetId,
          });
        check();
        active.set(id, record);
        const owned = record;
        return Object.freeze({
          actorId: id,
          sample(
            query: FightingRecipeQuery,
            expectation: FightingPointExpectation,
          ) {
            enter();
            try {
              if (owned.retired) throw new Error('Point lease closed');
              if (owned.samples >= budgets.maxSamplesPerLease)
                throw new RangeError('Point sample budget exceeded');
              const call = snapshot({ query, expectation }, maxDataNodes);
              check();
              if (owned.retired) throw new Error('Point lease closed');
              exactDataFields(
                call.query,
                [
                  'clipId',
                  'phase',
                  'posture',
                  'atMs',
                  'acceptedRoot',
                  'groundClearanceM',
                ],
                ['incoming'],
              );
              exactDataFields(call.query.acceptedRoot, ['x', 'z']);
              exactDataFields(call.expectation, [
                'selectedGeometryBindingId',
                'impacts',
                'expectedHurtProxy',
              ]);
              const variant = factory.geometryManifest.variants.find(
                (v) =>
                  v.geometryBindingId ===
                  call.expectation.selectedGeometryBindingId,
              );
              if (
                !variant ||
                variant.clipId !== call.query.clipId ||
                variant.phase !== call.query.phase ||
                variant.posture !== call.query.posture ||
                !Number.isFinite(call.query.atMs) ||
                call.query.atMs < 0 ||
                !Number.isFinite(call.query.acceptedRoot.x) ||
                !Number.isFinite(call.query.acceptedRoot.z) ||
                !Number.isFinite(call.query.groundClearanceM) ||
                call.query.groundClearanceM < 0
              )
                throw new RangeError('Invalid point preparation query/variant');
              if (call.query.incoming)
                captureFightingRecipeEntry(call.query.incoming);
              owned.samples++;
              const result = port.sample(call.query);
              check();
              if (owned.retired) throw new Error('Point lease closed');
              const point = captureFightingActualRecipeGeometrySample(
                snapshot(result, maxDataNodes),
                {
                  query: call.query,
                  ...call.expectation,
                  manifest: factory.geometryManifest,
                  manifestContext: captured.manifestContext,
                  normalLengthTolerance: captured.normalLengthTolerance,
                },
              );
              check();
              if (owned.retired) throw new Error('Point lease closed');
              return point;
            } catch (error) {
              retire(owned);
              throw error;
            } finally {
              busy = false;
              flush();
            }
          },
          dispose() {
            retire(owned);
            flush();
          },
        });
      } catch (error) {
        if (record) retire(record);
        throw error;
      } finally {
        busy = false;
        flush();
      }
    },
    dispose() {
      close();
      if (failures.length)
        throw new AggregateError(
          [...failures],
          'Point preparation cleanup failed',
        );
    },
  });
}
