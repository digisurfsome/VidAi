-- =====================================================
-- Add Test Mode Support
-- =====================================================
-- This migration adds support for test/sandbox mode to distinguish
-- test data from production data across all relevant tables.

-- 1. Add is_test flag to user-related tables
-- =====================================================

-- Add is_test to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

-- Add is_test to user_credits table
ALTER TABLE user_credits 
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

-- Add is_test to credit_transactions table
ALTER TABLE credit_transactions 
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

-- Add is_test to user_subscriptions table
ALTER TABLE user_subscriptions 
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

-- Add is_test to payment_transactions table
ALTER TABLE payment_transactions 
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

-- Add is_test to video_generations table
ALTER TABLE video_generations 
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

-- Add is_test to stripe_customers table
ALTER TABLE stripe_customers 
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

-- 2. Add test mode tracking to plans and packages
-- =====================================================

-- Add is_test to subscription_plans table (for test-only plans)
ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

-- Add is_test to credit_packages table (for test-only packages)
ALTER TABLE credit_packages 
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

-- 3. Create indexes for efficient filtering
-- =====================================================

-- Index for filtering test users
CREATE INDEX IF NOT EXISTS idx_profiles_is_test 
ON profiles(is_test) 
WHERE is_test = TRUE;

-- Index for filtering test transactions
CREATE INDEX IF NOT EXISTS idx_credit_transactions_is_test 
ON credit_transactions(is_test) 
WHERE is_test = TRUE;

-- Index for filtering test subscriptions
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_is_test 
ON user_subscriptions(is_test) 
WHERE is_test = TRUE;

-- Index for filtering test payments
CREATE INDEX IF NOT EXISTS idx_payment_transactions_is_test 
ON payment_transactions(is_test) 
WHERE is_test = TRUE;

-- 4. Create helper functions
-- =====================================================

-- Function to mark a user and all their data as test
CREATE OR REPLACE FUNCTION mark_user_as_test(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Update profiles
    UPDATE profiles SET is_test = TRUE WHERE id = p_user_id;
    
    -- Update user credits
    UPDATE user_credits SET is_test = TRUE WHERE user_id = p_user_id;
    
    -- Update credit transactions
    UPDATE credit_transactions SET is_test = TRUE WHERE user_id = p_user_id;
    
    -- Update subscriptions
    UPDATE user_subscriptions SET is_test = TRUE WHERE user_id = p_user_id;
    
    -- Update payment transactions
    UPDATE payment_transactions SET is_test = TRUE WHERE user_id = p_user_id;
    
    -- Update video generations
    UPDATE video_generations SET is_test = TRUE WHERE user_id = p_user_id;
    
    -- Update stripe customers
    UPDATE stripe_customers SET is_test = TRUE WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if a Stripe ID is from test mode
CREATE OR REPLACE FUNCTION is_stripe_test_id(p_stripe_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Test mode IDs contain specific prefixes
    RETURN p_stripe_id LIKE 'pk_test_%' 
        OR p_stripe_id LIKE 'sk_test_%'
        OR p_stripe_id LIKE 'price_test_%'
        OR p_stripe_id LIKE 'prod_test_%'
        OR p_stripe_id LIKE 'sub_test_%'
        OR p_stripe_id LIKE 'cus_test_%'
        OR p_stripe_id LIKE 'pi_test_%'
        OR p_stripe_id LIKE '%_test_%';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to automatically mark transactions as test based on Stripe IDs
CREATE OR REPLACE FUNCTION auto_mark_test_transactions()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if the stripe payment intent ID is a test ID
    IF NEW.stripe_payment_intent_id IS NOT NULL 
       AND is_stripe_test_id(NEW.stripe_payment_intent_id) THEN
        NEW.is_test := TRUE;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Create triggers for automatic test marking
-- =====================================================

-- Trigger to auto-mark payment transactions as test
DROP TRIGGER IF EXISTS auto_mark_test_payment_transactions ON payment_transactions;
CREATE TRIGGER auto_mark_test_payment_transactions
    BEFORE INSERT OR UPDATE ON payment_transactions
    FOR EACH ROW
    EXECUTE FUNCTION auto_mark_test_transactions();

-- Trigger to auto-mark credit transactions as test based on payment
DROP TRIGGER IF EXISTS auto_mark_test_credit_transactions ON credit_transactions;
CREATE TRIGGER auto_mark_test_credit_transactions
    BEFORE INSERT OR UPDATE ON credit_transactions
    FOR EACH ROW
    EXECUTE FUNCTION auto_mark_test_transactions();

-- 6. Create views for easy filtering
-- =====================================================

-- View for production-only users
CREATE OR REPLACE VIEW production_users AS
SELECT * FROM profiles 
WHERE is_test = FALSE OR is_test IS NULL;

-- View for test-only users
CREATE OR REPLACE VIEW test_users AS
SELECT * FROM profiles 
WHERE is_test = TRUE;

-- View for production-only transactions
CREATE OR REPLACE VIEW production_transactions AS
SELECT * FROM payment_transactions 
WHERE is_test = FALSE OR is_test IS NULL;

-- View for test-only transactions
CREATE OR REPLACE VIEW test_transactions AS
SELECT * FROM payment_transactions 
WHERE is_test = TRUE;

-- 7. Add RLS policies for test data visibility
-- =====================================================

-- Policy to allow admins to see all data including test
CREATE POLICY "Admin can see all data including test" 
ON profiles FOR SELECT
USING (
    auth.uid() IN (
        SELECT user_id FROM user_roles WHERE role = 'admin'
    )
);

-- Policy to prevent test users from seeing production data
CREATE POLICY "Test users can only see test data"
ON profiles FOR SELECT
USING (
    -- If current user is test, only see test data
    CASE 
        WHEN EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_test = TRUE)
        THEN is_test = TRUE
        ELSE TRUE
    END
);

-- 8. Grant permissions
-- =====================================================

GRANT EXECUTE ON FUNCTION mark_user_as_test TO authenticated;
GRANT EXECUTE ON FUNCTION is_stripe_test_id TO authenticated;
GRANT SELECT ON production_users TO authenticated;
GRANT SELECT ON test_users TO authenticated;
GRANT SELECT ON production_transactions TO authenticated;
GRANT SELECT ON test_transactions TO authenticated;

-- 9. Add comments for documentation
-- =====================================================

COMMENT ON COLUMN profiles.is_test IS 'Flag indicating if this is a test user account';
COMMENT ON COLUMN credit_transactions.is_test IS 'Flag indicating if this is a test transaction';
COMMENT ON COLUMN payment_transactions.is_test IS 'Flag indicating if this is a test payment';
COMMENT ON COLUMN user_subscriptions.is_test IS 'Flag indicating if this is a test subscription';
COMMENT ON FUNCTION mark_user_as_test IS 'Marks a user and all their associated data as test data';
COMMENT ON FUNCTION is_stripe_test_id IS 'Checks if a Stripe ID is from test mode based on prefixes';
COMMENT ON VIEW production_users IS 'View containing only production (non-test) users';
COMMENT ON VIEW test_users IS 'View containing only test users';