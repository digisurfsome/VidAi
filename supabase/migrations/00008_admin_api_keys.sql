-- Migration: Add admin API keys to app_settings table
-- Description: Allows admins to configure default API keys that users can fall back to
-- Created: 2025-08-31

-- Add admin OpenAI API key setting
INSERT INTO app_settings (setting_key, setting_value, setting_type, description, is_public, updated_at)
VALUES (
  'admin_openai_api_key',
  NULL,
  'string',
  'Default OpenAI API key for users without their own key configured',
  false,
  NOW()
) ON CONFLICT (setting_key) DO NOTHING;

-- Add admin fal.ai API key setting
INSERT INTO app_settings (setting_key, setting_value, setting_type, description, is_public, updated_at)
VALUES (
  'admin_fal_api_key',
  NULL,
  'string',
  'Default fal.ai API key for users without their own key configured',
  false,
  NOW()
) ON CONFLICT (setting_key) DO NOTHING;

-- Update RLS policies to ensure only admins can modify these keys
-- but service role can read them for API resolution

-- Drop existing update policy if it exists
DROP POLICY IF EXISTS "Admins can update app settings" ON app_settings;

-- Create new policy that specifically protects admin API keys
CREATE POLICY "Admins can update app settings" ON app_settings
  FOR UPDATE
  USING (
    -- Check if user is admin
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role = 'admin'
    )
  )
  WITH CHECK (
    -- Ensure only admins can update admin API keys
    CASE 
      WHEN setting_key IN ('admin_openai_api_key', 'admin_fal_api_key') THEN
        EXISTS (
          SELECT 1 FROM user_roles
          WHERE user_id = auth.uid()
          AND role = 'admin'
        )
      ELSE true
    END
  );

-- Ensure insert policy also protects admin API keys
DROP POLICY IF EXISTS "Admins can insert app settings" ON app_settings;

CREATE POLICY "Admins can insert app settings" ON app_settings
  FOR INSERT
  WITH CHECK (
    -- Only admins can insert any app settings
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- Add audit log trigger for admin API key changes
CREATE OR REPLACE FUNCTION audit_admin_api_key_changes()
RETURNS TRIGGER AS $$
DECLARE
  admin_user_email TEXT;
BEGIN
  -- Only log changes to admin API keys
  IF NEW.setting_key IN ('admin_openai_api_key', 'admin_fal_api_key') THEN
    -- Get admin email for logging
    SELECT email INTO admin_user_email
    FROM auth.users
    WHERE id = auth.uid();
    
    -- Log the change (without exposing the actual key value)
    INSERT INTO admin_audit_log (
      admin_user_id,
      admin_email,
      action,
      target_user_id,
      target_email,
      details,
      created_at
    ) VALUES (
      auth.uid(),
      COALESCE(admin_user_email, 'system'),
      CASE 
        WHEN OLD.setting_value IS NULL AND NEW.setting_value IS NOT NULL THEN 'create_admin_api_key'
        WHEN OLD.setting_value IS NOT NULL AND NEW.setting_value IS NULL THEN 'delete_admin_api_key'
        ELSE 'update_admin_api_key'
      END,
      NULL, -- No target user for admin key changes
      NULL, -- No target email for admin key changes
      jsonb_build_object(
        'key_type', CASE 
          WHEN NEW.setting_key = 'admin_openai_api_key' THEN 'OpenAI'
          WHEN NEW.setting_key = 'admin_fal_api_key' THEN 'fal.ai'
        END,
        'setting_key', NEW.setting_key,
        'action_description', CASE 
          WHEN OLD.setting_value IS NULL AND NEW.setting_value IS NOT NULL THEN 'Admin API key configured'
          WHEN OLD.setting_value IS NOT NULL AND NEW.setting_value IS NULL THEN 'Admin API key removed'
          ELSE 'Admin API key updated'
        END,
        'timestamp', NOW()
      ),
      NOW()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for admin API key changes
DROP TRIGGER IF EXISTS audit_admin_api_key_changes_trigger ON app_settings;
CREATE TRIGGER audit_admin_api_key_changes_trigger
  AFTER INSERT OR UPDATE ON app_settings
  FOR EACH ROW
  EXECUTE FUNCTION audit_admin_api_key_changes();

-- Add comment for documentation
COMMENT ON COLUMN app_settings.setting_value IS 'Setting value. For admin API keys, this stores the actual API key securely.';

-- Grant necessary permissions to service role for reading admin keys
-- This is needed for the API endpoints to access admin keys for fallback
GRANT SELECT ON app_settings TO service_role;

-- Add index for faster lookups of admin API keys
CREATE INDEX IF NOT EXISTS idx_app_settings_admin_api_keys 
  ON app_settings(setting_key) 
  WHERE setting_key IN ('admin_openai_api_key', 'admin_fal_api_key');
