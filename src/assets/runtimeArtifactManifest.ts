// Deterministically generated offline by tools/assets/build-runtime-artifacts.mts.
const sourcePins = Object.freeze(
  [
    {
      path: 'assets/android/motions/completed42-speed15/movement/android_movement.glb',
      sha256:
        'c5ade077f78d87b33bb4e6aee4d331a8fd0dbfa190d4d5718a87873d3e94774f',
      bytes: 5516676,
    },
    {
      path: 'assets/android/motions/completed42-speed15/jump/android_jump.glb',
      sha256:
        'c3a6b2595633e29ee264a6555ad46165f1c6bc3de878fa75167c5221b7ddb2a4',
      bytes: 5380008,
    },
    {
      path: 'assets/android/motions/completed42-speed15/punch/android_punch.glb',
      sha256:
        'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
      bytes: 5584752,
    },
    {
      path: 'assets/android/motions/completed42-speed15/kick/android_kick.glb',
      sha256:
        '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
      bytes: 5685720,
    },
  ].map((source) => Object.freeze(source)),
);
export const ANDROID_RUNTIME_ARTIFACT_V1 = Object.freeze({
  ...{
    schemaVersion: 1,
    url: '/game-assets/android/runtime-artifact-v1.json',
    sha256: '04dd9e6ee5dd9600eb93a4083a18e721634e4b136afe3b1b02d7835e6caf5c22',
    bytes: 1351601,
    supportAlgorithm: 'exact-weight-hull-v1',
    deathAlgorithm: 'articulated-death-500ms-v1',
    scope:
      'Exact CPU support and existing canonical death tracks only; not complete motion or world-visual acceptance',
  },
  sources: sourcePins,
} as const);
