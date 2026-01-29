-- Migration: Add Stripe Admin Management Support
-- Description: Adds tables and columns for integrated Stripe product/price management with sync tracking
-- Created: 2025-08-26

BEGIN;

-- Add sync tracking columns to subscription_plans
ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS created_via VARCHAR(20) DEFAULT 'manual' CHECK (created_via IN ('manual', 'admin_ui', 'api', 'stripe_webhook')),
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS stripe_sync_status VARCHAR(20) DEFAULT 'synced' CHECK (stripe_sync_status IN ('synced', 'pending', 'error')),
ADD COLUMN IF NOT EXISTS sync_error_message TEXT,
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id);

-- Add index for sync status queries
CREATE INDEX IF NOT EXISTS idx_subscription_plans_sync_status 
ON subscription_plans(stripe_sync_status) 
WHERE stripe_sync_status != 'synced';

-- Add sync tracking columns to credit_packages
ALTER TABLE credit_packages
ADD COLUMN IF NOT EXISTS created_via VARCHAR(20) DEFAULT 'manual' CHECK (created_via IN ('manual', 'admin_ui', 'api', 'stripe_webhook')),
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS stripe_sync_status VARCHAR(20) DEFAULT 'synced' CHECK (stripe_sync_status IN ('synced', 'pending', 'error')),
ADD COLUMN IF NOT EXISTS sync_error_message TEXT,
ADD COLUMN IF NOT EXISTS stripe_product_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS popular_badge BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id);

-- Add unique constraint for Stripe product ID (skip if exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_stripe_product_id'
  ) THEN
    ALTER TABLE credit_packages
    ADD CONSTRAINT unique_stripe_product_id UNIQUE (stripe_product_id);
  END IF;
END $$;

-- Create stripe_sync_log table for tracking sync operations
CREATE TABLE IF NOT EXISTS stripe_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type VARCHAR(50) NOT NULL CHECK (sync_type IN ('manual', 'webhook', 'scheduled', 'api_call')),
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('to_stripe', 'from_stripe', 'bidirectional')),
  entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('product', 'price', 'subscription', 'customer')),
  entity_id VARCHAR(255),
  local_id UUID,
  action VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failure', 'partial')),
  request_data JSONB,
  response_data JSONB,
  error_message TEXT,
  performed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_stripe_sync_log_created_at ON stripe_sync_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_sync_log_entity ON stripe_sync_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_stripe_sync_log_status ON stripe_sync_log(status) WHERE status = 'failure';

-- Create price_history table for tracking historical pricing
CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES subscription_plans(id) ON DELETE CASCADE,
  stripe_price_id VARCHAR(255) NOT NULL,
  price_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  active_from TIMESTAMPTZ NOT NULL,
  active_until TIMESTAMPTZ,
  reason_for_change TEXT,
  changed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure non-overlapping price periods
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_history_active_price 
ON price_history(plan_id) 
WHERE active_until IS NULL;

-- Migrate existing data to include new fields
UPDATE subscription_plans 
SET created_via = 'manual',
    stripe_sync_status = 'synced',
    last_synced_at = NOW()
WHERE stripe_product_id IS NOT NULL
  AND created_via IS NULL;

UPDATE credit_packages
SET created_via = 'manual',
    stripe_sync_status = 'synced',
    last_synced_at = NOW()
WHERE stripe_price_id IS NOT NULL
  AND created_via IS NULL;

-- Create initial price history from current prices (only if not already exists)
INSERT INTO price_history (plan_id, stripe_price_id, price_cents, currency, active_from, reason_for_change)
SELECT id, stripe_price_id, price_cents, currency, created_at, 'Initial migration'
FROM subscription_plans
WHERE stripe_price_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM price_history ph 
    WHERE ph.plan_id = subscription_plans.id 
    AND ph.stripe_price_id = subscription_plans.stripe_price_id
  );

-- Enable RLS on new tables
ALTER TABLE stripe_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for stripe_sync_log
-- Admins can view sync logs
CREATE POLICY IF NOT EXISTS "Admins can view sync logs" ON stripe_sync_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_id = auth.uid() 
      AND role = 'admin' 
      AND status = 'active'
    )
  );

-- Service role can insert sync logs
CREATE POLICY IF NOT EXISTS "Service role can insert sync logs" ON stripe_sync_log
  FOR INSERT WITH CHECK (true);

-- Service role can update sync logs
CREATE POLICY IF NOT EXISTS "Service role can update sync logs" ON stripe_sync_log
  FOR UPDATE USING (true);

-- RLS Policies for price_history
-- Admins can view price history
CREATE POLICY IF NOT EXISTS "Admins can view price history" ON price_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_id = auth.uid() 
      AND role = 'admin' 
      AND status = 'active'
    )
  );

-- Service role can manage price history
CREATE POLICY IF NOT EXISTS "Service role can insert price history" ON price_history
  FOR INSERT WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can update price history" ON price_history
  FOR UPDATE USING (true);

-- Create function to log sync operations
CREATE OR REPLACE FUNCTION log_stripe_sync(
  p_sync_type VARCHAR,
  p_direction VARCHAR,
  p_entity_type VARCHAR,
  p_entity_id VARCHAR,
  p_local_id UUID,
  p_action VARCHAR,
  p_status VARCHAR,
  p_request_data JSONB DEFAULT NULL,
  p_response_data JSONB DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_performed_by UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO stripe_sync_log (
    sync_type, direction, entity_type, entity_id, local_id,
    action, status, request_data, response_data, error_message, performed_by
  ) VALUES (
    p_sync_type, p_direction, p_entity_type, p_entity_id, p_local_id,
    p_action, p_status, p_request_data, p_response_data, p_error_message, p_performed_by
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to archive plans safely
CREATE OR REPLACE FUNCTION archive_subscription_plan(
  p_plan_id UUID,
  p_archived_by UUID
) RETURNS BOOLEAN AS $$
BEGIN
  -- Check if plan has active subscriptions
  IF EXISTS (
    SELECT 1 FROM user_subscriptions 
    WHERE plan_id = p_plan_id 
    AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cannot archive plan with active subscriptions';
  END IF;
  
  -- Archive the plan
  UPDATE subscription_plans
  SET archived_at = NOW(),
      archived_by = p_archived_by,
      is_active = false
  WHERE id = p_plan_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get sync status summary
CREATE OR REPLACE FUNCTION get_sync_status_summary()
RETURNS TABLE (
  total_products INTEGER,
  synced_products INTEGER,
  pending_sync INTEGER,
  sync_errors INTEGER,
  last_sync_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER as total_products,
    COUNT(*) FILTER (WHERE stripe_sync_status = 'synced')::INTEGER as synced_products,
    COUNT(*) FILTER (WHERE stripe_sync_status = 'pending')::INTEGER as pending_sync,
    COUNT(*) FILTER (WHERE stripe_sync_status = 'error')::INTEGER as sync_errors,
    MAX(last_synced_at) as last_sync_at
  FROM subscription_plans
  WHERE archived_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions on functions to authenticated users
GRANT EXECUTE ON FUNCTION log_stripe_sync TO authenticated;
GRANT EXECUTE ON FUNCTION archive_subscription_plan TO authenticated;
GRANT EXECUTE ON FUNCTION get_sync_status_summary TO authenticated;

-- Add comment documentation
COMMENT ON TABLE stripe_sync_log IS 'Audit log for all Stripe synchronization operations';
COMMENT ON TABLE price_history IS 'Historical record of price changes for subscription plans';
COMMENT ON COLUMN subscription_plans.created_via IS 'Source of plan creation: manual, admin_ui, api, or stripe_webhook';
COMMENT ON COLUMN subscription_plans.stripe_sync_status IS 'Current synchronization status with Stripe';
COMMENT ON COLUMN subscription_plans.archived_at IS 'Soft delete timestamp - plan is hidden but data preserved';
COMMENT ON COLUMN credit_packages.display_order IS 'Display order for packages in UI (lower numbers appear first)';
COMMENT ON COLUMN credit_packages.popular_badge IS 'Whether to show a "Most Popular" badge on this package';

COMMIT;