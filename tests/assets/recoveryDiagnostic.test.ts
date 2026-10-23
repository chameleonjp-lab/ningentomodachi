function required<T>(value: T | undefined): T {
  if (value === undefined) throw Error('Missing test value');
  return value;
}

import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import {
  applyPoseToLayout,
  blendPose,
  capturePose,
  composePoseMatrices,
} from '../../src/assets/poseRecipeMath';
import {
  captureCanonicalQuery,
  captureCanonicalSnapshot,
  createRecoveryDiagnostic,
  sampleRecoveryDiagnostic,
} from '../../src/assets/recoveryDiagnostic';
import {
  actorId,
  attackActivationId,
  clipId,
  createLivingPoseStamp,
  durationMs,
  gameTimeMs,
  runId,
} from '../../src/contracts';

const pose = (x = 0) => [
  { id: 'gltf:54', parent: null, t: [x, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
  {
    id: 'gltf:0',
    parent: 'gltf:54',
    t: [0, 2, 0],
    q: [0, 0, 0, 1],
    s: [1, 1, 1],
  },
];
const stamp = (attack = false) =>
  createLivingPoseStamp({
    version: 1,
    binding: {
      clipId: clipId(attack ? 'KungFuStraight' : 'Idle'),
      durationMs: durationMs(attack ? 1000 : 50),
      sourceBindingId: attack ? 'trusted-attack' : 'trusted-idle',
    },
    mode: attack ? 'attack' : 'idle',
    startedAt: gameTimeMs(attack ? 0 : 1000),
    playback: attack ? 'clamp' : 'loop',
    activationId: attack ? attackActivationId('a1') : null,
  });
const input = () => ({
  runId: runId('r1'),
  actorId: actorId('actor1'),
  outgoing: stamp(true),
  destination: stamp(),
  durationMs: durationMs(150),
  diagnostic: true as const,
  fixedLiftSign: 1 as const,
});
const source = (q: ReturnType<typeof captureCanonicalQuery>) =>
  captureCanonicalSnapshot(
    q,
    q.stamp.mode === 'attack' ? 'grounded-posture-y' : 'full-translation',
    pose(q.clipTime),
    'fixture-hierarchy',
  );
describe('isolated canonical recovery diagnostic', () => {
  test('captures detached deeply frozen TRS', () => {
    const p = pose();
    const c = capturePose(p);
    expect(Object.isFrozen(p[0])).toBe(false);
    required(p[0]).t[0] = 9;
    expect(required(c[0]).t[0]).toBe(0);
    expect(Object.isFrozen(required(c[0]).t)).toBe(true);
  });
  test('exact endpoints preserve source TRS without interpolation', () => {
    expect(blendPose(pose(2), pose(7), 0, 1)).toEqual(pose(2));
    expect(blendPose(pose(2), pose(7), 1, 1)).toEqual(pose(7));
  });
  test('composition includes non-bone ancestor', () => {
    const p = pose(3);
    required(p[0]).q = [0, 0, 1, 0];
    expect(required(composePoseMatrices(p)[1]).matrix.slice(12, 15)).toEqual([
      3, -2, 0,
    ]);
  });
  test.each([
    [1, Number.POSITIVE_INFINITY, 1],
    [0, 0, 0],
    [-1, -1, -1],
  ])('rejects unsupported scale %s', (...s) => {
    const p = pose();
    required(p[0]).s = s;
    expect(() => capturePose(p)).toThrow();
  });
  test('rejects positive-scale composition underflow', () => {
    const p = pose();
    p.forEach((n) => {
      n.s = [1e-200, 1e-200, 1e-200];
    });
    expect(() => composePoseMatrices(p)).toThrow();
  });
  test('rejects invalid quaternion/hierarchy/mismatched topology', () => {
    const p = pose();
    required(p[0]).q = [0, 0, 0, 0];
    expect(() => capturePose(p)).toThrow(
      'predicate=quaternion-norm-positive node="gltf:54" index=0 q=[0,0,0,0] s=[1,1,1]',
    );
    required(p[0]).q = [0, 0, 0, 1];
    required(p[0]).s = [1, 0.9999998211860657, 1];
    expect(capturePose(p)).toEqual(p);
    required(p[0]).s = [-0, 0, 0];
    expect(() => capturePose(p)).toThrow(
      'predicate=scale-positive node="gltf:54" index=0 q=[0,0,0,1] s=[-0,0,0]',
    );
    expect(() => capturePose(pose().reverse())).toThrow();
    expect(() => blendPose(pose(), pose().slice(0, 1), 0.5, 1)).toThrow();
  });
  test('fixed positive lift rejects antipodal quaternion path', () => {
    const p = pose();
    required(p[0]).q = [0, 0, 0, -1];
    expect(() => blendPose(pose(), p, 0.5, 1)).toThrow();
  });
  test('real stamp binding duration and clock provenance retained', () => {
    const r = createRecoveryDiagnostic(input());
    expect(r.startMs).toBe(1000);
    expect(r.endMs).toBe(1150);
    expect(r.destination.binding.sourceBindingId).toBe('trusted-idle');
    expect(r.destination.playback).toBe('loop');
  });
  test('equivalent insertion order has same recipe identity', () => {
    const i = input();
    const a = createRecoveryDiagnostic(i);
    const b = createRecoveryDiagnostic({
      diagnostic: true,
      fixedLiftSign: i.fixedLiftSign,
      durationMs: i.durationMs,
      destination: i.destination,
      outgoing: i.outgoing,
      actorId: i.actorId,
      runId: i.runId,
    });
    expect(a.identity).toBe(b.identity);
  });
  test('source side and loop seam uses real poseClipTime', () => {
    const right = captureCanonicalQuery(stamp(), gameTimeMs(1050), 'right');
    const left = captureCanonicalQuery(stamp(), gameTimeMs(1050), 'left');
    expect(right.clipTime).toBe(0);
    expect(left.clipTime).toBe(50);
  });
  test('start left and right reconstruct outgoing exact endpoint', () => {
    const r = createRecoveryDiagnostic(input());
    for (const side of ['left', 'right'] as const)
      expect(
        sampleRecoveryDiagnostic(r, gameTimeMs(1000), side, source).pose,
      ).toEqual(pose(1000));
  });
  test('end preserves proper destination loop seam side', () => {
    const r = createRecoveryDiagnostic(input());
    expect(
      sampleRecoveryDiagnostic(r, gameTimeMs(1150), 'left', source).pose,
    ).toEqual(pose(50));
    expect(
      sampleRecoveryDiagnostic(r, gameTimeMs(1150), 'right', source).pose,
    ).toEqual(pose(0));
  });
  test('absolute reverse repeat sampling never restarts destination', () => {
    const r = createRecoveryDiagnostic(input());
    const a = sampleRecoveryDiagnostic(r, gameTimeMs(1075), 'right', source);
    expect(a.destinationQuery?.clipTime).toBe(25);
    for (const t of [1150, 1000, 1100, 1075]) {
      const b = sampleRecoveryDiagnostic(r, gameTimeMs(t), 'right', source);
      if (t === 1075) expect(b).toEqual(a);
    }
  });
  test('snapshot accepts legacy full extraction without inventing a policy', () => {
    const q = captureCanonicalQuery(stamp(), gameTimeMs(1000), 'right');
    expect(
      captureCanonicalSnapshot(q, 'full-translation', pose(), 'fixture')
        .rootMode,
    ).toBe('full-translation');
  });
  test('caller source mismatch is rejected', () => {
    const r = createRecoveryDiagnostic(input());
    expect(() =>
      sampleRecoveryDiagnostic(r, gameTimeMs(1075), 'right', (q) =>
        source({ ...q, clipTime: durationMs(1) }),
      ),
    ).toThrow();
  });
  test('invalid recipe/time/side fails before evaluator', () => {
    const r = createRecoveryDiagnostic(input());
    let count = 0;
    expect(() =>
      sampleRecoveryDiagnostic(r, gameTimeMs(999), 'right', (q) => {
        count++;
        return source(q);
      }),
    ).toThrow();
    expect(count).toBe(0);
    expect(() =>
      createRecoveryDiagnostic({ ...input(), durationMs: durationMs(0) }),
    ).toThrow();
    expect(() =>
      createRecoveryDiagnostic({ ...input(), destination: stamp(true) }),
    ).toThrow();
  });
  test('tampered identity rejected before canonical sampling', () => {
    const r = createRecoveryDiagnostic(input());
    let count = 0;
    expect(() =>
      sampleRecoveryDiagnostic(
        { ...r, identity: 'wrong' },
        gameTimeMs(1075),
        'right',
        (q) => {
          count++;
          return source(q);
        },
      ),
    ).toThrow();
    expect(count).toBe(0);
  });
  test('provider failure does not poison later absolute sampling', () => {
    const r = createRecoveryDiagnostic(input());
    expect(() =>
      sampleRecoveryDiagnostic(r, gameTimeMs(1075), 'right', () => {
        throw Error('fail');
      }),
    ).toThrow('fail');
    expect(
      sampleRecoveryDiagnostic(r, gameTimeMs(1075), 'right', source).kind,
    ).toBe('synthetic-recovery');
  });
});
test('zero-dot path keeps the explicit fixed lift rather than canonicalizing', () => {
  const a = pose(),
    b = pose();
  required(a[0]).q = [1, 0, 0, 0];
  required(b[0]).q = [-1, 0, 0, 0];
  expect(blendPose(pose(), a, 0.5, 1)).not.toEqual(
    blendPose(pose(), b, 0.5, 1),
  );
});
test('recipe capture does not freeze or retain caller-owned nested bindings', () => {
  const i = structuredClone(input()),
    r = createRecoveryDiagnostic(i);
  expect(Object.isFrozen(i)).toBe(false);
  expect(Object.isFrozen(i.destination.binding)).toBe(false);
  expect(r.destination.binding).not.toBe(i.destination.binding);
});
test('composition overflow and invalid blend weights fail closed', () => {
  const p = pose();
  p.forEach((n) => {
    n.s = [1e200, 1e200, 1e200];
  });
  expect(() => composePoseMatrices(p)).toThrow();
  for (const weight of [NaN, -0.1, 1.1])
    expect(() => blendPose(pose(), pose(), weight, 1)).toThrow();
});
test('natural completion identity rejects late destination epoch', () => {
  const i = input();
  expect(() =>
    createRecoveryDiagnostic({
      ...i,
      destination: { ...i.destination, startedAt: gameTimeMs(1001) },
    }),
  ).toThrow();
});
test('provider topology drift is rejected before a synthetic pose escapes', () => {
  const r = createRecoveryDiagnostic(input());
  expect(() =>
    sampleRecoveryDiagnostic(r, gameTimeMs(1075), 'right', (q) =>
      captureCanonicalSnapshot(
        q,
        q.stamp.mode === 'attack' ? 'grounded-posture-y' : 'full-translation',
        q.stamp.mode === 'attack' ? pose() : pose().slice(0, 1),
        'fixture',
      ),
    ),
  ).toThrow();
});
test('review regression: sparse quaternion cannot freeze undefined coordinates', () => {
  const p = pose(),
    q = new Array<number>(4);
  q[3] = 1;
  required(p[0]).q = q;
  expect(() => capturePose(p)).toThrow();
});
test('review regression: sparse position cannot freeze undefined coordinates', () => {
  const p = pose(),
    t = new Array<number>(3);
  t[0] = 0;
  required(p[0]).t = t;
  expect(() => capturePose(p)).toThrow();
});
test('review regression: every vector index must be an own finite value', () => {
  for (const field of ['t', 'q', 's'] as const)
    for (let index = 0; index < (field === 'q' ? 4 : 3); index++) {
      const p = pose();
      delete required(p[0])[field][index];
      expect(() => capturePose(p), `${field}[${index}] hole`).toThrow();
    }
});
test('review regression: inherited numeric values do not fill vector holes', () => {
  for (const field of ['t', 'q', 's'] as const)
    for (let index = 0; index < (field === 'q' ? 4 : 3); index++) {
      const p = pose(),
        v = required(p[0])[field],
        prototype = Object.create(Array.prototype);
      prototype[index] = v[index];
      delete v[index];
      Object.setPrototypeOf(v, prototype);
      expect(
        () => capturePose(p),
        `${field}[${index}] inherited hole`,
      ).toThrow();
    }
});
test('review regression: sparse pose node array rejects before any apply can start', () => {
  for (let index = 0; index < 2; index++) {
    const p = pose();
    delete p[index];
    expect(() => capturePose(p), `node ${index} hole`).toThrow();
  }
});
test('review regression: inherited pose node cannot fill a missing own node', () => {
  for (let index = 0; index < 2; index++) {
    const p = pose(),
      prototype = Object.create(Array.prototype);
    prototype[index] = p[index];
    delete p[index];
    Object.setPrototypeOf(p, prototype);
    expect(() => capturePose(p), `node ${index} inherited hole`).toThrow();
  }
});
test('dense own vector controls remain exact and detached', () => {
  const p = pose();
  expect(capturePose(p)).toEqual(p);
  const result = capturePose(p);
  for (const field of ['t', 'q', 's'] as const)
    expect(required(result[0])[field]).not.toBe(required(p[0])[field]);
});
test('quaternion norm must be finite before normalization tolerance', () => {
  const p = pose();
  required(p[0]).q = [Number.MAX_VALUE, Number.MAX_VALUE, 0, 0];
  expect(() => capturePose(p)).toThrow();
  required(p[0]).q = [NaN, 0, 0, 1];
  expect(() => capturePose(p)).toThrow();
});
test('late invalid node and late layout mismatch cause zero diagnostic writes', () => {
  const invalid = pose();
  required(invalid[1]).t = new Array<number>(3);
  const layout = pose().map(({ id, parent }) => ({ id, parent }));
  let writes = 0;
  expect(() =>
    applyPoseToLayout(invalid, layout, () => {
      writes++;
    }),
  ).toThrow();
  expect(writes).toBe(0);
  const sparse = pose();
  delete sparse[1];
  expect(() =>
    applyPoseToLayout(sparse, layout, () => {
      writes++;
    }),
  ).toThrow();
  expect(writes).toBe(0);
  required(layout[1]).id = 'wrong';
  expect(() =>
    applyPoseToLayout(pose(), layout, () => {
      writes++;
    }),
  ).toThrow();
  expect(writes).toBe(0);
});
test('valid diagnostic application writes detached captured nodes after complete validation', () => {
  const p = pose(),
    seen: unknown[] = [];
  applyPoseToLayout(p, p, (n) => {
    seen.push(n);
  });
  expect(seen).toEqual(p);
  expect(seen[0]).not.toBe(p[0]);
  expect(Object.isFrozen(p[0])).toBe(false);
});
test('accessor coordinates are rejected without invoking caller getters', () => {
  for (const field of ['t', 'q', 's'] as const) {
    const p = pose();
    let reads = 0;
    Object.defineProperty(required(p[0])[field], 0, {
      get() {
        reads++;
        return 0;
      },
    });
    expect(() => capturePose(p)).toThrow();
    expect(reads).toBe(0);
  }
});

test('raw nonunit canonical values remain exact and detached', () => {
  const p = pose();
  required(p[0]).q = [-0, 0.2, 0, 1.0000001];
  const captured = capturePose(p);
  expect(captured).toEqual(p);
  expect(Object.is(required(captured[0]).q[0], -0)).toBe(true);
});

test('nonunit hierarchy equals independent Three products, not quaternion shortcut', () => {
  const p = pose();
  required(p[0]).q = [0.3, 0.1, 0, 0.9];
  required(p[1]).q = [0, 0.4, 0.2, 0.8];
  const local = p.map((n) =>
    new Matrix4().compose(
      new Vector3().fromArray(n.t),
      new Quaternion().fromArray(n.q),
      new Vector3().fromArray(n.s),
    ),
  );
  const expected = required(local[0]).clone().multiply(required(local[1]));
  expect(required(composePoseMatrices(p)[1]).matrix).toEqual(
    expected.toArray(),
  );
  const shortcut = new Matrix4().makeRotationFromQuaternion(
    new Quaternion()
      .fromArray(required(p[0]).q)
      .multiply(new Quaternion().fromArray(required(p[1]).q)),
  );
  expect(
    Math.max(
      ...[0, 1, 2, 4, 5, 6, 8, 9, 10].map((i) =>
        Math.abs(
          required(shortcut.elements[i]) - required(expected.elements[i]),
        ),
      ),
    ),
  ).toBeGreaterThan(1e-3);
  for (const weight of [0, 1]) expect(blendPose(p, p, weight, 1)).toEqual(p);
});
test('canonical nonsingular low radius is retained but synthesis is unsupported; singular and late world failure are atomic', () => {
  const p = pose();
  required(p[0]).q = [0, 0, 0, 0.5];
  expect(capturePose(p)).toEqual(p);
  expect(() => blendPose(p, p, 0.5, 1)).toThrow('radius');
  required(p[0]).q = [0.5, 0.5, 0, 0];
  expect(() => capturePose(p)).toThrow('matrix');
  const large = pose();
  large.forEach((n) => {
    n.s = [1e60, 1e60, 1e60];
  });
  let writes = 0;
  expect(() =>
    applyPoseToLayout(large, large, () => {
      writes++;
    }),
  ).toThrow('matrix');
  expect(writes).toBe(0);
});
test('fixed lift is immutable recipe identity; negative lift preserves exact endpoints and matrix limits', () => {
  const positive = createRecoveryDiagnostic(input());
  const negative = createRecoveryDiagnostic({ ...input(), fixedLiftSign: -1 });
  expect(positive.identity).not.toBe(negative.identity);
  expect(Object.isFrozen(negative)).toBe(true);
  const a = pose(),
    b = pose();
  b.forEach((n) => {
    n.q = [0, 0, 0, -1.0000001];
  });
  expect(() => blendPose(a, b, 1, 1)).toThrow('fixed-lift');
  expect(blendPose(a, b, 1, -1)).toEqual(b);
  const near = composePoseMatrices(blendPose(a, b, 1 - 1e-8, -1));
  expect(near).toEqual(composePoseMatrices(b));
  for (const w of [0.2, 0.8, 0.2])
    expect(blendPose(a, b, w, -1)).toEqual(blendPose(a, b, w, -1));
});

test('diagonal raw reported scale is captured exactly without caller mutation', () => {
  const p = pose();
  required(p[0]).s = [0.9999999403953552, 0.9999998807907104, 1];
  const c = capturePose(p);
  expect(c).toEqual(p);
  expect(Object.isFrozen(required(p[0]).s)).toBe(false);
  required(p[0]).s[0] = 2;
  expect(required(c[0]).s[0]).toBe(0.9999999403953552);
  expect(Object.isFrozen(required(c[0]).s)).toBe(true);
});
test('diagonal endpoints remain exact and interpolate componentwise', () => {
  const a = pose(),
    b = pose();
  required(a[0]).s = [1, 2, 3];
  required(b[0]).s = [3, 4, 7];
  expect(blendPose(a, b, 0, 1)).toEqual(a);
  expect(blendPose(a, b, 1, 1)).toEqual(b);
  expect(required(blendPose(a, b, 0.25, 1)[0]).s).toEqual([1.5, 2.5, 4]);
});
test('diagonal rotated nonunit hierarchy matches independent matrix products', () => {
  const p = pose();
  required(p[0]).s = [2, 3, 4];
  required(p[0]).q = [0, 0.2, 0, 0.98];
  required(p[1]).q = [0.3, 0, 0.1, 0.9];
  required(p[1]).s = [0.5, 1, 2];
  const local = p.map((n) =>
    new Matrix4().compose(
      new Vector3().fromArray(n.t),
      new Quaternion().fromArray(n.q),
      new Vector3().fromArray(n.s),
    ),
  );
  expect(required(composePoseMatrices(p)[1]).matrix).toEqual(
    required(local[0]).clone().multiply(required(local[1])).toArray(),
  );
});
test('diagonal parent and rotated child retain world shear without decomposition', () => {
  const p = pose();
  required(p[0]).s = [2, 1, 1];
  required(p[1]).q = new Quaternion()
    .setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4)
    .toArray();
  const m = required(composePoseMatrices(p)[1]).matrix;
  const x = new Vector3().fromArray(m),
    y = new Vector3().fromArray(m, 4);
  expect(Math.abs(x.dot(y))).toBeGreaterThan(1);
  const expected = new Matrix4()
    .makeScale(2, 1, 1)
    .multiply(
      new Matrix4().compose(
        new Vector3(0, 2, 0),
        new Quaternion().fromArray(required(p[1]).q),
        new Vector3(1, 1, 1),
      ),
    );
  expect(m).toEqual(expected.toArray());
});
test('diagonal late world underflow rejects before any write', () => {
  const p = pose();
  p.forEach((n) => {
    n.s = [1e-200, 1, 1];
  });
  expect(capturePose(p)).toEqual(p);
  let writes = 0;
  expect(() =>
    applyPoseToLayout(p, p, () => {
      writes++;
    }),
  ).toThrow('matrix');
  expect(writes).toBe(0);
});
test('diagonal zero negative and positive-determinant reflected scales remain unsupported', () => {
  for (const scale of [
    [0, 1, 2],
    [-1, 2, 3],
    [-1, -2, 3],
    [1, Infinity, 2],
  ]) {
    const p = pose();
    required(p[1]).s = scale;
    let writes = 0;
    expect(() =>
      applyPoseToLayout(p, p, () => {
        writes++;
      }),
    ).toThrow();
    expect(writes).toBe(0);
  }
});

// Stage2 synthetic-only token boundary, no loader or canonical file access.
import {
  createPoseFrameDriver,
  type PoseFrameRequest,
} from '../../src/assets/poseFramePreparation';
const stagedRequest = (revision = 1): PoseFrameRequest => ({
  kind: 'living',
  runId: runId('r1'),
  actorId: actorId('actor1'),
  revision,
  epoch: stamp(),
  at: gameTimeMs(1025),
  side: 'right',
});
describe('synthetic stage2 frame preparation', () => {
  test('prepare captures detached immutable pose and performs zero writes', () => {
    const raw = pose(3),
      writes: unknown[] = [];
    const driver = createPoseFrameDriver(
      () => ({ pose: raw }),
      (r) => writes.push(r),
      () => {},
    );
    const token = driver.prepare(stagedRequest());
    expect(writes).toEqual([]);
    required(raw[0]).t[0] = 99;
    driver.apply(token);
    expect(writes).toMatchObject([{ pose: [{ t: [3, 0, 0] }, {}] }]);
    expect(Object.isFrozen(token)).toBe(true);
  });
  test('foreign token rejected even when identity strings match', () => {
    const make = () =>
      createPoseFrameDriver(
        () => ({ pose: pose() }),
        () => {},
        () => {},
      );
    const a = make(),
      b = make(),
      token = a.prepare(stagedRequest());
    expect(() => b.apply(token)).toThrow();
    expect(() => a.apply({ ...token })).toThrow();
  });
  test('dispose invalidates token and blocks further preparation', () => {
    const d = createPoseFrameDriver(
        () => ({ pose: pose() }),
        () => {},
        () => {},
      ),
      t = d.prepare(stagedRequest());
    d.dispose();
    expect(() => d.apply(t)).toThrow();
    expect(() => d.prepare(stagedRequest())).toThrow();
  });
  test('new successful preparation invalidates older prepared token generations', () => {
    let writes = 0;
    const d = createPoseFrameDriver(
      () => ({ pose: pose() }),
      () => {
        writes++;
      },
      () => {},
    );
    const old = d.prepare(stagedRequest(1)),
      next = d.prepare(stagedRequest(2));
    d.apply(next);
    expect(() => d.apply(old)).toThrow();
    expect(writes).toBe(1);
  });
  test('actor ownership cannot change after application', () => {
    const d = createPoseFrameDriver(
      () => ({ pose: pose() }),
      () => {},
      () => {},
    );
    d.apply(d.prepare(stagedRequest()));
    expect(() =>
      d.prepare({ ...stagedRequest(), actorId: actorId('other') }),
    ).toThrow();
  });
  test('late malformed hierarchy is rejected without writer invocation', () => {
    let writes = 0;
    const raw = pose();
    required(raw[1]).s[2] = 0;
    const d = createPoseFrameDriver(
      () => ({ pose: raw }),
      () => {
        writes++;
      },
      () => {},
    );
    expect(() => d.prepare(stagedRequest())).toThrow();
    expect(writes).toBe(0);
  });
  test('support snapshot is detached and frozen', () => {
    const support = {
      entryLocalMinY: -1,
      currentLocalBounds: {
        min: { x: 0, y: -1, z: 0 },
        max: { x: 1, y: 1, z: 1 },
      },
    };
    let captured: unknown;
    const d = createPoseFrameDriver(
        () => ({ pose: pose(), support }),
        (r) => {
          captured = r.support;
        },
        () => {},
      ),
      t = d.prepare(stagedRequest());
    support.currentLocalBounds.min.y = -99;
    d.apply(t);
    expect(captured).toMatchObject({ currentLocalBounds: { min: { y: -1 } } });
  });
  test('invalid support is rejected before write', () => {
    const d = createPoseFrameDriver(
      () => ({
        pose: pose(),
        support: {
          entryLocalMinY: NaN,
          currentLocalBounds: {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 1, y: 1, z: 1 },
          },
        },
      }),
      () => {
        throw Error('write called');
      },
      () => {},
    );
    expect(() => d.prepare(stagedRequest())).toThrow(
      'Invalid prepared support',
    );
  });
});

import { createRecoveryPoseEpoch } from '../../src/contracts';
import {
  samplePoseEpoch,
  poseEpochIntervals,
} from '../../src/assets/recoveryDiagnostic';
describe('synthetic stage2 shared C epoch adapters', () => {
  test('C identity and source destination clock survive exact endpoint queries', () => {
    const epoch = createRecoveryPoseEpoch(input()),
      queries: ReturnType<typeof captureCanonicalQuery>[] = [];
    const evaluate = (q: ReturnType<typeof captureCanonicalQuery>) => {
      queries.push(q);
      return source(q);
    };
    const start = samplePoseEpoch(epoch, gameTimeMs(1000), 'left', evaluate),
      end = samplePoseEpoch(epoch, gameTimeMs(1150), 'right', evaluate);
    expect(start.recipeIdentity).toBe(epoch.identity);
    expect(end.recipeIdentity).toBe(epoch.identity);
    expect(start.pose).toEqual(pose(1000));
    expect(end.pose).toEqual(pose(0));
    expect(queries.at(-1)?.stamp.startedAt).toBe(1000);
    expect(queries.at(-1)?.clipTime).toBe(0);
  });
  test('shared epoch reverse and repeated sampling is absolute', () => {
    const epoch = createRecoveryPoseEpoch(input()),
      first = samplePoseEpoch(epoch, gameTimeMs(1075), 'left', source);
    samplePoseEpoch(epoch, gameTimeMs(1140), 'right', source);
    expect(samplePoseEpoch(epoch, gameTimeMs(1075), 'left', source)).toEqual(
      first,
    );
  });
  test('synthetic interval is explicitly unresolved with canonical spans split', () => {
    const epoch = createRecoveryPoseEpoch(input()),
      parts = [...poseEpochIntervals(epoch, gameTimeMs(990), gameTimeMs(1175))];
    expect(parts.map((p) => p.kind)).toEqual([
      'canonical',
      'unsupported',
      'canonical',
    ]);
    expect(parts[1]).toMatchObject({
      resolution: 'unresolved',
      from: 1000,
      to: 1150,
      identity: epoch.identity,
    });
  });
  test('fully synthetic interval never becomes a canonical or clear answer', () => {
    const parts = [
      ...poseEpochIntervals(
        createRecoveryPoseEpoch(input()),
        gameTimeMs(1020),
        gameTimeMs(1040),
      ),
    ];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      kind: 'unsupported',
      resolution: 'unresolved',
    });
  });
  test('forged C epoch identity is rejected before any source read', () => {
    let reads = 0;
    const epoch = createRecoveryPoseEpoch(input());
    expect(() =>
      samplePoseEpoch(
        { ...epoch, identity: 'forged' },
        gameTimeMs(1050),
        'right',
        (q) => {
          reads++;
          return source(q);
        },
      ),
    ).toThrow();
    expect(reads).toBe(0);
  });
});

import {
  createMatrixSkinBounds,
  type SkinBoundsPlan,
  type SkinMatrixBinding,
} from '../../src/assets/skinBounds';
const matrixPlan: SkinBoundsPlan = {
  meshes: [
    {
      positions: [1, 2, 3],
      joints: [0, 0, 0, 0],
      weights: [1, 0, 0, 0],
      groups: [
        {
          joints: [0, 0, 0, 0],
          weights: [1, 0, 0, 0],
          points: [new Vector3(1, 2, 3)],
        },
      ],
    },
  ],
  stats: {
    vertices: 1,
    retainedVertices: 1,
    groups: 1,
    exactPlaneTests: 0,
    fallbackGroups: 1,
  },
};
const matrixBinding = (): SkinMatrixBinding => ({
  matrixWorld: new Matrix4(),
  bindMatrix: new Matrix4(),
  bindMatrixInverse: new Matrix4(),
  bones: [{ world: new Matrix4(), inverse: new Matrix4() }],
});
describe('synthetic stage2 shared support matrix binding', () => {
  test('retains full affine product including positive diagonal shear', () => {
    const b = matrixBinding();
    b.matrixWorld.makeRotationY(0.7).scale(new Vector3(2, 3, 4));
    required(b.bones[0]).world.makeRotationX(0.4);
    const expected = new Vector3(1, 2, 3).applyMatrix4(
      new Matrix4().multiplyMatrices(b.matrixWorld, required(b.bones[0]).world),
    );
    const actual = createMatrixSkinBounds(matrixPlan, () => [b]).measure(
      new Matrix4(),
    );
    expect(actual.min).toEqual({ x: expected.x, y: expected.y, z: expected.z });
    expect(actual.max).toEqual(actual.min);
  });
  test('never mutates binding matrices or immutable plan', () => {
    const b = matrixBinding(),
      before = JSON.stringify(b),
      plan = JSON.stringify(matrixPlan);
    createMatrixSkinBounds(matrixPlan, () => [b]).measure(new Matrix4());
    expect(JSON.stringify(b)).toBe(before);
    expect(JSON.stringify(matrixPlan)).toBe(plan);
  });
  test('late malformed binding rejected before result', () => {
    const b = matrixBinding(),
      bad = matrixBinding();
    bad.bindMatrix.elements[12] = Infinity;
    expect(() =>
      createMatrixSkinBounds(
        {
          ...matrixPlan,
          meshes: [
            required(matrixPlan.meshes[0]),
            required(matrixPlan.meshes[0]),
          ],
        },
        () => [b, bad],
      ).measure(new Matrix4()),
    ).toThrow('Invalid support matrix');
  });
  test('sparse matrix elements cannot bypass finite guards', () => {
    const b = matrixBinding();
    Reflect.deleteProperty(b.matrixWorld.elements, '4');
    expect(() =>
      createMatrixSkinBounds(matrixPlan, () => [b]).measure(new Matrix4()),
    ).toThrow('Invalid support matrix');
  });
  test('missing required bone rejects instead of fallback bounds', () => {
    const b = { ...matrixBinding(), bones: [] };
    expect(() =>
      createMatrixSkinBounds(matrixPlan, () => [b]).measure(new Matrix4()),
    ).toThrow('Missing support bone');
  });
  test('layout mismatch rejects rather than partial bounds', () => {
    expect(() =>
      createMatrixSkinBounds(matrixPlan, () => []).measure(new Matrix4()),
    ).toThrow('layout');
  });
});

test('synthetic stage2 R2 fresh historical revision remains replayable in the same actor lifetime', () => {
  const written: number[] = [];
  const d = createPoseFrameDriver(
    () => ({ pose: pose() }),
    (_r, q) => {
      written.push(q.revision);
    },
    () => {},
  );
  d.apply(d.prepare(stagedRequest(2)));
  d.apply(d.prepare(stagedRequest(1)));
  expect(written).toEqual([2, 1]);
});
test('synthetic stage2 R2 applied receipt is consumed even at equal revision', () => {
  const d = createPoseFrameDriver(
      () => ({ pose: pose() }),
      () => {},
      () => {},
    ),
    t = d.prepare(stagedRequest());
  d.apply(t);
  expect(() => d.apply(t)).toThrow('consumed');
  d.apply(d.prepare(stagedRequest()));
});
test('synthetic stage2 R2 superseded receipt rejects before newer receipt application', () => {
  const d = createPoseFrameDriver(
      () => ({ pose: pose() }),
      () => {},
      () => {},
    ),
    t = d.prepare(stagedRequest());
  d.prepare(stagedRequest(0));
  expect(() => d.apply(t)).toThrow('superseded');
});

test('synthetic stage2 R2 failed preparation invalidates older unconsumed receipt', () => {
  let fail = false;
  const d = createPoseFrameDriver(
      () => {
        if (fail) throw Error('bad pose');
        return { pose: pose() };
      },
      () => {},
      () => {},
    ),
    old = d.prepare(stagedRequest());
  fail = true;
  expect(() => d.prepare(stagedRequest())).toThrow('bad pose');
  expect(() => d.apply(old)).toThrow();
});
test('synthetic stage2 R2 writer failure consumes its receipt without claiming rollback', () => {
  let writes = 0;
  const d = createPoseFrameDriver(
      () => ({ pose: pose() }),
      () => {
        writes++;
        throw Error('external writer');
      },
      () => {},
    ),
    t = d.prepare(stagedRequest());
  expect(() => d.apply(t)).toThrow('external writer');
  expect(() => d.apply(t)).toThrow('consumed');
  expect(writes).toBe(1);
});
