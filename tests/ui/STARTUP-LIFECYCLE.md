# Startup and finishing HUD contract harness

`startup-shell.test.ts` uses public HostSnapshot fixtures, not an implementation of the host clock or asset loader. The title's explicit click retains PrepareRequested for compatibility; legacy snapshots without startup retain their manual ready-screen StartRequested flow. Supplied startup state never causes D to send StartRequested automatically.

Covered: all four countdown values crossed with required readiness and each pause reason; no wall-timer progression; polite atomic status semantics; generation-specific settings/interruption requests and stale detached callback rejection; failure/retry; settings focus across loading completion; A-gated gameplay input; ordinary playing updates do not display startup or lock noncombat settings.

`damage-timeline.test.ts` and `hud-dom.test.ts` feed the public opponent-defeat-finish stage with the original startedAt and authoritative endsAt. They assert victim retention and DOM identity through 1624, cleanup at1625 even with skipped finish frames, no restarted red/absorption animation, and replacement-opponent cleanup. The existing actual-Core integration regressions remain separate; the new host startup clock and new Core finishing-stage emission need A's implementation for composed integration validation.

Run using already installed local binaries, without package-manager startup:

```
NO_UPDATE_NOTIFIER=1 npm_config_offline=true node node_modules/vitest/vitest.mjs run tests/ui tests/input
```

This harness verifies jsdom/state behavior, not Safari rendering, live-region announcements on VoiceOver, touch hardware, visual layout, FPS, actual asset readiness, cache disposal, or optional prefetch performance. A owns phase, generation, clocks, readiness, resident actor selection, input gates, and one-start semantics. D does not infer them from elapsed wall time or DOM animation completion.
