import type {
  HostPort,
  HostRequest,
  HostSnapshot,
  PauseReason,
  ViewportReader,
} from '../contracts';
import type { ControlElements } from '../input';
import { button, element } from './elements';
import {
  buttonNames,
  defaultSettings,
  readSettings,
  resolveLayout,
  saveSettings,
  settingsForLayout,
  type ControlSettings,
  type SettingsStorage,
} from './settings';
import { interfaceStyles } from './styles';
import { actionLabels, resultLines } from './viewModel';
export function createShell(root: HTMLElement, storage?: SettingsStorage) {
  const document = root.ownerDocument;
  const wrapper = element(document, 'div', 'nt-interface');
  wrapper.setAttribute('aria-label', 'ニンゲントモダチ');
  const style = element(document, 'style');
  style.textContent = interfaceStyles;
  const hud = element(document, 'div', 'nt-hud');
  const effects = element(document, 'div', 'nt-effects');
  effects.setAttribute('aria-hidden', 'true');
  const fade = element(document, 'div', 'nt-fade');
  fade.hidden = true;
  const controlsLayer = element(document, 'div', 'nt-controls');
  controlsLayer.hidden = true;
  const move = element(document, 'div', 'nt-swipe', 'スワイプで移動');
  move.setAttribute('aria-label', '移動スワイプ領域');
  const controls: ControlElements = {
    move,
    punch: button(document, 'パンチ', () => {}),
    kick: button(document, 'キック', () => {}),
    jump: button(document, 'ジャンプ', () => {}),
  };
  for (const name of buttonNames) controls[name].className = 'nt-control';
  controlsLayer.append(move, ...buttonNames.map((name) => controls[name]));
  const chrome = element(document, 'div', 'nt-chrome');
  const tools = element(document, 'div', 'nt-tools');
  const notice = element(document, 'div', 'nt-notice');
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  wrapper.append(
    style,
    hud,
    effects,
    controlsLayer,
    fade,
    chrome,
    tools,
    notice,
  );
  root.append(wrapper);
  let state: HostSnapshot | null = null;
  let viewport: ViewportReader | null = null;
  let unsubscribe = () => {};
  let disposed = false;
  let attached = false;
  let counter = 0;
  let settingsOpen = false;
  let key = '';
  let renderEpoch = 0;
  let layoutUsable = true;
  let refreshSettingsPreview: (() => void) | null = null;
  let startupViewKey: string | null = null;
  let startupStatus: HTMLElement | null = null;
  const startupStatusText = () => {
    const startup = state?.startup;
    if (!startup) return '';
    const countdown =
      startup.countdown > 0
        ? `開始まで ${startup.countdown}`
        : startup.requiredAssetsReady
          ? '開始を準備しています…'
          : '読み込み完了を待っています…';
    const loading = startup.requiredAssetsReady
      ? '必要な素材の準備ができました。'
      : '必要な素材を読込中…';
    return `${countdown} ${loading}`;
  };
  let renderedFocusContext = '';
  const focusScope = () =>
    JSON.stringify(
      state?.startup && !['error', 'results', 'disposed'].includes(state.phase)
        ? ['startup', state.startup.generation]
        : [state?.phase, state?.runId, state?.game?.runId],
    );
  const semanticFocusKey = (node: Element | null) => {
    if (!node || !['BUTTON', 'INPUT'].includes(node.tagName)) return null;
    const label = node.getAttribute('aria-label') ?? node.textContent;
    return label ? `${node.tagName}:${label}` : null;
  };
  const ownedControls = () => [
    ...chrome.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button,input',
    ),
    ...tools.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button,input',
    ),
  ];
  // Only explicit activation of a DOM-focused settings trigger moves focus
  // between views. Pointer clicks and an AT cursor alone do not request it.
  const settingsNavigationButton = (
    label: string,
    opening: boolean,
    navigate: () => void,
  ) => {
    const node = element(document, 'button', '', label);
    node.type = 'button';
    node.addEventListener('click', (event) => {
      const moveFocus = event.detail === 0 && document.activeElement === node;
      const scope = focusScope();
      navigate();
      if (
        !moveFocus ||
        disposed ||
        scope !== focusScope() ||
        settingsOpen !== opening ||
        document.activeElement !== document.body
      )
        return;
      const target = opening
        ? chrome.querySelector<HTMLElement>('h2')
        : ownedControls().find(
            (control) => semanticFocusKey(control) === 'BUTTON:設定',
          );
      target?.focus({ preventScroll: true });
    });
    return node;
  };
  const initial = readSettings(storage);
  let settings = initial.settings;
  let settingsWarning = initial.warning;
  const listeners = new Set<(request: HostRequest) => void>();
  const request = (
    payload: HostRequest extends infer R
      ? R extends HostRequest
        ? Omit<R, 'requestId'>
        : never
      : never,
  ) => {
    if (disposed) return;
    const message = {
      ...payload,
      requestId: `interface:${++counter}`,
    } as HostRequest;
    for (const listener of [...listeners]) listener(message);
  };
  const pause = (
    type: 'PauseRequested' | 'ResumeRequested',
    reason: PauseReason,
    startupGeneration?: number,
  ) => {
    if (startupGeneration !== undefined) {
      if (state?.startup?.generation !== startupGeneration) return;
      request({
        type:
          type === 'PauseRequested'
            ? 'StartupPauseRequested'
            : 'StartupResumeRequested',
        startupGeneration,
        reason,
      });
      return;
    }
    if (state?.startup) return;
    if (state?.game)
      request({
        type: 'CommandRequested',
        command: { type, runId: state.game.runId, reason },
      });
  };
  const layout = () => {
    if (!viewport) return;
    const v = viewport.read();
    const result = resolveLayout(settings, v);
    layoutUsable = result.usable;
    notice.textContent = result.warning ?? '';
    notice.hidden = !result.warning;
    tools.style.top = `${v.safeAreaCssPx.top + 8}px`;
    tools.style.right = `${v.safeAreaCssPx.right + 8}px`;
    hud.style.top = `${v.safeAreaCssPx.top + 66}px`;
    hud.style.left = `${v.safeAreaCssPx.left + 12}px`;
    hud.style.right = `${v.safeAreaCssPx.right + 12}px`;
    for (const name of buttonNames) {
      const b = result.buttons[name];
      const style = controls[name].style;
      style.left = `${b.x}px`;
      style.top = `${b.y}px`;
      style.width = `${b.size}px`;
      style.height = `${b.size}px`;
      style.opacity = String(b.opacity);
    }
    controlsLayer.hidden =
      state?.phase !== 'playing' ||
      Boolean(state?.startup) ||
      settingsOpen ||
      Boolean(state.game?.pauseReasons.length) ||
      !layoutUsable;
  };
  const apply = (next: ControlSettings) => {
    const proposed = viewport ? resolveLayout(next, viewport.read()) : null;
    const safe = viewport ? settingsForLayout(next, viewport.read()) : next;
    const result = saveSettings(safe, storage);
    settings = result.settings;
    settingsWarning = result.saved
      ? (proposed?.warning ?? null)
      : '変更はこのプレイに適用しましたが、端末内に保存できません。';
    layout();
  };
  const renderSettings = (
    panel: HTMLElement,
    isCurrent: () => boolean,
    startupGeneration?: number,
  ) => {
    const heading = element(document, 'h2', '', '操作設定');
    heading.tabIndex = -1;
    panel.append(heading);
    if (state?.game) {
      panel.append(
        element(
          document,
          'p',
          '',
          `表示品質：${state.game.quality === 'low' ? '低負荷' : '標準'}（端末性能は未計測）`,
        ),
      );
      for (const [quality, label] of [
        ['standard', '標準品質'],
        ['low', '低負荷'],
      ] as const)
        panel.append(
          button(document, label, () => {
            if (!isCurrent()) return;
            if (state?.game)
              request({
                type: 'CommandRequested',
                command: {
                  type: 'QualityChanged',
                  runId: state.game.runId,
                  quality,
                },
              });
          }),
        );
    }
    const status = element(
      document,
      'p',
      '',
      settingsWarning ??
        '操作領域は44 CSS px以上です。位置は画面内へ調整されます。',
    );
    status.setAttribute('role', 'status');
    panel.append(status);
    const preview = element(document, 'div', 'nt-preview');
    preview.setAttribute('aria-label', '操作配置プレビュー');
    panel.append(preview);
    const updatePreview = () => {
      if (!viewport) return;
      const v = viewport.read();
      const resolved = resolveLayout(settings, v);
      preview.replaceChildren();
      preview.style.aspectRatio = `${v.widthCssPx} / ${v.heightCssPx}`;
      for (const name of buttonNames) {
        const b = resolved.buttons[name];
        const dot = element(document, 'span', '', actionLabels[name]);
        dot.style.left = `${(100 * b.x) / v.widthCssPx}%`;
        dot.style.top = `${(100 * b.y) / v.heightCssPx}%`;
        dot.style.width = `${(100 * b.size) / v.widthCssPx}%`;
        dot.style.height = `${(100 * b.size) / v.heightCssPx}%`;
        dot.style.opacity = String(b.opacity);
        preview.append(dot);
      }
    };
    refreshSettingsPreview = () => {
      if (isCurrent()) updatePreview();
    };
    updatePreview();
    for (const name of buttonNames) {
      const field = element(document, 'fieldset');
      field.append(element(document, 'legend', '', actionLabels[name]));
      for (const [property, label, min, max, step] of [
        ['x', '横位置', 0, 1, 0.01],
        ['y', '縦位置', 0, 1, 0.01],
        ['size', 'サイズ', 44, 140, 1],
        ['opacity', '不透明度', 0.3, 1, 0.01],
      ] as const) {
        const row = element(document, 'label', '', label);
        const input = element(document, 'input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(settings.buttons[name][property]);
        input.setAttribute('aria-label', `${actionLabels[name]} ${label}`);
        input.addEventListener('input', () => {
          if (!isCurrent()) return;
          apply({
            ...settings,
            buttons: {
              ...settings.buttons,
              [name]: {
                ...settings.buttons[name],
                [property]: Number(input.value),
              },
            },
          });
          status.textContent = settingsWarning ?? '設定を保存しました。';
          updatePreview();
          for (const slider of panel.querySelectorAll('input')) {
            const label = slider.getAttribute('aria-label');
            for (const action of buttonNames)
              for (const [property, text] of [
                ['x', '横位置'],
                ['y', '縦位置'],
                ['size', 'サイズ'],
                ['opacity', '不透明度'],
              ] as const)
                if (label === `${actionLabels[action]} ${text}`)
                  slider.value = String(settings.buttons[action][property]);
          }
        });
        row.append(input);
        field.append(row);
      }
      panel.append(field);
    }
    panel.append(
      button(document, '初期配置に戻す', () => {
        if (!isCurrent()) return;
        apply(defaultSettings);
        key = '';
        render();
      }),
      settingsNavigationButton('設定を閉じる', false, () => {
        if (!isCurrent()) return;
        if (
          startupGeneration !== undefined &&
          state?.startup?.generation !== startupGeneration
        )
          return;
        settingsOpen = false;
        pause('ResumeRequested', 'settings', startupGeneration);
        key = '';
        render();
      }),
    );
  };
  const render = () => {
    if (disposed || !state) return;
    layout();
    const nextKey = JSON.stringify([
      settingsOpen && state.startup ? 'startup-settings' : state.phase,
      state.error,
      state.runId,
      state.game?.runId,
      state.game?.pauseReasons,
      state.game?.quality,
      state.game?.result,
      settingsOpen && state.startup
        ? { generation: state.startup.generation }
        : state.startup,
      settingsOpen,
    ]);
    if (nextKey === key) return;
    key = nextKey;
    const nextStartupViewKey =
      state.startup &&
      !settingsOpen &&
      !['error', 'results', 'disposed'].includes(state.phase)
        ? JSON.stringify([
            state.phase,
            state.error,
            state.runId,
            state.game?.runId,
            state.game?.pauseReasons,
            state.game?.quality,
            state.game?.result,
            state.startup.generation,
            state.startup.pauseReasons,
          ])
        : null;
    // Text-only startup updates retain native control identity and its epoch.
    // Any captured view/authority change still takes the invalidating path.
    if (
      nextStartupViewKey !== null &&
      nextStartupViewKey === startupViewKey &&
      startupStatus &&
      chrome.contains(startupStatus)
    ) {
      startupStatus.textContent = startupStatusText();
      return;
    }
    startupViewKey = null;
    startupStatus = null;
    const focusContext = `${focusScope()}:${settingsOpen}`;
    const focused = document.activeElement;
    const focusedKey =
      renderedFocusContext === focusContext &&
      focused &&
      (chrome.contains(focused) || tools.contains(focused))
        ? semanticFocusKey(focused)
        : null;
    renderedFocusContext = focusContext;
    const restoreFocus = () => {
      if (!focusedKey || document.activeElement !== document.body) return;
      ownedControls()
        .find((control) => semanticFocusKey(control) === focusedKey)
        ?.focus({ preventScroll: true });
    };
    const epoch = ++renderEpoch;
    const generation = state.startup?.generation;
    const isCurrent = () =>
      !disposed &&
      epoch === renderEpoch &&
      generation === state?.startup?.generation;
    refreshSettingsPreview = null;
    chrome.replaceChildren();
    tools.replaceChildren();
    const startup = !['error', 'results', 'disposed'].includes(state.phase)
      ? state.startup
      : null;
    const startupGeneration = startup?.generation;
    const playing = state.phase === 'playing' && !startup;
    controlsLayer.hidden =
      !playing ||
      settingsOpen ||
      Boolean(state.game?.pauseReasons.length) ||
      !layoutUsable;
    if (state.phase === 'disposed') {
      wrapper.hidden = true;
      return;
    }
    wrapper.hidden = false;
    const openSettings = () => {
      if (!isCurrent()) return;
      if (
        startupGeneration !== undefined &&
        state?.startup?.generation !== startupGeneration
      )
        return;
      settingsOpen = true;
      pause('PauseRequested', 'settings', startupGeneration);
      key = '';
      render();
    };
    if ((playing || startup) && !settingsOpen) {
      tools.append(settingsNavigationButton('設定', true, openSettings));
      if (!(startup?.pauseReasons ?? state.game?.pauseReasons)?.length)
        tools.append(
          button(document, '一時停止', () => {
            if (isCurrent())
              pause('PauseRequested', 'manual', startupGeneration);
          }),
        );
    }
    if (playing && !settingsOpen && !state.game?.pauseReasons.length) {
      restoreFocus();
      return;
    }
    const panel = element(document, 'section', 'nt-panel');
    panel.setAttribute(
      'aria-label',
      settingsOpen ? '操作設定' : 'ゲームメニュー',
    );
    if (settingsOpen) {
      renderSettings(panel, isCurrent, startupGeneration);
      chrome.append(panel);
      restoreFocus();
      return;
    }
    panel.append(element(document, 'h1', '', 'ニンゲントモダチ'));
    if (startup) {
      const status = element(
        document,
        'p',
        'nt-startup-status',
        startupStatusText(),
      );
      startupStatus = status;
      startupViewKey = nextStartupViewKey;
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      panel.append(status);
      if (startup.pauseReasons.length)
        panel.append(element(document, 'h2', '', '開始前の一時停止中'));
      const labels = {
        settings: '設定を編集中',
        background: '画面に戻ると再開を確認できます',
        manual: '手動で一時停止',
        interruption: '操作または描画が中断されました',
      };
      for (const reason of startup.pauseReasons) {
        panel.append(element(document, 'p', '', labels[reason]));
        if (reason === 'manual' || reason === 'interruption')
          panel.append(
            button(
              document,
              reason === 'manual' ? '再開' : '中断から再開',
              () => {
                if (isCurrent())
                  pause('ResumeRequested', reason, startupGeneration);
              },
            ),
          );
      }
      panel.append(
        button(document, '読込を中止', () => {
          if (isCurrent() && state?.startup?.generation === startupGeneration)
            request({ type: 'CancelLoadingRequested' });
        }),
      );
      chrome.append(panel);
      restoreFocus();
      return;
    }
    if (state.phase === 'title') {
      panel.append(
        element(document, 'p', '', '人間の友達として、街の暴動を止めよう。'),
        button(document, 'はじめる', () =>
          request({ type: 'PrepareRequested' }),
        ),
        settingsNavigationButton('設定', true, openSettings),
      );
    }
    if (state.phase === 'loading') {
      const status = element(document, 'p', '', '読込中…');
      status.setAttribute('role', 'status');
      panel.append(
        status,
        button(document, '読込を中止', () =>
          request({ type: 'CancelLoadingRequested' }),
        ),
      );
    }
    if (state.phase === 'error') {
      const error = element(
        document,
        'p',
        '',
        state.error ?? '読込に失敗しました。',
      );
      error.setAttribute('role', 'alert');
      panel.append(
        error,
        button(document, '再試行', () => request({ type: 'RetryRequested' })),
        button(document, 'タイトルへ', () =>
          request({ type: 'ReturnToTitleRequested' }),
        ),
      );
    }
    if (state.phase === 'ready')
      panel.append(
        element(document, 'p', '', '準備ができました。'),
        button(document, 'プレイ開始', () =>
          request({ type: 'StartRequested' }),
        ),
      );
    if (playing) {
      panel.append(element(document, 'h2', '', '一時停止中'));
      for (const reason of state.game?.pauseReasons ?? []) {
        const labels = {
          settings: '設定を編集中',
          background: '画面に戻ると再開を確認できます',
          manual: '手動で一時停止',
          interruption: '操作または描画が中断されました',
        };
        panel.append(element(document, 'p', '', labels[reason]));
        if (reason === 'manual' || reason === 'interruption')
          panel.append(
            button(
              document,
              reason === 'manual' ? '再開' : '中断から再開',
              () => pause('ResumeRequested', reason),
            ),
          );
      }
    }
    if (state.phase === 'results' && state.game?.result) {
      const dl = element(document, 'dl');
      for (const [label, value] of resultLines(state.game.result))
        dl.append(
          element(document, 'dt', '', label),
          element(document, 'dd', '', value),
        );
      panel.append(
        dl,
        button(document, '再挑戦', () => request({ type: 'RetryRequested' })),
        button(document, 'タイトルへ', () =>
          request({ type: 'ReturnToTitleRequested' }),
        ),
      );
    }
    chrome.append(panel);
    restoreFocus();
  };
  const host = (reader: ViewportReader): HostPort => {
    if (attached) throw Error('Interface host already attached');
    attached = true;
    viewport = reader;
    unsubscribe = reader.subscribe(() => {
      layout();
      refreshSettingsPreview?.();
    });
    layout();
    return {
      subscribe(listener) {
        if (!disposed) listeners.add(listener);
        return () => listeners.delete(listener);
      },
      render(next) {
        if (disposed) return;
        if (
          (next.phase !== 'playing' &&
            next.phase !== 'title' &&
            !next.startup) ||
          next.phase === 'error' ||
          next.phase === 'disposed' ||
          state?.startup?.generation !== next.startup?.generation
        )
          settingsOpen = false;
        state = next;
        render();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        refreshSettingsPreview = null;
        unsubscribe();
        listeners.clear();
        wrapper.remove();
      },
    };
  };
  return { host, hud, effects, fade, controls };
}
