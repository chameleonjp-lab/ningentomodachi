import { clipId } from '../contracts';
import { copyRootPolicy } from './rootPolicy';
/** Source-proven posture partition for two diagnostics, NOT accepted attack timing/contact art.
 * Pointers address immutable assets/android/motions/completed42-speed15/{punch,kick}/manifest.json.
 * No aerial/other-clip policy is inferred from these grounded representatives. */
export const PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES = Object.freeze([
  copyRootPolicy({
    version: 1,
    clipId: clipId('Cross'),
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    mode: 'grounded-posture-y',
    provenance: {
      manifestSha256:
        'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
      clipPointer: '/clips/1',
      supportPointer: '/clips/1/support_contacts',
    },
  }),
  copyRootPolicy({
    version: 1,
    clipId: clipId('FrontKick'),
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    mode: 'grounded-posture-y',
    provenance: {
      manifestSha256:
        'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
      clipPointer: '/clips/0',
      supportPointer: '/clips/0/support_contacts/support/0',
    },
  }),
]);
