-- =====================================================
-- Initial Database Schema for AICoder 2025
-- =====================================================
-- This migration creates all necessary tables, indexes, 
-- RLS policies, and demo users for a fresh installation
-- =====================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. CREATE BASE TABLES
-- =====================================================

-- Profiles table (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles table (manages permissions)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user', 'moderator')) DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'invited', 'cancelled')),
  invitation_id UUID,
  invitation_sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id),
  UNIQUE(email)
);

-- User API keys table (stores user settings and API keys)
CREATE TABLE IF NOT EXISTS public.user_api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  key_name TEXT NOT NULL,
  key_value TEXT,
  sender_name TEXT,
  sender_email TEXT,
  sender_domain TEXT,
  resend_api_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key_name)
);

-- User metadata table (additional user information)
CREATE TABLE IF NOT EXISTS public.user_metadata (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  preferences JSONB DEFAULT '{}',
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin audit log table (tracks admin actions - no CASCADE DELETE to preserve history)
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id UUID,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id UUID,
  target_email TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- App settings table (global application configuration)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT,
  setting_type TEXT DEFAULT 'string',
  description TEXT,
  is_public BOOLEAN DEFAULT false,
  updated_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. CREATE INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_email ON user_roles(email);
CREATE INDEX IF NOT EXISTS idx_user_roles_status ON user_roles(status);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
CREATE INDEX IF NOT EXISTS idx_user_roles_created_by ON user_roles(created_by);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_metadata_user_id ON user_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_user_id ON admin_audit_log(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target_user_id ON admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(setting_key);
CREATE INDEX IF NOT EXISTS idx_app_settings_is_public ON app_settings(is_public);

-- =====================================================
-- 3. CREATE TRIGGER FUNCTIONS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to handle new user signup (supports invitations)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Create profile
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  
  -- Handle user role - either update existing invitation or create new record
  -- Check if there's an existing invitation for this email
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE email = new.email AND status = 'invited') THEN
    -- Update the existing invitation record with the new user_id
    UPDATE public.user_roles 
    SET 
      user_id = new.id,
      status = 'active',
      updated_at = NOW()
    WHERE email = new.email AND status = 'invited';
    
    -- Auto-confirm email for invitation signups (optional - remove if email confirmation is disabled)
    UPDATE auth.users 
    SET 
      email_confirmed_at = NOW(),
      confirmed_at = NOW(),
      updated_at = NOW()
    WHERE id = new.id;
  ELSE
    -- Create new user role for direct sign-ups (when allowed)
    INSERT INTO public.user_roles (user_id, email, role, status)
    VALUES (new.id, new.email, 'user', 'active')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  
  -- Create empty user metadata
  INSERT INTO public.user_metadata (user_id)
  VALUES (new.id)
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 4. CREATE TRIGGERS
-- =====================================================

-- Updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_roles_updated_at BEFORE UPDATE ON user_roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_api_keys_updated_at BEFORE UPDATE ON user_api_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_metadata_updated_at BEFORE UPDATE ON user_metadata
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- New user signup trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- 5. ENABLE ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 6. CREATE RLS POLICIES
-- =====================================================

-- Profiles policies
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- User roles policies
-- Allow users to view their own role
CREATE POLICY "Users can view their own role" ON user_roles
  FOR SELECT USING (auth.uid() = user_id);

-- Allow anyone to view pending invitations (needed for sign-up verification)
CREATE POLICY "Anyone can view invitations" ON user_roles
  FOR SELECT USING (
    status = 'invited' 
    AND invitation_id IS NOT NULL
  );

-- Service role bypass (for admin operations via API)
-- Note: Service role automatically bypasses RLS, this is just for clarity
CREATE POLICY "Service role full access" ON user_roles
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- User API keys policies
CREATE POLICY "Users can manage their own API keys" ON user_api_keys
  FOR ALL USING (auth.uid() = user_id);

-- User metadata policies
CREATE POLICY "Users can view their own metadata" ON user_metadata
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own metadata" ON user_metadata
  FOR UPDATE USING (auth.uid() = user_id);

-- Removed admin policy to prevent recursion
-- Admin access should be handled at the application level

-- Removed admin update policy to prevent recursion

-- Admin audit log policies
-- Admin audit log policies
-- Service role can view audit logs (admin operations use service role)
CREATE POLICY "Service role can view audit logs" ON admin_audit_log
  FOR SELECT USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "System can insert audit logs" ON admin_audit_log
  FOR INSERT WITH CHECK (true);

-- App settings policies
CREATE POLICY "Public settings are viewable by everyone" ON app_settings
  FOR SELECT USING (is_public = true);

-- Authenticated users can view all settings
CREATE POLICY "Authenticated users can view settings" ON app_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Service role can manage app settings
CREATE POLICY "Service role can manage app settings" ON app_settings
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- 7. GRANT PERMISSIONS TO ROLES
-- =====================================================
-- CRITICAL: Grant permissions to Supabase roles
-- Without these, even service_role cannot access tables!
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Grant usage on sequences for auto-incrementing IDs
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- =====================================================
-- 8. INSERT DEFAULT APP SETTINGS
-- =====================================================

INSERT INTO app_settings (setting_key, setting_value, setting_type, description, is_public)
VALUES 
  ('app_name', 'AICoder 2025', 'string', 'Application name displayed in the header and browser title', true),
  ('app_description', 'Modern AI-powered development codebase', 'string', 'Application description for meta tags and SEO', true),
  ('app_logo_url', '', 'string', 'URL to the application logo image', true),
  ('app_favicon_url', '', 'string', 'URL to the favicon file', true)
ON CONFLICT (setting_key) DO NOTHING;

-- =====================================================
-- 8. HELPER FUNCTION FOR ROLE UPDATES
-- =====================================================
-- This function allows updating user roles, bypassing RLS
-- Used by the setup script to promote admin users
CREATE OR REPLACE FUNCTION public.update_user_role(
  target_user_id UUID,
  new_role TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.user_roles
  SET role = new_role
  WHERE user_id = target_user_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION public.update_user_role TO service_role;

-- =====================================================
-- 9. DEMO USERS
-- =====================================================
-- Demo users cannot be created via SQL in Supabase.
-- After running this migration, use the Node.js script:
-- npm run setup:users
-- This will create test users with proper authentication.

-- =====================================================
-- 9. GRANT PERMISSIONS (if needed)
-- =====================================================
-- These are typically handled by Supabase automatically
-- but included for completeness

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- =====================================================
-- Migration Complete!
-- =====================================================