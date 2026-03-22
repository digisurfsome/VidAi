# MVP Enterprise Stack — Feature Roadmap

## Finalized: 2026-03-22

---

## BUILD NOW (MVP Launch)

### 1. Real-Time Build Progress UI
**What:** WebSocket-powered live status page showing customers exactly what's happening during their build.
```
✅ Phase 1: Build Validation — passed (42s)
✅ Phase 2: Functional Tests — 15/15 passed (68s)
🔄 Phase 3: Interactive QA — testing page 4 of 7...
⏳ Phase 4: Final Assembly
```
**Why NOW:** Without this, customers think the build is broken every time it takes >30s. Support tickets on day one. The experience of watching your app get built IS a sales tool.

**Implementation:**
- WebSocket server for real-time push updates
- Build progress tracking in database (build_jobs table)
- React components: BuildProgressPage, BuildStatusCard, PhaseIndicator
- Event types: phase_start, phase_complete, test_result, screenshot_captured, build_complete, build_failed
- Auto-screenshot display as they're captured during testing

### 2. Build Idempotency
**What:** Every build request gets a unique idempotency key. Double-clicks, refreshes, browser hiccups — none of them spawn duplicate builds or double-charge.

**Why NOW:** Payment integrity. Double-charging someone on a $300 product destroys trust instantly. 30 minutes to implement, prevents lawsuits.

**Implementation:**
- Idempotency key generated client-side (UUID v4)
- Server checks for existing build with same key before creating
- Returns existing build status if duplicate detected
- Keys expire after 24 hours
- Stored in build_jobs table alongside build data

### 3. Per-App Secret Vault
**What:** Secure encrypted storage for each built app's API keys (Supabase, Stripe, email providers, etc.). Keys injected at build time into `.env.local`, never hardcoded in source.

**Why NOW:** Shipping hardcoded API keys in delivered source code is a security vulnerability. Contradicts the brand promise. Handle from day one.

**Implementation:**
- app_secrets table: app_id, key_name, encrypted_value, created_at
- Encryption at rest using AES-256-GCM
- Keys injected into .env.local during build Phase 1
- UI for customers to input/update keys per app
- When returning for edits, system already has the keys

### 4. Build Delivery Receipt
**What:** Structured receipt generated at delivery proving what was built, test results, and linking to the integrity system.

**Why NOW:** Without this, delivery is "here's a zip file" — feels like a $30 Fiverr gig. The receipt elevates the experience and ties directly into the Build Integrity System guarantee.

**Implementation:**
- Generated automatically at build completion
- Stored in build_deliveries table
- Includes: app name, date, phases completed, tests passed, files delivered, tech stack, routes, screenshots gallery link, test report link, manifest ID
- PDF generation for downloadable version
- Email delivery with receipt summary
- Links to Build Integrity System manifest

### 5. Automated Deployment (One-Click)
**What:** After build passes testing, one-click deploy to Vercel. Customer goes from idea to live URL without touching a terminal.

**Why NOW:** The gap between "here's your code" and "here's your live app" is where customers drop off. Closing that gap is the difference between a code generator and a full product delivery platform. This IS the product.

**Implementation:**
- Vercel API integration for project creation and deployment
- Git repo creation (GitHub) for the built app
- Environment variable injection from the secret vault
- Deploy status tracking (building → deploying → live)
- Custom domain support (later enhancement)
- Deployment URL returned to customer immediately
- Rollback capability using Vercel's deployment history
- Integration with Build Progress UI (deployment is the final phase)

### 6. Build Analytics Dashboard (Internal)
**What:** Internal dashboard tracking build success rates, failure patterns, average times, resource usage, and quality scores. Data-driven improvement of the builder itself.

**Why NOW:** We need this for ourselves from day one. Every build generates data. Without capturing it, we're flying blind on what works, what breaks, and what to improve. This data also becomes marketing ammunition ("94% first-attempt success rate").

**Implementation:**
- build_analytics table: captures every metric from every build
- Dashboard page in admin panel with Recharts visualizations
- Metrics: success rate, avg build time, retry rate, phase failure distribution, visual QA scores, time-to-delivery
- Filterable by date range, app type, complexity tier
- Export capability for reporting
- Real-time updates as builds complete

---

## BUILD LATER (Post-MVP)

### 7. Changelog Generator
**What:** Automatic changelog generation when edits are made through the system.
**When:** After apps are being actively edited (post-launch behavior).
**Effort:** Small

### 8. Mobile Wrapper Generation (Capacitor/Expo)
**What:** Convert web apps to iOS/Android apps. Massive upsell.
**When:** After core platform is stable. Requires app store submission knowledge, signing certs.
**Effort:** Large

### 9. Template Marketplace
**What:** Customers list successful builds as templates. Others start from proven templates. Revenue share.
**When:** After 50+ successful builds to seed the marketplace. Empty marketplace looks bad.
**Effort:** Large

### 10. Metaprogram Messaging Engine
**What:** Personalizes all in-app copy based on detected user psychology profiles.
**When:** After hundreds of users generate enough interaction data for detection.
**Effort:** Large

---

## Database Tables Required (New)

```sql
-- Build job tracking and progress
build_jobs (
  id UUID PRIMARY KEY,
  idempotency_key VARCHAR(255) UNIQUE,
  user_id UUID REFERENCES auth.users,
  app_id UUID,
  status VARCHAR(50),  -- queued, building, testing, deploying, complete, failed
  current_phase INTEGER,
  current_phase_name VARCHAR(100),
  phases_completed JSONB,
  progress_percentage INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_context JSONB,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Per-app secret storage
app_secrets (
  id UUID PRIMARY KEY,
  app_id UUID REFERENCES build_jobs(id),
  user_id UUID REFERENCES auth.users,
  key_name VARCHAR(255),
  encrypted_value TEXT,
  iv TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id, key_name)
)

-- Build delivery receipts
build_deliveries (
  id UUID PRIMARY KEY,
  build_job_id UUID REFERENCES build_jobs(id),
  user_id UUID REFERENCES auth.users,
  app_name VARCHAR(255),
  tech_stack JSONB,
  routes JSONB,
  files_delivered INTEGER,
  tests_passed INTEGER,
  tests_total INTEGER,
  visual_qa_score INTEGER,
  manifest_hash VARCHAR(255),
  receipt_pdf_url TEXT,
  screenshots JSONB,
  delivered_at TIMESTAMPTZ DEFAULT NOW()
)

-- Deployment tracking
app_deployments (
  id UUID PRIMARY KEY,
  build_job_id UUID REFERENCES build_jobs(id),
  user_id UUID REFERENCES auth.users,
  provider VARCHAR(50) DEFAULT 'vercel',
  deployment_url TEXT,
  deployment_id VARCHAR(255),
  github_repo_url TEXT,
  status VARCHAR(50),  -- creating, deploying, live, failed, rolled_back
  environment_vars_injected BOOLEAN DEFAULT FALSE,
  deployed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Build analytics metrics
build_analytics (
  id UUID PRIMARY KEY,
  build_job_id UUID REFERENCES build_jobs(id),
  phase_1_duration_ms INTEGER,
  phase_2_duration_ms INTEGER,
  phase_3_duration_ms INTEGER,
  total_duration_ms INTEGER,
  phase_1_passed BOOLEAN,
  phase_2_test_count INTEGER,
  phase_2_tests_passed INTEGER,
  phase_3_visual_score INTEGER,
  phase_3_interactions_tested INTEGER,
  phase_3_interactions_passed INTEGER,
  retry_count INTEGER DEFAULT 0,
  failure_phase INTEGER,
  failure_reason TEXT,
  app_complexity_tier VARCHAR(20),
  routes_count INTEGER,
  components_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Build progress events (for real-time WebSocket)
build_events (
  id UUID PRIMARY KEY,
  build_job_id UUID REFERENCES build_jobs(id),
  event_type VARCHAR(50),
  phase INTEGER,
  phase_name VARCHAR(100),
  message TEXT,
  data JSONB,
  screenshot_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

---

## Architecture Integration

These features integrate with the existing systems:

```
Build Integrity System (existing)
  ├── Delivery Receipt (NEW) → generates manifest + receipt at delivery
  ├── Secret Vault (NEW) → injects keys securely, never in source
  └── Deployment (NEW) → deploys verified build with injected secrets

Testing Pipeline (existing)
  ├── Build Progress UI (NEW) → streams test results in real-time
  ├── Idempotency (NEW) → prevents duplicate test runs
  └── Analytics Dashboard (NEW) → captures metrics from every test phase

Admin Dashboard (existing)
  └── Analytics Dashboard (NEW) → new admin tab with build metrics
```

---

## Implementation Order

1. **Database migrations** — all tables first (foundation)
2. **Build jobs + idempotency** — the core tracking (everything depends on this)
3. **Build events + progress UI** — real-time visibility
4. **Secret vault** — secure key management
5. **Delivery receipt** — generated at build completion
6. **Deployment system** — final phase of the pipeline
7. **Analytics dashboard** — aggregates data from everything above
