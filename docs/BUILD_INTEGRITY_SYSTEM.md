# Build Integrity & Guarantee System

## Overview

Every app delivered through our platform includes a Build Integrity System — a multi-layer verification framework that proves what we built, when we built it, and whether it's been modified since. This protects both us and the customer: they get a real guarantee backed by evidence, and we get protection against false claims.

---

## Technical Architecture

### Layer 1: Git Post-Commit Hook

A `.git/hooks/post-commit` script included in every delivered app. Fires automatically after any commit.

**What it sends (webhook to our API):**
```json
{
  "app_id": "unique-app-identifier",
  "timestamp": "ISO-8601",
  "files_changed": ["src/pages/Dashboard.tsx", "src/lib/api.ts"],
  "commit_hash": "a3f2b8c",
  "source": "unknown"
}
```

**When edits come through our platform:** The commit is tagged with `source: "our-platform"`. Unknown source = external edit.

**Limitations:** User can delete this file. That's fine — it's one layer, not the whole system. If webhooks stop arriving entirely, the server flags the app as "monitoring interrupted" which is itself a signal.

### Layer 2: Server-Side Repo Copy

At delivery, we retain a full copy of the codebase on our infrastructure. This is our source of truth.

- When the customer returns for any reason (edits, support, questions), we diff our copy against theirs
- Instant, irrefutable proof of outside modification
- They cannot tamper with this because they don't control it
- Updated every time they make changes through our system

### Layer 3: Signed Delivery Receipt

Cryptographic manifest generated at delivery:

```
DELIVERY MANIFEST
─────────────────────────────────────────
App ID:          abc-123-def
Customer:        [account ID]
Delivered:       2026-03-22T14:30:00Z
Total files:     47
Integrity hash:  sha256:9f8e7d6c5b4a3...

Per-file hashes:
  src/App.tsx              → sha256:a3f2b8c...
  src/pages/Dashboard.tsx  → sha256:7e1d4f9...
  src/lib/auth.ts          → sha256:b8c3e2a...
  [... every file ...]
```

- Stored on our server, timestamped, immutable
- New manifest generated after every edit made through our system
- Creates an unbroken chain: delivery → edit 1 → edit 2 → current state
- Functions like a notarized record — producible in any dispute

### Layer 4: Terms of Service

Clear, upfront language in the service agreement:

> "Our Build Guarantee covers the codebase as delivered and as modified through our platform. External modifications void the guarantee on affected files. We maintain cryptographic delivery records for verification purposes. Our delivered apps include a build integrity monitor; removing this monitor terminates guarantee coverage."

---

## Automated Response System

### When an Unknown-Source Commit Is Detected

**Timeline:**

1. **Immediate:** App flagged as "modified outside system" in database
2. **Within minutes:** Automated email sent (see template below)
3. **Dashboard update:** App status badge changes from green (pure) to yellow (modified)

### Email Template — External Modification Detected

Subject: Changes detected outside [Brand] — your build guarantee

---

Hey [name],

We detected changes to [App Name] made outside our build system on [date/time].

Here's why this matters: Our guarantee covers work done through our platform because our system includes safety protocols, validation checks, and architectural safeguards that protect your app's integrity. Changes made outside that system skip all of those protections.

**Your options:**

**Option A: Roll back and redo through us**
We have your last verified version saved. Come back to the platform, we'll restore your app to its last verified state, and you can make your changes through our system with full safety protocols.
→ [Button: Restore & Edit Through Our System]

**Option B: Keep your changes**
Totally your call. Your app, your code. Just know that our Build Guarantee no longer covers the modified files. If issues come up later, we can still help — it's just a standard credit-based edit, not a guaranteed fix.

Either way, your last verified build is always saved with us. We never delete it.

— [Brand] Team

---

## The Build Guarantee

### What We Guarantee

> Every app delivered through [Brand] comes with our Build Guarantee:
>
> 1. **It works as specified.** Every feature described in your approved spec functions as documented at the time of delivery.
> 2. **If we built it and it breaks — we fix it, no charge.** Defects in code we delivered or modified through our system are fixed at zero cost to you.
> 3. **Provable quality.** Every delivery comes with a cryptographic manifest proving exactly what was built and when. No ambiguity. No finger-pointing. Just receipts.
>
> **What voids the guarantee:**
> - Modifications to the codebase made outside our platform
> - Removal of the build integrity monitor
> - The guarantee applies to affected files only — if you modify 3 files externally, only those 3 files lose coverage. Everything else remains guaranteed.
>
> **Guarantee limits:**
> - One guarantee claim per app per 30-day period
> - Covers defects present at delivery or introduced through our edits, not issues caused by external services (API changes, hosting outages, etc.)
> - Abuse of guarantee claims results in account review

### Per-File Granularity

This is important: the guarantee is file-level, not all-or-nothing. If someone edits `src/pages/Dashboard.tsx` outside the system, only that file loses coverage. The other 46 files are still guaranteed. This is fair and precise — we're not punishing them for one external edit by voiding everything.

---

## Build Certificate & Public Verification

### The Badge

Every delivered app can display a "Built & Verified by [Brand]" badge. This links to a public verification page.

### Public Verification Page

URL: `[yourdomain].com/verify/[app-id]`

Displays:
- App name
- Original delivery date
- Last verified edit date
- Integrity status: VERIFIED (green) or MODIFIED (yellow)
- Number of verified edits through the platform
- "This app was built using [Brand]'s verified build system"

**Does NOT display:** Customer name (unless they opt in), file details, code, or any proprietary information.

### Why This Matters to the Customer

The badge is social proof for THEIR users. It says: "This app was professionally built and is actively maintained by the system that created it." It's like an SSL certificate for build quality.

When the app goes yellow (external modification), the badge reflects it. This creates natural motivation to stay in the system — not because we're forcing them, but because the green badge is worth something to their reputation.

### Badge Implementation

Simple embed code provided to the customer:
```html
<a href="https://[brand].com/verify/[app-id]">
  <img src="https://[brand].com/badge/[app-id]" alt="Built & Verified by [Brand]" />
</a>
```

Badge image is dynamically generated — green when pure, yellow when modified. No customer action needed; it updates automatically based on integrity status.

---

## Restoration Service

When someone edits outside the system and breaks things, we offer restoration:

1. Customer comes back (either via the automated email prompt or on their own)
2. We pull their last verified version from our server-side copy
3. We show them what changed (diff between their current state and last verified)
4. They choose: full restore to last verified, or selective restore (keep some external changes, revert others)
5. We apply their intended changes through our system with full safety protocols
6. New manifest generated, integrity chain restored, badge goes green

**Cost:** Standard credit-based edit. Not punitive pricing. The goal is to bring them back, not punish them.

**Positioning:** This is rescue, not punishment. "We kept a backup of your verified build specifically for moments like this."

---

## Reputation Defense Protocol

### If a Customer Publicly Complains

**Step 1:** Check their app's integrity status in the dashboard.

**Step 2a — App is PURE (green):**
This is our problem. Own it immediately. Fix it publicly. Respond:
> "Thank you for flagging this. Our records confirm this build is under our guarantee. We're on it and will have a fix for you [timeframe]. Apologies for the issue."

**Step 2b — App is MODIFIED (yellow):**
Respond factually, never aggressively:
> "We take every customer experience seriously. Our build integrity records show [App Name] was delivered on [date] with a verified manifest. Our records indicate [X] files were modified outside our system between [date] and [date]. Our Build Guarantee covers work done through our platform — we're always happy to help get things back on track through our system."

**Rules for public responses:**
- Never insult the customer
- Never use technical jargon to intimidate
- State only verifiable facts with dates
- Always offer to help (restoration service)
- Let the audience draw their own conclusions
- The facts are more devastating than any clapback

### What This Achieves

Anyone reading the exchange sees:
1. You have actual records with dates and cryptographic proof
2. You offered to help even after they edited outside your system
3. You're professional and factual, not emotional
4. The implication is clear without you having to say it

---

## Front-End Marketing Copy

### Website Section: "We Stand Behind Every Build"

**Headline:**
The only build platform that guarantees its work — with proof.

**Subheadline:**
Every app we deliver comes with a cryptographic Build Certificate. If we built it and it breaks, we fix it. No charge. No excuses. No ambiguity.

**Body:**

Most build tools hand you code and wish you luck. We don't work like that.

Every app delivered through [Brand] gets:

**A Build Guarantee.** If something we built doesn't work as specified, we fix it at no cost. Not a promise — a guarantee backed by cryptographic delivery records that prove exactly what we built and when.

**Build Integrity Monitoring.** Our system tracks the health of your codebase. If changes are made outside our platform, we'll let you know — because those changes skip the safety protocols that make your app solid in the first place.

**A Verified Build Certificate.** A public badge your users can see, confirming your app was professionally built and is actively maintained. Think of it like an SSL certificate for build quality.

**Instant Restoration.** Went outside our system and something broke? We kept your last verified version. Come back, we'll restore it, and you can make your changes through our system properly.

We're not trying to trap you. Your code is yours. You can edit it however you want with whatever tool you want. We just can't guarantee work we didn't do — the same way a mechanic can't warranty parts they didn't install.

Our system is built on years of engineering methodology that we protect fiercely. We don't hand out our process because AI makes it too easy to clone overnight. But we pour every bit of it into every app we build. That's why we can guarantee the result.

**CTA:** See what a verified build looks like →

---

### FAQ Section (addresses objections head-on)

**"So I can't edit my own code?"**
You absolutely can. It's your code, you own it completely. We just can't guarantee files that were modified outside our system. Think of it like a car warranty — you can take it to any mechanic, but the warranty covers work done at authorized shops.

**"What if I just need a quick one-line fix?"**
Bring it to us. Through our system, a one-line fix takes about 2 minutes and costs minimal credits. And your guarantee stays intact. If you do it yourself, we won't stop you — but that file loses guarantee coverage.

**"Isn't this just vendor lock-in?"**
No. Vendor lock-in means you CAN'T leave. You can leave anytime. Your code is standard [React/TypeScript/etc.] — no proprietary dependencies, no custom runtimes, nothing that ties you to us technically. We're betting that you'll WANT to stay because the quality of our system speaks for itself. If someone else builds better, go with them. We'd rather earn your business every time than trap you into it.

**"Why don't you share your build methodology?"**
Because AI makes it trivially easy to clone. We spent [time] developing a build system that combines [vague but impressive description — multi-layer safety protocols, deterministic architecture analysis, automated quality verification]. If we published it, there'd be 50 competitors by next week running worse versions of it. We'd rather keep it internal and let the results speak.

**"What if your servers go down? Does my app break?"**
No. Your app runs completely independently. The integrity monitor is a reporting tool, not a dependency. If our servers go down, your app keeps running perfectly. You just won't get integrity alerts until we're back up. Your app has zero runtime dependency on us.

---

## Additional Considerations

### Data Privacy
- We store file hashes and filenames only, never full source code in the webhook data
- The server-side repo copy is stored encrypted, access-controlled to the customer's account
- Customers can request deletion of their server-side copy at any time (this voids the guarantee)
- Webhook data retention: 2 years, then auto-deleted
- GDPR/CCPA compliant — all data tied to account, deletable on request

### Competitive Attack Mitigation
- Guarantee claims limited to 1 per app per 30 days
- Account creation requires verified payment method
- Pattern detection: if an account creates multiple apps and immediately files guarantee claims, flag for review
- Each build costs $249-349 — the economics of grief attacks don't work at this price point
- Guarantee covers defects at delivery, not "I don't like how it looks" — subjective complaints aren't defects

### Future Enhancement: Automated Integrity Scoring
As data accumulates, build an integrity score per customer:
- Always pure, never modified externally → high trust score → faster support, priority builds
- Frequently modified externally → lower trust score → standard support queue
- This is internal only, never displayed to the customer
- Used for operational prioritization, not punishment
