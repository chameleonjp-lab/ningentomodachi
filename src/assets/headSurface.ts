/** Standalone pinned CPU point provider. No scene, actor, GPU, solid-volume or CCD authority. */
import {
  DiscreteInterpolant,
  LinearInterpolant,
  Matrix4,
  Quaternion,
  QuaternionLinearInterpolant,
  Vector3,
  type Interpolant,
} from 'three';
import {
  clipId,
  durationMs,
  type DurationMs,
  type PoseCatalogBindings,
  type PoseClipBinding,
} from '../contracts';
import { ANDROID_DERIVED_PACK_V1 } from './derivedPackManifest';
import { ANDROID_RUNTIME_ARTIFACT_V1 } from './runtimeArtifactManifest';
import { loadVerifiedSource } from './loadVerifiedSource';
import { buildPoseBindings, type PoseBindingSource } from './poseBindings';
import { copyRootPolicy, type ClipRootPolicy } from './rootPolicy';

import {
  createHeadIntervalDiagnostics,
  type IntervalChannel,
  type IntervalValue,
  type SourceHeadIntervalDiagnostics,
} from './headIntervals';

type Point = Readonly<{ x: number; y: number; z: number }>;
export interface SourceHeadDescriptor {
  readonly geometryId: string;
  readonly sourceHashes: readonly string[];
  readonly meshIndex: 0;
  readonly skinIndex: 0;
  readonly headJointIndex: 6;
  readonly headNodeIndex: 0;
  readonly policy: 'exact-head-weight-one-open-triangles-v1';
  readonly reference: 'head-origin-actor-bind-axes-metres-v1';
  readonly referenceToActorAtBind: readonly number[];
  readonly headAttachmentAtBind: readonly number[];
  readonly headBoneInverse: readonly number[];
  readonly primitives: readonly Readonly<{
    primitive: number;
    indexAccessor: number;
    positionAccessor: number;
    jointsAccessor: number;
    weightsAccessor: number;
  }>[];
  readonly vertices: readonly Readonly<{
    primitive: number;
    vertexIndex: number;
    position: Point;
  }>[];
  readonly triangles: readonly Readonly<{
    primitive: number;
    triangleIndex: number;
    vertexIndices: readonly [number, number, number];
    vertices: readonly [Point, Point, Point];
  }>[];
}
export type SourceHeadSample =
  | Readonly<{
      kind: 'transform';
      matrix: readonly number[];
      numerics: 'cpu-float64-not-certified';
    }>
  | Readonly<{
      kind: 'unavailable';
      reason:
        | 'invalid-binding'
        | 'invalid-time'
        | 'disposed'
        | 'unsupported-affine'
        | 'unsupported-root-policy';
    }>;
export interface SourceHeadProvider {
  readonly intervalDiagnostics?: SourceHeadIntervalDiagnostics;
  readonly descriptor: SourceHeadDescriptor;
  readonly poseBindings: PoseCatalogBindings;
  readonly clipSources: readonly Readonly<{
    binding: PoseClipBinding;
    sourceSha256: string;
    sourceClipIndex: number;
    rootPolicy: ClipRootPolicy | null;
    sampling: 'three-0.186.1-absolute-source-trs-first-key-hold-v1';
  }>[];
  evaluate(binding: PoseClipBinding, time: DurationMs): SourceHeadSample;
  dispose(): void;
}
export type SourceHeadInput = {
  readonly intervalDiagnostics?:
    | 'idle-uppercut-f21-f24-v1'
    | 'pinned42-source-cells-v1';
  readonly rootPolicies?: readonly ClipRootPolicy[];
  readonly signal: AbortSignal;
  readonly checkpoint?: (stage: string) => Promise<void>;
} & (
  | { readonly sources: readonly Uint8Array[]; readonly derivedBytes?: never }
  | { readonly derivedBytes: Uint8Array; readonly sources?: never }
);

function unsupported(reason: string): never {
  throw new Error(`Unsupported source head: ${reason}`);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return unsupported('object');
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) return unsupported('array');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    return unsupported('integer');
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value) return unsupported('name');
  return value;
}
function required<T>(value: T | undefined): T {
  if (value === undefined) return unsupported('missing value');
  return value;
}
const point = (v: Vector3): Point => Object.freeze({ x: v.x, y: v.y, z: v.z });
const matrixArray = (m: Matrix4): readonly number[] =>
  Object.freeze(m.elements.slice());
function affine(m: Matrix4): boolean {
  const e = m.elements;
  if (
    !e.every(Number.isFinite) ||
    e[3] !== 0 ||
    e[7] !== 0 ||
    e[11] !== 0 ||
    e[15] !== 1
  )
    return false;
  const d = m.determinant();
  return (
    Number.isFinite(d) &&
    d !== 0 &&
    m.clone().invert().elements.every(Number.isFinite)
  );
}
interface Decoded {
  readonly document: Record<string, unknown>;
  readonly binary: DataView;
}
function decode(bytes: Uint8Array): Decoded {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a
  )
    return unsupported('GLB layout');
  const jsonLength = view.getUint32(12, true),
    binHeader = 20 + jsonLength;
  if (
    binHeader + 8 > bytes.length ||
    view.getUint32(binHeader + 4, true) !== 0x004e4942 ||
    binHeader + 8 + view.getUint32(binHeader, true) !== bytes.length
  )
    return unsupported('GLB chunks');
  const document = record(
    JSON.parse(new TextDecoder().decode(bytes.subarray(20, binHeader))),
  );
  if (document.extensionsRequired !== undefined)
    return unsupported('required extensions');
  return {
    document,
    binary: new DataView(
      bytes.buffer,
      bytes.byteOffset + binHeader + 8,
      view.getUint32(binHeader, true),
    ),
  };
}
function accessor(
  source: Decoded,
  index: number,
  type: string,
  component?: number,
): number[] {
  const a = record(list(source.document.accessors)[index]);
  const b = record(list(source.document.bufferViews)[integer(a.bufferView)]);
  const c = integer(a.componentType),
    size = (
      { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<
        string,
        number
      >
    )[type];
  const width =
    c === 5126 || c === 5125 ? 4 : c === 5123 ? 2 : c === 5121 ? 1 : 0;
  if (
    !size ||
    !width ||
    a.type !== type ||
    (component !== undefined && c !== component) ||
    a.sparse !== undefined ||
    a.normalized !== undefined ||
    b.byteStride !== undefined ||
    b.buffer !== 0
  )
    return unsupported('accessor layout');
  const count = integer(a.count) * size,
    local = integer(a.byteOffset ?? 0),
    start = integer(b.byteOffset ?? 0),
    length = integer(b.byteLength);
  if (
    local + count * width > length ||
    start + length > source.binary.byteLength ||
    (start + local) % width !== 0
  )
    return unsupported('accessor bounds');
  return Array.from({ length: count }, (_, i) => {
    const at = start + local + i * width;
    const value =
      c === 5126
        ? source.binary.getFloat32(at, true)
        : c === 5125
          ? source.binary.getUint32(at, true)
          : c === 5123
            ? source.binary.getUint16(at, true)
            : source.binary.getUint8(at);
    if (!Number.isFinite(value)) return unsupported('nonfinite accessor');
    return value;
  });
}
interface NumericNode {
  readonly sourceIndex: number;
  readonly parent: number | undefined;
  readonly position: Vector3;
  readonly rotation: Quaternion;
  readonly scale: Vector3;
  readonly basePosition: Vector3;
  readonly baseRotation: Quaternion;
  readonly baseScale: Vector3;
  readonly local: Matrix4;
  readonly world: Matrix4;
}
interface Channel {
  readonly interval?: IntervalChannel;
  readonly node: NumericNode;
  readonly property: 'translation' | 'rotation' | 'scale';
  readonly interpolant: Interpolant;
}
interface ClipPlan {
  readonly origin: PoseBindingSource;
  readonly seconds: number;
  readonly channels: readonly Channel[];
  readonly localOrigin: Vector3;
  readonly actorOrigin: Vector3;
}
function tuple(
  value: unknown,
  fallback: readonly number[],
  length: number,
): number[] {
  const values = value === undefined ? [...fallback] : list(value);
  if (
    values.length !== length ||
    values.some((v) => typeof v !== 'number' || !Number.isFinite(v))
  )
    return unsupported('node transform');
  return values as number[];
}
const closureIds = [54, 52, 51, 42, 41, 40, 1, 0, 53] as const;
function compileNodes(source: Decoded): NumericNode[] {
  const all = list(source.document.nodes),
    parents = new Map<number, number>();
  all.forEach((value, index) => {
    const node = record(value);
    for (const child of node.children === undefined
      ? []
      : list(node.children)) {
      const id = integer(child);
      if (parents.has(id)) unsupported('multiple parents');
      parents.set(id, index);
    }
  });
  const expectedNames = [
    'ANDROID_RIG',
    'root',
    'pelvis',
    'spine.01',
    'spine.02',
    'chest',
    'neck',
    'head',
    'ANDROID | skinned armor + mechanisms',
  ];
  return closureIds.map((id, index) => {
    const node = record(all[id]);
    if (
      node.name !== expectedNames[index] ||
      node.matrix !== undefined ||
      node.weights !== undefined ||
      node.extensions !== undefined
    )
      return unsupported('canonical node hierarchy');
    const parent = parents.get(id);
    if (
      parent !== undefined &&
      !closureIds.slice(0, index).some((x) => x === parent)
    )
      return unsupported('ancestor closure');
    const basePosition = new Vector3().fromArray(
        tuple(node.translation, [0, 0, 0], 3),
      ),
      baseRotation = new Quaternion().fromArray(
        tuple(node.rotation, [0, 0, 0, 1], 4),
      ),
      baseScale = new Vector3().fromArray(tuple(node.scale, [1, 1, 1], 3));
    return {
      sourceIndex: id,
      parent,
      basePosition,
      baseRotation,
      baseScale,
      position: basePosition.clone(),
      rotation: baseRotation.clone(),
      scale: baseScale.clone(),
      local: new Matrix4(),
      world: new Matrix4(),
    };
  });
}
function reset(nodes: readonly NumericNode[]): void {
  for (const n of nodes) {
    n.position.copy(n.basePosition);
    n.rotation.copy(n.baseRotation);
    n.scale.copy(n.baseScale);
  }
}
function update(
  nodes: readonly NumericNode[],
  byId: ReadonlyMap<number, NumericNode>,
): void {
  for (const n of nodes) {
    n.local.compose(n.position, n.rotation, n.scale);
    if (n.parent === undefined) n.world.copy(n.local);
    else n.world.multiplyMatrices(required(byId.get(n.parent)).world, n.local);
  }
}
function sampleChannels(
  clip: ClipPlan,
  time: number,
  nodes: readonly NumericNode[],
  byId: ReadonlyMap<number, NumericNode>,
): void {
  reset(nodes);
  for (const channel of clip.channels) {
    const values = channel.interpolant.evaluate(time);
    if (channel.property === 'rotation')
      channel.node.rotation.fromArray(values);
    else if (channel.property === 'translation')
      channel.node.position.fromArray(values);
    else channel.node.scale.fromArray(values);
  }
  update(nodes, byId);
}
function staticEqual(a: Decoded, b: Decoded): void {
  for (const key of ['nodes', 'skins', 'meshes', 'scenes', 'scene'])
    if (JSON.stringify(a.document[key]) !== JSON.stringify(b.document[key]))
      unsupported(`canonical template ${key} mismatch`);
  const meshes = list(a.document.meshes);
  for (const value of meshes)
    for (const primitive of list(record(value).primitives)) {
      const p = record(primitive),
        attrs = record(p.attributes);
      const items: [number, string][] = [
        [integer(p.indices), 'SCALAR'],
        [integer(attrs.POSITION), 'VEC3'],
        [integer(attrs.JOINTS_0), 'VEC4'],
        [integer(attrs.WEIGHTS_0), 'VEC4'],
      ];
      for (const [id, type] of items) {
        const left = accessor(a, id, type),
          right = accessor(b, id, type);
        if (
          left.length !== right.length ||
          left.some((v, i) => !Object.is(v, right[i]))
        )
          unsupported('canonical template geometry mismatch');
      }
    }
  const skin = record(list(a.document.skins)[0]);
  const left = accessor(a, integer(skin.inverseBindMatrices), 'MAT4'),
    right = accessor(b, integer(skin.inverseBindMatrices), 'MAT4');
  if (
    left.length !== right.length ||
    left.some((v, i) => !Object.is(v, right[i]))
  )
    unsupported('canonical template inverse bind mismatch');
}

/** Trust roots are built-in pins only. Caller data is captured before any await. */
export async function preparePinnedSourceHead(
  input: SourceHeadInput,
): Promise<SourceHeadProvider> {
  const intervalDiagnostics = input.intervalDiagnostics;
  if (
    intervalDiagnostics !== undefined &&
    intervalDiagnostics !== 'idle-uppercut-f21-f24-v1' &&
    intervalDiagnostics !== 'pinned42-source-cells-v1'
  )
    unsupported('interval diagnostic scope');
  const signal = input.signal,
    scheduled = input.checkpoint;
  const check = () => {
    if (signal.aborted)
      throw new DOMException('Head preparation aborted', 'AbortError');
  };
  check();
  const isDerived = input.derivedBytes !== undefined;
  if (isDerived && input.sources !== undefined)
    unsupported('ambiguous sources');
  const captured = isDerived
    ? [new Uint8Array(required(input.derivedBytes))]
    : required(input.sources).map((b) => new Uint8Array(b));
  const policies = (input.rootPolicies ?? []).map(copyRootPolicy);
  if (
    policies.some(
      (p) =>
        ![
          'full-translation',
          'grounded-posture-y',
          'in-place-posture-xyz',
        ].includes(p.mode),
    )
  )
    unsupported('root policy mode');
  const policyMap = new Map(policies.map((p) => [p.clipId, p]));
  if (policyMap.size !== policies.length) unsupported('duplicate root policy');
  const pins = isDerived
    ? [ANDROID_DERIVED_PACK_V1]
    : ANDROID_RUNTIME_ARTIFACT_V1.sources;
  if (captured.length !== pins.length) unsupported('source count');
  const checkpoint = async (stage: string) => {
    check();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    check();
    await scheduled?.(stage);
    check();
  };
  const sources: Decoded[] = [];
  for (let i = 0; i < captured.length; i++) {
    await checkpoint(`verify:${i}:before`);
    const verified = await loadVerifiedSource(
      async () => required(captured[i]),
      required(pins[i]),
      signal,
    );
    check();
    sources.push(decode(verified.bytes));
    await checkpoint(`verify:${i}:after`);
  }
  const template = required(sources[0]);
  for (const source of sources.slice(1)) {
    staticEqual(template, source);
    await checkpoint('geometry:equivalence');
  }
  const nodes = compileNodes(template),
    byId = new Map(nodes.map((n) => [n.sourceIndex, n])),
    root = required(byId.get(52)),
    head = required(byId.get(0)),
    mesh = required(byId.get(53));
  update(nodes, byId);
  const meshes = list(template.document.meshes),
    skin = record(list(template.document.skins)[0]);
  if (
    meshes.length !== 1 ||
    list(skin.joints)[6] !== 0 ||
    record(list(template.document.nodes)[53]).skin !== 0
  )
    unsupported('mesh/skin identity');
  const inverses = accessor(
      template,
      integer(skin.inverseBindMatrices),
      'MAT4',
      5126,
    ),
    headInverse = new Matrix4().fromArray(inverses, 6 * 16);
  const attachment = new Matrix4()
    .multiplyMatrices(mesh.world, mesh.world.clone().invert())
    .multiply(head.world);
  if (!affine(attachment) || !affine(headInverse)) unsupported('bind affine');
  const reference = new Matrix4().makeTranslation(
    new Vector3().setFromMatrixPosition(attachment),
  );
  const inverseReference = reference.clone().invert(),
    meshInverse = mesh.world.clone().invert();
  const skinMatrix = new Matrix4().multiplyMatrices(head.world, headInverse);
  const vertices: SourceHeadDescriptor['vertices'][number][] = [],
    triangles: SourceHeadDescriptor['triangles'][number][] = [],
    primitives: SourceHeadDescriptor['primitives'][number][] = [];
  const primitiveList = list(record(meshes[0]).primitives);
  if (primitiveList.length !== 5) unsupported('primitive count');
  for (let primitive = 0; primitive < primitiveList.length; primitive++) {
    const p = record(primitiveList[primitive]),
      attributes = record(p.attributes);
    if (p.targets !== undefined || (p.mode !== undefined && p.mode !== 4))
      unsupported('morph/topology');
    const positionAccessor = integer(attributes.POSITION),
      jointsAccessor = integer(attributes.JOINTS_0),
      weightsAccessor = integer(attributes.WEIGHTS_0),
      indexAccessor = integer(p.indices);
    const positions = accessor(template, positionAccessor, 'VEC3', 5126),
      joints = accessor(template, jointsAccessor, 'VEC4'),
      weights = accessor(template, weightsAccessor, 'VEC4', 5126),
      indices = accessor(template, indexAccessor, 'SCALAR');
    if (
      joints.length !== (positions.length / 3) * 4 ||
      weights.length !== joints.length ||
      indices.length % 3 !== 0
    )
      unsupported('attribute count');
    const selected = new Map<number, Point>();
    for (
      let vertexIndex = 0;
      vertexIndex < positions.length / 3;
      vertexIndex++
    ) {
      let headWeight = 0,
        otherWeight = 0;
      for (let c = 0; c < 4; c++) {
        const w = required(weights[vertexIndex * 4 + c]);
        if (w < 0) unsupported('negative weight');
        if (joints[vertexIndex * 4 + c] === 6) headWeight += w;
        else otherWeight += w;
      }
      if (headWeight !== 0) {
        if (headWeight !== 1 || otherWeight !== 0) unsupported('nonrigid head');
        // Same CPU skin order as SkinnedMesh.getVertexPosition. GLTFLoader binds identity;
        // attached mesh bindMatrixInverse is its current world inverse.
        const v = new Vector3()
          .fromArray(positions, vertexIndex * 3)
          .applyMatrix4(skinMatrix)
          .applyMatrix4(meshInverse)
          .applyMatrix4(mesh.world)
          .applyMatrix4(inverseReference);
        if (![v.x, v.y, v.z].every(Number.isFinite))
          unsupported('reference coordinates');
        const value = point(v);
        selected.set(vertexIndex, value);
        vertices.push(
          Object.freeze({ primitive, vertexIndex, position: value }),
        );
      }
      if (vertexIndex % 512 === 0)
        await checkpoint(`geometry:${primitive}:vertices`);
    }
    for (let offset = 0; offset < indices.length; offset += 3) {
      const a = integer(indices[offset]),
        b = integer(indices[offset + 1]),
        c = integer(indices[offset + 2]);
      if (Math.max(a, b, c) >= positions.length / 3)
        unsupported('triangle bounds');
      const va = selected.get(a),
        vb = selected.get(b),
        vc = selected.get(c),
        count = Number(!!va) + Number(!!vb) + Number(!!vc);
      if (count !== 0 && count !== 3) unsupported('mixed head boundary');
      if (va && vb && vc) {
        const area = new Vector3()
          .subVectors(
            new Vector3(vb.x, vb.y, vb.z),
            new Vector3(va.x, va.y, va.z),
          )
          .cross(
            new Vector3().subVectors(
              new Vector3(vc.x, vc.y, vc.z),
              new Vector3(va.x, va.y, va.z),
            ),
          )
          .lengthSq();
        if (!(area > 0) || !Number.isFinite(area))
          unsupported('degenerate head triangle');
        triangles.push(
          Object.freeze({
            primitive,
            triangleIndex: offset / 3,
            vertexIndices: Object.freeze([a, b, c] as const),
            vertices: Object.freeze([va, vb, vc] as const),
          }),
        );
      }
      if (offset % 1536 === 0)
        await checkpoint(`geometry:${primitive}:triangles`);
    }
    primitives.push(
      Object.freeze({
        primitive,
        indexAccessor,
        positionAccessor,
        jointsAccessor,
        weightsAccessor,
      }),
    );
  }
  if (vertices.length !== 4472 || triangles.length !== 4326)
    unsupported('head topology counts');
  const descriptor: SourceHeadDescriptor = Object.freeze({
    geometryId: `source-head-v1:${ANDROID_DERIVED_PACK_V1.staticSha256}`,
    sourceHashes: Object.freeze(
      ANDROID_RUNTIME_ARTIFACT_V1.sources.map((s) => s.sha256),
    ),
    meshIndex: 0,
    skinIndex: 0,
    headJointIndex: 6,
    headNodeIndex: 0,
    policy: 'exact-head-weight-one-open-triangles-v1',
    reference: 'head-origin-actor-bind-axes-metres-v1',
    referenceToActorAtBind: matrixArray(reference),
    headAttachmentAtBind: matrixArray(attachment),
    headBoneInverse: matrixArray(headInverse),
    primitives: Object.freeze(primitives),
    vertices: Object.freeze(vertices),
    triangles: Object.freeze(triangles),
  });
  const plans = new Map<string, ClipPlan>();
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = required(sources[sourceIndex]),
      animations = list(source.document.animations);
    for (
      let sourceClipIndex = 0;
      sourceClipIndex < animations.length;
      sourceClipIndex++
    ) {
      const animation = record(animations[sourceClipIndex]),
        id = clipId(name(animation.name)),
        samplers = list(animation.samplers),
        channels: Channel[] = [];
      if (plans.has(id)) unsupported('duplicate clip');
      let seconds = 0;
      const targets = new Set<string>();
      for (const channelValue of list(animation.channels)) {
        const channel = record(channelValue),
          target = record(channel.target),
          sampler = record(samplers[integer(channel.sampler)]),
          targetIndex = integer(target.node),
          property = name(target.path);
        const times = accessor(source, integer(sampler.input), 'SCALAR', 5126);
        if (
          !times.length ||
          times.some((t, i) => t < 0 || (i > 0 && t <= required(times[i - 1])))
        )
          unsupported('key times');
        seconds = Math.max(seconds, required(times[times.length - 1]));
        const node = byId.get(targetIndex);
        if (!node) continue;
        if (
          property !== 'translation' &&
          property !== 'rotation' &&
          property !== 'scale'
        )
          unsupported('channel property');
        const key = `${targetIndex}:${property}`;
        if (targets.has(key)) unsupported('duplicate channel target');
        targets.add(key);
        const size = property === 'rotation' ? 4 : 3,
          values = accessor(
            source,
            integer(sampler.output),
            size === 4 ? 'VEC4' : 'VEC3',
            5126,
          ),
          mode = sampler.interpolation ?? 'LINEAR';
        if (
          values.length !== times.length * size ||
          (mode !== 'STEP' && mode !== 'LINEAR')
        )
          unsupported('channel interpolation');
        const inputTimes = new Float32Array(times),
          inputValues = new Float32Array(values),
          output = new Float64Array(size);
        const interpolant =
          mode === 'STEP'
            ? new DiscreteInterpolant(inputTimes, inputValues, size, output)
            : property === 'rotation'
              ? new QuaternionLinearInterpolant(
                  inputTimes,
                  inputValues,
                  size,
                  output,
                )
              : new LinearInterpolant(inputTimes, inputValues, size, output);
        channels.push({
          node,
          property,
          interpolant,
          ...(intervalDiagnostics &&
          (intervalDiagnostics === 'pinned42-source-cells-v1' ||
            id === 'Idle' ||
            id === 'Uppercut')
            ? {
                interval: {
                  node: targetIndex,
                  property,
                  mode,
                  times: inputTimes,
                  values: inputValues,
                },
              }
            : {}),
        });
        if (
          intervalDiagnostics === 'pinned42-source-cells-v1' &&
          channels.length % 7 === 0
        )
          await checkpoint(`interval-channels:${id}:${channels.length}`);
      }
      const manifestOrigin = isDerived
        ? ANDROID_DERIVED_PACK_V1.clips.find((c) => c.name === id)
        : undefined;
      if (isDerived && !manifestOrigin) unsupported('derived clip origin');
      const sourceSha256 =
          manifestOrigin?.sourceSha256 ??
          required(ANDROID_RUNTIME_ARTIFACT_V1.sources[sourceIndex]).sha256,
        rootPolicy = policyMap.get(id);
      const origin: PoseBindingSource = {
        clipId: id,
        durationMs: durationMs(seconds * 1000),
        sourceSha256,
        sourceClipIndex: manifestOrigin?.sourceClipIndex ?? sourceClipIndex,
        ...(rootPolicy ? { rootPolicy } : {}),
      };
      const plan: ClipPlan = {
        origin,
        seconds,
        channels,
        localOrigin: new Vector3(),
        actorOrigin: new Vector3(),
      };
      sampleChannels(plan, 0, nodes, byId);
      plan.localOrigin.copy(root.position);
      plan.actorOrigin.setFromMatrixPosition(root.world);
      plans.set(id, plan);
      await checkpoint(`clip:${id}`);
    }
  }
  if (plans.size !== 42 || policies.some((p) => !plans.has(p.clipId)))
    unsupported('clip/policy coverage');
  const poseBindings = await buildPoseBindings(
    [...plans.values()].map((p) => p.origin),
    () => checkpoint('bindings'),
  );
  const referenceAdjustment = attachment.clone().invert().multiply(reference);
  if (intervalDiagnostics) await checkpoint('interval-diagnostics');
  await checkpoint('publish');
  sources.length = 0;
  captured.length = 0;
  return numericProvider(
    descriptor,
    poseBindings,
    plans,
    nodes,
    referenceAdjustment,
    intervalDiagnostics,
  );
}

/** Deliberate lifetime boundary: returned closures cannot capture GLB bytes,
 * parsed documents, preparation callbacks or the caller's abort controller. */
function numericProvider(
  descriptor: SourceHeadDescriptor,
  poseBindings: PoseCatalogBindings,
  plans: Map<string, ClipPlan>,
  nodes: NumericNode[],
  referenceAdjustment: Matrix4,
  intervalScope: SourceHeadInput['intervalDiagnostics'],
): SourceHeadProvider {
  const byId = new Map(nodes.map((n) => [n.sourceIndex, n]));
  const root = required(byId.get(52)),
    head = required(byId.get(0)),
    mesh = required(byId.get(53));
  const known = new Map(poseBindings.clips.map((b) => [b.clipId, b]));
  let disposed = false;
  const clipSources = Object.freeze(
    poseBindings.clips.map((binding) => {
      const origin = required(plans.get(binding.clipId)).origin;
      return Object.freeze({
        binding,
        sourceSha256: origin.sourceSha256,
        sourceClipIndex: origin.sourceClipIndex,
        rootPolicy: origin.rootPolicy ?? null,
        sampling:
          'three-0.186.1-absolute-source-trs-first-key-hold-v1' as const,
      });
    }),
  );
  function resolve(binding: PoseClipBinding) {
    const expected = binding && known.get(binding.clipId),
      plan = binding && plans.get(binding.clipId);
    if (
      !expected ||
      !plan ||
      binding.sourceBindingId !== expected.sourceBindingId ||
      binding.durationMs !== expected.durationMs
    )
      return undefined;
    return { binding: expected, plan };
  }
  function matrixFor(plan: ClipPlan): SourceHeadSample {
    switch (plan.origin.rootPolicy?.mode ?? 'full-translation') {
      case 'grounded-posture-y': {
        const parent = required(byId.get(required(root.parent))).world;
        if (!affine(parent))
          return Object.freeze({
            kind: 'unavailable',
            reason: 'unsupported-affine',
          });
        const current = new Vector3().setFromMatrixPosition(root.world);
        current.x = plan.actorOrigin.x;
        current.z = plan.actorOrigin.z;
        root.position.copy(current.applyMatrix4(parent.clone().invert()));
        break;
      }
      case 'full-translation':
        root.position.copy(plan.localOrigin);
        break;
      case 'in-place-posture-xyz':
        // Zero extraction: keep native source XYZ, including first-key hold.
        break;
      default:
        return Object.freeze({
          kind: 'unavailable',
          reason: 'unsupported-root-policy',
        });
    }
    update(nodes, byId);
    const matrix = new Matrix4()
      .multiplyMatrices(mesh.world, mesh.world.clone().invert())
      .multiply(head.world)
      .multiply(referenceAdjustment);
    if (!affine(matrix))
      return Object.freeze({
        kind: 'unavailable',
        reason: 'unsupported-affine',
      });
    return Object.freeze({
      kind: 'transform',
      matrix: matrixArray(matrix),
      numerics: 'cpu-float64-not-certified',
    });
  }
  function evaluate(
    binding: PoseClipBinding,
    time: DurationMs,
  ): SourceHeadSample {
    if (disposed)
      return Object.freeze({ kind: 'unavailable', reason: 'disposed' });
    const found = resolve(binding);
    if (!found)
      return Object.freeze({ kind: 'unavailable', reason: 'invalid-binding' });
    const { plan, binding: expected } = found;
    if (!Number.isFinite(time) || time < 0 || time > expected.durationMs)
      return Object.freeze({ kind: 'unavailable', reason: 'invalid-time' });
    sampleChannels(
      plan,
      time === expected.durationMs ? plan.seconds : time / 1000,
      nodes,
      byId,
    );
    return matrixFor(plan);
  }
  function sampleValues(
    binding: PoseClipBinding,
    values: readonly IntervalValue[],
  ): SourceHeadSample {
    const found = resolve(binding);
    if (!found)
      return Object.freeze({ kind: 'unavailable', reason: 'invalid-binding' });
    reset(nodes);
    for (const value of values) {
      const node = required(byId.get(value.node));
      if (value.property === 'rotation') node.rotation.fromArray(value.value);
      else if (value.property === 'translation')
        node.position.fromArray(value.value);
      else node.scale.fromArray(value.value);
    }
    update(nodes, byId);
    return matrixFor(found.plan);
  }
  function makeIntervals(): SourceHeadIntervalDiagnostics {
    const identity = new Matrix4().elements;
    const parents = [undefined, 54, 52, 51, 42, 41, 40, 1, 54];
    const staticNodes = [required(byId.get(54)), mesh];
    const layoutSupported =
      nodes.every((n, i) => n.parent === parents[i]) &&
      staticNodes.every(
        (n) =>
          n.baseRotation.equals(new Quaternion()) &&
          n.baseScale.equals(new Vector3(1, 1, 1)),
      ) &&
      required(staticNodes[0]).basePosition.equals(
        new Vector3(0, -0.02199999988079071, 0),
      ) &&
      mesh.basePosition.equals(new Vector3()) &&
      referenceAdjustment.elements.every((x, i) => x === identity[i]);
    let radiusM = 0;
    for (const { position: p } of descriptor.vertices)
      radiusM = Math.max(radiusM, Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z));
    return createHeadIntervalDiagnostics(
      {
        geometryId: descriptor.geometryId,
        radiusM,
        layoutSupported,
        alive: () => !disposed,
        resolve(binding) {
          const found = resolve(binding);
          if (!found) return undefined;
          const { plan } = found;
          return {
            binding: found.binding,
            sourceSha256: plan.origin.sourceSha256,
            sourceClipIndex: plan.origin.sourceClipIndex,
            rootMode: plan.origin.rootPolicy?.mode ?? 'full-translation',
            rootOrigin: plan.localOrigin.toArray(),
            channels: plan.channels.flatMap((c) =>
              c.interval ? [c.interval] : [],
            ),
          };
        },
        sampleCanonical: evaluate,
        sampleValues,
      },
      intervalScope,
    );
  }
  return Object.freeze({
    descriptor,
    poseBindings,
    clipSources,
    evaluate,
    ...(intervalScope ? { intervalDiagnostics: makeIntervals() } : {}),
    dispose() {
      disposed = true;
      plans.clear();
      known.clear();
      nodes.length = 0;
      byId.clear();
    },
  });
}
