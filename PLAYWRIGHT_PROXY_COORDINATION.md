# Playwright Proxy Coordination

## Goal

Move the real WRY/WKWebView Playwright proxy from a useful page/frame/handle subset toward broader Playwright parity, without losing the current green real-app test path.

## Current Status

- `npm test` is currently green with 53 passing tests.
- The repo validates:
  - real embedded app coverage in `tests/app.spec.mjs`
  - imported Playwright-style coverage for:
    - `page.evaluate`
    - `JSHandle` property access
    - basic `$` / `$$` queries
    - basic `waitForSelector`
    - DOM getters and state helpers
    - test-id selector semantics
    - text, attr, label, and basic role locator semantics

## Implemented And Green

- `page.evaluate`, `page.evaluateHandle`
- handle arguments into `page.evaluate`
- `JSHandle.getProperty`, `JSHandle.getProperties`, `jsonValue`
- `$`, `$$`, `$eval`, `$$eval`
- `waitForSelector`, `waitForFunction`
- `click`, `fill`, `focus`, `type`, `press`, `check`, `uncheck`, `selectOption`
- `hover`, `dblclick`, `dispatchEvent`
- `textContent`, `getAttribute`, `inputValue`, `content`, `title`, `reload`
- `isChecked`, `isEditable`, `isDisabled`, `isHidden`, `isVisible`
- minimal protocol shims for `snapshotForAI` and `setTestIdAttributeName`
- `innerText`, `innerHTML`, `blur`, `isEnabled`, `queryCount`, `waitForTimeout`
- test-id selectors through `selectors.setTestIdAttribute()`
- `internal:text`, `internal:attr`, `internal:label`
- a constrained `internal:role` subset for common controls and headings

## Highest-Value Gaps

### Tier 1

- richer locator semantics beyond the current selector-family subset:
  - locator chaining/filtering
  - `getByRole()` parity beyond common controls
  - stricter actionability semantics on locator actions
- richer navigation semantics beyond reload
- more detailed actionability and input fidelity

### Tier 2

- multi-frame, popup, and broader multi-page behavior
- multi-context/browser features
- network interception and request/response surfaces

### Tier 3

- screenshots, media, tracing, downloads, dialogs, workers

## Parallel Workstreams

### Track A: Selector Runtime

- Scope:
  - extend the runtime selector engine beyond CSS and test-id
  - implement `internal:text`, `internal:attr`, `internal:label`, and a minimal high-value `internal:role` subset
  - keep selector parsing and matching centralized in the runtime
- Files:
  - `tests/driver/src/runtime.ts`
  - `tests/driver/src/controller.ts` only if selector plumbing needs new bridge helpers
- Acceptance:
  - Playwright locator helpers for text/placeholder/title/alt/label work on the proxy
  - a basic `getByRole()` subset works for common controls in this app and imported fixtures
- Owner:
  - Codex
- Status:
  - done in `tests/driver/src/runtime.ts` with proxy-backed verification in the real-app and imported suites

### Track B: Real-App Locator Fixtures

- Scope:
  - extend the Automation Lab with deterministic fixtures for placeholder/title/label/text/role queries
  - add real-app coverage that uses public locator APIs rather than raw selectors
- Files:
  - `assets/src/App.tsx`
  - `assets/style.css` if needed
  - `tests/app.spec.mjs`
- Acceptance:
  - the real embedded app suite proves these locator helpers work end to end
- Owner:
  - Galileo
- Status:
  - done with a dedicated Locator Lab in `assets/src/App.tsx` and real-app assertions in `tests/app.spec.mjs`

### Track C: Imported Locator Coverage

- Scope:
  - add imported Playwright-style slices for the new selector families
  - prefer stable coverage for text/attr/label first, then add a focused role subset
- Files:
  - `tests/playwright-internal/`
  - `tests/playwright-internal-*.spec.mjs`
- Acceptance:
  - repo gets one or more meaningful imported selector slices, not just ad hoc local tests
- Owner:
  - Sagan
- Status:
  - done with proxy-backed locator behavior in `tests/playwright-internal/locator.spec.mjs`

## Rules

- Keep the real embedded app path authoritative.
- Do not reintroduce a fake standalone WebKit harness into `npm test`.
- Prefer fresh session isolation per test over shared-session flake.
- Add coverage before claiming parity for a surface.

## Coordination Notes

- Main rollout owns integration, conflict resolution, and final verification.
- Worker changes should stay inside their assigned write scopes.
- If a track discovers a larger architectural blocker, document it here instead of silently widening scope.

## Resulting Coverage

- Real-app suite:
  - `tests/app.spec.mjs`
- Imported Playwright-style slices:
  - `tests/playwright-internal-evaluate.spec.mjs`
  - `tests/playwright-internal-handles.spec.mjs`
  - `tests/playwright-internal-query.spec.mjs`
  - `tests/playwright-internal-wait.spec.mjs`
  - `tests/playwright-internal-dom.spec.mjs`
  - `tests/playwright-internal-testid.spec.mjs`
  - `tests/playwright-internal-locator.spec.mjs`
