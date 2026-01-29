# Supabase Setup Guide

This guide will help you set up a new Supabase project using this boilerplate's database schema.

## Prerequisites

- A Supabase account ([sign up free](https://supabase.com))
- Node.js installed locally
- Your application code configured with Supabase credentials

## Quick Start

### 1. Create a New Supabase Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click "New Project"
3. Fill in:
   - Project name
   - Database password (save this!)
   - Region (choose closest to your users)
4. Click "Create Project" and wait ~2 minutes for setup

### 2. Apply the Database Schema

1. Once your project is ready, click "SQL Editor" in the left sidebar
2. Click "New Query"
3. Copy the entire contents of `supabase/migrations/00000_initial_schema.sql`
4. Paste it into the SQL Editor
5. Click "Run" (or press Ctrl+Enter)

You should see "Success. No rows returned" - this means your schema is set up!

### 3. Get Your Project Credentials

1. Click "Settings" (gear icon) in the left sidebar
2. Click "API"
3. Copy these values to your `.env.local` file:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role secret` key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ Keep this secret!)

### 4. Create Test Users

After the migration is complete and your environment variables are set, create test users using the provided Node.js script:

```bash
npm run setup:users
```

This will create two test users:
- **Admin**: `admin@example.com` / `Password01`
- **User**: `user@example.com` / `Password01`

The script uses the Supabase Admin API to properly create authenticated users with the correct roles.

> **Note**: Users cannot be created directly via SQL in Supabase. The `npm run setup:users` script handles the proper authentication setup.

### 5. (Optional) Additional Demo Data

If you want more sample data for testing, you can run the `seed.sql` file:

1. Go to SQL Editor
2. Copy contents of `supabase/seed.sql`
3. Paste and run

This adds sample metadata, API keys, and audit logs to the test users.

## Verify Your Setup

1. **Check tables were created:**
   - Go to "Table Editor" in sidebar
   - You should see: `profiles`, `user_roles`, `user_api_keys`, `user_metadata`, `admin_audit_log`, `app_settings`

2. **Check test users were created:**
   - Go to "Authentication" → "Users"
   - You should see both test users with confirmed emails

3. **Test sign in:**
   - Start your app: `npm run dev`
   - Sign in with `admin@example.com` / `Password01`
   - You should see the "Admin" link in the dashboard sidebar

## What Gets Created

### By Supabase (automatic):
- `auth.users` table and authentication system
- JWT token handling
- Password reset and email verification flows

### By Your Migration:
- **User Management**: Profiles, roles, metadata tables with automatic triggers
- **Admin System**: User invitations, audit logging, admin dashboard access
- **App Settings**: Configurable app name, logo, and branding
- **Email System**: User-configurable email settings storage
- **Security**: Row Level Security (RLS) policies on all tables
- **Helper Functions**: `update_user_role()` for admin operations

## Troubleshooting

### "relation auth.users does not exist"
- Make sure you're running this in a Supabase project, not a regular Postgres database
- The `auth` schema is automatically created by Supabase

### npm run setup:users fails
- Check that `SUPABASE_SERVICE_ROLE_KEY` is set correctly in `.env.local`
- Verify your Supabase project URL is correct
- Make sure the migration has been run first

### Admin link doesn't appear
- The `setup:users` script should automatically set admin role
- If not, manually check the `user_roles` table in Table Editor
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is set in `.env.local`

### Can't sign in
- Verify your Supabase URL and anon key are correct in `.env.local`
- Check that users exist in Authentication → Users
- Ensure emails show as confirmed (green badge)

## Manual User Creation (Alternative)

If you prefer to create users manually instead of using the script:

1. **Create user in Dashboard:**
   - Go to Authentication → Users
   - Click "Add user" → "Create new user"
   - Enter email, password, check "Auto Confirm Email"

2. **Set admin role via SQL:**
   ```sql
   -- Use the RPC function to update role (bypasses RLS)
   SELECT update_user_role(
     (SELECT id FROM auth.users WHERE email = 'your-email@example.com'),
     'admin'
   );
   ```

## Next Steps

1. Sign in with your admin account
2. Configure application settings in Admin → Settings
3. Invite team members through Admin → Users → Invite
4. Set up email sending (optional) in Settings → Email Settings

## Database Schema Overview

```
auth.users (Managed by Supabase)
    ↓ (triggers on insert)
profiles - User display information
user_roles - Permission management (admin/user/moderator)
user_metadata - Additional user data
    ↓ (referenced by)
user_api_keys - API keys and email settings
admin_audit_log - Tracks all admin actions
app_settings - Global app configuration
```

All tables include RLS (Row Level Security) policies for data protection.