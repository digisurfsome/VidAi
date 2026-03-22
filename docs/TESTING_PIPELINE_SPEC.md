# Deterministic Testing Pipeline — Maxed Out Spec

## Overview

Enterprise-grade automated testing system that verifies every build before delivery. Four-phase pipeline: mechanical build validation, automated functional testing (Playwright), full interactive Computer Use QA (Claude controls a real browser like a human), and multi-build consensus analysis. No build ships without passing all four phases.

This is built for ourselves first (to test our own platform), then becomes part of the product for customers.

---

## Architecture Decision

**Option A: Full Docker Isolation** — chosen because:
- We need enterprise-level testing for our own builds
- We're building a builder, so the testing infrastructure IS the product
- No dependency on third-party sandbox services
- Full control over the environment
- Every build runs in its own isolated container — no cross-contamination

---

## Phase 1: Build Validation (Deterministic — Zero AI)

Pure mechanical checks. No intelligence needed. Pass/fail.

```
Step 1: npm install
  Timeout: 120 seconds
  Pass: node_modules populated, no errors
  Fail: Capture npm error log → feed to builder for retry

Step 2: TypeScript compilation check
  Command: npx tsc --noEmit
  Timeout: 60 seconds
  Pass: Zero type errors
  Fail: Capture type errors with file:line → feed to builder

Step 3: Lint check
  Command: npm run lint
  Timeout: 30 seconds
  Pass: Zero lint errors (warnings acceptable)
  Fail: Capture lint errors → feed to builder

Step 4: Production build
  Command: npm run build
  Timeout: 60 seconds
  Pass: dist/ directory created with index.html
  Fail: Capture build errors → feed to builder

Step 5: Start dev server
  Command: npm run dev (or npm run preview for prod build)
  Timeout: 15 seconds
  Pass: Server responds with 200 on expected port
  Fail: Capture startup errors → feed to builder
```

**Phase 1 is the gate.** Nothing proceeds until all 5 steps pass. This catches 60% of issues before any browser opens.

---

## Phase 2: Automated Functional Testing (Playwright — Deterministic)

Headless browser automation. Scripted test scenarios. Deterministic — same inputs always produce same outputs.

### 2.1 Route Discovery

```
- Parse App.tsx (or equivalent router config) to extract all routes
- Categorize: public routes, auth-required routes, admin routes
- Generate test plan based on discovered routes
```

### 2.2 Baseline Tests (Run on EVERY build, non-negotiable)

```typescript
// Smoke tests — every single page
for (const route of allRoutes) {
  test(`${route} — no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test(`${route} — not blank`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const bodyText = await page.textContent('body');
    expect(bodyText?.trim().length).toBeGreaterThan(0);
  });

  test(`${route} — no broken images`, async ({ page }) => {
    await page.goto(route);
    const images = await page.locator('img').all();
    for (const img of images) {
      const naturalWidth = await img.evaluate(
        (el: HTMLImageElement) => el.naturalWidth
      );
      expect(naturalWidth).toBeGreaterThan(0);
    }
  });

  test(`${route} — no uncaught exceptions`, async ({ page }) => {
    const exceptions: string[] = [];
    page.on('pageerror', err => exceptions.push(err.message));
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    expect(exceptions).toEqual([]);
  });

  test(`${route} — screenshot captured`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: `screenshots/${route.replace(/\//g, '_')}.png`,
      fullPage: true
    });
  });
}
```

### 2.3 Auth Flow Tests

```
- Navigate to protected route without auth → verify redirect to sign-in
- Sign in with valid credentials → verify redirect to dashboard
- Sign in with invalid credentials → verify error message displayed
- Sign up flow → verify account creation
- Password reset flow → verify email sent confirmation
- Sign out → verify redirect and session cleared
```

### 2.4 Form Validation Tests

```
For every form discovered on every page:
  - Submit empty → verify required field errors shown
  - Submit with invalid data types → verify validation messages
  - Submit with valid data → verify success state
  - Test field-level validation (email format, password strength, etc.)
  - Verify submit button disabled during submission (no double-submit)
```

### 2.5 Navigation Tests

```
- Click every navigation link → verify correct page loads
- Browser back button → verify correct previous page
- Direct URL entry for every route → verify page loads (no broken deep links)
- 404 page → verify graceful handling of non-existent routes
```

### 2.6 Responsive Tests

```
For each page, test at three viewports:
  - Desktop: 1920x1080
  - Tablet: 768x1024
  - Mobile: 375x667

At each viewport:
  - No horizontal scrollbar (unless intentional)
  - No text overflow/truncation that breaks readability
  - Navigation is accessible (hamburger menu on mobile, etc.)
  - Interactive elements are tap-target sized on mobile (min 44x44px)
  - Screenshot captured at each viewport
```

### 2.7 Artifact Collection

```
Every Phase 2 run produces:
  - screenshots/[route]_[viewport].png — every page at every viewport
  - videos/[test-name].webm — video recording of FAILED tests only
  - test-results.json — structured pass/fail with timing data
  - coverage-report/ — which routes/components were tested
```

**Phase 2 timeout:** 5 minutes total. If it exceeds this, something is fundamentally wrong.

---

## Phase 3: Full Interactive Computer Use QA (AI-Driven — Maxed Out)

This is NOT screenshot analysis. This is Claude controlling a real browser — mouse, keyboard, clicks, scrolls — using the app exactly like a human would.

### 3.1 Environment Setup

```
- Browser: Chromium, NOT headless (Computer Use needs real pixels)
- Resolution: 1920x1080 (start desktop, resize during responsive tests)
- Screen recording: ON for entire session (produces full QA video)
- Super-log: Every action timestamped with before/after screenshots
- Network throttling available for loading state tests
```

### 3.2 Claude's QA Script

Claude receives:
- The original user prompt / app description
- The generated spec (what was supposed to be built)
- The route map from Phase 2
- Screenshots from Phase 2 (baseline reference)

Claude then executes:

```
FOR EACH PAGE:

  1. NAVIGATE
     - Click navigation to reach the page (don't type URL — test the nav)
     - Verify the page loaded correctly
     - Screenshot: "arrived at [page]"

  2. VISUAL INSPECTION
     - Does the layout match the spec/mockup?
     - Are all expected elements visible?
     - Is text readable and not truncated?
     - Are colors/branding consistent with style selection?
     - Is spacing/alignment reasonable?
     - Score: 0-100 with specific issues noted

  3. CLICK EVERY INTERACTIVE ELEMENT
     - Buttons: click each one, verify expected behavior
     - Links: click each one, verify navigation
     - Dropdowns: open, select option, verify selection registered
     - Modals: open, interact with content, close (click X, click outside, press Escape)
     - Tabs: click each tab, verify content switches
     - Toggles/switches: toggle on and off, verify state change
     - Accordions: expand and collapse each one
     - Screenshot before and after each interaction

  4. FORM TESTING (as a user would)
     - Find every form on the page
     - Fill with realistic data (not test123 — actual plausible inputs)
     - Submit and verify success
     - Clear and fill with bad data
     - Submit and verify error handling
     - Test tab-key navigation between fields
     - Test Enter key submission

  5. HOVER AND FOCUS STATES
     - Hover over every interactive element
     - Verify hover state exists (color change, underline, cursor change)
     - Tab through the page
     - Verify focus rings on focusable elements
     - Verify no focus traps (can tab out of modals, dropdowns)

  6. LOADING STATES
     - Throttle network to 3G
     - Navigate to data-heavy pages
     - Verify loading indicators appear
     - Verify content replaces loading state when complete
     - Verify no layout shift when content loads
     - Restore normal network

  7. RESPONSIVE CHECK
     - Resize browser to tablet (768px)
     - Verify layout adapts — no overflow, no broken elements
     - Test hamburger menu if present
     - Resize to mobile (375px)
     - Same checks
     - Resize back to desktop
     - Verify layout restores correctly

  8. EDGE CASES
     - Rapid double-click on submit buttons
     - Click back button during form submission
     - Open same modal twice rapidly
     - Scroll to bottom of long pages — verify footer visible
     - Test empty states (pages with no data)
```

### 3.3 Computer Use Output

```json
{
  "overall_score": 87,
  "pages_tested": 12,
  "interactions_tested": 156,
  "issues_found": [
    {
      "page": "/dashboard",
      "element": "Export button",
      "action": "click",
      "expected": "Download modal opens",
      "actual": "Nothing happened",
      "severity": "high",
      "screenshot_before": "s3://...",
      "screenshot_after": "s3://..."
    }
  ],
  "visual_issues": [
    {
      "page": "/settings",
      "description": "Save button overlaps sidebar on tablet viewport",
      "viewport": "768x1024",
      "severity": "medium",
      "screenshot": "s3://..."
    }
  ],
  "passed_interactions": 149,
  "failed_interactions": 7,
  "session_video": "s3://full-qa-session.webm",
  "duration_seconds": 180,
  "recommendation": "fix"  // "pass" | "fix" | "rebuild"
}
```

### 3.4 Dual Purpose: QA + Documentation

The same Computer Use session produces:
- **QA results** — what passed, what failed
- **User manual screenshots** — every page, every interaction, captured in sequence
- **Tutorial video** — the full session recording IS a walkthrough of the app
- **Documentation source** — action descriptions become step-by-step guides

Build docs and QA at the same time. Zero extra work.

---

## Phase 4: Multi-Build Consensus Analysis (The Trees Approach)

Run the entire pipeline (Phases 1-3) multiple times with different agents. Use consensus to find the optimal build.

### 4.1 Process

```
Build 1: Agent A builds from spec → Phase 1-3 testing → Results
Build 2: Agent B builds from spec → Phase 1-3 testing → Results
Build 3: Agent C builds from spec → Phase 1-3 testing → Results

(Optional: Build 4-5 for critical builds)

Consensus Analysis:
  - Diff all builds file-by-file
  - Where 2+ agree → that's the answer
  - Where all diverge → spec is ambiguous at that point
  - Ambiguous points → refine spec → rebuild those sections only
```

### 4.2 Scoring

```
Each build gets a composite score:
  Phase 1: Pass/Fail (binary gate)
  Phase 2: Tests passed / Tests total (percentage)
  Phase 3: Computer Use overall_score (0-100)

  Composite = (Phase2% * 0.4) + (Phase3_score * 0.6)

Winner: Highest composite score among builds that pass Phase 1
```

### 4.3 When To Use Trees

```
- Standard builds: 1 build, Phases 1-3. Most builds pass first time
  with deterministic specs.
- Important builds: 3 builds, consensus diff. For production launches.
- Critical builds: 5 builds, consensus diff + human review.
  For payment systems, auth systems, anything security-critical.
```

### 4.4 The Tightening Loop

Every time we use the builder to build something:
- We find gaps in the builder
- We fix them
- Next build is better
- Which makes the next test better
- Which finds subtler gaps

The builder builds the builder. Each pass gets straighter. Deterministic specs + Docker isolation + multi-build consensus = mechanical convergence toward perfection.

---

## Docker Container Specification

### Base Image

```dockerfile
FROM node:20.11.1-slim

# System deps for Playwright browsers + Computer Use
RUN apt-get update && apt-get install -y \
    libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 \
    libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libxshmfence1 \
    # X11 for non-headless browser (Computer Use needs pixels)
    xvfb x11-utils \
    && rm -rf /var/lib/apt/lists/*

# Pre-install Playwright browsers (cached in image — fast spin-up)
RUN npx playwright install chromium

WORKDIR /app
```

### Resource Limits

```yaml
container_limits:
  memory: 4GB          # Chromium + Playwright + Computer Use needs room
  cpu: 4 cores         # Parallel test execution
  disk: 10GB           # node_modules + build artifacts + screenshots/videos
  network:
    allowed_outbound:
      - "registry.npmjs.org:443"    # npm install
      - "localhost:*"                # the app itself
      - "api.anthropic.com:443"     # Computer Use API calls
    blocked_outbound: "*"           # everything else
  max_lifetime: 600s   # 10 minutes hard cap
  pids_limit: 512      # Chromium spawns many processes
```

### Container Lifecycle

```
1. Create temp directory on host
2. Write generated project files to temp directory
3. Spin up container from cached base image
4. Mount temp directory at /app
5. Start Xvfb (virtual display for Computer Use)
6. Execute Phase 1 (build validation)
7. Execute Phase 2 (Playwright tests)
8. Execute Phase 3 (Computer Use QA)
9. Collect all artifacts (screenshots, videos, test results, logs)
10. Destroy container
11. Clean up temp directory
12. Return results to orchestrator
```

### Security Constraints

```yaml
security:
  no_privileged_mode: true
  no_host_network: true
  no_host_mounts: true  # except the project temp dir, read-only where possible
  read_only_root_fs: false  # npm needs to write

  # Generated code scanning (runs BEFORE build)
  scan_for:
    - eval() usage
    - Function() constructor
    - dynamic imports from external URLs
    - fetch() to domains not in the app's config
    - process.env access (outside of config files)
    - fs module usage (server-side code only)
    - child_process usage
    - crypto mining patterns
    - obfuscated code

  # If scan triggers found:
  action: "block_and_report"
  # Build does not proceed. Flagged for review.
```

---

## Retry Logic

```
Attempt 1: Full pipeline (Phases 1-3)
  Fail? → Extract ALL error context (build errors, test failures,
          Computer Use issues, screenshots of failures)

Attempt 2: Feed cumulative errors to builder → Rebuild → Full pipeline
  Fail? → Extract cumulative context (attempt 1 + attempt 2 errors)

Attempt 3: Feed ALL context to builder → Rebuild → Full pipeline
  Fail? → Flag for human review. Do not ship.

Rules:
  - Max 3 retries per build
  - No retry on: security scan violations, resource limit exceeded
  - Each retry gets MORE context, not the same context
  - Builder sees: "Here's what you built. Here's what failed. Here's
    the screenshot showing the failure. Fix THIS SPECIFIC THING."
```

---

## Orchestration

```
Job Queue (Redis/BullMQ)
    ↓
Worker Process (Node.js)
    ├── Pulls job from queue
    ├── Writes generated files to temp dir
    ├── Spawns Docker container
    ├── Monitors container health (every 5s)
    ├── Streams logs in real-time
    ├── Collects artifacts on completion
    ├── Updates job status in database
    ├── Triggers retry or delivery
    └── Notifies customer on completion

Concurrency: Configurable (default: 3 concurrent builds per host)
Priority: Tier 2 (paid builds) > Tier 1 > Free
```

---

## Pass/Fail Criteria

```yaml
must_pass:
  phase_1_all_steps: true
  phase_2_test_percentage: 100%     # Zero tolerance on functional tests
  phase_2_no_console_errors: true
  phase_2_no_uncaught_exceptions: true
  phase_3_visual_score_minimum: 75  # Some visual flexibility
  phase_3_failed_interactions_max: 0 # Every button must work
  security_scan: clean

ship_criteria:
  all_must_pass: true
  # If ANY criteria fails after 3 retries → human review required
```

---

## Metrics & Monitoring

```yaml
metrics_tracked:
  - build_success_rate          # target: >95% on first attempt
  - average_total_pipeline_time # target: <5 minutes
  - phase_1_time                # target: <90 seconds
  - phase_2_time                # target: <120 seconds
  - phase_3_time                # target: <180 seconds
  - retry_rate                  # target: <15%
  - visual_score_average        # target: >85
  - customer_satisfaction_post_delivery
  - container_resource_usage    # memory, cpu peaks
  - queue_depth                 # real-time capacity planning
  - time_from_prompt_to_delivery # the number that matters most
```

---

## Implementation Priority

```
Phase 1 MVP (build for ourselves first):
  ✓ Docker base image with Playwright + Xvfb
  ✓ Full build validation (install, typecheck, lint, build, serve)
  ✓ Baseline smoke tests (console errors, blank pages, broken images)
  ✓ Auth flow tests
  ✓ Screenshot capture at all viewports
  ✓ Single retry with error feedback
  ✓ Results dashboard

Phase 2 Enhanced (add Computer Use):
  ✓ Full interactive Computer Use QA (the entire Phase 3 above)
  ✓ Form testing (valid + invalid data)
  ✓ Hover/focus state verification
  ✓ Loading state tests (network throttling)
  ✓ Session video recording
  ✓ Dual-purpose docs generation
  ✓ 3-attempt retry with cumulative context

Phase 3 Scale (production-ready):
  ✓ Multi-build consensus analysis (trees approach)
  ✓ Job queue with priority tiers
  ✓ Concurrent builds (3+ per host)
  ✓ Security scanning pre-build
  ✓ Metrics dashboard with real-time monitoring
  ✓ Auto-scaling based on queue depth

Phase 4 Polish:
  ✓ Customer-facing build progress UI (real-time status)
  ✓ Shareable test reports (link customer can send to stakeholders)
  ✓ Historical build comparison (is this build better than the last?)
  ✓ Automated regression detection across builds
```
