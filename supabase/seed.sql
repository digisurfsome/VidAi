-- =====================================================
-- Development Seed Data
-- =====================================================
-- This file contains sample data for development/testing
-- DO NOT run this in production!
-- 
-- IMPORTANT: Users cannot be created via SQL in Supabase
-- Use the Node.js script instead: npm run setup:users
-- =====================================================

-- NOTE: auth.admin_create_user() is NOT a SQL function
-- It's a JavaScript SDK method that must be called from
-- a Node.js script with the service role key.
-- 
-- To create test users, run: npm run setup:users

-- After running the user creation script, you can optionally
-- run these commands to add sample data:

-- Update app settings (optional - customize for your app)
UPDATE app_settings 
SET setting_value = 'My Demo App' 
WHERE setting_key = 'app_name';

UPDATE app_settings 
SET setting_value = 'A demo application showcasing the boilerplate features' 
WHERE setting_key = 'app_description';

-- Summary output to confirm seed data
SELECT 
  'Seed data loaded!' as message,
  COUNT(*) as total_settings
FROM app_settings
WHERE setting_key IN ('app_name', 'app_description');

-- To view created users after running npm run setup:users
-- SELECT email, role, status FROM user_roles ORDER BY created_at;