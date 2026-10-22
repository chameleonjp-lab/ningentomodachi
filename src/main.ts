import { CONTRACT_VERSION } from './contracts';

// P0 is a foundation entry point, not a playable B/C/D adapter or combat preview.
const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Application mount point #app is missing');
root.dataset.contractVersion = String(CONTRACT_VERSION);
root.textContent =
  'ニンゲントモダチ：共通基盤の準備中です。ゲーム本体はまだ実装されていません。';
