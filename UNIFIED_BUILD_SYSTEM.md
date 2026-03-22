# Unified Build System — Complete Architecture
## Synthesized from VidAi Analysis + PRD Maker Design + Deterministic Scaffolding Sessions

---

## THE 7-LAYER SAFETY SYSTEM

These seven independent safety nets stack together. Any ONE catches most problems.
All seven together = near-zero bugs surviving to production.

### 1. PROACTIVE WALLS (7-Question Scaffolding)
Before any code is written, every mechanism gets analyzed:
- What happens here?
- Is there only one way to do this, or can it vary?
- What must be true before this step can start?
- What are all possible outcomes?
- For each outcome, where do you go next?
- How do you verify this step was done correctly?
- Can this step be skipped?

Output: Wall/Door/Room classification for each step.
- WALL = deterministic, code handles it, no AI judgment
- DOOR = AI operates within strict constraints
- ROOM = AI has creative freedom (but topic-bounded)

### 2. SANDBOX DURING BUILD (File Scoping)
Each phase PRD specifies:
- Files agent CAN modify (explicit whitelist)
- Files agent can READ but NOT modify (reference patterns)
- Files agent must NOT touch (forbidden list)

### 3. GPS TRACKING AFTER BUILD (git diff)
`git diff --name-only $SNAPSHOT` — deterministic, unfoolable.
Compares every modified file against the allowed list.
Any unauthorized file change = entire build rejected + rolled back.

### 4. PULSE CHECK (After Every Feature, 2-5 min)
- npm run lint
- npm run build (type check)
- Run existing tests
- Check for unused imports
- Confirm dependencies in package.json

### 5. SEAM CHECK (After Database/API/Auth/Wire Changes, 10-20 min)
- Everything from Pulse Check, PLUS:
- Start/restart the app (zero console errors)
- Test the specific thing that just changed
- Test ONE thing that depends on what changed
- Check console + terminal for errors

### 6. FULL PROTOCOL (End of Every Phase, 30-60 min)
- Investigation 1: Map routes, journeys, components
- Investigation 2: Database schema and data flows
- Investigation 3: Bug hunt (logic, UI, data integrity, security)
- Static verification (lint, type check, full test suite)
- Functional verification (every user journey end-to-end)
- Database validation (query after every action)
- Edge cases (empty states, bad input, rapid clicks, auth)
- Cross-feature integration
- Responsive check (375px, 768px, 1280px)
- Fix everything found, re-verify, final report

### 7. ALIGNMENT PROTOCOL (Architectural Integrity)
1. AUTH: Do all new API endpoints verify Bearer tokens?
2. RLS: Do all new database tables have Row-Level Security?
3. VALIDATION: Do all new endpoints validate input?
4. CORS: Are new endpoints using domain whitelist (not *)?
5. CREDITS: Does anything touch the credit system? If yes, test atomicity.
6. TYPES: Any TypeScript errors? (npm run build catches these)
7. ROUTES: Are all new routes in App.tsx?
8. SECRETS: Are any API keys hardcoded? (should be in .env.local only)
9. ADMIN: Do admin-only features check user role server-side?
10. CLEANUP: Do React effects clean up on unmount?

---

## FEATURE TAGS (Auto-Detected, Drive Protocol Selection)

Every feature in a PRD gets tagged:
- [UI] — only changes visual stuff → PULSE CHECK
- [DATA] — touches database → SEAM CHECK
- [API] — new/modified API endpoint → SEAM CHECK
- [WIRE] — connects two existing things → SEAM CHECK
- [AUTH] — touches auth/permissions → SEAM CHECK
- [PHASE-END] — last feature in a phase → FULL PROTOCOL

---

## DETERMINISTIC BUILD WRAPPER (Bash Script)

```bash
#!/bin/bash
set -e  # Stop on ANY error

# ========== DETERMINISTIC: Setup ==========
SNAPSHOT=$(git rev-parse HEAD)
npm run build || { echo "ABORT: Build broken BEFORE phase start"; exit 1; }
npm run lint || { echo "ABORT: Lint broken BEFORE phase start"; exit 1; }

# ========== AI AGENT: Creative work ==========
# Agent runs with sandboxed PRD (file scoping enforced)

# ========== DETERMINISTIC: Post-build validation ==========
npm run build || { echo "FAIL: Build broken"; git reset --hard $SNAPSHOT; exit 1; }
npm run lint || { echo "FAIL: Lint broken"; git reset --hard $SNAPSHOT; exit 1; }

# Check forbidden files weren't modified
FORBIDDEN=$(git diff --name-only $SNAPSHOT | grep -E \
  "^(src/lib/supabase\.ts|src/contexts/AuthContext|api/stripe)" || true)
if [ -n "$FORBIDDEN" ]; then
  echo "FAIL: Agent modified forbidden files: $FORBIDDEN"
  git reset --hard $SNAPSHOT
  exit 1
fi

# Check new API endpoints have auth
for f in $(git diff --name-only $SNAPSHOT -- api/); do
  if ! grep -q "Bearer" "$f" 2>/dev/null; then
    echo "FAIL: $f missing auth token verification"
    exit 1
  fi
done

# Check new migrations have RLS
for f in $(git diff --name-only $SNAPSHOT -- supabase/migrations/); do
  if ! grep -q "ENABLE ROW LEVEL SECURITY" "$f" 2>/dev/null; then
    echo "WARNING: $f may be missing RLS policies"
  fi
done

echo "=== All deterministic checks passed ==="
git add -A && git commit -m "Phase N complete"
```

---

## PHASE PRD TEMPLATE

```
PHASE [N] PRD
=============

SANDBOX (files agent CAN modify):
  - [explicit file list]

READ-ONLY (reference files):
  - [files for pattern matching]

FORBIDDEN (must NOT touch):
  - [protected files/directories]

OBJECTIVE: [One clear sentence]

FEATURES:
  F01: [name] [UI]
  F02: [name] [DATA]
  F03: [name] [WIRE] [DEPENDS:F02]
  F04: [name] [PHASE-END]

PATTERNS TO FOLLOW:
  - Auth: copy pattern from [file:lines]
  - RLS: copy pattern from [file:lines]
  - UI: copy pattern from [file:lines]

DETERMINISTIC CHECKS:
  - npm run build must pass
  - npm run lint must pass
  - No forbidden files modified
  - All new API endpoints have Bearer auth
  - All new tables have RLS enabled
  - [Phase-specific checks]
```

---

## MARTIN'S 13 MODULES — HOW THEY MAP

| # | Module | Role in System |
|---|--------|---------------|
| 01 | Scaffold | Knowledge: file structure patterns |
| 02 | Auth | Knowledge: auth flow patterns |
| 03 | Data Layer | Knowledge: RLS, service layer patterns |
| 04 | UI Kit | Knowledge: component patterns |
| 05 | CRUD Flow | Knowledge: List→Detail→Create→Edit patterns |
| 06 | Polish | Knowledge: hover, transitions, a11y, error recovery |
| 07 | Style & Theming | Separate system: UI style picker |
| 08 | Bug Fix Protocol | Safety: baked into every phase as recovery step |
| 09 | Feature Add | Core: this IS the phase build pattern |
| 10 | Debug Protocol | Safety: baked into every phase as fallback |
| 11 | Clean Room | Utility: for reverse engineering (separate use case) |
| 12 | PRD Generator | Core: merges with PRD maker system |
| 13 | Testing Protocol | Safety: merges with Pulse/Seam/Full system |

These are NOT sequential steps. They're a knowledge base referenced by the build system.
Agent OS is the harness. Martin's modules are the engine knowledge.
Testing protocol is the brakes. Stripe minion pattern is the seatbelt.

---

## CODING ERAS (Progress Tracking)

| Era | Concept | You Have It? |
|-----|---------|-------------|
| 1 (1950s) | One big room (spaghetti) | Past this |
| 2 (1960s) | Walls/Functions | Current — 7-question scaffolding |
| 3 (1970s) | Labeled rooms/Modules | Building — phase grouping |
| 4 (1980s) | Reusable blueprints | Next — PRD maker templates |
| 5 (2000s) | Systems talk to each other | Future — API interfaces |
| 6 (2010s) | Orchestration | Future — multi-agent coordination |
| 7 (Now) | AI inside the walls | Current — the whole point |

---

## PAYMENT ABSTRACTION (Stripe/Square)

```
App → paymentService.createCheckout()
  paymentService internally:
    if PAYMENT_PROVIDER=square → SquareProvider
    if PAYMENT_PROVIDER=stripe → StripeProvider

Toggle: one environment variable. Switchover: 30 seconds.
```

Build wrapper in Phase 0. Add Square provider anytime.
Stripe code never deleted, just dormant.

---

## VIDAI SPECIFIC: BUILD PHASES

Phase 0: Security + stability + payment wrapper + pricing fix (~85K tokens)
Phase 1: Video extension 15-30s + aspect ratios (~110K tokens)
Phase 2: Script engine + templates (~190K tokens) [PARALLEL with Phase 3]
Phase 3: Social media distribution via Late.dev (~165K tokens) [PARALLEL with Phase 2]
Phase 4: Scalability infrastructure (~185K tokens)

Total: ~735K tokens across 8-10 sessions

---

## VIDAI SPECIFIC: PLATFORM VIDEO GROUPINGS

Video 1 (9:16 vertical): TikTok, Instagram Reels, YouTube Shorts, Facebook Reels, X
Video 2 (4:5 near-square): LinkedIn, Facebook Feed
Video 3 (16:9 landscape, optional): YouTube Standard, LinkedIn Desktop

Cost per concept (15-20s): $1.62-4.50 depending on model
Daily budget for 5 concepts: $10-20/day

---

## SOURCES & REFERENCES

- Stripe Minions Part 1: https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents
- Stripe Minions Part 2: https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2
- fal.ai Pricing: https://fal.ai/pricing
- Late.dev (Social Media API): https://getlate.dev/
- Martin's boilerplate: VidAi repo (this repo)
- AutoForge reference: https://github.com/digisurfsome/Greptacular
- Web Boilerplate: https://github.com/digisurfsome/Web-BoilerPlate-D2D
