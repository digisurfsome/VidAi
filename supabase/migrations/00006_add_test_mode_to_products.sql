-- Add is_test column to subscription_plans and credit_packages
-- This allows separate test and live products in the same database

ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT false;

ALTER TABLE credit_packages
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT false;

-- Add indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_subscription_plans_is_test 
ON subscription_plans(is_test);

CREATE INDEX IF NOT EXISTS idx_credit_packages_is_test 
ON credit_packages(is_test);

-- Update existing products based on their Stripe IDs
-- Products with test Stripe IDs are marked as test products
UPDATE subscription_plans 
SET is_test = true 
WHERE stripe_product_id LIKE 'prod_test_%' 
   OR stripe_price_id LIKE 'price_test_%';

UPDATE credit_packages 
SET is_test = true 
WHERE stripe_product_id LIKE 'prod_test_%' 
   OR stripe_price_id LIKE 'price_test_%';

-- Add comment documentation
COMMENT ON COLUMN subscription_plans.is_test IS 'Whether this plan is for test mode only';
COMMENT ON COLUMN credit_packages.is_test IS 'Whether this package is for test mode only';