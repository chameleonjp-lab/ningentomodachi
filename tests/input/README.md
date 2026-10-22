# P1 input adapter

`createPointerInput(context, optionalActorId)` is pure pointer intent transport. Normal composition resolves the current white actor lazily because `context.readSnapshot()` is null during A factory construction. Starts disabled; A's same-run gate grants input. Source IDs/sequences span every gameplay kind and never reset on pause. Competing jump/punch/kick taps are retained without battle arbitration.

Coordinates are screen-right-positive x and screen-up/away-positive z (`startY - clientY`), never directly world Z. C alone converts through its captured right/depth vectors.

Movement begins synchronously at pointer-down, including zero displacement, and captures C's basis revision. Unique gesture counter prevents OS pointer-ID reuse from reusing a session. Pointer-up ends movement. `releaseAll()` clears local state only and never echoes to A; local cancellation calls A's public movement release port. No HP/heat/attack selection/physics lives here.

`bindPointerControls` scopes browser-default suppression to controls and owned pointers. Document move/up listeners handle failed capture without swallowing unrelated page gestures. Pointer clicks do not duplicate down intents; detail-zero clicks support native keyboard/assistive activation. Key repeats are suppressed. Cancellation, lost capture, blur, pagehide and visibility loss release input; A owns actual pause/resume. Factory subscriptions cancel on shared viewport changes; disposal removes listeners and captures.

Node tests cover transport/identity/basis/release. Per-file jsdom tests cover actual listeners and failed capture. Real multi-touch Safari, VoiceOver and OS interruption behavior remain unverified; see the UI checklist.
