# GitHub Pages deployment

## Current status: preparation only

Publication is closed by two independent gates: `deployment/release-readiness.json` has `enabled: false`, and `PAGES_DEPLOY_ENABLED` must explicitly equal `true`. No Pages settings, environment, repository variable or permissions have been changed by this code. The separate `publish.yml` remains disabled. Existing Pages settings are unverified because the connector's Pages endpoint was unsupported.

Intended free public destination: https://chameleonjp-lab.github.io/ningentomodachi/ (not a claim that it exists). No custom domain, paid preview, PAT or third-party deployment service is used. Every published static asset is downloadable publicly. Do not include private source packs, personal data or unapproved third-party assets.

## First publication sequence

1. Before opening either gate, finish and review the real production catalog, loader and response handling. Prove title/start, movement and combat, four-opponent progression, clear/defeat scoring and retry through appropriate code/integration evidence. A green build alone is not usable-game completion. Tests and fixture-only startup are not substitutes for the accepted production asset catalog.
2. Qualify the exact production artifact and asset paths for `/ningentomodachi/`, including models, textures, animations and other dynamic loads. Existing Vite `base: './'` remains unchanged. Record the evidence and remaining limitations in a new, reviewed `docs/deployment/acceptance.md` before enabling. No public URL is required for this prepublication qualification.
3. Audit the public file inventory and licensing. Store its SHA-256 in `publicInventorySha256`, and the accepted baseline commit in `acceptedCommit`. The validator enforces that baseline is an ancestor of the publication commit and that the acceptance evidence exists. The inventory digest records acceptance evidence, not an automatic proof of licensing or future assets; review later asset changes in their PRs.
4. Actual prepublication browser/device playtesting is currently unavailable, not passed: the available cloud browser cannot reach the existing local shell server. Do not introduce tunnels, new paid previews, browser installations or security bypasses. The release decision must explicitly distinguish automated code/catalog/subpath qualification from outstanding browser/device checks. Do not fabricate completion evidence to open the gate.
5. After the first usable-implementation readiness decision, confirm the required Pages settings/permission actions separately. Inspect current settings through a supported authorized route; select GitHub Actions as Pages source, restrict `github-pages` deployments to `main`, and keep default token permissions read-only. Job-level `pages:write` and `id-token:write` are needed by the deploy action. Environment creation/protection and branch/ruleset changes are not performed by this PR. Do not use auto-enable configuration or introduce credentials. Main was observed unprotected during preparation. Before activation, separately verify PR-only/no-force protections with no applicable bypass; this is an activation prerequisite for the promised PR-merge-only workflow. This PR does not create or change those protections; such settings require separate confirmation. The workflow rejects forced pushes, but association with a historical merged SHA is not proof that this particular push was a fresh merge event. Do not claim strict direct-push prevention from code alone.
6. The owner merges the reviewed readiness/configuration changes. Open `PAGES_DEPLOY_ENABLED` only within the confirmed activation scope. The next main commit produced by a merged PR with successful checks publishes; unassociated direct commits and forced pushes are rejected, subject to the historical-SHA replay limitation below. There is deliberately no manual-dispatch arbitrary-ref bypass. If no new commit is appropriate, a normal rerun of the current main workflow is possible after gates are set; old main runs are rejected before deployment.
7. After publication, the workflow checks the exact returned HTTPS destination, manifest hash, commit/run/build-attempt identity and each public file hash. Only then report a verified deployed version and its URL. This is an HTTP/artifact smoke check, not playability testing.
8. Browser playtesting and the user's actual iPhone acceptance follow on the first published URL. Report these separately from deployment success and keep unresolved visual/input/performance defects explicit. Do not claim device acceptance without observed evidence.

## Pipeline and trust boundary

`ci-typecheck`, `ci-contracts`, `ci-unit`, `ci-integration` and `ci-build` feed the existing `ci-required` exact-SHA/byte validation gate. New deployment tests execute inside `ci-typecheck`; original checks remain intact.

`pages-package` requires successful `ci-required`, same repository, `push`, `refs/heads/main` and explicit enable variable. A read-only PR API check additionally requires `merged_at`, exact `merge_commit_sha`, and this repository/main as the base. Merge, squash and rebase merges are accepted only when their recorded merge commit equals the run SHA. The event must explicitly report forced=false. Unassociated direct commits fail closed, but a non-forced push replaying a historical merged SHA can satisfy association; strict PR-only prevention additionally depends on verified branch protections. Association is checked up to six times for eventual consistency when the API returns successfully but has no matching PR. Any API exception, including transient network failures, immediately fails closed; exceptions are not retried. Missing provenance also fails closed. The package job has `contents:read` and `pull-requests:read`, not write permissions. It checks out only that run's source, validates readiness and ancestry, and downloads only its exact-SHA/run build artifacts. Partial reruns choose the newest available build attempt exactly as `ci-required` does, and reject a future/mismatched attempt rather than silently changing identity. The public metadata distinguishes build attempt from packaging CI attempt. Package artifact name and package attempt are carried as outputs to deploy and verification, so rerunning only a failed downstream job does not silently select a different attempt. There is no rebuild.

All artifact files must be listed and hash-match; paths, duplicate entries, links and unexpected files fail closed. Only `dist` ships, plus generated `version.json` and `deployment-manifest.json`. Reports/source/fixtures are not copied. Hidden files, source maps and unreviewed extensions are rejected. This is defense in depth, not a complete private-data scanner. Review static assets before accepting the release.

`pages-deploy` is the only job with Pages/OIDC write permissions. It has no checkout, install, shell command or project-script execution. SHA-pinned official actions first read Pages configuration and require the exact approved HTTPS project URL, null custom domain and workflow build type, then check current main and deploy the explicit Pages artifact. Missing/unsupported/denied Pages metadata fails closed. This is future runtime preflight code, not evidence that current settings have been inspected or enabled. Settings can theoretically change between preflight and deployment; administrative changes during release must be coordinated. No PR/fork/`workflow_run`/`pull_request_target` publication path is added; no persistent secret is used. Official action pins were verified via GitHub refs during preparation.

## Concurrency and limits

Main workflow runs do not cancel an in-flight run, including deployment. PR runs still cancel superseded PR runs. A separate Pages lock serializes deployments; old queued builds fail the current-main check. GitHub concurrency queues are not guaranteed FIFO.

The final main-head read and Pages deployment are not atomic. A new merge may arrive between them; an earlier verified version can briefly be public until the new verified main deploys. Serialization prevents an old deployment from overwriting a newer completed deployment. A newer failing main never replaces a prior good deployment.

Existing CI runtime uses Node 24 with the lockfile; packaging pins Node 24.19.0. Action dependencies and hosted runners mean this is verified-artifact reuse, not a claim of universal bit-for-bit reproducible rebuilds. Packaging emits deterministic metadata for the same build/run identity and does not alter application bytes.

The HTTP smoke polls manifest propagation for up to roughly one minute plus request timeouts, then checks each file. A large catalog may require a measured timeout adjustment; failure is reported, not silently ignored. No custom-domain destination is accepted. Static Pages is not a backend or SPA route fallback.

## Failure and recovery

- Failed, canceled or skipped prepublication CI/readiness/packaging/freshness checks do not deploy; the previous published version remains unchanged.
- A deploy transport failure or post-deploy smoke failure may already have changed live content. It does NOT guarantee last-good preservation. Read the live version and workflow result before retrying; do not announce success or automatic rollback.
- Normal recovery: owner-reviewed revert PR restoring known-good product content as a new main commit, then all checks and normal deployment. No force-push, history deletion, arbitrary-old-SHA redeploy, permission bypass or silent unpublish.
- Disabling future deployments and unpublishing an existing site are distinct operations requiring appropriate approval. Disabling the variable does not remove already public content.
- Successful verification writes commit/build-attempt/URL in the job summary. CI evidence and Pages artifact retention are 14 days; do not depend on expired artifacts for recovery. Keep source/accepted asset provenance in version control and approved backups.

## Local verification

Use existing dependencies, without installing packages:

- `node --test deployment/validate-pages-artifact.test.mjs`
- `actionlint .github/workflows/ci.yml`
- Existing repository format, lint, typecheck, Vitest and Vite build commands.

Local tests do not prove remote Actions behavior, Pages settings, live availability or device acceptance. First deployment remains conditional on the readiness decision and confirmed settings.

## References

- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://vite.dev/guide/static-deploy.html#github-pages

- https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request (merge/squash/rebase merge-commit identity)

- https://docs.github.com/en/rest/pages/pages#get-a-github-pages-site (read-only destination/build-mode preflight)
