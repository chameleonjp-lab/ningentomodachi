import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { decodeMotionAssetJson } from '../../src/assets/motionAssetJson';
import {
  createMotionCatalog,
  type MotionAsset,
} from '../../src/assets/motionCatalog';
import { durationMs } from '../../src/contracts';

type Mutable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer U)[]
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Mutable<T[K]> }
      : T;
function saved(name = 'kungfu-hand-combo-v1') {
  return JSON.parse(
    readFileSync(
      new URL(`./fixtures/${name}/candidate.json.fixture`, import.meta.url),
      'utf8',
    ),
  ) as {
    status: string;
    results: { asset: Mutable<MotionAsset>; acceptance: null }[];
  };
}
function asset(name?: string) {
  return saved(name).results[0]!.asset;
}
const own = (value: unknown) => value as Record<string, unknown>;
function expectFrozen(value: unknown): void {
  if (value && typeof value === 'object') {
    expect(Object.isFrozen(value)).toBe(true);
    for (const nested of Object.values(value)) expectFrozen(nested);
  }
}
for (const name of ['kungfu-hand-combo-v1', 'grounded-kicks-v1']) {
  test(`decodes saved ${name} metadata exactly without qualifying its envelope`, () => {
    const envelope = saved(name),
      before = structuredClone(envelope),
      input = envelope.results[0]!.asset;
    const output = decodeMotionAssetJson(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expectFrozen(output);
    expect(envelope).toEqual(before);
    expect(envelope.status).toBe('DIAGNOSTIC_SOURCE_CANDIDATE_NOT_ACCEPTED');
    expect(envelope.results[0]!.acceptance).toBeNull();
  });
}
test('does not retain or freeze caller references', () => {
  const input = asset(),
    output = decodeMotionAssetJson(input),
    time = output.definition.rootCurve[0]!.position.x;
  input.definition.rootCurve[0]!.position.x += 1;
  expect(output.definition.rootCurve[0]!.position.x).toBe(time);
  expect(Object.isFrozen(input)).toBe(false);
});
test('preserves signed coordinates and native fractional times without adjustment', () => {
  const input = asset();
  input.definition.rootCurve[0]!.position = { x: -0, y: -2, z: 3 };
  const output = decodeMotionAssetJson(input);
  expect(Object.is(output.definition.rootCurve[0]!.position.x, -0)).toBe(true);
  expect(output.definition.durationMs).toBe(input.definition.durationMs);
  expect(output.definition.rootCurve).toEqual(input.definition.rootCurve);
});
test('allows plain null-prototype metadata records', () => {
  const input = asset();
  Object.setPrototypeOf(input, null);
  expect(decodeMotionAssetJson(input)).toEqual(input);
});
test('rejects diagnostic envelope rather than stripping its status or evidence', () =>
  expect(() => decodeMotionAssetJson(saved())).toThrow());
test('does not silently remove an acceptance field attached to the asset', () => {
  const input = asset();
  own(input).acceptance = null;
  expect(() => decodeMotionAssetJson(input)).toThrow();
});
const malformed: readonly [string, (value: Mutable<MotionAsset>) => void][] = [
  [
    'missing top field',
    (x) => {
      delete own(x).ownership;
    },
  ],
  [
    'missing nested field',
    (x) => {
      delete own(x.definition.rootCurve[0]!.position).y;
    },
  ],
  [
    'null record',
    (x) => {
      own(x).definition = null;
    },
  ],
  [
    'wrong array',
    (x) => {
      own(x).shapes = {};
    },
  ],
  [
    'numeric string',
    (x) => {
      own(x.definition).durationMs = '100';
    },
  ],
  [
    'nonfinite coordinate',
    (x) => {
      x.definition.rootCurve[0]!.position.x = Infinity;
    },
  ],
  [
    'unknown category',
    (x) => {
      own(x.definition).category = 'grab';
    },
  ],
  [
    'unknown ownership',
    (x) => {
      own(x.ownership[0]).verticalOwner = 'both';
    },
  ],
  [
    'unknown sampling version',
    (x) => {
      own(x.definition.sampling).version = 2;
    },
  ],
  [
    'invalid definition window',
    (x) => {
      x.definition.impacts[0]!.endMs = durationMs(0);
    },
  ],
  [
    'invalid existing clip brand',
    (x) => {
      own(x.definition).clipId = ' Jab ';
    },
  ],
  [
    'unknown volume variant',
    (x) => {
      own(x.shapes[0]!.keys[0]!.volume).kind = 'box';
    },
  ],
  [
    'sparse array',
    (x) => {
      delete x.definition.rootCurve[0];
    },
  ],
  [
    'array extra property',
    (x) => {
      own(x.shapes).status = 'accepted';
    },
  ],
  [
    'symbol field',
    (x) => {
      Object.defineProperty(x, Symbol('extra'), { value: 1 });
    },
  ],
];
test.each(malformed)(
  'rejects %s without filling or coercion',
  (_name, change) => {
    const input = asset();
    change(input);
    expect(() => decodeMotionAssetJson(input)).toThrow();
  },
);
test('rejects inherited required fields', () => {
  const input = asset();
  const d = Object.create(input.definition) as MotionAsset['definition'];
  own(input).definition = d;
  expect(() => decodeMotionAssetJson(input)).toThrow();
});
test('rejects record accessors without invoking them', () => {
  const input = asset();
  let calls = 0;
  Object.defineProperty(input.definition, 'durationMs', {
    get() {
      calls++;
      return 1;
    },
    enumerable: true,
  });
  expect(() => decodeMotionAssetJson(input)).toThrow();
  expect(calls).toBe(0);
});
test('rejects array index accessors without invoking them', () => {
  const input = asset();
  let calls = 0;
  Object.defineProperty(input.definition.rootCurve, '0', {
    get() {
      calls++;
      return {};
    },
    enumerable: true,
  });
  expect(() => decodeMotionAssetJson(input)).toThrow();
  expect(calls).toBe(0);
});
async function prepare(value: MotionAsset) {
  const catalog = createMotionCatalog(async () => [value]);
  try {
    await catalog.prepare(new AbortController().signal);
    return catalog.list();
  } finally {
    catalog.dispose();
  }
}
test('saved decoded metadata passes existing pure catalog semantics', async () => {
  const input = asset();
  expect(await prepare(decodeMotionAssetJson(input))).toEqual([
    input.definition,
  ]);
});
const semantic: readonly [string, (value: Mutable<MotionAsset>) => void][] = [
  [
    'duplicate shapes',
    (x) => {
      x.shapes.push(structuredClone(x.shapes[0]!));
    },
  ],
  [
    'unresolved impact shape',
    (x) => {
      x.definition.impacts[0]!.shapeId = 'absent';
    },
  ],
  [
    'incomplete shape curve',
    (x) => {
      x.shapes[0]!.keys.pop();
    },
  ],
  [
    'out-of-order shape keys',
    (x) => {
      x.shapes[0]!.keys.reverse();
    },
  ],
  [
    'mixed volume kind',
    (x) => {
      x.shapes[0]!.keys[0]!.volume = {
        kind: 'capsule',
        start: { x: 0, y: 0, z: 0 },
        end: { x: 1, y: 0, z: 0 },
        radiusM: 1,
      };
    },
  ],
  [
    'missing ownership coverage',
    (x) => {
      x.ownership = [];
    },
  ],
];
test.each(semantic)(
  'leaves %s relational rejection to existing catalog',
  async (_name, change) => {
    const input = asset();
    change(input);
    const decoded = decodeMotionAssetJson(input);
    await expect(prepare(decoded)).rejects.toThrow();
  },
);
