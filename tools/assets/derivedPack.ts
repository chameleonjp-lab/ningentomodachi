/** OFFLINE ONLY. This certificate is not a caller-supplied runtime trust root. */
import { createHash } from 'node:crypto';
import { ANDROID_RUNTIME_ARTIFACT_V1 } from '../../src/assets/runtimeArtifactManifest';
import { inspectGlb } from '../../src/assets/source';

type ObjectValue = Record<string, unknown>;
const record = (value: unknown): ObjectValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected GLTF object');
  return value as ObjectValue;
};
const list = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error('Expected GLTF array');
  return value;
};
const integer = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Expected nonnegative integer');
  return value;
};
const sha = (value: Uint8Array | string) =>
  createHash('sha256').update(value).digest('hex');
/** JSON's normal serializer loses signed zero. Both the writer and certificate retain it. */
export function losslessJson(value: unknown, sortKeys = false): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Nonfinite JSON value');
    return Object.is(value, -0) ? '-0' : String(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => losslessJson(item, sortKeys)).join(',')}]`;
  const object = record(value),
    keys = Object.keys(object);
  if (sortKeys) keys.sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${losslessJson(object[key], sortKeys)}`).join(',')}}`;
}
// Deliberately restricted to the EXACT observed source feature set. Texture/morph,
// sparse/interleaved/quantized additions or unknown extensions must be reviewed,
// never silently dropped by this source-specific lossless representation.
const fields: Readonly<Record<string, readonly string[]>> = {
  root: [
    'accessors',
    'animations',
    'asset',
    'bufferViews',
    'buffers',
    'extensionsUsed',
    'materials',
    'meshes',
    'nodes',
    'scene',
    'scenes',
    'skins',
  ],
  'root.asset': ['generator', 'version'],
  'root.scenes[]': ['name', 'nodes'],
  'root.nodes[]': [
    'children',
    'mesh',
    'name',
    'rotation',
    'scale',
    'skin',
    'translation',
  ],
  'root.animations[]': ['channels', 'name', 'samplers'],
  'root.animations[].channels[]': ['sampler', 'target'],
  'root.animations[].channels[].target': ['node', 'path'],
  'root.animations[].samplers[]': ['input', 'interpolation', 'output'],
  'root.materials[]': [
    'doubleSided',
    'emissiveFactor',
    'extensions',
    'name',
    'pbrMetallicRoughness',
  ],
  'root.materials[].pbrMetallicRoughness': [
    'baseColorFactor',
    'metallicFactor',
    'roughnessFactor',
  ],
  'root.materials[].extensions': ['KHR_materials_emissive_strength'],
  'root.materials[].extensions.KHR_materials_emissive_strength': [
    'emissiveStrength',
  ],
  'root.meshes[]': ['name', 'primitives'],
  'root.meshes[].primitives[]': ['attributes', 'indices', 'material'],
  'root.meshes[].primitives[].attributes': [
    'JOINTS_0',
    'NORMAL',
    'POSITION',
    'TEXCOORD_0',
    'WEIGHTS_0',
  ],
  'root.skins[]': ['inverseBindMatrices', 'joints', 'name'],
  'root.accessors[]': [
    'bufferView',
    'byteOffset',
    'componentType',
    'count',
    'max',
    'min',
    'type',
  ],
  'root.bufferViews[]': ['buffer', 'byteLength', 'byteOffset', 'target'],
  'root.buffers[]': ['byteLength'],
};
function validateFields(value: unknown, path = 'root'): void {
  if (Array.isArray(value)) {
    for (const item of value) validateFields(item, `${path}[]`);
  } else if (value !== null && typeof value === 'object') {
    const allowed = fields[path];
    if (!allowed) throw new Error(`Unsupported object ${path}`);
    for (const [key, item] of Object.entries(value)) {
      if (!allowed.includes(key))
        throw new Error(`Unsupported field ${path}.${key}`);
      validateFields(item, `${path}.${key}`);
    }
  } else if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Nonfinite source value');
  }
}
interface Parsed {
  readonly document: ObjectValue;
  readonly binary: Uint8Array;
}
function parse(bytes: Uint8Array): Parsed {
  if (bytes.byteLength < 28) throw new Error('Truncated GLB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length
  )
    throw new Error('GLB header mismatch');
  const jsonLength = view.getUint32(12, true),
    binaryHeader = 20 + jsonLength;
  if (
    jsonLength % 4 ||
    binaryHeader + 8 > bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    view.getUint32(binaryHeader + 4, true) !== 0x004e4942
  )
    throw new Error('Expected JSON and BIN chunks');
  const binaryLength = view.getUint32(binaryHeader, true);
  if (binaryLength % 4 || binaryHeader + 8 + binaryLength !== bytes.length)
    throw new Error('Unexpected GLB chunks');
  const document = record(
    JSON.parse(new TextDecoder().decode(bytes.subarray(20, binaryHeader))),
  );
  validateFields(document);
  if (list(document.buffers).length !== 1)
    throw new Error('Expected one embedded buffer');
  const declared = integer(record(list(document.buffers)[0]).byteLength);
  if (declared > binaryLength || binaryLength - declared > 3)
    throw new Error('Declared buffer boundary');
  const binary = bytes.subarray(binaryHeader + 8, binaryHeader + 8 + declared);
  for (const byte of bytes.subarray(binaryHeader + 8 + declared))
    if (byte !== 0) throw new Error('Nonzero BIN padding');
  const extensions = list(document.extensionsUsed);
  if (
    extensions.length !== 1 ||
    extensions[0] !== 'KHR_materials_emissive_strength'
  )
    throw new Error('Unsupported source extension');
  inspectGlb(bytes);
  return { document, binary };
}
function accessor(source: Parsed, index: unknown): unknown {
  const value = record(list(source.document.accessors)[integer(index)]);
  const view = record(
    list(source.document.bufferViews)[integer(value.bufferView)],
  );
  if (view.buffer !== 0) throw new Error('External accessor buffer');
  const dimensions: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT4: 16,
  };
  const widths: Record<number, number> = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
  };
  const width = widths[integer(value.componentType)],
    dimension =
      typeof value.type === 'string' ? dimensions[value.type] : undefined;
  if (!width || !dimension) throw new Error('Unsupported accessor layout');
  const length = integer(value.count) * width * dimension;
  const local = integer(value.byteOffset ?? 0),
    viewStart = integer(view.byteOffset ?? 0),
    viewLength = integer(view.byteLength);
  if (
    local + length > viewLength ||
    viewStart + viewLength > source.binary.length
  )
    throw new Error('Accessor exceeds declared buffer');
  return {
    definition: Object.fromEntries(
      Object.entries(value).filter(
        ([key]) => key !== 'bufferView' && key !== 'byteOffset',
      ),
    ),
    target: view.target ?? null,
    packedBytesSha256: sha(
      source.binary.subarray(viewStart + local, viewStart + local + length),
    ),
  };
}
function staticProjection(source: Parsed): unknown {
  const projection = Object.fromEntries(
    Object.entries(source.document).filter(
      ([key]) =>
        !['animations', 'accessors', 'bufferViews', 'buffers'].includes(key),
    ),
  );
  projection.meshes = list(source.document.meshes).map((value) => {
    const mesh = record(value);
    return {
      ...mesh,
      primitives: list(mesh.primitives).map((value) => {
        const primitive = record(value);
        return {
          ...primitive,
          attributes: Object.fromEntries(
            Object.entries(record(primitive.attributes)).map(
              ([name, index]) => [name, accessor(source, index)],
            ),
          ),
          indices: accessor(source, primitive.indices),
        };
      }),
    };
  });
  projection.skins = list(source.document.skins).map((value) => {
    const skin = record(value);
    return {
      ...skin,
      inverseBindMatrices: accessor(source, skin.inverseBindMatrices),
    };
  });
  return projection;
}
function clipProjection(source: Parsed, clip: unknown): unknown {
  const animation = record(clip);
  return {
    ...animation,
    samplers: list(animation.samplers).map((value) => {
      const sampler = record(value);
      return {
        ...sampler,
        input: accessor(source, sampler.input),
        output: accessor(source, sampler.output),
      };
    }),
  };
}
export interface ClipOrigin {
  readonly name: string;
  readonly sourceIndex: number;
  readonly sourceSha256: string;
  readonly sourceClipIndex: number;
  readonly contentSha256: string;
}
/** Offline validation intentionally independent of runtime pins. Produces evidence,
 * never runtime authorization; the builder below additionally enforces trusted pins. */
export function certifySourceEquivalence(sources: readonly Uint8Array[]) {
  if (sources.length !== 4)
    throw new Error('Expected original four-category inventory');
  const parsed = sources.map(parse);
  const staticHashes = parsed.map((source) =>
    sha(losslessJson(staticProjection(source), true)),
  );
  if (new Set(staticHashes).size !== 1)
    throw new Error('Source scene/geometry/bind/material mismatch');
  const clips: ClipOrigin[] = [];
  parsed.forEach((source, sourceIndex) => {
    list(source.document.animations).forEach((value, sourceClipIndex) => {
      const clip = record(value);
      if (
        typeof clip.name !== 'string' ||
        clips.some((item) => item.name === clip.name)
      )
        throw new Error('Invalid/duplicate original clip');
      clips.push({
        name: clip.name,
        sourceIndex,
        sourceSha256: sha(sources[sourceIndex] ?? new Uint8Array()),
        sourceClipIndex,
        contentSha256: sha(losslessJson(clipProjection(source, clip), true)),
      });
    });
  });
  if (clips.length !== 42) throw new Error('Original42 inventory mismatch');
  return {
    version: 'lossless-category-dedup-v1' as const,
    staticSha256: staticHashes[0],
    clips,
  };
}
export function buildDerivedPack(sources: readonly Uint8Array[]) {
  const pins = ANDROID_RUNTIME_ARTIFACT_V1.sources;
  if (
    sources.length !== pins.length ||
    sources.some(
      (source, index) =>
        source.length !== pins[index]?.bytes ||
        sha(source) !== pins[index]?.sha256,
    )
  )
    throw new Error('Original immutable source pin mismatch');
  const certificate = certifySourceEquivalence(sources),
    parsed = sources.map(parse);
  const first = parsed[0];
  if (!first) throw new Error('Missing base source');
  const document = structuredClone(first.document);
  const views = [...list(document.bufferViews)],
    accessors = [...list(document.accessors)],
    animations = [...list(document.animations)];
  const chunks: Uint8Array[] = [first.binary];
  let binaryLength = first.binary.length;
  const append = (bytes: Uint8Array) => {
    const padding = (4 - (binaryLength % 4)) % 4;
    if (padding) {
      chunks.push(new Uint8Array(padding));
      binaryLength += padding;
    }
    const offset = binaryLength;
    chunks.push(bytes);
    binaryLength += bytes.length;
    return offset;
  };
  for (const source of parsed.slice(1)) {
    const viewMap = new Map<number, number>(),
      accessorMap = new Map<number, number>();
    const remap = (rawIndex: unknown): number => {
      const index = integer(rawIndex),
        existing = accessorMap.get(index);
      if (existing !== undefined) return existing;
      const original = record(list(source.document.accessors)[index]),
        sourceViewIndex = integer(original.bufferView);
      let newViewIndex = viewMap.get(sourceViewIndex);
      if (newViewIndex === undefined) {
        const view = record(list(source.document.bufferViews)[sourceViewIndex]);
        const start = integer(view.byteOffset ?? 0),
          size = integer(view.byteLength);
        if (view.buffer !== 0 || start + size > source.binary.length)
          throw new Error('Invalid animation buffer view');
        newViewIndex = views.length;
        views.push({
          ...view,
          byteOffset: append(source.binary.subarray(start, start + size)),
        });
        viewMap.set(sourceViewIndex, newViewIndex);
      }
      const newIndex = accessors.length;
      accessors.push({ ...original, bufferView: newViewIndex });
      accessorMap.set(index, newIndex);
      return newIndex;
    };
    for (const value of list(source.document.animations)) {
      const animation = record(value);
      animations.push({
        ...animation,
        samplers: list(animation.samplers).map((value) => {
          const sampler = record(value);
          return {
            ...sampler,
            input: remap(sampler.input),
            output: remap(sampler.output),
          };
        }),
      });
    }
  }
  document.bufferViews = views;
  document.accessors = accessors;
  document.animations = animations;
  document.buffers = [{ byteLength: binaryLength }];
  const json = new TextEncoder().encode(losslessJson(document)),
    jsonLength = Math.ceil(json.length / 4) * 4,
    paddedBinary = Math.ceil(binaryLength / 4) * 4;
  const bytes = new Uint8Array(28 + jsonLength + paddedBinary),
    header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, bytes.length, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(json, 20);
  header.setUint32(20 + jsonLength, paddedBinary, true);
  header.setUint32(24 + jsonLength, 0x004e4942, true);
  let offset = 28 + jsonLength;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const reread = parse(bytes);
  if (
    sha(losslessJson(staticProjection(reread), true)) !==
    certificate.staticSha256
  )
    throw new Error('Derived static readback mismatch');
  list(reread.document.animations).forEach((clip, index) => {
    if (
      sha(losslessJson(clipProjection(reread, clip), true)) !==
      certificate.clips[index]?.contentSha256
    )
      throw new Error('Derived clip readback mismatch');
  });
  return { bytes, certificate };
}
