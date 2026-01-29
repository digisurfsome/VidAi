-- Update stored procedures to handle test mode parameter

-- Drop existing function
DROP FUNCTION IF EXISTS create_subscription_plan;

-- Create updated function with is_test parameter
CREATE OR REPLACE FUNCTION create_subscription_plan(
  p_stripe_product_id TEXT,
  p_stripe_price_id TEXT,
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_price_cents INTEGER DEFAULT 0,
  p_currency TEXT DEFAULT 'USD',
  p_interval TEXT DEFAULT 'month',
  p_credits_per_period INTEGER DEFAULT 0,
  p_features TEXT[] DEFAULT '{}',
  p_is_active BOOLEAN DEFAULT true,
  p_created_via TEXT DEFAULT 'admin_ui',
  p_is_test BOOLEAN DEFAULT false
)
RETURNS JSON AS $$
DECLARE
  new_plan RECORD;
  max_order INTEGER;
BEGIN
  -- Get the max sort_order
  SELECT COALESCE(MAX(sort_order), 0) INTO max_order FROM subscription_plans;
  
  -- Insert the new plan
  INSERT INTO subscription_plans (
    stripe_product_id,
    stripe_price_id,
    name,
    description,
    price_cents,
    currency,
    interval,
    credits_per_period,
    features,
    is_active,
    sort_order,
    created_via,
    stripe_sync_status,
    last_synced_at,
    is_test
  ) VALUES (
    p_stripe_product_id,
    p_stripe_price_id,
    p_name,
    p_description,
    p_price_cents,
    p_currency,
    p_interval,
    p_credits_per_period,
    p_features,
    p_is_active,
    max_order + 1,
    p_created_via,
    'synced',
    NOW(),
    p_is_test
  ) RETURNING * INTO new_plan;
  
  -- Return as JSON
  RETURN row_to_json(new_plan);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Similar update for credit packages
DROP FUNCTION IF EXISTS create_credit_package;

CREATE OR REPLACE FUNCTION create_credit_package(
  p_stripe_product_id TEXT,
  p_stripe_price_id TEXT,
  p_name TEXT,
  p_credits INTEGER,
  p_price DECIMAL(10,2),
  p_bonus_percentage DECIMAL(5,2) DEFAULT 0,
  p_description TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
  p_display_order INTEGER DEFAULT NULL,
  p_created_via TEXT DEFAULT 'admin_ui',
  p_is_test BOOLEAN DEFAULT false
)
RETURNS JSON AS $$
DECLARE
  new_package RECORD;
  max_order INTEGER;
  calculated_total INTEGER;
BEGIN
  -- Calculate total credits including bonus
  calculated_total := p_credits + ROUND(p_credits * p_bonus_percentage / 100);
  
  -- Get the max display_order if not provided
  IF p_display_order IS NULL THEN
    SELECT COALESCE(MAX(display_order), 0) INTO max_order FROM credit_packages;
    p_display_order := max_order + 1;
  END IF;
  
  -- Insert the new package
  INSERT INTO credit_packages (
    stripe_product_id,
    stripe_price_id,
    name,
    credits,
    price,
    bonus_percentage,
    total_credits,
    description,
    is_active,
    display_order,
    created_via,
    stripe_sync_status,
    last_synced_at,
    is_test
  ) VALUES (
    p_stripe_product_id,
    p_stripe_price_id,
    p_name,
    p_credits,
    p_price,
    p_bonus_percentage,
    calculated_total,
    p_description,
    p_is_active,
    p_display_order,
    p_created_via,
    'synced',
    NOW(),
    p_is_test
  ) RETURNING * INTO new_package;
  
  -- Return as JSON
  RETURN row_to_json(new_package);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update function to sync products from Stripe
CREATE OR REPLACE FUNCTION sync_stripe_product_to_db(
  p_stripe_product_id TEXT,
  p_stripe_price_id TEXT,
  p_name TEXT,
  p_description TEXT,
  p_price_amount INTEGER,
  p_currency TEXT,
  p_interval TEXT,
  p_product_type TEXT,
  p_metadata JSONB,
  p_is_active BOOLEAN,
  p_is_test BOOLEAN DEFAULT false
)
RETURNS JSON AS $$
DECLARE
  result RECORD;
  v_credits INTEGER;
  v_bonus_percentage DECIMAL(5,2);
BEGIN
  -- Extract metadata values
  v_credits := COALESCE((p_metadata->>'credits')::INTEGER, 
                        (p_metadata->>'credits_per_period')::INTEGER, 
                        0);
  v_bonus_percentage := COALESCE((p_metadata->>'bonus_percentage')::DECIMAL, 0);
  
  IF p_product_type = 'subscription' THEN
    -- Upsert subscription plan
    INSERT INTO subscription_plans (
      stripe_product_id,
      stripe_price_id,
      name,
      description,
      price_cents,
      currency,
      interval,
      credits_per_period,
      features,
      is_active,
      metadata,
      created_via,
      stripe_sync_status,
      last_synced_at,
      is_test
    ) VALUES (
      p_stripe_product_id,
      p_stripe_price_id,
      p_name,
      p_description,
      p_price_amount,
      p_currency,
      p_interval,
      v_credits,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_metadata->'features')), '{}'),
      p_is_active,
      p_metadata,
      'stripe_sync',
      'synced',
      NOW(),
      p_is_test
    )
    ON CONFLICT (stripe_product_id) DO UPDATE SET
      stripe_price_id = EXCLUDED.stripe_price_id,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      price_cents = EXCLUDED.price_cents,
      currency = EXCLUDED.currency,
      interval = EXCLUDED.interval,
      credits_per_period = EXCLUDED.credits_per_period,
      features = EXCLUDED.features,
      is_active = EXCLUDED.is_active,
      metadata = EXCLUDED.metadata,
      stripe_sync_status = 'synced',
      last_synced_at = NOW(),
      is_test = EXCLUDED.is_test
    RETURNING * INTO result;
    
  ELSIF p_product_type = 'one_time' THEN
    -- Upsert credit package
    INSERT INTO credit_packages (
      stripe_product_id,
      stripe_price_id,
      name,
      description,
      price,
      credits,
      bonus_percentage,
      total_credits,
      is_active,
      metadata,
      created_via,
      stripe_sync_status,
      last_synced_at,
      is_test
    ) VALUES (
      p_stripe_product_id,
      p_stripe_price_id,
      p_name,
      p_description,
      p_price_amount / 100.0, -- Convert cents to dollars
      v_credits,
      v_bonus_percentage,
      v_credits + ROUND(v_credits * v_bonus_percentage / 100),
      p_is_active,
      p_metadata,
      'stripe_sync',
      'synced',
      NOW(),
      p_is_test
    )
    ON CONFLICT (stripe_product_id) DO UPDATE SET
      stripe_price_id = EXCLUDED.stripe_price_id,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      price = EXCLUDED.price,
      credits = EXCLUDED.credits,
      bonus_percentage = EXCLUDED.bonus_percentage,
      total_credits = EXCLUDED.total_credits,
      is_active = EXCLUDED.is_active,
      metadata = EXCLUDED.metadata,
      stripe_sync_status = 'synced',
      last_synced_at = NOW(),
      is_test = EXCLUDED.is_test
    RETURNING * INTO result;
  END IF;
  
  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;