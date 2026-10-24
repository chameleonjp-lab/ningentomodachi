# Device preview publication boundary

Status: locally validated activation candidate, pending owner approval, remote CI and owner merge. No public URL, formal catalog acceptance, or device acceptance is claimed.

## Separate from release acceptance

`deployment/release-readiness.json` remains disabled and unchanged. A preview must use the separate `preview-readiness.json`, with channel `device-preview`, accepted `false`, and externalSubmission `false`. Both channels cannot be enabled simultaneously. Preview availability never establishes accepted collision models, gameplay acceptance, or iPhone acceptance.

Before activation, provide the actual complete preview runtime configuration and public asset payloads, exercise game startup/movement/combat/progression, and document known experimental limitations. Missing production candidates must not be replaced by synthetic samples without explicit disclosure and an appropriate separate scope. The retained Cross/FrontKick payloads are now assembled with the 29 saved candidates into the pinned diagnostic catalog. Runtime integration and its local checks are recorded below; remote CI, publication and actual-device acceptance are separate checks.

## Exact public inventory

`publicFiles` contains exactly three static public assets: `game-assets/android/derived-pack-v1.glb` and `game-assets/android/runtime-artifact-v1.json`, and `game-assets/diagnostic-preview-v1/catalog.json`, with SHA-256 values sorted by path using JavaScript string order. Only `path` and `sha256` keys are allowed; duplicates and unsafe paths fail. `publicInventorySha256` is SHA-256 of UTF-8 `JSON.stringify(publicFiles)` without a trailing newline. The validator compares this reviewed inventory with both the checkout's complete public tree and the independently verified exact-run CI build manifest. Added, changed, or missing static assets fail closed. Future runtime payloads need an explicit reviewed allowlist expansion, not a wildcard.

Generated output is limited to `index.html`, exactly one `assets/index-XXXXXXXX.js`, and at most one `assets/index-XXXXXXXX.css`, where each X is a Vite hash character (ASCII letter, digit, underscore, or hyphen). Every generated file still hash-matches the exact commit/run CI manifest and the public readback. Index script and stylesheet references must name those same local generated files. Unknown chunks, maps, JSON, HTML, or additional scripts/links are rejected. Normal owner-reviewed source changes may change the generated filenames and hashes automatically after a merge without revising the static asset approval.

This is an output boundary, not proof that bundled JavaScript has no private data or new network behavior. Source imports and communications remain subject to PR review and the owner's merge approval. Hashes do not prove licensing. Record provenance and publication rights before enabling. Do not include private source packs, credentials, or internal records.

The artifact's index must include `data-release-channel="device-preview"` and the text `実機確認用・未受入試験版`. This static marker check is not a browser visibility or playability test; runtime review must confirm the notice stays visible and no real ranking/external submission path is active. The false externalSubmission declaration is not a network sandbox or proof of absence of requests.

## Existing pipeline reused

The same main push / merged PR provenance / successful exact-SHA CI / freshness gate and fixed GitHub Pages URL are reused. There is no new workflow, service, credential, manual arbitrary-ref deployment, or extra source evaluation. Package validation checks baseline ancestry and evidence before copying the verified dist bytes unchanged. Generated version metadata additionally records channel, accepted:false, and externalSubmission:false; public verification checks these fields and every file hash.

The repository Pages deployment flag is unchanged and not enabled by this patch. This activation candidate fills the actual baseline/evidence/inventory, connects the preview runtime, and explicitly enables only the unaccepted preview readiness gate. The owner alone merges. Only then can the authorized repository publication flag be enabled and a normal main workflow publish.

Artifact storage remains subject to the account's existing free limits and retention. This change does not authorize paid overages or new storage budgets. Publication and HTTP verification must be reported separately from browser checks and the user's actual-device acceptance. A failed post-deploy check may follow a real public change; inspect live metadata before retrying.

## First preview page notice

The checked-in index carries an always-present unaccepted/provisional notice outside the application mount. The integrated runtime is connected only by the explicit preview build flag. Browser visibility, gameplay behavior and device acceptance still require separate verification. Release packaging explicitly rejects the preview marker/text, so a later accepted release requires a reviewed index notice change as well as release readiness. Do not silently label the preview as accepted. Script/link tags are restricted to the exact known Vite form, including double quotes, normal lowercase attributes, and optional crossorigin. Base URL elements, duplicate or additional attributes and external reference substitutions are rejected. This is not a general-purpose HTML sanitizer.

## Pinned preview payload and local integration

Baseline: `847a5d4f516d66304bec45511dc87a516b21fb1a`, after owner merge of PR 46. Its existing CI output retention lines are preserved. CI build explicitly sets `VITE_DIAGNOSTIC_PREVIEW=1`; a future accepted release must review/remove this flag and the preview notice, not only change readiness.

The diagnostic catalog is 15,711,286 bytes, SHA-256 `0746cf12f393e9d083fbfd91b1a49bed64591f21ffbc614a7fd05c42ec417b9e`. It contains all 31 diagnostic motions and 47 impact events. The assembly check compared the complete saved motion assets, root policies, ownership and event windows with their original payloads, without fitting, original-source reevaluation, compression or curve omission. Original measurement reports and source packs are referenced by provenance, not copied to this public catalog. Diagnostics remain unaccepted.

The two existing visual assets plus the catalog total 25,412,287 bytes before generated HTML/JavaScript. Mobile download cost, memory use, frame rate and iPhone acceptance have not been measured. Color move allocation and balance values remain provisional. No ranking or external submission is enabled. Hash equality is not a network sandbox.

Three pre-existing diagnostic impactId strings are relocated to provenance.excludedDiagnosticFields with exact pointers and values, because the strict runtime decoder rejects diagnostic-only fields. Reverse reconstruction deep-equals the original catalog; motion curves and gameplay fields are unchanged. The original diagnostic payload is retained separately, not substituted with an accepted model.

Local integration checks: deployment validator 40/40 synthetic tests; six selected runtime/catalog-admission test files 116/116; type checking, formatting, lint (warnings remain), and preview build passed. The actual local build output also passed packaging/allowlist/hash shape checks using a clearly synthetic context, not remote CI or merged-PR evidence. Runtime review separately decoded all 31 catalog assets and 47 events and prepared the existing pinned visual pack without original-source evaluation. Neither these checks nor a successful build establishes browser or iPhone acceptance.
