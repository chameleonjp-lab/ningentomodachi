/** Diagnostic-only actor-local TRS. No physical parent, source clock or renderer. */
import { Matrix4, Quaternion, Vector3 } from 'three';
export interface LocalPoseNode {
  readonly id: string;
  readonly parent: string | null;
  readonly t: readonly number[];
  readonly q: readonly number[];
  readonly s: readonly number[];
}
export type LocalPose = readonly LocalPoseNode[];
function captureVector(
  input: readonly number[],
  size: number,
): readonly number[] {
  if (!Array.isArray(input) || input.length !== size)
    throw Error('Unsupported vector domain');
  const result: number[] = [];
  for (let index = 0; index < size; index++) {
    // Inherited values and accessors cannot masquerade as stable owned coordinates.
    const property = Object.getOwnPropertyDescriptor(input, index);
    if (
      !property ||
      !('value' in property) ||
      typeof property.value !== 'number' ||
      !Number.isFinite(property.value)
    )
      throw Error('Unsupported dense own finite vector domain');
    result.push(property.value);
  }
  return Object.freeze(result);
}
export function capturePose(input: LocalPose): LocalPose {
  if (!Array.isArray(input) || !input.length) throw Error('Invalid pose');
  const seen = new Set<string>();
  let roots = 0;
  const nodes: LocalPoseNode[] = [];
  for (let index = 0; index < input.length; index++) {
    const property = Object.getOwnPropertyDescriptor(input, index);
    if (!property || !('value' in property))
      throw Error('Unsupported sparse/inherited pose domain');
    const n = property.value as LocalPoseNode;
    if (!n) throw Error('Unsupported TRS/hierarchy domain');
    const { id, parent } = n;
    if (
      typeof id !== 'string' ||
      !id ||
      seen.has(id) ||
      (parent !== null && !seen.has(parent))
    )
      throw Error('Unsupported TRS/hierarchy domain');
    const t = captureVector(n.t, 3),
      q = captureVector(n.q, 4),
      s = captureVector(n.s, 3);
    const norm = Math.hypot(...q);
    const predicate = !Number.isFinite(norm)
      ? 'quaternion-norm-finite'
      : norm <= 0
        ? 'quaternion-norm-positive'
        : s.some((v) => v <= 0)
          ? 'scale-positive'
          : undefined;
    if (predicate) {
      // Round-trip JS decimal values; signed zero is preserved, no source mutation.
      const exact = (values: readonly number[]) =>
        `[${values.map((v) => (Object.is(v, -0) ? '-0' : String(v))).join(',')}]`;
      throw Error(
        `Unsupported TRS/hierarchy domain: predicate=${predicate} node=${JSON.stringify(id)} index=${index} q=${exact(q)} s=${exact(s)}`,
      );
    }
    if (parent === null) roots++;
    seen.add(id);
    const node = Object.freeze({ id, parent, t, q, s });
    checkedMatrix(localMatrix(node));
    nodes.push(node);
  }
  if (roots !== 1) throw Error('Unsupported multiple roots');
  return Object.freeze(nodes);
}
/** Validate every input node and layout identity before the first diagnostic write. */
export function applyPoseToLayout(
  input: LocalPose,
  layout: readonly Pick<LocalPoseNode, 'id' | 'parent'>[],
  write: (node: LocalPoseNode, index: number) => void,
): void {
  const pose = capturePose(input);
  if (!Array.isArray(layout) || pose.length !== layout.length)
    throw Error('Unsupported diagnostic apply hierarchy');
  for (let index = 0; index < pose.length; index++) {
    const property = Object.getOwnPropertyDescriptor(layout, index);
    if (!property || !('value' in property))
      throw Error('Unsupported sparse layout');
    const entry = property.value as Pick<LocalPoseNode, 'id' | 'parent'>;
    if (
      !entry ||
      entry.id !== pose[index]?.id ||
      entry.parent !== pose[index]?.parent
    )
      throw Error('Unsupported diagnostic apply hierarchy');
  }
  composePoseMatrices(pose);
  pose.forEach(write);
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw Error('Missing pose component');
  return value;
}
/** Computed arithmetic guards, not conditioning or interval certificates. */
function checkedMatrix(matrix: Matrix4): Matrix4 {
  const determinant = matrix.determinant();
  if (
    !matrix.elements.every(Number.isFinite) ||
    !Number.isFinite(determinant) ||
    determinant <= 0 ||
    !matrix.clone().invert().elements.every(Number.isFinite)
  )
    throw Error('Unsupported singular/unrepresentable matrix domain');
  return matrix;
}
function localMatrix(n: LocalPoseNode): Matrix4 {
  return new Matrix4().compose(
    new Vector3().fromArray(n.t),
    new Quaternion().fromArray(n.q),
    new Vector3().fromArray(n.s),
  );
}
export interface PoseWorldMatrix {
  readonly id: string;
  readonly parent: string | null;
  readonly matrix: readonly number[];
}
/** Actual raw-quaternion matrix products, never decomposed world TRS. */
export function composePoseMatrices(
  input: LocalPose,
): readonly PoseWorldMatrix[] {
  const nodes = capturePose(input),
    world = new Map<string, Matrix4>();
  return Object.freeze(
    nodes.map((n) => {
      const local = checkedMatrix(localMatrix(n));
      const matrix = checkedMatrix(
        n.parent === null
          ? local
          : required(world.get(n.parent)).clone().multiply(local),
      );
      world.set(n.id, matrix);
      return Object.freeze({
        id: n.id,
        parent: n.parent,
        matrix: Object.freeze(matrix.toArray()),
      });
    }),
  );
}
const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(x) / x);
function radiusSpherical(
  a: readonly number[],
  b: readonly number[],
  sign: 1 | -1,
  weight: number,
): number[] {
  const ra = Math.hypot(...a),
    rb = Math.hypot(...b);
  if (
    !(ra > Math.SQRT1_2) ||
    !(rb > Math.SQRT1_2) ||
    !Number.isFinite(ra * ra) ||
    !Number.isFinite(rb * rb)
  )
    throw Error('Unsupported synthetic radius domain');
  const u = a.map((x) => x / ra),
    v = b.map((x) => (sign * x) / rb);
  const dot = u.reduce((sum, x, i) => sum + x * required(v[i]), 0);
  if (!Number.isFinite(dot) || dot < 0)
    throw Error('Unsupported fixed-lift crossing/antipodal domain');
  const wedge: number[] = [];
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      wedge.push(
        required(u[i]) * required(v[j]) - required(u[j]) * required(v[i]),
      );
  const theta = Math.atan2(Math.hypot(...wedge), dot),
    denominator = sinc(theta),
    rho = (1 - weight) * ra + weight * rb;
  if (
    !Number.isFinite(theta) ||
    !Number.isFinite(denominator) ||
    denominator <= 0 ||
    !Number.isFinite(rho)
  )
    throw Error('Unsupported interpolation arithmetic');
  const left = ((1 - weight) * sinc((1 - weight) * theta)) / denominator,
    right = (weight * sinc(weight * theta)) / denominator;
  return u.map((x, i) => rho * (left * x + right * required(v[i])));
}
/** Synthetic law only. Fixed recipe lift, no query-dependent hemisphere selection. */
export function blendPose(
  aInput: LocalPose,
  bInput: LocalPose,
  weight: number,
  fixedLiftSign: 1 | -1,
): LocalPose {
  const a = capturePose(aInput),
    b = capturePose(bInput);
  if (
    !Number.isFinite(weight) ||
    weight < 0 ||
    weight > 1 ||
    ![1, -1].includes(fixedLiftSign) ||
    a.length !== b.length ||
    a.some((n, i) => n.id !== b[i]?.id || n.parent !== b[i]?.parent)
  )
    throw Error('Unsupported blend domain');
  const result = a.map((n, i) => {
    const end = required(b[i]);
    return {
      id: n.id,
      parent: n.parent,
      t: n.t.map((x, k) => x * (1 - weight) + required(end.t[k]) * weight),
      s: n.s.map((x, k) => x * (1 - weight) + required(end.s[k]) * weight),
      q: radiusSpherical(n.q, end.q, fixedLiftSign, weight),
    };
  });
  const captured = weight === 0 ? a : weight === 1 ? b : capturePose(result);
  composePoseMatrices(captured);
  return captured;
}
