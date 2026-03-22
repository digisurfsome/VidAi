# VidAi Project State Document
## Captured: March 19, 2026

This document captures the complete analysis, decisions, and build plan for VidAi
as established during the initial deep-dive session.

---

## 1. WHAT WE HAVE (Current State)

### Video Generation Engine
- **Service:** fal.ai (pay-per-use API platform)
- **Package:** @fal-ai/client v1.6.2
- **Models configured:**
  - Veo 3.1 Fast (Google) — 8s max, 720p, ~$0.80-1.20/video, generates audio
  - Hailuo-02 Standard (MiniMax) — 6s max, 768p, ~$0.27/video, fast & cheap
  - MiniMax Image-to-Video — 6s max, needs source image + prompt
- **Key limitation:** 6-8 second clips per generation (API limit, not app limit)

### Video Extension Capability (NOT yet implemented)
- Veo 3.1 has "Extend Video" endpoint: `fal-ai/veo3.1/fast/extend-video`
- Extends by 7 seconds per iteration, up to 20 iterations = 148 seconds total
- Cost: ~$0.10-0.15/second for extensions
- Seamless stitching with audio continuation

### Authentication & User Management
- Supabase Auth with implicit flow (working)
- Admin role system with RLS policies (working)
- User invitation system with email delivery (working)
- CASCADE delete on user removal (working)
- Admin status caching in localStorage (working)

### Payment System (Stripe - Fully Integrated)
- Subscription plans: Basic $9.99/500cr, Pro $29.99/2000cr, Business $99.99/10000cr
- One-time credit packs: $4.99-$69.99
- Stripe Billing Portal for upgrades/downgrades/cancellations
- Webhook handling for payment events
- Test mode AND production mode separated
- Credit system with atomic database locks

### Admin Dashboard
- Tabbed interface: Overview, Users, Invitations, Settings, Audit Logs
- Stripe product/pricing management
- Sync monitoring between database and Stripe
- Complete audit trail

### Tech Stack
- React 18 + TypeScript + Vite
- TanStack Query for data fetching
- shadcn/ui component library
- Supabase (database, auth, storage)
- Serverless API functions (Vercel-ready)

---

## 2. CRITICAL BUGS TO FIX

### Bug 1: Double Credit Deduction (CRITICAL)
- **File:** api/generate-video.ts (lines 302-316 AND 343-359)
- **Issue:** deduct_credits() called TWICE per successful generation
- **Impact:** Users charged 2x per video
- **Fix:** Delete the duplicate deduction block

### Bug 2: CORS Wildcard (HIGH)
- **Issue:** Every API endpoint has `Access-Control-Allow-Origin: *`
- **Impact:** Any website can trigger actions on behalf of logged-in users
- **Fix:** Change to specific domain whitelist

### Bug 3: Stripe Webhook Pagination (MEDIUM)
- **File:** api/stripe-webhook-simple.ts (line 73)
- **Issue:** `listUsers()` without pagination — breaks with 1000+ users
- **Fix:** Use proper user lookup by email instead of listing all users

### Bug 4: Missing Input Validation on Admin Endpoints (MEDIUM)
- **Fix:** Add Zod schemas for admin API input validation

---

## 3. SECURITY ASSESSMENT

### Already Solid
- Row-Level Security (RLS) properly configured
- Auth tokens verified on all protected endpoints
- No hardcoded secrets in code
- Stripe webhook signatures validated
- Service role key never exposed to browser
- CASCADE delete works correctly

### Needs Fixing (Phase 0)
- CORS wildcard → domain whitelist
- Admin endpoint input validation
- Rate limiting on admin operations
- Admin status localStorage spoofing (low priority, server still checks)

---

## 4. SCALABILITY ASSESSMENT

### Current Capacity
- 1-100 users: VIABLE (with bug fixes)
- 100-500 users: VIABLE (with optimization)
- 500-1000 users: PROBLEMATIC (needs refactoring)
- 1000+ users: WILL BREAK (needs architecture changes)

### Scalability Fixes Needed
1. Connection pooling (singleton Supabase clients) — ~500+ users
2. Job queue for video generation (BullMQ) — ~200+ concurrent generations
3. Distributed rate limiting — ~500+ users
4. Webhook-based status (replace 5s polling) — ~500+ users
5. Missing database indexes (user_subscriptions, credit_transactions)
6. CDN for video delivery

---

## 5. PRICING FIX (CRITICAL BEFORE LAUNCH)

### Current Problem
1 credit = 1 video = $0.27-1.50 API cost, but plans give 500 credits for $9.99.
THIS LOSES MONEY ON EVERY CUSTOMER.

### Solution Options
- Option A: Make 1 video cost 25-50 credits (500 credits = 10-20 videos)
- Option B: Price plans at $49-199/month with fewer credits
- Option C: Limit model access by tier (Basic=Hailuo only, Pro=Veo Fast, Business=Veo Standard)
- **Implementation:** Change numbers in src/lib/credits.ts and admin Stripe dashboard

---

## 6. PAYMENT STRATEGY

### Decision: Start with Square, Keep Stripe as Backup
- Build payment abstraction wrapper (src/lib/payment-service.ts)
- Active provider controlled by env variable: PAYMENT_PROVIDER=square
- Square implementation first (owner already uses Square, no denial risk)
- Stripe code preserved but dormant
- Toggle between providers by changing one env variable
- Risk level: LOW

### Wrapper Architecture
```
App → paymentService.createCheckout()
  paymentService internally → SquareProvider (active)
                            → StripeProvider (dormant, ready)
```

---

## 7. BUILD PLAN (Phases)

### Phase 0: Security + Stability + Payment Wrapper (~85K tokens, 1 session)
- Fix double credit deduction
- Fix CORS from * to domain whitelist
- Add input validation on admin endpoints
- Fix Stripe webhook pagination bug
- Add connection pooling (singleton clients)
- Add missing database indexes
- Build payment abstraction wrapper
- Add Square provider
- Fix credit-to-cost pricing

### Phase 1: Video Extension (~110K tokens, 1-2 sessions)
- Add Veo 3.1 Extend Video endpoint (8s → 30-60s+)
- Add multi-clip stitching with ffmpeg
- Add aspect ratio variants (9:16, 4:5, 16:9)
- THIS enables owner to start making marketing videos immediately

### Phase 2: Script Engine + Templates (~190K tokens, 2-3 sessions)
- Template library (database + CRUD + UI)
- AI script generator (OpenAI/Claude → scene-by-scene prompts)
- Idea → Template → Script → Multi-scene pipeline
- CAN RUN PARALLEL with Phase 3

### Phase 3: Social Media Distribution (~165K tokens, 2 sessions)
- Late.dev API integration ($19/mo, 13 platforms)
- Platform-specific caption templates
- Scheduling UI (calendar/queue)
- Batch processing (multiple ideas → multiple videos)
- CAN RUN PARALLEL with Phase 2

### Phase 4: Scalability (~185K tokens, 2 sessions)
- Job queue (BullMQ or similar)
- Distributed rate limiting
- Webhook-based status (replace polling)
- CDN for video delivery

### Total: ~735K tokens across 8-10 sessions

---

## 8. PLATFORM VIDEO FORMAT GROUPINGS

### Only Need 2-3 Videos Per Concept

**Video 1: Vertical (9:16) — Covers 5 platforms**
- TikTok, Instagram Reels, YouTube Shorts, Facebook Reels, X (Twitter)

**Video 2: Near-Square (4:5) — Covers 2 platforms**
- LinkedIn, Facebook Feed

**Video 3 (optional): Landscape (16:9) — Covers 2 platforms**
- YouTube Standard, LinkedIn Desktop

### Cost Per Concept (15-20s videos, all platforms)
- Budget (Hailuo): ~$1.62-2.94
- Quality (Veo 3.1 Fast): ~$3.00-4.50
- Daily budget for 5 concepts: ~$10-20/day

---

## 9. SOCIAL MEDIA POSTING

### Decision: Late.dev ($19/month)
- 13 platforms via single API
- Video posting included on all plans (even free)
- 120 posts/month on starter plan
- Upgrade to Ayrshare ($149/mo) later when customers need analytics/DM management

---

## 10. SAFETY SYSTEM (Build Integrity)

### Sandbox Rules (per phase PRD)
- Explicit list of files agent CAN modify
- Explicit list of files agent can READ but not modify
- Explicit list of FORBIDDEN files

### Deterministic Checks (bash script, runs after every phase)
1. npm run build (must pass)
2. npm run lint (must pass)
3. git diff against snapshot — check no forbidden files modified
4. All new API endpoints have Bearer token auth
5. All new database tables have RLS enabled
6. No secrets hardcoded in source

### Alignment Protocol (10-point check)
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

### Stripe Minions Blueprint Pattern
- Deterministic setup → AI builds → Deterministic verification → AI fixes → Deterministic commit
- Agent scoped to specific files only
- Rollback on any check failure: git reset --hard $SNAPSHOT

---

## 11. THE FLYWHEEL

1. App makes videos → owner uses it for own marketing (cost: $1-5/video)
2. Post videos → free organic social media marketing
3. People see videos → some sign up for the app
4. Subscriptions → revenue funds development
5. Revenue → hire Martin's team for future apps
6. Repeat with each new app

The product IS the marketing tool. Every commercial is both an ad AND a product demo.

---

## 12. KEY FILES REFERENCE

| File | Purpose |
|------|---------|
| src/lib/fal-client.js | Model definitions, helpers |
| api/generate-video.ts | Main video generation (HAS BUGS) |
| api/generation-status.ts | Status polling |
| api/generations.ts | History retrieval |
| src/pages/GeneratePage.tsx | Frontend UI & polling |
| src/lib/credits.ts | Credit system (NEEDS PRICING FIX) |
| src/lib/api-keys.ts | User/admin API key resolution |
| api/stripe-webhook-simple.ts | Stripe webhooks (HAS BUG) |
| src/contexts/AuthContext.tsx | Auth state management |
| src/lib/supabase.ts | Supabase client config |

---

## 13. DECISIONS MADE
- Stay with fal.ai as video engine (cheapest, already integrated)
- Start with Square payments, keep Stripe as backup via wrapper
- Use Late.dev ($19/mo) for social media posting
- Build phases sequentially with fresh context windows
- Sandbox + deterministic checks after every phase
- Fix ALL security/stability issues before any feature work
- Target 15-20 second videos (not 30-60s) for marketing efficiency
