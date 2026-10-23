function required<T>(value: T | undefined): T {
  if (value === undefined) throw Error('Missing test value');
  return value;
}

/** Normal-CI source regressions with zero top-level source I/O.
 * No runtime activation or gameplay/art acceptance. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { AnimationMixer, Group, Matrix4, SkinnedMesh, Vector3 } from 'three';
import { expect, test, vi } from 'vitest';
import {
  composePoseMatrices,
  type LocalPose,
} from '../../src/assets/poseRecipeMath';
import {
  type CanonicalPoseQuery,
  type CanonicalPoseSnapshot,
  captureCanonicalQuery,
  createRecoveryDiagnostic,
  sampleRecoveryDiagnostic,
} from '../../src/assets/recoveryDiagnostic';
import {
  actorId,
  clipId,
  createRecoveryPoseEpoch,
  createDefeatPoseStamp,
  presentationTimeMs,
  type PoseEpoch,
  type PoseSampleSide,
  attackActivationId,
  createLivingPoseStamp,
  durationMs,
  gameTimeMs,
  runId,
} from '../../src/contracts';

type Receipt = {
  emit: (marker: string, payload?: unknown) => void;
  path: string;
  records: unknown[];
};
function createReceipt(
  directory: string | undefined,
  kind: 'adapter' | 'consumer' | 'detail' = 'consumer',
): Receipt {
  if (directory !== undefined && (!directory || !isAbsolute(directory)))
    throw Error('Receipt override directory must be absolute');
  if (directory === undefined) {
    const root = resolve('reports');
    mkdirSync(root, { recursive: true });
    directory = mkdtempSync(join(root, 'recovery-'));
  }
  const resolved = realpathSync(directory);
  if (!statSync(resolved).isDirectory())
    throw Error('Receipt target is not a directory');
  const path = join(resolved, `kung-fu-recovery-${kind}.json`);
  if (existsSync(path)) throw Error('Receipt target already exists');
  const records: unknown[] = [];
  return {
    path,
    records,
    emit(marker, payload) {
      const record = JSON.parse(JSON.stringify({ marker, payload }));
      records.push(record);
      // Reporter forwarding is optional; persistence and cleanup must not depend on it.
      try {
        console.info(marker, JSON.stringify(payload));
      } catch {
        /* retained above */
      }
    },
  };
}
function errorRecord(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'NonError', message: String(error) };
}
function reportReceiptFailure(marker: string, error: unknown) {
  try {
    process.stderr.write(`${marker} ${JSON.stringify(errorRecord(error))}\n`);
  } catch {
    /* preserve the primary error if the process output stream also fails */
  }
}
function finishReceipt(
  receipt: Receipt | undefined,
  primary: { error: unknown } | undefined,
  cleanup: () => void,
): void {
  let cleanupFailure: { error: unknown } | undefined;
  let writeFailure: { error: unknown } | undefined;
  if (primary) receipt?.emit('TEST_ERROR', errorRecord(primary.error));
  try {
    cleanup();
  } catch (error) {
    cleanupFailure = { error };
    receipt?.emit('CLEANUP_ERROR', errorRecord(error));
    if (primary) reportReceiptFailure('RECEIPT_CLEANUP_ERROR', error);
  } finally {
    if (receipt) {
      try {
        writeFileSync(
          receipt.path,
          JSON.stringify(receipt.records, null, 2) + '\n',
          {
            encoding: 'utf8',
            flag: 'wx',
          },
        );
      } catch (error) {
        writeFailure = { error };
        reportReceiptFailure('RECEIPT_WRITE_ERROR', error);
      }
    }
  }
  if (primary) throw primary.error;
  if (cleanupFailure) throw cleanupFailure.error;
  if (writeFailure) throw writeFailure.error;
}
const receiptFixture = async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  return {
    fs,
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-receipt-')),
  };
};
test('receipt persists detached raw records and cleanup in UTF8', async () => {
  const { fs, dir } = await receiptFixture();
  const receipt = createReceipt(dir),
    raw = { name: '骨', t: [1, 2, 3] };
  receipt.emit('RAW', raw);
  raw.t[0] = 99;
  finishReceipt(receipt, undefined, () => receipt.emit('CLEANUP_COMPLETE'));
  expect(JSON.parse(fs.readFileSync(receipt.path, 'utf8'))).toEqual([
    { marker: 'RAW', payload: { name: '骨', t: [1, 2, 3] } },
    { marker: 'CLEANUP_COMPLETE' },
  ]);
});
test('receipt override requires absolute existing directory', async () => {
  const { dir } = await receiptFixture();
  expect(() => createReceipt('relative')).toThrow('absolute');
  expect(() => createReceipt(dir + '/absent')).toThrow();
});
test('receipt preflight and exclusive write never overwrite', async () => {
  const { fs, dir } = await receiptFixture();
  const receipt = createReceipt(dir);
  fs.writeFileSync(receipt.path, 'preserved', { flag: 'wx' });
  expect(() => createReceipt(dir)).toThrow('exists');
  expect(() => finishReceipt(receipt, undefined, () => {})).toThrow();
  expect(fs.readFileSync(receipt.path, 'utf8')).toBe('preserved');
});
test('receipt retains primary test failure through cleanup failure', async () => {
  const { fs, dir } = await receiptFixture();
  const receipt = createReceipt(dir),
    primary = new Error('primary');
  let caught: unknown;
  try {
    finishReceipt(receipt, { error: primary }, () => {
      throw Error('cleanup');
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(primary);
  expect(JSON.parse(fs.readFileSync(receipt.path, 'utf8'))).toEqual([
    { marker: 'TEST_ERROR', payload: { name: 'Error', message: 'primary' } },
    { marker: 'CLEANUP_ERROR', payload: { name: 'Error', message: 'cleanup' } },
  ]);
});
test('receipt surfaces write failure without replacing primary', async () => {
  const { fs, dir } = await receiptFixture();
  const receipt = createReceipt(dir),
    primary = new Error('primary');
  fs.writeFileSync(receipt.path, 'preserved', { flag: 'wx' });
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  try {
    let caught: unknown;
    try {
      finishReceipt(receipt, { error: primary }, () => {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(primary);
    expect(stderr.mock.calls.flat().join('')).toContain('RECEIPT_WRITE_ERROR');
  } finally {
    stderr.mockRestore();
  }
});
test('receipt propagates cleanup failure after persistence', async () => {
  const { fs, dir } = await receiptFixture();
  const receipt = createReceipt(dir),
    failure = new Error('cleanup');
  expect(() =>
    finishReceipt(receipt, undefined, () => {
      throw failure;
    }),
  ).toThrow(failure);
  expect(JSON.parse(fs.readFileSync(receipt.path, 'utf8'))).toHaveLength(1);
});

test('receipt survives a throwing reporter during primary and cleanup errors', async () => {
  const { fs, dir } = await receiptFixture();
  const receipt = createReceipt(dir),
    primary = new Error('primary');
  const reporter = vi.spyOn(console, 'info').mockImplementation(() => {
    throw Error('reporter');
  });
  let cleaned = false,
    caught: unknown;
  try {
    try {
      finishReceipt(receipt, { error: primary }, () => {
        cleaned = true;
        throw Error('cleanup');
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(primary);
    expect(cleaned).toBe(true);
    expect(JSON.parse(fs.readFileSync(receipt.path, 'utf8'))).toHaveLength(2);
  } finally {
    reporter.mockRestore();
  }
});
test('receipt default creates fresh report-owned directories with distinct filenames', () => {
  const adapter = createReceipt(undefined, 'adapter');
  const consumer = createReceipt(undefined, 'consumer');
  expect(adapter.path).toContain('/reports/recovery-');
  expect(consumer.path).toContain('/reports/recovery-');
  expect(adapter.path).toMatch(/kung-fu-recovery-adapter.json$/);
  expect(consumer.path).toMatch(/kung-fu-recovery-consumer.json$/);
  expect(adapter.path).not.toBe(consumer.path);
  finishReceipt(adapter, undefined, () => {});
  finishReceipt(consumer, undefined, () => {});
});
test('receipt explicit directory supports distinct adapter and consumer without overwrite', async () => {
  const { fs, dir } = await receiptFixture();
  const adapter = createReceipt(dir, 'adapter');
  const consumer = createReceipt(dir, 'consumer');
  expect(adapter.path).not.toBe(consumer.path);
  finishReceipt(adapter, undefined, () => {});
  finishReceipt(consumer, undefined, () => {});
  expect(fs.readdirSync(dir).sort()).toEqual([
    'kung-fu-recovery-adapter.json',
    'kung-fu-recovery-consumer.json',
  ]);
});
test('receipt is hashed and copied by the actual CI integration artifact step', async () => {
  const { fs, dir } = await receiptFixture();
  const { parse } = await import('yaml');
  const { execFileSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const workflow = parse(
    fs.readFileSync('.github/workflows/ci.yml', 'utf8'),
  ) as {
    jobs: Record<string, { steps: { name?: string; run?: string }[] }>;
  };
  const step = required(
    required(workflow.jobs['ci-integration']).steps.find(
      (value) => value.name === 'Record exact-SHA evidence',
    )?.run,
  );
  const script = required(step.match(/<<'NODE'\n([\s\S]*?)\nNODE/)?.[1]);
  const reportDir = join(dir, 'reports', 'recovery-synthetic');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.copyFileSync('package-lock.json', join(dir, 'package-lock.json'));
  for (const kind of ['adapter', 'consumer'] as const) {
    const receipt = createReceipt(reportDir, kind);
    receipt.emit('SYNTHETIC_ONLY', { kind });
    finishReceipt(receipt, undefined, () => receipt.emit('CLEANUP_COMPLETE'));
  }
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: dir,
    env: {
      ...process.env,
      GITHUB_WORKSPACE: process.cwd(),
      CHECK_NAME: 'ci-integration',
      CHECK_RESULT: 'success',
    },
    timeout: 5000,
  });
  const manifest = JSON.parse(
    fs.readFileSync(join(dir, 'reports/manifest.json'), 'utf8'),
  ) as {
    files: { path: string; sha256: string }[];
  };
  for (const kind of ['adapter', 'consumer']) {
    const path = `reports/recovery-synthetic/kung-fu-recovery-${kind}.json`;
    const bytes = fs.readFileSync(join(dir, path));
    expect(manifest.files.find((file) => file.path === path)?.sha256).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(fs.readFileSync(join(dir, 'ci-evidence', path))).toEqual(bytes);
  }
});

test(
  'canonical recovery adapter 24-query source regression',
  () => runSource('adapter'),
  60_000,
);
test(
  'coherent recovery consumer 62-unit source regression',
  () => runSource('consumer'),
  60_000,
);
if (process.env.KUNG_FU_RECOVERY_CAPTURE_DETAIL === '1') {
  test(
    'manual outgoing capture detail only',
    () => runSource('detail'),
    60_000,
  );
}
async function runSource(mode: 'adapter' | 'consumer' | 'detail') {
  const consumerMode = mode === 'consumer';
  const captureDetailOnly = mode === 'detail';
  const receipt = createReceipt(process.env.KUNG_FU_RECOVERY_RECEIPT_DIR, mode);
  const emit = (marker: string, payload?: unknown) => {
    if (receipt)
      receipt.emit(
        marker,
        typeof payload === 'string' ? JSON.parse(payload) : payload,
      );
    else console.info(marker, payload);
  };
  let primary: { error: unknown } | undefined;
  let cleanup = () => {};
  try {
    emit('SOURCE_ADMISSION', {
      mode,
      plannedUnits: consumerMode ? 62 : captureDetailOnly ? 1 : 24,
      hardCap: consumerMode ? 64 : captureDetailOnly ? 1 : 24,
      onePack: true,
      oneVisibleActor: true,
    });
    const runStarted = performance.now();
    let preparationElapsedMs = 0,
      consumerDisposedCheck: (() => void) | undefined;
    // Every file read, provider creation and source query remains inside the gate.
    const { readFileSync } = await import('node:fs');
    const { createPinnedDerivedThreeAssetPack } = await import(
      '../../src/assets'
    );
    const { preparePinnedSourceHead } = await import(
      '../../src/assets/headSurface'
    );
    const { loadKungFuStraightDiagnostics, KUNG_FU_STRAIGHT_SOURCE_PINS } =
      await import('../../tools/assets/kungFuStraightDiagnostic');
    const entries = loadKungFuStraightDiagnostics({
      sourceBytes: readFileSync(KUNG_FU_STRAIGHT_SOURCE_PINS.sourcePath),
      manifestBytes: readFileSync(KUNG_FU_STRAIGHT_SOURCE_PINS.manifestPath),
      recipeBytes: readFileSync(
        'tests/assets/fixtures/kungfu-straight-v1/recipe.json.fixture',
      ),
      candidateBytes: readFileSync(
        'tests/assets/fixtures/kungfu-straight-v1/candidate.json.fixture',
      ),
    });
    const bytes = readFileSync(
        'public/game-assets/android/derived-pack-v1.glb',
      ),
      rootPolicies = entries.map((e) => e.rootPolicy),
      artifactBytes = readFileSync(
        'public/game-assets/android/runtime-artifact-v1.json',
      );
    const controller = new AbortController();
    const preparationTimer = setTimeout(() => controller.abort(), 30_000);
    let pack:
      | Awaited<ReturnType<typeof createPinnedDerivedThreeAssetPack>>
      | undefined;
    let numeric:
      | Awaited<ReturnType<typeof preparePinnedSourceHead>>
      | undefined;
    let rig:
      | ReturnType<
          Awaited<
            ReturnType<typeof createPinnedDerivedThreeAssetPack>
          >['create']
        >
      | undefined;
    cleanup = () => {
      clearTimeout(preparationTimer);
      controller.abort();
      rig?.node.removeFromParent();
      rig?.dispose();
      numeric?.dispose();
      pack?.dispose();
      if (captureDetailOnly) emit('CAPTURE_DETAIL_CLEANUP_COMPLETE');
      consumerDisposedCheck?.();
      emit(
        mode === 'consumer'
          ? 'CONSUMER_CLEANUP_COMPLETE'
          : mode === 'adapter'
            ? 'ADAPTER_CLEANUP_COMPLETE'
            : 'DETAIL_CLEANUP_COMPLETE',
      );
    };
    {
      pack = await createPinnedDerivedThreeAssetPack({
        derivedBytes: bytes,
        artifactBytes,
        rootPolicies,
        signal: controller.signal,
      });
      numeric = await preparePinnedSourceHead({
        derivedBytes: bytes,
        rootPolicies,
        signal: controller.signal,
      });
      clearTimeout(preparationTimer);
      preparationElapsedMs = performance.now() - runStarted;
      rig = pack.create('white');
      // Fixed existing finite-composition fixture, not fitted to a target/source result.
      const physicalParent = new Group();
      physicalParent.position.set(0.7, 2, -0.8);
      physicalParent.rotation.y = 0.43;
      physicalParent.add(rig.node);
      const updateAttached = () => {
        // updateMatrixWorld (not only updateWorldMatrix) refreshes attached-mode
        // SkinnedMesh.bindMatrixInverse before any skinned observation.
        physicalParent.updateMatrixWorld(true);
        required(rig).node.traverse((part) => {
          if (part instanceof SkinnedMesh) part.skeleton.update();
        });
      };
      updateAttached();
      const physicalSnapshot = () => ({
        position: physicalParent.position.toArray(),
        quaternion: physicalParent.quaternion.toArray(),
        scale: physicalParent.scale.toArray(),
        matrix: physicalParent.matrix.toArray(),
        matrixWorld: physicalParent.matrixWorld.toArray(),
      });
      const fixedPhysical = physicalSnapshot();
      const b = rig.recoveryDiagnostic,
        n = numeric.recoveryDiagnostic;
      if (!b || !n) throw Error('Missing diagnostic capabilities');
      const attack = pack.poseBindings?.clips.find(
          (v) => v.clipId === 'KungFuStraight',
        ),
        idle = pack.poseBindings?.clips.find((v) => v.clipId === 'Idle');
      if (!attack || !idle) throw Error('Missing authentic bindings');
      for (const binding of [attack, idle])
        expect(
          numeric.poseBindings.clips.find((v) => v.clipId === binding.clipId),
        ).toEqual(binding);
      const outgoing = createLivingPoseStamp({
        version: 1,
        binding: attack,
        mode: 'attack',
        startedAt: gameTimeMs(0),
        playback: 'clamp',
        activationId: attackActivationId('recovery-diagnostic:attack'),
      });
      if (captureDetailOnly) {
        let attempted = 0,
          completed = 0;
        try {
          // Exactly one outgoing B capture; no recipe or destination/numeric query.
          attempted++;
          const snapshot = b.sampleCanonical(
            captureCanonicalQuery(
              outgoing,
              gameTimeMs(attack.durationMs),
              'left',
            ),
          );
          completed++;
          emit(
            'CAPTURE_DETAIL_SUCCESS',
            JSON.stringify({
              nodes: snapshot.pose.length,
              query: snapshot.query,
            }),
          );
        } finally {
          emit(
            'CAPTURE_DETAIL_COUNTS',
            JSON.stringify({
              attempted,
              completed,
              destination: 0,
              numeric: 0,
              apply: 0,
            }),
          );
        }
        return;
      }
      const destination = createLivingPoseStamp({
        version: 1,
        binding: idle,
        mode: 'idle',
        startedAt: gameTimeMs(attack.durationMs),
        playback: 'loop',
        activationId: null,
      });
      if (consumerMode) {
        const epoch = createRecoveryPoseEpoch({
          runId: runId('recovery-diagnostic'),
          actorId: actorId('recovery-diagnostic:actor'),
          outgoing,
          destination,
        });
        const driver = required(rig.poseFrame),
          visible = rig,
          headProvider = numeric;
        let bAttempted = 0,
          bCompleted = 0,
          hReserved = 0,
          hPublicCompleted = 0,
          hDirectAttempted = 0,
          hDirectCompleted = 0,
          applies = 0,
          revision = 0;
        const rows: unknown[] = [];
        let rowCosts: Record<string, number> = {};
        const budget = () => {
          if (bAttempted + hReserved > 64)
            throw Error('Hard64 evaluation cap exceeded');
        };
        const originalUpdate = AnimationMixer.prototype.update;
        const updateSpy = vi
          .spyOn(AnimationMixer.prototype, 'update')
          .mockImplementation(function (this: AnimationMixer, delta: number) {
            bAttempted++;
            budget();
            const value = originalUpdate.call(this, delta);
            bCompleted++;
            return value;
          });
        try {
          emit(
            'CONSUMER_ADMISSION',
            JSON.stringify({
              epoch,
              rootPolicies,
              parent: fixedPhysical,
              hAccounting:
                'static reservations, not observed canonical completions',
              plannedUnits: 62,
              hardCap: 64,
            }),
          );
          const reserveH = (reads: number) => {
            hReserved += reads;
            budget();
          };
          let snapshotSequence = 0;
          const locals = (label = 'visible local snapshot') => {
            const result: {
              index: number;
              name: string;
              type: string;
              t: number[];
              q: number[];
              s: number[];
            }[] = [];
            visible.node.traverse((part) => {
              result.push({
                index: result.length,
                name: part.name,
                type: part.type,
                t: part.position.toArray(),
                q: part.quaternion.toArray(),
                s: part.scale.toArray(),
              });
            });
            emit(
              'CONSUMER_RAW_SNAPSHOT',
              JSON.stringify({
                sequence: ++snapshotSequence,
                label,
                nodes: result,
              }),
            );
            return result;
          };
          const renderedMatrices = (label: string) => {
            const inverse = new Matrix4()
              .copy(visible.node.matrixWorld)
              .invert();
            const nodes: { index: number; name: string; matrix: number[] }[] =
              [];
            visible.node.traverse((part) => {
              nodes.push({
                index: nodes.length,
                name: part.name,
                matrix: new Matrix4()
                  .multiplyMatrices(inverse, part.matrixWorld)
                  .toArray(),
              });
            });
            emit(
              'CONSUMER_RENDERED_SNAPSHOT',
              JSON.stringify({
                label,
                basis: 'actor-local world matrix',
                nodes,
                physicalParent: physicalSnapshot(),
              }),
            );
            return nodes;
          };
          const meshes: SkinnedMesh[] = [];
          visible.node.traverse((part) => {
            if (part instanceof SkinnedMesh) meshes.push(part);
          });
          const mesh = required(meshes[headProvider.descriptor.meshIndex]),
            headBone = required(
              mesh.skeleton.bones[headProvider.descriptor.headJointIndex],
            );
          required(
            mesh.skeleton.boneInverses[headProvider.descriptor.headJointIndex],
          ).elements.forEach((value, index) => {
            expect(
              Math.abs(
                value -
                  required(headProvider.descriptor.headBoneInverse[index]),
              ),
            ).toBeLessThan(1e-10);
          });
          const adjustment = new Matrix4()
            .fromArray(headProvider.descriptor.headAttachmentAtBind)
            .invert()
            .multiply(
              new Matrix4().fromArray(
                headProvider.descriptor.referenceToActorAtBind,
              ),
            );
          const displayedHead = () =>
            new Matrix4()
              .copy(visible.node.matrixWorld)
              .invert()
              .multiply(headBone.matrixWorld)
              .multiply(adjustment)
              .toArray();
          const parity = (
            sample: ReturnType<typeof headProvider.epochDiagnostic.point>,
          ) => {
            if (sample.kind !== 'transform')
              throw Error(`Unsupported numeric sample: ${sample.reason}`);
            displayedHead().forEach((value, index) => {
              expect(
                Math.abs(value - required(sample.matrix[index])),
              ).toBeLessThan(1e-10);
            });
          };
          const record = (
            name: string,
            bBefore: number,
            hBefore: number,
            bExpected: number,
            hExpected: number,
            started: number,
          ) => {
            expect(bAttempted - bBefore).toBe(bExpected);
            expect(hReserved - hBefore).toBe(hExpected);
            expect(physicalSnapshot()).toEqual(fixedPhysical);
            rows.push({
              name,
              bObserved: bAttempted - bBefore,
              hReserved: hReserved - hBefore,
              elapsedMs: performance.now() - started,
              aggregate: bAttempted + hReserved,
              ...rowCosts,
            });
            emit('CONSUMER_ROW', JSON.stringify(rows.at(-1)));
            rowCosts = {};
          };
          let outgoingEndpoint: ReturnType<typeof locals> | undefined,
            interiorRepeat: ReturnType<typeof locals> | undefined;
          // Row1: unchanged visible canonical path, then same-clock private canonical oracle.
          // Only the private canonical/recovery pair has an exact local-TRS oracle.
          {
            const started = performance.now(),
              bb = bAttempted,
              hh = hReserved;
            required(visible.seekPose).call(visible, attack, attack.durationMs);
            updateAttached();
            const defaultLocals = locals('1 default canonical outgoing');
            const defaultMatrices = renderedMatrices(
              '1 default canonical outgoing',
            );
            reserveH(1);
            hDirectAttempted++;
            const raw = n.sampleCanonical(
              captureCanonicalQuery(outgoing, epoch.startMs, 'left'),
            );
            hDirectCompleted++;
            const numericSample = {
              kind: 'transform' as const,
              matrix: n.matrix(raw.pose),
              numerics: 'cpu-float64-not-certified' as const,
            };
            parity(numericSample);
            const parentBefore = physicalSnapshot();
            const command = driver.prepare({
              kind: 'living',
              runId: epoch.runId,
              actorId: epoch.actorId,
              revision: ++revision,
              epoch: outgoing,
              at: epoch.startMs,
              side: 'left',
            });
            expect(locals('1 after private canonical preparation')).toEqual(
              defaultLocals,
            );
            expect(physicalSnapshot()).toEqual(parentBefore);
            driver.apply(command);
            applies++;
            updateAttached();
            outgoingEndpoint = locals(
              '1 private canonical outgoing exact-start oracle',
            );
            const privateMatrices = renderedMatrices(
              '1 private canonical outgoing',
            );
            expect(privateMatrices).toHaveLength(defaultMatrices.length);
            privateMatrices.forEach((node, index) => {
              const expected = required(defaultMatrices[index]);
              expect({ index: node.index, name: node.name }).toEqual({
                index: expected.index,
                name: expected.name,
              });
              node.matrix.forEach((value, component) => {
                expect(
                  Math.abs(value - required(expected.matrix[component])),
                ).toBeLessThan(1e-10);
              });
            });
            expect(physicalSnapshot()).toEqual(parentBefore);
            parity(numericSample); // Reuse the same independent H result, no extra source query.
            record(
              '1 default and private canonical endpoint',
              bb,
              hh,
              4,
              1,
              started,
            );
          }
          const livingRows: readonly [
            string,
            PoseEpoch,
            number,
            PoseSampleSide,
            number,
            number,
          ][] = [
            ['2 recovery start', epoch, epoch.startMs, 'left', 2, 1],
            ['3 recovery interior75', epoch, epoch.startMs + 75, 'right', 4, 2],
            ['4 recovery end', epoch, epoch.endMs, 'right', 4, 2],
            ['5 recovery reverse25', epoch, epoch.startMs + 25, 'right', 4, 2],
            ['6 recovery repeat75', epoch, epoch.startMs + 75, 'right', 4, 2],
            [
              '7 cancellation exact start',
              destination,
              epoch.startMs,
              'right',
              2,
              1,
            ],
            [
              '8 cancellation interior',
              createLivingPoseStamp({
                ...destination,
                startedAt: gameTimeMs(epoch.startMs + 75),
              }),
              epoch.startMs + 75,
              'right',
              2,
              1,
            ],
          ];
          for (const [
            name,
            selected,
            at,
            side,
            bExpected,
            hExpected,
          ] of livingRows) {
            const started = performance.now(),
              bb = bAttempted,
              hh = hReserved,
              before = locals(name + ' before preparation'),
              parentBefore = physicalSnapshot();
            const command = driver.prepare({
              kind: 'living',
              runId: epoch.runId,
              actorId: epoch.actorId,
              revision: ++revision,
              epoch: selected,
              at: gameTimeMs(at),
              side,
            });
            rowCosts.privatePrepareMs = performance.now() - started;
            expect(locals(name + ' after preparation')).toEqual(before);
            expect(physicalSnapshot()).toEqual(parentBefore);
            const applyStarted = performance.now();
            driver.apply(command);
            rowCosts.applyMs = performance.now() - applyStarted;
            applies++;
            updateAttached();
            reserveH(hExpected);
            const numericSample = headProvider.epochDiagnostic.point(
              selected,
              gameTimeMs(at),
              side,
            );
            hPublicCompleted++;
            const appliedLocals = locals(name + ' applied');
            parity(numericSample);
            if (name.startsWith('2 '))
              expect(appliedLocals).toEqual(outgoingEndpoint);
            if (name.startsWith('3 ')) interiorRepeat = appliedLocals;
            if (name.startsWith('6 '))
              expect(appliedLocals).toEqual(interiorRepeat);
            record(name, bb, hh, bExpected, hExpected, started);
          }
          for (const [name, at, bExpected, hExpected] of [
            ['9 death start', epoch.startMs, 5, 1],
            ['10 death interior', epoch.startMs + 75, 7, 2],
            ['11 death end', epoch.endMs, 7, 2],
          ] as const) {
            const started = performance.now(),
              bb = bAttempted,
              hh = hReserved,
              before = locals(name + ' before preparation');
            const input = {
              runId: epoch.runId,
              actorId: epoch.actorId,
              defeatStartedAt: presentationTimeMs(2000),
              deathClipId: clipId('DefeatPunch'),
              deathClipTime: durationMs(0),
              entry: {
                kind: 'recovery' as const,
                epoch,
                at: gameTimeMs(at),
                sampleSide: 'left' as const,
              },
            };
            const command = driver.prepare({
              kind: 'defeat',
              runId: epoch.runId,
              actorId: epoch.actorId,
              revision: ++revision,
              input,
            });
            rowCosts.privatePrepareIncludingSupportMs =
              performance.now() - started;
            expect(locals(name + ' after preparation')).toEqual(before);
            const applyStarted = performance.now();
            driver.apply(command);
            rowCosts.applyMs = performance.now() - applyStarted;
            applies++;
            updateAttached();
            reserveH(hExpected);
            const numericSample = headProvider.epochDiagnostic.entry(
              createDefeatPoseStamp({
                kind: 'defeat',
                entry: epoch,
                entryAt: gameTimeMs(at),
                defeatStartedAt: input.defeatStartedAt,
              }),
            );
            hPublicCompleted++;
            locals(name + ' applied');
            parity(numericSample);
            const oracleStarted = performance.now();
            const support = required(visible.defeatPoseSupport?.()),
              inverse = new Matrix4().copy(visible.node.matrixWorld).invert(),
              point = new Vector3(),
              min = new Vector3(Infinity, Infinity, Infinity),
              max = new Vector3(-Infinity, -Infinity, -Infinity);
            for (const surface of meshes) {
              const positions = surface.geometry.getAttribute('position');
              for (let i = 0; i < positions.count; i++) {
                point.fromBufferAttribute(positions, i);
                surface
                  .applyBoneTransform(i, point)
                  .applyMatrix4(surface.matrixWorld)
                  .applyMatrix4(inverse);
                min.min(point);
                max.max(point);
              }
            }
            for (const key of ['x', 'y', 'z'] as const) {
              expect(
                Math.abs(support.currentLocalBounds.min[key] - min[key]),
              ).toBeLessThan(1e-10);
              expect(
                Math.abs(support.currentLocalBounds.max[key] - max[key]),
              ).toBeLessThan(1e-10);
            }
            rowCosts.allVertexSupportOracleMs =
              performance.now() - oracleStarted;
            record(name, bb, hh, bExpected, hExpected, started);
          }
          const beforeControls = bAttempted + hReserved;
          expect(headProvider.epochDiagnostic.postDefeat()).toEqual({
            kind: 'unsupported',
            reason: 'post-defeat',
            resolution: 'unresolved',
          });
          expect([
            ...headProvider.epochDiagnostic.intervals(
              epoch,
              gameTimeMs(epoch.startMs + 1),
              gameTimeMs(epoch.endMs - 1),
            ),
          ]).toMatchObject([{ kind: 'unsupported', resolution: 'unresolved' }]);
          const { createActorAnimator } = await import(
            '../../src/assets/actorAnimator'
          );
          const { state, viewport } = await import('../world/fixtures');
          const { RECOVERY_FRAME_CAPABILITY } = await import(
            '../../src/assets/poseFramePreparation'
          );
          const snapshot = state(1, { runId: epoch.runId }),
            ids = snapshot.actors.map((a) => a.actorId),
            beforeInvalid = locals();
          const animator = createActorAnimator(
            {
              runId: epoch.runId,
              seed: 1,
              posePolicy: {
                version: 1,
                mode: 'deterministic-pose-v1',
                recovery: RECOVERY_FRAME_CAPABILITY,
              },
              viewport: { read: () => viewport, subscribe: () => () => {} },
              renderHost: {
                runId: epoch.runId,
                mountActor() {
                  throw Error('Unexpected mount');
                },
              },
            },
            {
              poseBindings: required(pack.poseBindings),
              recoveryCapability: RECOVERY_FRAME_CAPABILITY,
              locomotionClips: required(pack.poseBindings).locomotion,
              clipDuration: pack.clipDuration,
              create() {
                throw Error('Unexpected actor creation');
              },
              stageActor() {
                throw Error('Unexpected actor staging');
              },
            },
          );
          try {
            expect(() =>
              animator.render({
                snapshot: { ...snapshot, residentActorIds: ids },
                spatial: {
                  runId: epoch.runId,
                  tick: snapshot.clocks.tick,
                  actors: snapshot.actors.map((a, i) => ({
                    actorId: a.actorId,
                    position: { x: 0, y: 0, z: 0 },
                    facing: { x: 0, y: 0, z: 1 },
                    velocity: { x: 0, y: 0, z: 0 },
                    grounded: true,
                    locomotion: 'idle' as const,
                    pose: {
                      kind: 'living' as const,
                      living: createLivingPoseStamp({
                        ...destination,
                        startedAt: gameTimeMs(0),
                        binding:
                          i === 0
                            ? idle
                            : {
                                ...idle,
                                sourceBindingId:
                                  'deliberately-invalid-late-binding',
                              },
                      }),
                    },
                  })),
                  vehicles: [],
                },
                events: [],
                viewport,
              }),
            ).toThrow('Unprepared pose source binding');
          } finally {
            animator.dispose();
          }
          expect(locals()).toEqual(beforeInvalid);
          expect(bAttempted + hReserved).toBe(beforeControls);
          const artifact = JSON.parse(artifactBytes.toString()) as {
            support: import('../../src/assets/skinBoundsArtifact').SkinBoundsArtifact;
          };
          let nodes = 0;
          visible.node.traverse(() => {
            nodes++;
          });
          const vertices = meshes.reduce(
              (sum, surface) =>
                sum + surface.geometry.getAttribute('position').count,
              0,
            ),
            supportNumericBytes = artifact.support.meshes.reduce(
              (sum, m) =>
                sum +
                (11 * m.vertexCount +
                  m.groups.reduce(
                    (n, g) =>
                      n +
                      g.joints.length +
                      g.weights.length +
                      g.indices.length * 3,
                    0,
                  )) *
                  8,
              0,
            );
          expect(vertices).toBe(artifact.support.stats.vertices);
          expect(nodes).toBeGreaterThan(0);
          expect(meshes.length).toBe(artifact.support.meshes.length);
          emit(
            'CONSUMER_RESOURCES',
            JSON.stringify({
              packs: 1,
              visibleActors: 1,
              maximumVisibleActors: 1,
              nodes,
              vertices,
              retainedSupportPoints: artifact.support.stats.retainedVertices,
              transformNumericBytes: nodes * 336,
              frameTRSNumericBytes: (nodes - 1) * 80,
              supportNumericBytes,
              preparationElapsedMs,
              processHeapUsedBytes: process.memoryUsage().heapUsed,
              heapIncludesUnattributedJSAndMixer: true,
              existingOfflineSupportCacheMaxKeys: 4,
              cacheRedesign: false,
            }),
          );
          expect(bAttempted).toBe(45);
          expect(bCompleted).toBe(45);
          expect(hReserved).toBe(17);
          expect(applies).toBe(11);
          expect(rows).toHaveLength(11);
          consumerDisposedCheck = () => {
            expect(() =>
              driver.prepare({
                kind: 'living',
                runId: epoch.runId,
                actorId: epoch.actorId,
                revision: 99,
                epoch,
                at: epoch.startMs,
                side: 'left',
              }),
            ).toThrow('disposed');
            expect(
              headProvider.epochDiagnostic.point(epoch, epoch.startMs, 'left'),
            ).toEqual({ kind: 'unavailable', reason: 'disposed' });
          };
        } finally {
          updateSpy.mockRestore();
          emit(
            'CONSUMER_COUNTS',
            JSON.stringify({
              bAttempted,
              bCompleted,
              hReserved,
              hPublicCompleted,
              hDirectAttempted,
              hDirectCompleted,
              applies,
              rowsCompleted: rows.length,
              aggregateReserved: bAttempted + hReserved,
              hardCap: 64,
              plannedMax: 62,
              spareNotRetryBudget: 2,
            }),
          );
        }
        return;
      }
      const recipe = createRecoveryDiagnostic({
        runId: runId('recovery-diagnostic'),
        actorId: actorId('recovery-diagnostic:actor'),
        outgoing,
        destination,
        durationMs: durationMs(150),
        diagnostic: true,
        fixedLiftSign: 1,
      });
      let queries = 0,
        completedQueries = 0;
      const disposeResources = cleanup;
      cleanup = () => {
        emit('ADAPTER_FINAL_COUNTS', {
          attempted: queries,
          completed: completedQueries,
          hardCap: 24,
        });
        disposeResources();
      };
      const bounded =
        (fn: (q: CanonicalPoseQuery) => CanonicalPoseSnapshot) =>
        (q: CanonicalPoseQuery) => {
          if (++queries > 24) throw Error('Source query cap exceeded');
          const value = fn(q);
          completedQueries++;
          emit('ADAPTER_CANONICAL_QUERY', {
            ordinal: queries,
            query: q,
            snapshot: value,
          });
          return value;
        };
      const readB = bounded((q) => b.sampleCanonical(q)),
        readN = bounded((q) => n.sampleCanonical(q));
      const adjustment = new Matrix4()
        .fromArray(numeric.descriptor.headAttachmentAtBind)
        .invert()
        .multiply(
          new Matrix4().fromArray(numeric.descriptor.referenceToActorAtBind),
        );
      const matrixFromFull = (pose: LocalPose) => {
        const h = composePoseMatrices(pose).find((v) => v.id === 'gltf:0');
        if (!h) throw Error('Missing mapped head');
        return new Matrix4().fromArray(h.matrix).multiply(adjustment).toArray();
      };
      const adjacent = (at: number, direction: 1n | -1n) => {
        const view = new DataView(new ArrayBuffer(8));
        view.setFloat64(0, at);
        view.setBigUint64(0, view.getBigUint64(0) + direction);
        return gameTimeMs(view.getFloat64(0));
      };
      // Late-first query, reverse order and adjacent representable endpoints.
      // Six recipe samples consume 22 canonical calls; the Idle seam adds two.
      const checks = [
        { at: recipe.endMs, side: 'right' },
        { at: recipe.startMs, side: 'right' },
        { at: adjacent(recipe.startMs, 1n), side: 'right' },
        { at: gameTimeMs(recipe.startMs + 75), side: 'right' },
        { at: adjacent(recipe.endMs, -1n), side: 'right' },
        { at: recipe.endMs, side: 'left' },
      ] as const;
      const observed: CanonicalPoseSnapshot[] = [];
      for (const { at, side } of checks) {
        const full = sampleRecoveryDiagnostic(recipe, at, side, readB),
          head = sampleRecoveryDiagnostic(recipe, at, side, readN);
        emit('ADAPTER_RAW_SAMPLE', { at, side, full, head });
        for (const node of head.pose) {
          const fromB = full.pose.find((v) => v.id === node.id);
          if (!fromB) throw Error(`Unmapped numeric ancestor ${node.id}`);
          expect(fromB.parent).toBe(node.parent);
          for (const field of ['t', 'q', 's'] as const)
            fromB[field].forEach((v, k) => {
              expect(Math.abs(v - required(node[field][k]))).toBeLessThan(
                1e-10,
              );
            });
        }
        const expected = matrixFromFull(full.pose),
          actual = n.matrix(head.pose);
        expected.forEach((v, k) => {
          expect(Math.abs(v - required(actual[k]))).toBeLessThan(1e-10);
        });
        expect(rig.node.parent).toBe(physicalParent);
        updateAttached();
        const parentBefore = physicalSnapshot();
        expect(parentBefore).toEqual(fixedPhysical);
        b.apply(full.pose);
        updateAttached();
        expect(physicalSnapshot()).toEqual(parentBefore);
        expect(physicalSnapshot()).toEqual(fixedPhysical);
        // Complete applied local TRS measured through actual node traversal.
        const applied: { t: number[]; q: number[]; s: number[] }[] = [];
        rig.node.traverse((part) => {
          if (part !== required(rig).node)
            applied.push({
              t: part.position.toArray(),
              q: part.quaternion.toArray(),
              s: part.scale.toArray(),
            });
        });
        emit('ADAPTER_APPLIED', {
          at,
          side,
          applied,
          physicalParent: physicalSnapshot(),
        });
        expect(applied).toEqual(full.pose.map(({ t, q, s }) => ({ t, q, s })));
      }
      // Actual Idle seam, no reset/retime: two additional source calls, total <=24.
      const seam = captureCanonicalQuery(
        destination,
        gameTimeMs(destination.startedAt + idle.durationMs),
        'left',
      );
      observed.push(readB(seam), readN(seam));
      expect(
        observed.every(
          (v) =>
            v.query.clipTime === idle.durationMs &&
            v.rootMode === 'full-translation',
        ),
      ).toBe(true);
      emit('ADAPTER_COUNTS', { queries, hardCap: 24, seam: observed });
      expect(queries).toBeLessThanOrEqual(24);
      rig.node.removeFromParent();
      rig.dispose();
      rig = undefined;
      numeric.dispose();
      numeric = undefined;
      expect(() => b.sampleCanonical(seam)).toThrow('disposed');
      expect(() => n.sampleCanonical(seam)).toThrow('disposed');
    }
  } catch (error) {
    primary = { error };
  } finally {
    finishReceipt(receipt, primary, cleanup);
  }
}
