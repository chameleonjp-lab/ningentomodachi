import { Bone, SkinnedMesh, Quaternion, Vector3 as ThreeVector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  FIGHTING_READY_REALIZATION,
  FIGHTING_READY_REALIZATION_DATA_SHA256,
} from './fightingMotionRecipes';
import {
  captureFightingActualRecipeGeometrySample,
  type FightingActualRecipeGeometrySample,
  type FightingGeometrySampleContext,
  type FightingRecipeQuery,
} from '../contracts/fighting';
import type { Vector3 } from '../contracts';

export interface FightingReadyHoldIdentity {
  readonly runId: string;
  readonly actorId: string;
  readonly epochId: string;
  readonly holdId: string;
  readonly facingBasis: Vector3;
  readonly maxQueries: number;
  readonly maxDataNodes: number;
}
export interface FightingReadyHoldRequest {
  readonly runId: string;
  readonly actorId: string;
  readonly epochId: string;
  readonly holdId: string;
  readonly geometryBindingId: string;
  readonly fromU: number;
  readonly toU: number;
  readonly motionMs: number;
  readonly acceptedRoot: FightingRecipeQuery['acceptedRoot'];
  readonly groundClearanceM: number;
  readonly facingBasis: Vector3;
}
export type FightingReadyHoldResult =
  | {
      readonly kind: 'covered';
      readonly law: 'captured-ready-hold-constant-v1';
      readonly holdId: string;
      readonly query: FightingRecipeQuery;
      readonly request: FightingReadyHoldRequest;
      readonly context: FightingGeometrySampleContext;
      readonly sample: FightingActualRecipeGeometrySample;
      readonly derivative: 0;
      readonly completeGeometry: false;
      readonly productionQualified: false;
    }
  | {
      readonly kind: 'unqualified';
      readonly reason:
        | 'invalid-input'
        | 'unsupported-domain'
        | 'work-budget'
        | 'disposed';
    };

class InvalidHoldData extends Error {}
/** Descriptor-only, bounded detached data; never invokes getters or iterators. */
function copyData<T>(value: T, limit: number): T {
  let left = limit;
  const ancestors = new Set<object>();
  function visit(v: unknown, depth = 0): unknown {
    // Structural safety ceiling, not a geometry/numerical qualification budget.
    if (depth > 64) throw new InvalidHoldData('Data depth exceeded');
    if (--left < 0) throw new InvalidHoldData('Data budget exceeded');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (!v || typeof v !== 'object' || ancestors.has(v))
      throw new InvalidHoldData('Invalid data');
    const array = Array.isArray(v);
    if (
      Object.getPrototypeOf(v) !==
        (array ? Array.prototype : Object.prototype) ||
      Object.getOwnPropertySymbols(v).length
    )
      throw new InvalidHoldData('Nonplain data');
    ancestors.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (
      array &&
      (Object.keys(descriptors).length !== v.length + 1 || v.length > left)
    )
      throw new InvalidHoldData('Invalid array');
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of Object.keys(descriptors)) {
      if (array && key === 'length') continue;
      const d = descriptors[key];
      if (!d || !('value' in d) || !d.enumerable)
        throw new InvalidHoldData('Data property required');
      Object.defineProperty(result, key, {
        value: visit(d.value, depth + 1),
        enumerable: true,
      });
    }
    ancestors.delete(v);
    return Object.freeze(result);
  }
  return visit(value) as T;
}
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (k) =>
        Object.hasOwn(b, k) &&
        equal(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}
function fields(v: object, keys: readonly string[]) {
  if (
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    throw new InvalidHoldData('Unexpected fields');
}
/** Captures a fixed realization, NOT the time-varying Ready source law.
 * Structural capture does not authenticate supplied source pins or a hold ID.
 * Caller must supply independent source authority. No production factory/binder is exposed.
 */
export function captureFightingReadyHold(
  sample: FightingActualRecipeGeometrySample,
  context: FightingGeometrySampleContext,
  identity: FightingReadyHoldIdentity,
) {
  // Read budgets by descriptor before copying; no caller getters execute.
  const budget = (key: string) => {
    const d = Object.getOwnPropertyDescriptor(identity, key);
    if (!d || !('value' in d) || !Number.isSafeInteger(d.value) || d.value <= 0)
      throw new InvalidHoldData('Explicit positive budget required');
    return d.value as number;
  };
  const maxDataNodes = budget('maxDataNodes'),
    maxQueries = budget('maxQueries');
  const captured = copyData({ sample, context, identity }, maxDataNodes);
  const c = captured.context,
    i = captured.identity;
  fields(i, [
    'runId',
    'actorId',
    'epochId',
    'holdId',
    'facingBasis',
    'maxQueries',
    'maxDataNodes',
  ]);
  for (const key of ['runId', 'actorId', 'epochId', 'holdId'] as const)
    if (typeof i[key] !== 'string' || !i[key])
      throw new InvalidHoldData('Missing identity');
  // Initial bounded domain is identity horizontal facing, neutral non-attacking, no incoming.
  if (
    !equal(i.facingBasis, { x: 0, y: 0, z: 1 }) ||
    c.query.phase !== 'neutral' ||
    c.query.posture !== 'standing' ||
    Object.hasOwn(c.query, 'incoming') ||
    c.impacts.length !== 0
  )
    throw new InvalidHoldData('Unsupported hold source');
  const s = captureFightingActualRecipeGeometrySample(captured.sample, c);
  if (s.active || s.shape !== null || s.hitShapes.length !== 0)
    throw new InvalidHoldData('Ready hold cannot carry attack geometry');
  let calls = 0,
    disposed = false;
  return Object.freeze({
    interval(input: unknown): FightingReadyHoldResult {
      if (disposed)
        return Object.freeze({ kind: 'unqualified', reason: 'disposed' });
      if (calls >= maxQueries)
        return Object.freeze({ kind: 'unqualified', reason: 'work-budget' });
      calls++;
      let q: FightingReadyHoldRequest;
      try {
        q = copyData(input, maxDataNodes) as FightingReadyHoldRequest;
        if (!q || typeof q !== 'object' || Array.isArray(q))
          throw new InvalidHoldData('Request object required');
        fields(q, [
          'runId',
          'actorId',
          'epochId',
          'holdId',
          'geometryBindingId',
          'fromU',
          'toU',
          'motionMs',
          'acceptedRoot',
          'groundClearanceM',
          'facingBasis',
        ]);
      } catch (error) {
        if (!(error instanceof InvalidHoldData)) throw error;
        return Object.freeze({ kind: 'unqualified', reason: 'invalid-input' });
      }
      const expected = {
        runId: i.runId,
        actorId: i.actorId,
        epochId: i.epochId,
        holdId: i.holdId,
        geometryBindingId: s.geometryBindingId,
        fromU: q.fromU,
        toU: q.toU,
        motionMs: c.query.atMs,
        acceptedRoot: c.query.acceptedRoot,
        groundClearanceM: c.query.groundClearanceM,
        facingBasis: i.facingBasis,
      };
      if (
        typeof q.fromU !== 'number' ||
        typeof q.toU !== 'number' ||
        q.fromU < 0 ||
        q.toU > 1 ||
        q.fromU >= q.toU ||
        !equal(q, expected)
      )
        return Object.freeze({
          kind: 'unqualified',
          reason: 'unsupported-domain',
        });
      return Object.freeze({
        kind: 'covered',
        law: 'captured-ready-hold-constant-v1',
        holdId: i.holdId,
        query: c.query,
        request: q,
        context: c,
        sample: s,
        derivative: 0,
        completeGeometry: false,
        productionQualified: false,
      });
    },
    dispose() {
      disposed = true;
    },
  });
}

/** Actual source-backed fixed Ready0 producer. Owns one parsed source and private skeletons.
 * No scene is mounted. Shared source geometry/materials are disposed only by this owner.
 * Neither this operation nor its data digest authenticates a full executable closure.
 */
export async function prepareFightingReadySource(input: Uint8Array) {
  const bytes = new Uint8Array(input);
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  ]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  if (digest !== FIGHTING_READY_REALIZATION.sourceSha256)
    throw new Error('Ready source digest mismatch');
  const recipe = FIGHTING_READY_REALIZATION;
  const view = new DataView(bytes.buffer);
  const document = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))),
  );
  for (const b of recipe.bones)
    if (document.nodes[b.sourceNodeIndex]?.name !== b.sourceBoneName)
      throw new Error('Ready source node identity mismatch');
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
  const template = gltf.scene;
  const originals: SkinnedMesh[] = [];
  template.traverse((node) => {
    if (node instanceof SkinnedMesh) originals.push(node);
  });
  const geometries = new Set(originals.map((m) => m.geometry));
  const materials = new Set(
    originals.flatMap((m) =>
      Array.isArray(m.material) ? m.material : [m.material],
    ),
  );
  const releaseSource = () => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    template.clear();
  };
  if (
    originals.length !== 5 ||
    gltf.animations.length !== 42 ||
    originals.some(
      (m, i) =>
        m.geometry.getAttribute('position').count !==
          recipe.primitives[i]?.vertexCount || m.skeleton.bones.length !== 53,
    )
  ) {
    releaseSource();
    throw new Error('Ready source structure mismatch');
  }
  let closed = false;
  const releases = new Set<() => void>();
  const stats = Object.freeze({
    sourcePrimitives: 5,
    sourceBones: 53,
    sourceClips: 42,
    materialClones: 0,
    geometryClones: 0,
  });
  return Object.freeze({
    status: 'actual-ready0-fixed-unqualified' as const,
    sourceSha256: digest,
    realizationDataSha256: FIGHTING_READY_REALIZATION_DATA_SHA256,
    stats,
    createLease() {
      if (closed) throw new Error('Ready source disposed');
      const node = cloneSkeleton(template),
        meshes: SkinnedMesh[] = [],
        bones = new Map<string, Bone>();
      node.traverse((part) => {
        if (part instanceof SkinnedMesh) meshes.push(part);
        if (part instanceof Bone) bones.set(part.name, part);
      });
      let disposed = false;
      const release = () => {
        if (disposed) return;
        disposed = true;
        for (const mesh of meshes) mesh.skeleton.dispose();
        node.clear();
        releases.delete(release);
      };
      releases.add(release);
      try {
        if (
          bones.size !== 53 ||
          meshes.some(
            (m, i) =>
              m.geometry !== originals[i]?.geometry ||
              m.material !== originals[i]?.material,
          )
        )
          throw new Error('Ready clone sharing mismatch');
        for (const p of recipe.pose) {
          const bone = bones.get(p.name);
          if (!bone) throw new Error('Ready pose bone missing');
          bone.position.fromArray(p.position);
          bone.quaternion.fromArray(p.quaternion);
          bone.scale.fromArray(p.scale);
        }
        node.updateMatrixWorld(true);
        for (const mesh of meshes) mesh.skeleton.update();
      } catch (error) {
        release();
        throw error;
      }
      const assertOpen = () => {
        if (closed || disposed) throw new Error('Ready source lease disposed');
      };
      const tuple3 = (v: ThreeVector3): readonly [number, number, number] => [
        v.x,
        v.y,
        v.z,
      ];
      const tuple4 = (
        v: Quaternion,
      ): readonly [number, number, number, number] => [v.x, v.y, v.z, v.w];
      const evaluate = () => {
        assertOpen();
        // Private hierarchy is not exposed; recompute real skinned source members on each call.
        node.updateMatrixWorld(true);
        for (const mesh of meshes) mesh.skeleton.update();
        const soles = recipe.soles.map((s) => {
          const foot = bones.get(`foot${s.side}`);
          if (!foot) throw new Error('Ready foot missing');
          const normal = new ThreeVector3()
            .fromArray(s.footLocalNormal)
            .applyQuaternion(foot.getWorldQuaternion(new Quaternion()))
            .toArray();
          return {
            side: s.side,
            surfaceId: s.surfaceId,
            normal,
            points: s.members.map((ref) => {
              const mesh = meshes[ref.primitive];
              if (!mesh) throw new Error('Ready primitive missing');
              const local = mesh
                .getVertexPosition(ref.vertexIndex, new ThreeVector3())
                .applyMatrix4(mesh.matrixWorld)
                .toArray();
              return { ...ref, local };
            }),
          };
        });
        const pose = recipe.pose.map((p) => {
          const b = bones.get(p.name);
          if (!b) throw new Error('Ready bone missing');
          return {
            name: p.name,
            position: tuple3(b.position),
            quaternion: tuple4(b.quaternion),
            scale: tuple3(b.scale),
          };
        });
        const support = recipe.soles.map((s) => {
          const b = bones.get(`foot${s.side}`);
          if (!b) throw new Error('Ready foot missing');
          const p = b.getWorldPosition(new ThreeVector3()),
            target = new ThreeVector3().fromArray(s.target);
          return {
            side: s.side,
            planted: true,
            local: tuple3(p),
            worldRotation: tuple4(b.getWorldQuaternion(new Quaternion())),
            desiredWorld: s.target,
            errorM: p.distanceTo(target),
            world: tuple3(p),
          };
        });
        return copyData(
          {
            pose,
            soles,
            support,
            completeGeometry: false as const,
            productionQualified: false as const,
          },
          20000,
        );
      };
      return Object.freeze({
        sample: evaluate,
        /** Real point geometry with independent caller A-context. Source bytes/mapping are
         * checked here; caller evaluator/closure/evidence claims remain unqualified. */
        sampleActual(
          context: FightingGeometrySampleContext,
        ): FightingActualRecipeGeometrySample {
          assertOpen();
          const c = copyData(context, 20000),
            q = c.query;
          if (
            q.clipId !== 'FightV3_Ready' ||
            q.atMs !== 0 ||
            q.phase !== 'neutral' ||
            q.posture !== 'standing' ||
            !equal(q.acceptedRoot, { x: 0, z: 0 }) ||
            q.groundClearanceM !== 0 ||
            Object.hasOwn(q, 'incoming') ||
            c.impacts.length !== 0
          )
            throw new Error('Unsupported Ready0 query');
          const variant = c.manifest.variants.find(
            (v) => v.geometryBindingId === c.selectedGeometryBindingId,
          );
          const source = c.manifest.sources.find(
            (s) => s.sourceBindingId === variant?.sourceBindingId,
          );
          if (
            !variant ||
            !equal(variant.coverage, { kind: 'finite', fromMs: 0, toMs: 0 }) ||
            !source ||
            source.clipId !== q.clipId ||
            source.durationMs !== 0 ||
            source.rootPolicy !== 'in-place-posture-xyz' ||
            source.shapeIds.length !== 0 ||
            source.provenance.sourceSha256 !== digest ||
            source.provenance.mappingSha256 !== recipe.mappingSha256 ||
            source.provenance.calibrationSha256 !== recipe.calibrationSha256 ||
            !equal(
              source.poseNames,
              recipe.pose.map((p) => p.name),
            ) ||
            !equal(
              source.primitives,
              recipe.primitives.map((p) => ({
                primitive: p.primitive,
                vertexCount: p.vertexCount,
              })),
            ) ||
            !equal(
              source.soles,
              recipe.soles.map((s) => ({
                side: s.side,
                surfaceId: s.surfaceId,
                sourceBindingId: source.sourceBindingId,
                members: s.members,
              })),
            )
          )
            throw new Error('Ready context source mismatch');
          const raw = evaluate();
          const xyz = (v: readonly number[]) => ({
            x: v[0] ?? NaN,
            y: v[1] ?? NaN,
            z: v[2] ?? NaN,
          });
          const candidate: FightingActualRecipeGeometrySample = {
            recipeVersion: 'actual53-ik-surface-v1',
            clipId: q.clipId,
            atMs: 0,
            pose: raw.pose,
            support: raw.support,
            durationMs: 0,
            active: false,
            intendedRoot: { x: 0, y: 0, z: 0 },
            acceptedRoot: { x: 0, y: 0, z: 0 },
            shape: null,
            geometryProtocol: 'actual-geometry-v1',
            geometryBindingId: c.selectedGeometryBindingId,
            soles: raw.soles.map((s) => ({
              ...s,
              normal: xyz(s.normal),
              points: s.points.map((p) => ({ ...p, local: xyz(p.local) })),
            })),
            hurt: c.expectedHurtProxy,
            hitShapes: [],
          };
          return captureFightingActualRecipeGeometrySample(candidate, c);
        },
        dispose: release,
      });
    },
    dispose() {
      if (closed) return;
      closed = true;
      for (const release of [...releases]) release();
      releaseSource();
    },
  });
}
