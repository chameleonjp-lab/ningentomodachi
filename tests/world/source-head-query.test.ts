import { Matrix4, Triangle, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import {
  prepareHeadSurface,
  type HeadSurfaceTriangle,
} from '../../src/world/source-head-query';

const point = (x: number, y: number, z = 0) => ({ x, y, z });
const identity = new Matrix4().toArray();
const face = (triangleIndex = 0, z = 0): HeadSurfaceTriangle => ({
  primitive: 0,
  triangleIndex,
  vertices: [point(0, 0, z), point(2, 0, z), point(0, 2, z)],
});
const sphere = (x: number, y: number, z: number, radiusM = 0) => ({
  center: point(x, y, z),
  radiusM,
});

describe('standalone finite head surface query', () => {
  test.each([
    [0.5, 0.5, 1, 0.5, 0.5, 0, 1],
    [1, -1, 0, 1, 0, 0, 1],
    [-1, -1, 0, 0, 0, 0, Math.sqrt(2)],
    [2, 2, 0, 1, 1, 0, Math.sqrt(2)],
  ])('returns analytic nearest face/edge/vertex for %j', (...v) => {
    const [x, y, z, px, py, pz, distance] = v as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const result = prepareHeadSurface([face()]).query(
      identity,
      sphere(x, y, z),
    );
    expect(result.kind).toBe('surface-distance');
    if (result.kind !== 'surface-distance') throw new Error(result.reason);
    expect(result.distanceM).toBeCloseTo(distance, 14);
    expect(result.closestPoint).toEqual(point(px, py, pz));
    expect(
      result.barycentric.x + result.barycentric.y + result.barycentric.z,
    ).toBeCloseTo(1, 14);
    expect(result.triangle).toEqual({ primitive: 0, triangleIndex: 0 });
    expect(result.numerics).toBe('float64-not-certified');
  });

  test('does not pad a radius and includes exact surface tangency', () => {
    const prepared = prepareHeadSurface([face()]);
    for (const [radius, overlap] of [
      [1, true],
      [1 - Number.EPSILON, false],
      [1 + Number.EPSILON, true],
    ] as const) {
      const result = prepared.query(identity, sphere(0.5, 0.5, 1, radius));
      expect(result.kind === 'surface-distance' && result.overlap).toBe(
        overlap,
      );
    }
    const on = prepared.query(identity, sphere(0.5, 0.5, 0));
    expect(on.kind === 'surface-distance' && on.overlap).toBe(true);
  });

  test('copies generic input, freezes public results and permits interleaved actor transforms', () => {
    const input = [face()];
    const prepared = prepareHeadSurface(input);
    const a = prepared.query(identity, sphere(0.5, 0.5, 1));
    (input[0]!.vertices[0] as { x: number }).x = 100;
    input.length = 0;
    const moved = new Matrix4().makeTranslation(0, 0, 10).toArray();
    const b = prepared.query(moved, sphere(0.5, 0.5, 11));
    expect(prepared.query(identity, sphere(0.5, 0.5, 1))).toEqual(a);
    expect(a.kind === 'surface-distance' && a.distanceM).toBe(1);
    expect(b.kind === 'surface-distance' && b.distanceM).toBe(1);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(a)).toBe(true);
    if (a.kind === 'surface-distance') {
      expect(Object.isFrozen(a.closestPoint)).toBe(true);
      expect(Object.isFrozen(a.triangle)).toBe(true);
    }
  });

  test('chooses exact-distance ties by original primitive/triangle IDs, not input order', () => {
    const triangles = Array.from({ length: 32 }, (_, i) => face(31 - i));
    const result = prepareHeadSurface(triangles).query(
      identity,
      sphere(0.5, 0.5, 1),
    );
    expect(
      result.kind === 'surface-distance' && result.triangle.triangleIndex,
    ).toBe(0);
    expect(
      prepareHeadSurface(triangles.reverse()).query(
        identity,
        sphere(0.5, 0.5, 1),
      ),
    ).toEqual(result);
  });

  test('reports distance to surface, not solid containment, even inside a closed tetrahedron', () => {
    const a = point(0, 0, 0),
      b = point(2, 0, 0),
      c = point(0, 2, 0),
      d = point(0, 0, 2);
    const triangles: HeadSurfaceTriangle[] = [
      [a, b, c],
      [a, b, d],
      [a, c, d],
      [b, c, d],
    ].map((vertices, triangleIndex) => ({
      primitive: 0,
      triangleIndex,
      vertices: vertices as [typeof a, typeof a, typeof a],
    }));
    const result = prepareHeadSurface(triangles).query(
      identity,
      sphere(0.25, 0.25, 0.25, 0.1),
    );
    expect(result.kind === 'surface-distance' && result.overlap).toBe(false);
    expect(result.kind === 'surface-distance' && result.sphereGapM).toBeCloseTo(
      0.15,
      14,
    );
    const open = prepareHeadSurface(triangles.slice(0, 3)).query(
      identity,
      sphere(1, 1, 1, 0.1),
    );
    expect(open.kind === 'surface-distance' && open.overlap).toBe(false);
  });

  test('rejects empty, duplicate, degenerate, nonfinite and invalid-ID descriptors explicitly', () => {
    expect(() => prepareHeadSurface([])).toThrow('empty');
    expect(() => prepareHeadSurface([face(), face()])).toThrow('duplicate');
    expect(() =>
      prepareHeadSurface([
        { ...face(), vertices: [point(0, 0), point(1, 0), point(2, 0)] },
      ]),
    ).toThrow('degenerate');
    expect(() =>
      prepareHeadSurface([
        {
          ...face(),
          vertices: [point(0, 0), point(1e-200, 0), point(0, 1e-200)],
        },
      ]),
    ).toThrow('degenerate');
    expect(() =>
      prepareHeadSurface([
        { ...face(), vertices: [point(NaN, 0), point(1, 0), point(0, 1)] },
      ]),
    ).toThrow('finite');
    expect(() => prepareHeadSurface([{ ...face(), primitive: -1 }])).toThrow(
      'identity',
    );
  });

  test('rejects malformed untrusted runtime shapes explicitly', () => {
    expect(() => prepareHeadSurface(new Array(1))).toThrow('identity');
    expect(() =>
      prepareHeadSurface([
        { ...face(), vertices: new Array(3) } as unknown as HeadSurfaceTriangle,
      ]),
    ).toThrow('finite');
    const prepared = prepareHeadSurface([face()]);
    expect(
      prepared.query(identity, {
        center: undefined,
        radiusM: 0,
      } as unknown as Parameters<typeof prepared.query>[1]),
    ).toEqual({ kind: 'invalid', reason: 'invalid-sphere' });
    expect(
      prepared.query(undefined as unknown as number[], sphere(0, 0, 0)),
    ).toEqual({ kind: 'invalid', reason: 'invalid-affine-transform' });
  });

  test('accepts representable thin triangles without an epsilon-area threshold', () => {
    const prepared = prepareHeadSurface([
      { ...face(), vertices: [point(0, 0), point(1, 0), point(0, 1e-8)] },
    ]);
    const result = prepared.query(identity, sphere(0, 0, 0));
    expect(result.kind === 'surface-distance' && result.overlap).toBe(true);
  });

  test('invalid transforms/spheres cannot masquerade as successful separation', () => {
    const prepared = prepareHeadSurface([face()]);
    for (const matrix of [
      [],
      identity.slice(1),
      identity.map(() => NaN),
      new Matrix4().makeScale(1, 0, 1).toArray(),
      new Matrix4().makePerspective(-1, 1, 1, -1, 1, 100).toArray(),
    ]) {
      expect(prepared.query(matrix, sphere(0, 0, 0)).kind).toBe('invalid');
    }
    for (const s of [
      sphere(NaN, 0, 0),
      sphere(0, 0, 0, -1),
      sphere(0, 0, 0, Infinity),
    ]) {
      expect(prepared.query(identity, s).kind).toBe('invalid');
    }
    expect(
      prepared.query(
        identity,
        sphere(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE),
      ).kind,
    ).toBe('unresolved');
    expect(prepared.query(identity, sphere(0, 0, 0)).kind).toBe(
      'surface-distance',
    );
  });

  test.each([
    new Matrix4(),
    new Matrix4().makeTranslation(4, -3, 2),
    new Matrix4().makeRotationY(0.8),
    new Matrix4().makeScale(2, 0.7, 3),
    new Matrix4().makeScale(-1, 2, 0.5),
    new Matrix4().makeShear(0.3, 0.2, -0.1, 0.4, 0.1, -0.2),
  ])(
    'matches exhaustive world-triangle queries under affine placement %#',
    (matrix) => {
      const triangles = Array.from({ length: 64 }, (_, i) => ({
        ...face(i, i * 0.25),
        primitive: i % 3,
      }));
      const prepared = prepareHeadSurface(triangles);
      for (let i = 0; i < 20; i++) {
        const center = new Vector3(Math.sin(i) * 3, Math.cos(i) * 2, i * 0.7);
        let best = Infinity;
        for (const t of triangles) {
          const vertices = t.vertices.map((p) =>
            new Vector3(p.x, p.y, p.z).applyMatrix4(matrix),
          );
          const nearest = new Triangle(
            vertices[0]!,
            vertices[1]!,
            vertices[2]!,
          ).closestPointToPoint(center, new Vector3());
          best = Math.min(best, nearest.distanceTo(center));
        }
        const result = prepared.query(matrix.toArray(), {
          center,
          radiusM: 0.2,
        });
        expect(result.kind).toBe('surface-distance');
        if (result.kind !== 'surface-distance') throw new Error(result.reason);
        expect(result.distanceM).toBeCloseTo(best, 12);
        expect(result.sphereGapM).toBeCloseTo(best - 0.2, 12);
        expect(result.overlap).toBe(best <= 0.2);
        expect(result.visitedTriangles).toBeLessThanOrEqual(triangles.length);
      }
    },
  );

  test('reports unresolved when an invertible placement numerically collapses a triangle', () => {
    const placed = new Matrix4().makeTranslation(1e20, 1e20, 1e20).toArray();
    const result = prepareHeadSurface([face()]).query(
      placed,
      sphere(1e20, 1e20, 1e20),
    );
    expect(result.kind).toBe('unresolved');
  });

  test.each([1e-162, 1e-170, Number.MIN_VALUE])(
    'preserves representable separation %s without squaring underflow',
    (z) => {
      const result = prepareHeadSurface([face()]).query(
        identity,
        sphere(0.5, 0.5, z),
      );
      expect(result.kind).toBe('surface-distance');
      if (result.kind !== 'surface-distance') throw new Error(result.reason);
      expect(result.distanceM).toBe(z);
      expect(result.sphereGapM).toBe(z);
      expect(result.overlap).toBe(false);
    },
  );

  test.each([
    [1e-160, 9.99997e-161],
    [1e-162, 5e-163],
    [1 + Number.EPSILON, 1],
  ])('keeps tiny/normal just-separated radii distinct %s %s', (z, radius) => {
    const result = prepareHeadSurface([face()]).query(
      identity,
      sphere(0.5, 0.5, z, radius),
    );
    expect(result.kind).toBe('surface-distance');
    if (result.kind !== 'surface-distance') throw new Error(result.reason);
    expect(result.distanceM).toBe(z);
    expect(result.sphereGapM).toBe(z - radius);
    expect(result.overlap).toBe(false);
  });

  test('supports large representable distances without squaring overflow', () => {
    const result = prepareHeadSurface([face()]).query(
      identity,
      sphere(1e308, 1e308, 1e308),
    );
    expect(result.kind).toBe('surface-distance');
    if (result.kind !== 'surface-distance') throw new Error(result.reason);
    expect(result.distanceM).toBe(Math.hypot(1e308, 1e308, 1e308));
    expect(result.overlap).toBe(false);
  });

  test('keeps tiny distinct distances distinct through hierarchy pruning and ID selection', () => {
    const triangles = Array.from({ length: 32 }, (_, i) => face(i, i * 1e-170));
    const centerZ = 33e-170;
    const result = prepareHeadSurface(triangles).query(
      identity,
      sphere(0.5, 0.5, centerZ),
    );
    expect(result.kind).toBe('surface-distance');
    if (result.kind !== 'surface-distance') throw new Error(result.reason);
    expect(result.triangle.triangleIndex).toBe(31);
    expect(result.distanceM).toBe(centerZ - 31e-170);
    expect(result.overlap).toBe(false);
  });

  test('prunes a separated cluster without discarding the nearest surface', () => {
    const triangles = Array.from({ length: 128 }, (_, i) => face(i, i * 10));
    const result = prepareHeadSurface(triangles).query(
      identity,
      sphere(0.5, 0.5, 1),
    );
    expect(result.kind === 'surface-distance' && result.distanceM).toBe(1);
    expect(
      result.kind === 'surface-distance' && result.visitedTriangles,
    ).toBeLessThan(128);
  });
});
