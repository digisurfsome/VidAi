# Scripts Directory

This directory contains utility scripts for VideoGen AI.

## create-test-users.js

Creates test users for development using the Supabase Admin API.

### Prerequisites

1. Supabase project set up with the initial schema migration
2. Environment variables configured in `.env.local`:
   - `VITE_SUPABASE_URL` - Your Supabase project URL  
   - `SUPABASE_SERVICE_ROLE_KEY` - Service role key (REQUIRED!)

### Usage

```bash
npm run setup:users
```

### What it does

1. Creates two test users in Supabase Auth:
   - `admin@example.com` (Password: Password01) - Admin role
   - `user@example.com` (Password: Password01) - User role

2. Updates user profiles with display names

3. Sets appropriate roles in the `user_roles` table

### Important Notes

- The script uses the Supabase JavaScript SDK, NOT SQL commands
- `auth.admin_create_user()` is a JavaScript method, not a SQL function
- Service role key is required to bypass Row Level Security
- Script handles existing users gracefully (skips if already created)

### Troubleshooting

If you get an error:
1. Check that your `.env.local` file exists and has the correct values
2. Ensure the initial migration has been run
3. Verify your Supabase project is active and accessible
4. Check that the service role key is correct (get from Supabase dashboard)