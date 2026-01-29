-- Migration: Stripe Payments and Credit System
-- Description: Adds tables for subscription management, credit tracking, and payment processing
-- Created: 2025-08-26

-- Create subscription_plans table
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_product_id VARCHAR(255) UNIQUE NOT NULL,
  stripe_price_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  interval VARCHAR(20) NOT NULL CHECK (interval IN ('month', 'year')),
  credits_per_period INTEGER NOT NULL,
  features JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create stripe_customers table
CREATE TABLE IF NOT EXISTS stripe_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  payment_method_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_subscriptions table
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id VARCHAR(255) UNIQUE,
  plan_id UUID REFERENCES subscription_plans(id),
  status VARCHAR(50) NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  canceled_at TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique partial index for active subscriptions
CREATE UNIQUE INDEX idx_user_active_subscription 
ON user_subscriptions(user_id) 
WHERE status = 'active';

-- Create user_credits table
CREATE TABLE IF NOT EXISTS user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INTEGER DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned INTEGER DEFAULT 0,
  lifetime_spent INTEGER DEFAULT 0,
  last_refill_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create credit_transactions table
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('purchase', 'subscription', 'deduction', 'refund', 'bonus')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT,
  reference_type VARCHAR(50),
  reference_id UUID,
  stripe_payment_intent_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create credit_packages table
CREATE TABLE IF NOT EXISTS credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_price_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  credits INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  bonus_percentage INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create payment_transactions table
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_payment_intent_id VARCHAR(255) UNIQUE,
  stripe_invoice_id VARCHAR(255),
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(50) NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Modify video_generations table to track credit consumption
ALTER TABLE video_generations 
ADD COLUMN IF NOT EXISTS credits_consumed INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS credit_transaction_id UUID REFERENCES credit_transactions(id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_stripe_customers_user_id ON stripe_customers(user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_customers_stripe_id ON stripe_customers(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON user_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_video_generations_credit_tx ON video_generations(credit_transaction_id);

-- Create function for atomic credit deduction
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_description TEXT,
  p_reference_type VARCHAR,
  p_reference_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Lock the user's credit row
  SELECT balance INTO v_current_balance
  FROM user_credits
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  -- Check if user has enough credits
  IF v_current_balance IS NULL OR v_current_balance < p_amount THEN
    RETURN FALSE;
  END IF;
  
  v_new_balance := v_current_balance - p_amount;
  
  -- Update balance
  UPDATE user_credits
  SET balance = v_new_balance,
      lifetime_spent = lifetime_spent + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id;
  
  -- Record transaction
  INSERT INTO credit_transactions (
    user_id, type, amount, balance_after, 
    description, reference_type, reference_id
  ) VALUES (
    p_user_id, 'deduction', -p_amount, v_new_balance,
    p_description, p_reference_type, p_reference_id
  );
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to add credits
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_type VARCHAR,
  p_description TEXT,
  p_stripe_payment_intent_id VARCHAR DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Get or create user credits record
  INSERT INTO user_credits (user_id, balance, lifetime_earned)
  VALUES (p_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Lock and get current balance
  SELECT balance INTO v_current_balance
  FROM user_credits
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  v_new_balance := v_current_balance + p_amount;
  
  -- Update balance
  UPDATE user_credits
  SET balance = v_new_balance,
      lifetime_earned = lifetime_earned + p_amount,
      last_refill_at = NOW(),
      updated_at = NOW()
  WHERE user_id = p_user_id;
  
  -- Record transaction
  INSERT INTO credit_transactions (
    user_id, type, amount, balance_after, 
    description, stripe_payment_intent_id
  ) VALUES (
    p_user_id, p_type, p_amount, v_new_balance,
    p_description, p_stripe_payment_intent_id
  );
  
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies

-- Enable RLS on all tables
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

-- subscription_plans: Public can view active plans
CREATE POLICY "Public can view active plans" ON subscription_plans
  FOR SELECT USING (is_active = true);

-- stripe_customers: Users can view their own record
CREATE POLICY "Users can view own stripe customer record" ON stripe_customers
  FOR SELECT USING (auth.uid() = user_id);

-- user_subscriptions: Users can view their own subscriptions
CREATE POLICY "Users can view own subscriptions" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- user_credits: Users can view their own credits
CREATE POLICY "Users can view own credits" ON user_credits
  FOR SELECT USING (auth.uid() = user_id);

-- credit_transactions: Users can view their own transactions
CREATE POLICY "Users can view own credit transactions" ON credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- credit_packages: Public can view active packages
CREATE POLICY "Public can view active credit packages" ON credit_packages
  FOR SELECT USING (is_active = true);

-- payment_transactions: Users can view their own payments
CREATE POLICY "Users can view own payment transactions" ON payment_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Insert default subscription plans (example data - adjust as needed)
INSERT INTO subscription_plans (
  stripe_product_id, stripe_price_id, name, description, 
  price_cents, currency, interval, credits_per_period, features, sort_order
) VALUES 
  ('prod_basic', 'price_basic_monthly', 'Basic', 'Perfect for getting started', 
   999, 'USD', 'month', 500, '["HD video quality", "5 minute max duration", "Standard models"]'::jsonb, 1),
  ('prod_pro', 'price_pro_monthly', 'Pro', 'For serious content creators', 
   2999, 'USD', 'month', 2000, '["4K video quality", "15 minute max duration", "Premium models", "Priority processing"]'::jsonb, 2),
  ('prod_business', 'price_business_monthly', 'Business', 'For teams and agencies', 
   9999, 'USD', 'month', 10000, '["4K video quality", "30 minute max duration", "All models", "Priority processing", "API access", "Custom branding"]'::jsonb, 3)
ON CONFLICT (stripe_product_id) DO NOTHING;

-- Insert default credit packages
INSERT INTO credit_packages (
  stripe_price_id, name, credits, price_cents, currency, bonus_percentage, sort_order
) VALUES
  ('price_credits_500', 'Credit Pack - 500', 500, 499, 'USD', 0, 1),
  ('price_credits_1000', 'Credit Pack - 1,000', 1000, 899, 'USD', 10, 2),
  ('price_credits_5000', 'Credit Pack - 5,000', 5000, 3999, 'USD', 20, 3),
  ('price_credits_10000', 'Credit Pack - 10,000', 10000, 6999, 'USD', 30, 4)
ON CONFLICT (stripe_price_id) DO NOTHING;

-- Create triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_subscription_plans_updated_at BEFORE UPDATE
  ON subscription_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stripe_customers_updated_at BEFORE UPDATE
  ON stripe_customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_subscriptions_updated_at BEFORE UPDATE
  ON user_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_credits_updated_at BEFORE UPDATE
  ON user_credits FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_transactions_updated_at BEFORE UPDATE
  ON payment_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();