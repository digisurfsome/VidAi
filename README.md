# VideoGen AI — AI Video Generation Platform

A production-ready SaaS platform for AI-powered video generation with subscription billing, credit system, and comprehensive admin controls.

## Features

- **AI Video Generation** — Generate videos using fal.ai models (Minimax, Wan T2V, image-to-video)
- **Credit System** — Per-user credit balance with real-time tracking
- **Subscription Billing** — Stripe integration for recurring subscriptions
- **One-Time Purchases** — Credit packages for additional credits
- **Admin Dashboard** — User management, billing analytics, and system configuration
- **Email System** — Transactional emails via Resend for invitations and notifications

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS |
| UI Components | shadcn/ui, Radix UI |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Payments | Stripe (subscriptions, one-time, webhooks) |
| Video AI | fal.ai (Minimax, Wan T2V models) |
| Email | Resend |
| Deployment | Vercel (serverless functions) |

## Prerequisites

Before you begin, make sure you have:

- **Node.js** 18+ (20+ recommended) — [Download here](https://nodejs.org)
- **npm** (included with Node.js)
- **Supabase account** — [Sign up free](https://supabase.com)
- **Stripe account** — [Sign up here](https://stripe.com)
- **fal.ai account** — [Sign up here](https://fal.ai)
- **Resend account** (optional, for email) — [Sign up here](https://resend.com)

---

## Quick Start Guide

Follow these steps in order to get the application running.

### Step 1: Clone and Install

```bash
git clone https://github.com/martincrumlish/videogenai.git
cd videogenai
npm install
```

### Step 2: Create Environment File

```bash
cp .env.example .env.local
```

Open `.env.local` in your editor and fill in your credentials (see Step 3 and 4 for where to get them).

### Step 3: Set Up Supabase Database

This is the most important step. Follow the detailed guide:

**👉 [supabase/README.md](supabase/README.md)** — Complete Supabase setup instructions

Quick summary:
1. Create a new Supabase project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Go to **Settings → API** and copy your credentials to `.env.local`:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role secret` key → `SUPABASE_SERVICE_ROLE_KEY`
3. Go to **SQL Editor** and run the migrations from `supabase/migrations/` folder (start with `00000_initial_schema.sql`)
4. Go to **Authentication → URL Configuration** and add these redirect URLs:
   ```
   http://localhost:8080/auth/callback
   http://localhost:8080/auth/update-password
   ```

### Step 4: Set Up Stripe (for payments)

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Go to **Developers → API keys** and copy to `.env.local`:
   - Publishable key → `VITE_STRIPE_PUBLISHABLE_KEY`
   - Secret key → `STRIPE_SECRET_KEY`
3. Set up webhooks (see [Stripe Setup](#stripe-setup) section below)

### Step 5: Set Up fal.ai (for video generation)

1. Create an account at [fal.ai](https://fal.ai)
2. Get your API key from the dashboard
3. Add to `.env.local`: `FAL_KEY=your-fal-api-key`

### Step 6: Create Test Users

After completing the database setup, create test users:

```bash
npm run setup:users
```

This creates two accounts for testing:
- **Admin**: `admin@example.com` / `Password01`
- **User**: `user@example.com` / `Password01`

**👉 [scripts/README.md](scripts/README.md)** — Troubleshooting if this fails

### Step 7: Start the Application

```bash
npm run dev
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

### Step 8: Sign In and Test

1. Sign in with `admin@example.com` / `Password01`
2. You should see the Admin link in the sidebar (confirms admin role works)
3. Go to **Generate** to test video generation (requires fal.ai API key and credits)

---

## Available Scripts

| Command | Description | More Info |
|---------|-------------|-----------|
| `npm run dev` | Start development server on port 8080 | |
| `npm run build` | Build for production | |
| `npm run preview` | Preview production build locally | |
| `npm run lint` | Run ESLint to check code | |
| `npm run setup:users` | Create test admin and user accounts | [scripts/README.md](scripts/README.md) |

---

## Stripe Setup

### Create Products in Stripe Dashboard

1. Go to **Products** in Stripe Dashboard
2. Create subscription products (e.g., Basic, Pro, Business)
3. Add recurring prices for each product
4. Note the **Product ID** (`prod_xxx`) and **Price ID** (`price_xxx`)

### Add Plans to Database

Run this SQL in Supabase SQL Editor:

```sql
INSERT INTO subscription_plans (
  stripe_product_id, stripe_price_id, name, description,
  price_cents, currency, interval, interval_count,
  features, is_active, display_order, monthly_credits
) VALUES (
  'prod_xxxxx', 'price_xxxxx', 'Pro',
  'For growing businesses',
  2999, 'usd', 'month', 1,
  '{"credits": 2000, "support": "priority"}',
  true, 2, 2000
);
```

### Configure Webhooks

**For Local Development:**

1. Install Stripe CLI: [stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli)
2. Run these commands:
   ```bash
   stripe login
   stripe listen --forward-to localhost:8080/api/stripe-webhook
   ```
3. Copy the webhook signing secret (`whsec_...`) to `.env.local` as `STRIPE_WEBHOOK_SECRET`

**For Production:**

1. Go to Stripe Dashboard → **Webhooks** → **Add endpoint**
2. Set endpoint URL: `https://your-domain.com/api/stripe-webhook`
3. Select events: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_*`
4. Copy the signing secret to your production environment variables

---

## Credit Packages

Add one-time credit purchase options (run in Supabase SQL Editor):

```sql
INSERT INTO credit_packages (
  name, credits, price_cents, currency,
  description, is_active, display_order, bonus_percentage
) VALUES
  ('Starter', 500, 499, 'usd', 'Try the platform', true, 1, 0),
  ('Popular', 1100, 899, 'usd', 'Best value', true, 2, 10),
  ('Bulk', 6000, 3999, 'usd', 'For power users', true, 3, 20);
```

---

## Email Configuration (Optional)

To enable invitation emails and notifications:

1. Create a [Resend](https://resend.com) account
2. Get your API key (starts with `re_`)
3. Run this SQL (replace `<admin-user-uuid>` with your admin user's ID from Supabase Auth):

```sql
INSERT INTO user_api_keys (user_id, key_name, key_value) VALUES
  ('<admin-user-uuid>', 'sender_name', 'VideoGen AI'),
  ('<admin-user-uuid>', 'sender_email', 'noreply@yourdomain.com'),
  ('<admin-user-uuid>', 'resend_api_key', 're_your_api_key');
```

---

## Project Structure

```
├── src/
│   ├── pages/              # Page components
│   │   ├── Index.tsx       # Landing page
│   │   ├── GeneratePage.tsx    # Video generation UI
│   │   └── admin/          # Admin pages (11 pages)
│   ├── components/
│   │   ├── ui/             # shadcn/ui components
│   │   └── auth/           # Auth components
│   ├── lib/                # Utilities and API clients
│   ├── hooks/              # Custom React hooks
│   ├── contexts/           # React context providers
│   └── App.tsx             # Routes and layouts
├── api/                    # Serverless API functions
├── supabase/
│   ├── migrations/         # SQL migrations (run these first!)
│   ├── seed.sql            # Optional sample data
│   └── README.md           # Database setup guide
├── scripts/
│   └── README.md           # Scripts documentation
└── public/                 # Static assets
```

---

## Deployment (Vercel)

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) and import your repository
3. Add all environment variables from `.env.local`
4. Use production Stripe keys (`pk_live_`, `sk_live_`)
5. Set `VITE_APP_URL` to your production domain
6. Update Supabase redirect URLs with your production domain
7. Create production Stripe webhook pointing to your domain

---

## Testing Payments

Use these test card numbers in Stripe test mode:

| Card Number | Result |
|-------------|--------|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 0002` | Decline |
| `4000 0025 0000 3155` | Requires authentication |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Missing Supabase configuration" | Check `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` |
| Admin API errors / RLS errors | Ensure `SUPABASE_SERVICE_ROLE_KEY` is set correctly |
| Stripe webhook not working | Verify `STRIPE_WEBHOOK_SECRET` matches your webhook signing secret |
| Credits not adding after payment | Check webhook is receiving events in Stripe Dashboard |
| `npm run setup:users` fails | See [scripts/README.md](scripts/README.md) for troubleshooting |
| Video generation fails | Check fal.ai API key is set and user has credits |
| Admin link not showing | Run `npm run setup:users` or manually set role in `user_roles` table |

---

## Documentation

| Document | Description |
|----------|-------------|
| [supabase/README.md](supabase/README.md) | Complete database setup guide |
| [scripts/README.md](scripts/README.md) | Test user creation script documentation |

---

