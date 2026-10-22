/** Strict inspection of self-contained glTF 2 binary sources. Never rewrites source bytes. */
export interface SourceClip {
  readonly name: string;
  readonly durationSeconds: number;
  /** Exact union of FLOAT accessor values, including fractional source frames. */
  readonly sampleTimes: readonly number[];
}
export interface SourceInspection {
  readonly clips: readonly SourceClip[];
  readonly skeletonSignature: string;
  readonly boneCount: number;
  readonly triangleCount: number;
  readonly materialCount: number;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected object');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected array');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Expected nonnegative integer');
  return value;
}
function named(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Missing source name');
  return value;
}
function validateTransform(node: Record<string, unknown>): void {
  for (const [key, length] of [
    ['translation', 3],
    ['rotation', 4],
    ['scale', 3],
    ['matrix', 16],
  ] as const) {
    if (node[key] === undefined) continue;
    const values = array(node[key]);
    if (
      values.length !== length ||
      values.some(
        (value) => typeof value !== 'number' || !Number.isFinite(value),
      )
    )
      throw new Error('Invalid node transform');
    if (key === 'rotation') {
      const norm = values.reduce<number>(
        (sum, value) => sum + (typeof value === 'number' ? value * value : 0),
        0,
      );
      if (Math.abs(norm - 1) > 1e-4) throw new Error('Invalid node quaternion');
    }
  }
  if (
    node.matrix !== undefined &&
    ['translation', 'rotation', 'scale'].some((key) => node[key] !== undefined)
  )
    throw new Error('Conflicting node matrix and TRS');
}
/** Synchronous compatibility driver. Both paths execute exactly the same checks. */
export function inspectGlb(bytes: Uint8Array): SourceInspection {
  const steps = inspectGlbSteps(bytes);
  for (;;) {
    const result = steps.next();
    if (result.done) return result.value;
  }
}
/** Internal cooperative driver. The trusted preparation scheduler supplies an
 * actual macrotask yield and cancellation check, not a resolved Promise. Input is
 * captured before yielding; callers cannot alter an accessor mid-inspection. */
export async function inspectGlbYielding(
  bytes: Uint8Array,
  checkpoint: (chunk: number) => Promise<void>,
): Promise<SourceInspection> {
  const steps = inspectGlbSteps(new Uint8Array(bytes));
  let chunk = 0;
  for (;;) {
    const result = steps.next();
    if (result.done) return result.value;
    await checkpoint(chunk++);
  }
}
function* inspectGlbSteps(
  bytes: Uint8Array,
): Generator<void, SourceInspection, void> {
  // An operation quota, not a device-independent wall-clock guarantee. Native
  // JSON parsing and each small structural/sort operation remain synchronous.
  let work = 0;
  const quota = 16384;
  if (bytes.length < 28) throw new Error('Empty or truncated GLB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length
  )
    throw new Error('Invalid GLB header');
  let offset = 12;
  let document: Record<string, unknown> | undefined;
  let binary: Uint8Array | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('Truncated chunk');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > bytes.length)
      throw new Error('Invalid chunk length');
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) {
      if (document || offset !== 12)
        throw new Error('Duplicate/misordered JSON');
      document = record(JSON.parse(new TextDecoder().decode(chunk)));
    } else if (type === 0x004e4942) {
      if (binary) throw new Error('Duplicate BIN');
      binary = chunk;
    }
    offset += 8 + length;
  }
  if (!document || !binary) throw new Error('Missing GLB payload');
  if (record(document.asset).version !== '2.0')
    throw new Error('Unsupported glTF');
  const buffers = array(document.buffers).map(record);
  if (
    buffers.length !== 1 ||
    buffers[0]?.uri !== undefined ||
    integer(buffers[0]?.byteLength) > binary.length
  )
    throw new Error('External or incomplete buffer');
  const accessors = array(document.accessors).map(record);
  const views = array(document.bufferViews).map(record);
  const binaryLength = integer(buffers[0]?.byteLength);
  for (const bufferView of views) {
    if (
      integer(bufferView.buffer) !== 0 ||
      integer(bufferView.byteOffset ?? 0) + integer(bufferView.byteLength) >
        binaryLength
    )
      throw new Error('Buffer view exceeds declared buffer');
  }
  const data = new DataView(
    binary.buffer,
    binary.byteOffset,
    binary.byteLength,
  );
  function* readAccessor(
    index: unknown,
    expectedType: string,
    unsigned = false,
  ): Generator<void, number[], void> {
    const accessor = accessors[integer(index)];
    if (
      !accessor ||
      accessor.type !== expectedType ||
      (unsigned
        ? ![5121, 5123, 5125].includes(integer(accessor.componentType))
        : accessor.componentType !== 5126) ||
      accessor.sparse !== undefined
    )
      throw new Error('Unsupported animation/bind accessor');
    const bufferView = views[integer(accessor.bufferView)];
    if (!bufferView || integer(bufferView.buffer) !== 0)
      throw new Error('Missing buffer view');
    const widths: Record<string, number> = {
      MAT4: 16,
      SCALAR: 1,
      VEC2: 2,
      VEC3: 3,
      VEC4: 4,
    };
    const width = widths[expectedType];
    if (!width) throw new Error('Unsupported accessor type');
    const componentSize =
      accessor.componentType === 5121
        ? 1
        : accessor.componentType === 5123
          ? 2
          : 4;
    const stride =
      bufferView.byteStride === undefined
        ? width * componentSize
        : integer(bufferView.byteStride);
    const start =
      integer(bufferView.byteOffset ?? 0) + integer(accessor.byteOffset ?? 0);
    const count = integer(accessor.count);
    const end = start + (count - 1) * stride + width * componentSize;
    if (
      !count ||
      stride < width * componentSize ||
      start % componentSize ||
      end > binaryLength ||
      end > integer(bufferView.byteOffset ?? 0) + integer(bufferView.byteLength)
    )
      throw new Error('Accessor bounds');
    const result: number[] = [];
    for (let i = 0; i < count; i++)
      for (let j = 0; j < width; j++) {
        const offset = start + i * stride + j * componentSize;
        const value =
          accessor.componentType === 5121
            ? data.getUint8(offset)
            : accessor.componentType === 5123
              ? data.getUint16(offset, true)
              : accessor.componentType === 5125
                ? data.getUint32(offset, true)
                : data.getFloat32(offset, true);
        if (!Number.isFinite(value)) throw new Error('Non-finite accessor');
        result.push(value);
        if (++work === quota) {
          work = 0;
          yield;
        }
      }
    return result;
  }
  for (const image of document.images === undefined
    ? []
    : array(document.images).map(record)) {
    if (image.uri !== undefined || !views[integer(image.bufferView)])
      throw new Error('External/missing image');
  }
  const names = new Set<string>();
  const clips: SourceClip[] = [];
  for (const entry of array(document.animations)) {
    const animation = record(entry);
    const name = named(animation.name);
    if (names.has(name)) throw new Error('Duplicate clip name');
    names.add(name);
    const times = new Set<number>();
    const samplers = array(animation.samplers).map(record);
    if (!samplers.length || !array(animation.channels).length)
      throw new Error('Empty clip');
    for (const sampler of samplers) {
      let previous = -1;
      for (const time of yield* readAccessor(sampler.input, 'SCALAR')) {
        if (time < 0 || time <= previous)
          throw new Error('Invalid sample order');
        times.add(time);
        previous = time;
        if (++work === quota) {
          work = 0;
          yield;
        }
      }
    }
    for (const channel of array(animation.channels).map(record)) {
      const sampler = samplers[integer(channel.sampler)];
      const target = record(channel.target);
      if (!sampler || !array(document.nodes)[integer(target.node)])
        throw new Error('Invalid animation channel');
      const type =
        target.path === 'rotation'
          ? 'VEC4'
          : target.path === 'translation' || target.path === 'scale'
            ? 'VEC3'
            : null;
      if (!type) throw new Error('Unsupported animation target');
      const interpolation = sampler.interpolation ?? 'LINEAR';
      if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(String(interpolation)))
        throw new Error('Unsupported interpolation');
      const output = yield* readAccessor(sampler.output, type);
      const input = yield* readAccessor(sampler.input, 'SCALAR');
      if (
        output.length !==
        input.length *
          (type === 'VEC4' ? 4 : 3) *
          (interpolation === 'CUBICSPLINE' ? 3 : 1)
      )
        throw new Error('Animation output count mismatch');
    }
    const sampleTimes = [...times].sort((a, b) => a - b);
    const durationSeconds = sampleTimes.at(-1) ?? 0;
    if (durationSeconds <= 0) throw new Error('Empty duration');
    clips.push({ name, durationSeconds, sampleTimes });
  }
  if (!clips.length) throw new Error('No clips');
  const nodes = array(document.nodes).map(record);
  const meshes = array(document.meshes).map(record);
  const materials =
    document.materials === undefined
      ? []
      : array(document.materials).map(record);
  const skins = array(document.skins).map(record);
  for (const node of nodes) {
    validateTransform(node);
    if (node.mesh !== undefined && !meshes[integer(node.mesh)])
      throw new Error('Invalid mesh reference');
    if (node.skin !== undefined && !skins[integer(node.skin)])
      throw new Error('Invalid skin reference');
  }
  for (const skin of skins)
    if (skin.skeleton !== undefined && !nodes[integer(skin.skeleton)])
      throw new Error('Invalid skeleton reference');
  const parents = new Map<number, number>();
  nodes.forEach((node, parent) => {
    for (const child of node.children === undefined
      ? []
      : array(node.children)) {
      const index = integer(child);
      if (!nodes[index] || parents.has(index))
        throw new Error('Invalid node parent');
      parents.set(index, parent);
    }
  });
  if (skins.length !== 1) throw new Error('Expected one skeleton');
  const skin = skins[0];
  if (!skin) throw new Error('Missing skin');
  const joints = array(skin.joints).map(integer);
  if (new Set(joints).size !== joints.length)
    throw new Error('Duplicate joint');
  const signature = joints.map((index) => {
    const node = nodes[index];
    if (!node) throw new Error('Missing joint');
    for (const [key, length] of [
      ['translation', 3],
      ['rotation', 4],
      ['scale', 3],
      ['matrix', 16],
    ] as const) {
      if (node[key] !== undefined) {
        const values = array(node[key]);
        if (
          values.length !== length ||
          values.some(
            (value) => typeof value !== 'number' || !Number.isFinite(value),
          )
        )
          throw new Error('Invalid rest transform');
      }
    }
    return {
      name: named(node.name),
      parent: parents.get(index) ?? null,
      translation: node.translation ?? [0, 0, 0],
      rotation: node.rotation ?? [0, 0, 0, 1],
      scale: node.scale ?? [1, 1, 1],
      matrix: node.matrix ?? null,
    };
  });
  const ancestorIndices = new Set<number>();
  for (const joint of joints) {
    const seen = new Set<number>([joint]);
    let parent = parents.get(joint);
    while (parent !== undefined) {
      if (seen.has(parent)) throw new Error('Cyclic skeleton hierarchy');
      seen.add(parent);
      if (!joints.includes(parent)) ancestorIndices.add(parent);
      parent = parents.get(parent);
    }
  }
  const ancestors = [...ancestorIndices]
    .sort((a, b) => a - b)
    .map((index) => {
      const node = nodes[index];
      if (!node) throw new Error('Missing ancestor');
      for (const [key, length] of [
        ['translation', 3],
        ['rotation', 4],
        ['scale', 3],
        ['matrix', 16],
      ] as const) {
        if (node[key] !== undefined) {
          const values = array(node[key]);
          if (
            values.length !== length ||
            values.some(
              (value) => typeof value !== 'number' || !Number.isFinite(value),
            )
          )
            throw new Error('Invalid ancestor transform');
        }
      }
      return {
        index,
        name: node.name ?? null,
        parent: parents.get(index) ?? null,
        translation: node.translation ?? [0, 0, 0],
        rotation: node.rotation ?? [0, 0, 0, 1],
        scale: node.scale ?? [1, 1, 1],
        matrix: node.matrix ?? null,
      };
    });
  const inverseBind = yield* readAccessor(skin.inverseBindMatrices, 'MAT4');
  if (inverseBind.length !== joints.length * 16)
    throw new Error('Bind count mismatch');
  let triangleCount = 0;
  for (const mesh of meshes)
    for (const primitive of array(mesh.primitives).map(record)) {
      if (primitive.mode !== undefined && primitive.mode !== 4)
        throw new Error('Non-triangle mesh');
      const indices = accessors[integer(primitive.indices)];
      if (!indices || integer(indices.count) % 3)
        throw new Error('Invalid indices');
      if (
        primitive.material !== undefined &&
        !materials[integer(primitive.material)]
      )
        throw new Error('Invalid material reference');
      const attributes = record(primitive.attributes);
      for (const index of Object.values(attributes))
        if (!accessors[integer(index)])
          throw new Error('Invalid attribute accessor reference');
      const positions = yield* readAccessor(attributes.POSITION, 'VEC3');
      for (const [name, type, width] of [
        ['NORMAL', 'VEC3', 3],
        ['TANGENT', 'VEC4', 4],
        ['TEXCOORD_0', 'VEC2', 2],
        ['TEXCOORD_1', 'VEC2', 2],
      ] as const) {
        if (
          attributes[name] !== undefined &&
          (yield* readAccessor(attributes[name], type)).length / width !==
            positions.length / 3
        )
          throw new Error('Attribute vertex count mismatch');
      }
      const weights = yield* readAccessor(attributes.WEIGHTS_0, 'VEC4');
      const jointIndices = yield* readAccessor(
        attributes.JOINTS_0,
        'VEC4',
        true,
      );
      if (
        weights.length !== jointIndices.length ||
        positions.length / 3 !== weights.length / 4
      )
        throw new Error('Skin vertex count mismatch');
      for (let i = 0; i < weights.length; i += 4) {
        let sum = 0;
        for (let j = 0; j < 4; j++) {
          const weight = weights[i + j],
            joint = jointIndices[i + j];
          if (
            weight === undefined ||
            joint === undefined ||
            weight < 0 ||
            weight > 1 ||
            joint >= joints.length
          )
            throw new Error('Invalid skin weight/joint');
          sum += weight;
          if (++work === quota) {
            work = 0;
            yield;
          }
        }
        if (Math.abs(sum - 1) > 1e-4)
          throw new Error('Unnormalized skin weights');
      }
      const indicesValues = yield* readAccessor(
        primitive.indices,
        'SCALAR',
        true,
      );
      for (const index of indicesValues) {
        if (index >= positions.length / 3)
          throw new Error('Index outside vertex range');
        if (++work === quota) {
          work = 0;
          yield;
        }
      }
      triangleCount += integer(indices.count) / 3;
    }
  return {
    clips,
    skeletonSignature: JSON.stringify({ signature, ancestors, inverseBind }),
    boneCount: joints.length,
    triangleCount,
    materialCount: materials.length,
  };
}
