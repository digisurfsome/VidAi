import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// Helper to get test mode from request header
function getTestModeFromRequest(req: VercelRequest): boolean {
  const testModeHeader = req.headers['x-test-mode'];
  return testModeHeader === 'true';
}

// Helper to get Stripe instance based on test mode
function getStripeClient(isTestMode: boolean): Stripe {
  const stripeSecretKey = isTestMode 
    ? process.env.STRIPE_TEST_SECRET_KEY
    : process.env.STRIPE_SECRET_KEY;
  
  return new Stripe(stripeSecretKey!, {
    // @ts-ignore
    apiVersion: '2023-10-16',
  });
}

// Create Supabase client factory with proper schema configuration
const createSupabaseClient = () => createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: {
      schema: 'public'
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!
      }
    }
  }
);

// Validation schemas
const CreatePlanSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  price_cents: z.number().min(99).max(99999),
  currency: z.string().default('USD'),
  interval: z.enum(['month', 'year']),
  credits_per_period: z.number().min(0),
  features: z.array(z.string()).default([]),
  is_active: z.boolean().default(true),
});

const UpdatePlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  price_cents: z.number().min(99).max(99999).optional(),
  credits_per_period: z.number().min(0).optional(),
  features: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
  archive: z.boolean().optional(),
});

const CreatePackageSchema = z.object({
  name: z.string().min(1).max(100),
  credits: z.number().min(100),
  price: z.number().min(0.99),
  bonus_percentage: z.number().min(0).max(100).default(0),
  is_active: z.boolean().default(true),
  display_order: z.number().optional(),
});

const UpdatePackageSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  credits: z.number().min(100).optional(),
  price: z.number().min(0.99).optional(),
  bonus_percentage: z.number().min(0).max(100).optional(),
  is_active: z.boolean().optional(),
  display_order: z.number().optional(),
});

// Helper functions
async function verifyAdminAccess(req: VercelRequest): Promise<{ isAdmin: boolean; userId?: string; error?: string }> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { isAdmin: false, error: 'No authorization token provided' };
  }

  const token = authHeader.substring(7);
  const supabase = createSupabaseClient();
  
  try {
    // Verify the token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return { isAdmin: false, error: 'Invalid authentication token' };
    }

    // Check if user has admin role
    const { data: userRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (!userRole || userRole.role !== 'admin') {
      return { isAdmin: false, error: 'Admin access required' };
    }

    return { isAdmin: true, userId: user.id };
  } catch (error) {
    console.error('Auth verification error:', error);
    return { isAdmin: false, error: 'Authentication failed' };
  }
}

async function logSync(params: any) {
  try {
    const supabase = createSupabaseClient();
    await supabase.rpc('log_stripe_sync', params);
  } catch (error) {
    console.error('Failed to log sync operation:', error);
  }
}

// API Handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify admin access
  const { isAdmin, userId, error: authError } = await verifyAdminAccess(req);
  if (!isAdmin) {
    return res.status(401).json({ error: authError });
  }

  const path = req.url?.split('?')[0];
  const pathParts = path?.split('/').filter(Boolean) || [];
  // URL reaches API as: /stripe-admin/plans -> ['stripe-admin', 'plans']
  const entity = pathParts[1]; // plans, packages, sync  
  const id = pathParts[2]; // plan/package ID for updates

  try {
    // Handle different endpoints
    if (entity === 'plans') {
      if (req.method === 'POST') {
        return await handleCreatePlan(req, res, userId!);
      } else if (req.method === 'PUT' && id) {
        return await handleUpdatePlan(req, res, id, userId!);
      } else if (req.method === 'DELETE' && id) {
        return await handleArchivePlan(req, res, id, userId!);
      } else if (req.method === 'GET') {
        return await handleGetPlans(req, res);
      }
    } else if (entity === 'packages') {
      if (req.method === 'POST') {
        return await handleCreatePackage(req, res, userId!);
      } else if (req.method === 'PUT' && id) {
        return await handleUpdatePackage(req, res, id, userId!);
      } else if (req.method === 'DELETE' && id) {
        return await handleDeletePackage(req, res, id, userId!);
      } else if (req.method === 'GET') {
        return await handleGetPackages(req, res);
      }
    } else if (entity === 'sync') {
      if (req.method === 'GET' || req.method === 'POST') {
        return await handleSync(req, res, userId!);
      }
    } else if (entity === 'sync-log') {
      if (req.method === 'GET') {
        return await handleGetSyncLog(req, res);
      }
    } else if (entity === 'sync-status') {
      if (req.method === 'GET') {
        return await handleGetSyncStatus(req, res);
      }
    } else if (entity === 'sync' && req.query.productId) {
      // Product-specific sync endpoint
      if (req.method === 'POST') {
        return await handleProductSync(req, res, userId!);
      }
    }

    return res.status(404).json({ error: 'Endpoint not found' });
  } catch (error: any) {
    console.error('Stripe admin API error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

// Handler functions
async function handleCreatePlan(req: VercelRequest, res: VercelResponse, userId: string) {
  try {
    const validatedData = CreatePlanSchema.parse(req.body);
    const supabase = createSupabaseClient();
    const isTestMode = getTestModeFromRequest(req);
    const stripe = getStripeClient(isTestMode);

    // Create product in Stripe
    const stripeProduct = await stripe.products.create({
      name: validatedData.name,
      description: validatedData.description,
      metadata: {
        app: 'video-studio',  // Mark this product as belonging to the video app
        sync_video_app: 'true',  // Alternative flag for clarity
        credits_per_period: validatedData.credits_per_period.toString(),
        created_via: 'admin_ui',
        is_test: isTestMode ? 'true' : 'false',
      },
    });

    // Create price in Stripe
    const stripePrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: validatedData.price_cents,
      currency: validatedData.currency.toLowerCase(),
      recurring: { interval: validatedData.interval },
    });

    // Save to database using RPC function to bypass RLS
    const { data: planJson, error: dbError } = await supabase
      .rpc('create_subscription_plan', {
        p_stripe_product_id: stripeProduct.id,
        p_stripe_price_id: stripePrice.id,
        p_name: validatedData.name,
        p_description: validatedData.description || null,
        p_price_cents: validatedData.price_cents,
        p_currency: validatedData.currency,
        p_interval: validatedData.interval,
        p_credits_per_period: validatedData.credits_per_period,
        p_features: validatedData.features || [],
        p_is_active: validatedData.is_active,
        p_created_via: 'admin_ui',
        p_is_test: isTestMode
      });

    if (dbError) throw dbError;
    
    const plan = typeof planJson === 'string' ? JSON.parse(planJson) : planJson;

    // Log sync operation
    await logSync({
      p_sync_type: 'api_call',
      p_direction: 'to_stripe',
      p_entity_type: 'product',
      p_entity_id: stripeProduct.id,
      p_local_id: plan.id,
      p_action: 'create',
      p_status: 'success',
      p_performed_by: userId,
    });

    return res.status(200).json({
      success: true,
      plan: {
        id: plan.id,
        stripe_product_id: stripeProduct.id,
        stripe_price_id: stripePrice.id,
        name: plan.name,
        created_at: plan.created_at,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input data', details: error.errors });
    }
    
    // Log failed sync
    await logSync({
      p_sync_type: 'api_call',
      p_direction: 'to_stripe',
      p_entity_type: 'product',
      p_action: 'create',
      p_status: 'failure',
      p_error_message: error.message,
      p_performed_by: userId,
    });

    throw error;
  }
}

async function handleUpdatePlan(req: VercelRequest, res: VercelResponse, planId: string, userId: string) {
  try {
    const validatedData = UpdatePlanSchema.parse(req.body);
    const supabase = createSupabaseClient();
    const isTestMode = getTestModeFromRequest(req);
    const stripe = getStripeClient(isTestMode);

    // Get current plan using RPC to bypass RLS
    const { data: planJson, error: fetchError } = await supabase
      .rpc('get_subscription_plan_by_id', { p_plan_id: planId });

    if (fetchError || !planJson) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    
    const currentPlan = typeof planJson === 'string' ? JSON.parse(planJson) : planJson;

    // Handle archiving
    if (validatedData.archive) {
      return await handleArchivePlan(req, res, planId, userId);
    }

    const updatedFields: string[] = [];
    let newPriceId = currentPlan.stripe_price_id;

    // Update Stripe product (mutable fields)
    if (validatedData.name || validatedData.description) {
      await stripe.products.update(currentPlan.stripe_product_id, {
        name: validatedData.name || currentPlan.name,
        description: validatedData.description || currentPlan.description,
      });
      if (validatedData.name) updatedFields.push('name');
      if (validatedData.description) updatedFields.push('description');
    }

    // Handle price change (create new price since prices are immutable)
    if (validatedData.price_cents && validatedData.price_cents !== currentPlan.price_cents) {
      const newPrice = await stripe.prices.create({
        product: currentPlan.stripe_product_id,
        unit_amount: validatedData.price_cents,
        currency: currentPlan.currency.toLowerCase(),
        recurring: { interval: currentPlan.interval },
      });
      
      newPriceId = newPrice.id;
      updatedFields.push('price');

      // Archive old price
      await stripe.prices.update(currentPlan.stripe_price_id, { active: false });

      // Record price history
      await supabase.from('price_history').insert({
        plan_id: planId,
        stripe_price_id: currentPlan.stripe_price_id,
        price_cents: currentPlan.price_cents,
        currency: currentPlan.currency,
        active_from: currentPlan.created_at,
        active_until: new Date().toISOString(),
        reason_for_change: 'Price update via admin UI',
        changed_by: userId,
      });
    }

    // Update database using RPC function to bypass RLS
    const { data: updatedPlanJson, error: updateError } = await supabase
      .rpc('update_subscription_plan', {
        p_plan_id: planId,
        p_name: validatedData.name || null,
        p_description: validatedData.description !== undefined ? validatedData.description : null,
        p_price_cents: validatedData.price_cents || null,
        p_credits_per_period: validatedData.credits_per_period || null,
        p_features: validatedData.features || null,
        p_is_active: validatedData.is_active !== undefined ? validatedData.is_active : null
      });

    if (updateError) throw updateError;
    
    // If price changed, update the stripe_price_id separately
    if (newPriceId !== currentPlan.stripe_price_id) {
      const { error: priceUpdateError } = await supabase
        .rpc('update_plan_stripe_price', {
          p_plan_id: planId,
          p_stripe_price_id: newPriceId
        });
      
      if (priceUpdateError) throw priceUpdateError;
    }

    // Log sync
    await logSync({
      p_sync_type: 'api_call',
      p_direction: 'to_stripe',
      p_entity_type: 'product',
      p_entity_id: currentPlan.stripe_product_id,
      p_local_id: planId,
      p_action: 'update',
      p_status: 'success',
      p_performed_by: userId,
    });

    return res.status(200).json({
      success: true,
      plan: {
        id: planId,
        stripe_price_id: newPriceId,
        previous_price_id: newPriceId !== currentPlan.stripe_price_id ? currentPlan.stripe_price_id : undefined,
        updated_fields: updatedFields,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid update data', details: error.errors });
    }
    throw error;
  }
}

async function handleArchivePlan(req: VercelRequest, res: VercelResponse, planId: string, userId: string) {
  try {
    const hard_delete = req.query?.hard_delete === 'true';
    const supabase = createSupabaseClient();
    const isTestMode = getTestModeFromRequest(req);
    const stripe = getStripeClient(isTestMode);

    // Check for active subscriptions
    const { data: activeSubscriptions } = await supabase
      .from('user_subscriptions')
      .select('id')
      .eq('plan_id', planId)
      .eq('status', 'active')
      .limit(1);

    if (activeSubscriptions && activeSubscriptions.length > 0) {
      if (hard_delete) {
        return res.status(409).json({ error: 'Cannot delete - has active subscriptions' });
      }
    }

    // Archive the plan
    const { error } = await supabase.rpc('archive_subscription_plan', {
      p_plan_id: planId,
      p_archived_by: userId,
    });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      action: 'archived',
      plan_id: planId,
      archived_at: new Date().toISOString(),
    });
  } catch (error: any) {
    throw error;
  }
}

async function handleGetPlans(req: VercelRequest, res: VercelResponse) {
  try {
    const includeArchived = req.query?.include_archived === 'true';
    const supabase = createSupabaseClient();

    // Force-refresh the schema cache right before the call to ensure function is detected
    try {
      await supabase.rpc('refresh_schema_cache');
      console.log('Successfully refreshed schema cache before fetching plans.');
    } catch (refreshError) {
      // This might fail if the migration for the function hasn't run, but we proceed anyway.
      console.warn('Could not refresh schema cache, proceeding with plan fetch:', refreshError);
    }

    console.log('Fetching subscription plans via RPC function...');
    
    // Try RPC first; fallback to direct table query if schema cache hasn't picked up the function yet
    const { data: rpcPlans, error: rpcError } = await supabase.rpc('get_subscription_plans');

    let plansResult = rpcPlans as any[] | null;
    if (rpcError || !plansResult) {
      console.warn('RPC error or empty result, attempting fallback SELECT:', rpcError);
      let query = supabase
        .from('subscription_plans')
        .select('*');
      
      if (!includeArchived) {
        query = query.is('archived_at', null);
      }
      
      const { data: fallbackPlans, error: fallbackError } = await query
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (fallbackError) {
        console.error('Fallback SELECT failed:', fallbackError);
        // Prefer to surface the original RPC error if present; otherwise the fallback error
        throw (rpcError || fallbackError);
      }
      plansResult = fallbackPlans || [];
      console.log('Fetched', plansResult.length, 'plans via fallback SELECT');
    } else {
      // Filter out archived plans if not requested
      if (!includeArchived && plansResult) {
        plansResult = plansResult.filter((plan: any) => !plan.archived_at);
      }
      console.log('Successfully fetched', plansResult.length, 'plans via RPC');
    }
    
    return handlePlansResponse(res, plansResult || []);
  } catch (error: any) {
    console.error('HandleGetPlans error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to fetch plans'
    });
  }
}

function handlePlansResponse(res: VercelResponse, plans: any[]) {
  // Process the data
  const plansWithCounts = plans.map((plan: any) => ({
    ...plan,
    subscribers_count: 0, // TODO: Calculate separately if needed
  }));

  // Get sync status summary
  const syncSummary = {
    total: plans.length,
    synced: plans.filter((p: any) => p.stripe_sync_status === 'synced').length,
    pending: plans.filter((p: any) => p.stripe_sync_status === 'pending').length,
    errors: plans.filter((p: any) => p.stripe_sync_status === 'error').length
  };

  return res.status(200).json({
    success: true,
    plans: plansWithCounts,
    sync_status: syncSummary,
    total: plans.length,
  });
}

async function handleCreatePackage(req: VercelRequest, res: VercelResponse, userId: string) {
  try {
    const validatedData = CreatePackageSchema.parse(req.body);
    const isTestMode = getTestModeFromRequest(req);
    const stripe = getStripeClient(isTestMode);
    const supabase = createSupabaseClient();

    // Calculate total credits with bonus (server-side calculation)
    const totalCredits = Math.floor(validatedData.credits + (validatedData.credits * validatedData.bonus_percentage / 100));
    const priceInCents = Math.round(validatedData.price * 100);

    // Create product in Stripe
    const stripeProduct = await stripe.products.create({
      name: validatedData.name,
      metadata: {
        app: 'video-studio',  // Mark this product as belonging to the video app
        sync_video_app: 'true',  // Alternative flag for clarity
        type: 'credit_package',
        credits: validatedData.credits.toString(),
        bonus_percentage: validatedData.bonus_percentage.toString(),
        total_credits: totalCredits.toString(),
        created_via: 'admin_ui',
        is_test: isTestMode ? 'true' : 'false',
      },
    });

    // Create one-time price in Stripe
    const stripePrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: priceInCents,
      currency: 'usd',
    });

    // Save to database (using price_cents, not price)
    const { data: package_, error: dbError } = await supabase
      .from('credit_packages')
      .insert({
        stripe_product_id: stripeProduct.id,
        stripe_price_id: stripePrice.id,
        name: validatedData.name,
        credits: validatedData.credits,
        price_cents: priceInCents, // Database uses price_cents
        currency: 'USD',
        bonus_percentage: validatedData.bonus_percentage,
        is_active: validatedData.is_active,
        display_order: validatedData.display_order || 1,
        created_via: 'admin_ui',
        stripe_sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
        is_test: isTestMode,
      })
      .select()
      .single();

    if (dbError) throw dbError;

    // Log sync
    await logSync({
      p_sync_type: 'api_call',
      p_direction: 'to_stripe',
      p_entity_type: 'product',
      p_entity_id: stripeProduct.id,
      p_local_id: package_.id,
      p_action: 'create',
      p_status: 'success',
      p_performed_by: userId,
    });

    // Return response with price converted back to dollars and calculated total_credits
    return res.status(200).json({
      success: true,
      package: {
        id: package_.id,
        stripe_product_id: stripeProduct.id,
        stripe_price_id: stripePrice.id,
        name: package_.name,
        credits: package_.credits,
        price: package_.price_cents / 100, // Convert back to dollars for frontend
        bonus_percentage: package_.bonus_percentage,
        total_credits: totalCredits,
        is_active: package_.is_active,
        created_at: package_.created_at,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid package data', details: error.errors });
    }
    
    // Log failed sync
    await logSync({
      p_sync_type: 'api_call',
      p_direction: 'to_stripe',
      p_entity_type: 'product',
      p_action: 'create',
      p_status: 'failure',
      p_error_message: error.message,
      p_performed_by: userId,
    });
    
    throw error;
  }
}

async function handleGetPackages(req: VercelRequest, res: VercelResponse) {
  try {
    const isTestMode = getTestModeFromRequest(req);
    const supabase = createSupabaseClient();

    // Query packages filtered by test mode
    const { data: packages, error } = await supabase
      .from('credit_packages')
      .select('*')
      .eq('is_test', isTestMode)
      .order('display_order', { ascending: true });

    if (error) throw error;

    // Transform packages to include calculated total_credits and price in dollars
    const transformedPackages = (packages || []).map(pkg => ({
      ...pkg,
      price: pkg.price_cents / 100, // Convert cents to dollars
      total_credits: Math.floor(pkg.credits + (pkg.credits * pkg.bonus_percentage / 100)),
    }));

    return res.status(200).json(transformedPackages);
  } catch (error: any) {
    console.error('Error fetching packages:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch packages',
      message: error.message 
    });
  }
}

async function handleUpdatePackage(req: VercelRequest, res: VercelResponse, packageId: string, userId: string) {
  try {
    const validatedData = UpdatePackageSchema.parse(req.body);
    const supabase = createSupabaseClient();
    const isTestMode = getTestModeFromRequest(req);
    const stripe = getStripeClient(isTestMode);

    // Get current package
    const { data: currentPackage, error: fetchError } = await supabase
      .from('credit_packages')
      .select('*')
      .eq('id', packageId)
      .eq('is_test', isTestMode)
      .single();

    if (fetchError || !currentPackage) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Calculate new total credits if needed
    const credits = validatedData.credits ?? currentPackage.credits;
    const bonusPercentage = validatedData.bonus_percentage ?? currentPackage.bonus_percentage;
    const totalCredits = Math.floor(credits + (credits * bonusPercentage / 100));

    // Update Stripe product metadata if any relevant field changed
    if (validatedData.name || validatedData.credits !== undefined || validatedData.bonus_percentage !== undefined) {
      await stripe.products.update(currentPackage.stripe_product_id, {
        name: validatedData.name || currentPackage.name,
        metadata: {
          app: 'video-studio',
          type: 'credit_package',
          credits: credits.toString(),
          bonus_percentage: bonusPercentage.toString(),
          total_credits: totalCredits.toString(),
          is_test: isTestMode ? 'true' : 'false',
        },
      });
    }

    // If price changed, create new price and archive old one (Stripe price immutability)
    let newPriceId = currentPackage.stripe_price_id;
    const currentPriceInDollars = currentPackage.price_cents / 100;
    
    if (validatedData.price !== undefined && validatedData.price !== currentPriceInDollars) {
      const priceInCents = Math.round(validatedData.price * 100);
      
      // Create new price
      const newPrice = await stripe.prices.create({
        product: currentPackage.stripe_product_id,
        unit_amount: priceInCents,
        currency: 'usd',
      });
      
      newPriceId = newPrice.id;

      // Archive old price
      await stripe.prices.update(currentPackage.stripe_price_id, { active: false });
    }

    // Prepare database update
    const updateData: any = {};
    if (validatedData.name !== undefined) updateData.name = validatedData.name;
    if (validatedData.credits !== undefined) updateData.credits = validatedData.credits;
    if (validatedData.price !== undefined) updateData.price_cents = Math.round(validatedData.price * 100);
    if (validatedData.bonus_percentage !== undefined) updateData.bonus_percentage = validatedData.bonus_percentage;
    if (validatedData.is_active !== undefined) updateData.is_active = validatedData.is_active;
    if (validatedData.display_order !== undefined) updateData.display_order = validatedData.display_order;
    if (newPriceId !== currentPackage.stripe_price_id) updateData.stripe_price_id = newPriceId;
    
    // Always update sync status
    updateData.stripe_sync_status = 'synced';
    updateData.last_synced_at = new Date().toISOString();

    // Update database
    const { data: updatedPackage, error: updateError } = await supabase
      .from('credit_packages')
      .update(updateData)
      .eq('id', packageId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Log sync
    await logSync({
      p_sync_type: 'api_call',
      p_direction: 'to_stripe',
      p_entity_type: 'product',
      p_entity_id: currentPackage.stripe_product_id,
      p_local_id: packageId,
      p_action: 'update',
      p_status: 'success',
      p_performed_by: userId,
    });

    // Return response with price converted to dollars and calculated total_credits
    return res.status(200).json({
      success: true,
      package: {
        ...updatedPackage,
        price: updatedPackage.price_cents / 100,
        total_credits: totalCredits,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid update data', details: error.errors });
    }
    throw error;
  }
}

async function handleDeletePackage(req: VercelRequest, res: VercelResponse, packageId: string, userId: string) {
  try {
    const supabase = createSupabaseClient();
    const isTestMode = getTestModeFromRequest(req);
    const stripe = getStripeClient(isTestMode);

    // Get current package
    const { data: currentPackage, error: fetchError } = await supabase
      .from('credit_packages')
      .select('*')
      .eq('id', packageId)
      .eq('is_test', isTestMode)
      .single();

    if (fetchError || !currentPackage) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Check if already archived
    if (currentPackage.archived_at) {
      return res.status(400).json({ error: 'Package is already archived' });
    }

    // Deactivate product in Stripe (don't delete, just archive)
    if (currentPackage.stripe_product_id) {
      await stripe.products.update(currentPackage.stripe_product_id, {
        active: false,
      });
    }

    // Deactivate price in Stripe
    if (currentPackage.stripe_price_id) {
      await stripe.prices.update(currentPackage.stripe_price_id, {
        active: false,
      });
    }

    // Soft delete in database (set archived_at timestamp)
    const { data: archivedPackage, error: updateError } = await supabase
      .from('credit_packages')
      .update({
        archived_at: new Date().toISOString(),
        archived_by: userId,
        is_active: false,
        stripe_sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', packageId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Log sync
    await logSync({
      p_sync_type: 'api_call',
      p_direction: 'to_stripe',
      p_entity_type: 'product',
      p_entity_id: currentPackage.stripe_product_id,
      p_local_id: packageId,
      p_action: 'archive',
      p_status: 'success',
      p_performed_by: userId,
    });

    return res.status(200).json({
      success: true,
      message: 'Package archived successfully',
    });
  } catch (error: any) {
    // Log failed sync
    await logSync({
      p_sync_type: 'api_call',
      p_direction: 'to_stripe',
      p_entity_type: 'product',
      p_local_id: packageId,
      p_action: 'archive',
      p_status: 'failure',
      p_error_message: error.message,
      p_performed_by: userId,
    });
    
    console.error('Error archiving package:', error);
    return res.status(500).json({ 
      error: 'Failed to archive package',
      message: error.message 
    });
  }
}

async function handleSync(req: VercelRequest, res: VercelResponse, userId: string) {
  try {
    // Support both GET (query params) and POST (body params)
    const direction = (req.query?.direction as string) || (req.body?.direction as string) || 'from_stripe';
    const force = req.query?.force === 'true' || req.body?.force === true;
    const isTestMode = getTestModeFromRequest(req);
    const stripe = getStripeClient(isTestMode);
    const supabase = createSupabaseClient();

    // Check if sync is already in progress (simple in-memory check for now)
    // In production, use Redis or database flag
    
    const startTime = Date.now();
    let productsCount = 0;
    let pricesCount = 0;
    const errors: string[] = [];

    if (direction === 'from_stripe' || direction === 'bidirectional') {
      // Fetch all products from Stripe
      const stripeProducts = await stripe.products.list({ limit: 100, active: true });
      
      // Filter products to only sync those belonging to this video app
      const appProducts = stripeProducts.data.filter(product => {
        // Only sync products explicitly marked for this app
        // Products must have metadata.app = 'video-studio' or metadata.sync_video_app = 'true'
        return product.metadata?.app === 'video-studio' || 
               product.metadata?.sync_video_app === 'true';
      });
      
      console.log(`Found ${stripeProducts.data.length} total products, ${appProducts.length} belong to video app`);
      
      for (const product of appProducts) {
        try {
          const supabase = createSupabaseClient();
          // Check if product exists in database
          const { data: existingPlan } = await supabase
            .from('subscription_plans')
            .select('id, last_synced_at')
            .eq('stripe_product_id', product.id)
            .single();

          // Skip if recently synced and not forced
          if (existingPlan && !force) {
            const lastSync = new Date(existingPlan.last_synced_at || 0);
            const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
            if (hoursSinceSync < 1) continue;
          }

          // Get active prices for this product
          const stripePrices = await stripe.prices.list({
            product: product.id,
            active: true,
            limit: 10,
          });

          const activePrice = stripePrices.data[0]; // Get most recent active price
          
          if (activePrice && activePrice.recurring) {
            // Update or insert plan
            const planData = {
              stripe_product_id: product.id,
              stripe_price_id: activePrice.id,
              name: product.name,
              description: product.description,
              price_cents: activePrice.unit_amount || 0,
              currency: activePrice.currency.toUpperCase(),
              interval: activePrice.recurring.interval,
              credits_per_period: parseInt(product.metadata?.credits_per_period || '0'),
              is_active: product.active,
              stripe_sync_status: 'synced',
              last_synced_at: new Date().toISOString(),
              created_via: existingPlan ? undefined : 'stripe_webhook',
            };

            if (existingPlan) {
              await supabase
                .from('subscription_plans')
                .update(planData)
                .eq('id', existingPlan.id);
            } else {
              await supabase
                .from('subscription_plans')
                .insert(planData);
            }

            productsCount++;
            pricesCount += stripePrices.data.length;
          }
        } catch (error: any) {
          errors.push(`Product ${product.id}: ${error.message}`);
        }
      }
    }

    if (direction === 'to_stripe' || direction === 'bidirectional') {
      // Sync local changes to Stripe
      const supabase = createSupabaseClient();
      const { data: unsyncedPlans } = await supabase
        .from('subscription_plans')
        .select('*')
        .neq('stripe_sync_status', 'synced')
        .is('archived_at', null);

      for (const plan of unsyncedPlans || []) {
        try {
          if (!plan.stripe_product_id) {
            // Create new product in Stripe
            const stripeProduct = await stripe.products.create({
              name: plan.name,
              description: plan.description,
              metadata: {
                app: 'video-studio',  // Mark this product as belonging to the video app
                sync_video_app: 'true',  // Alternative flag for clarity
                credits_per_period: plan.credits_per_period.toString(),
                local_id: plan.id,
              },
            });

            const stripePrice = await stripe.prices.create({
              product: stripeProduct.id,
              unit_amount: plan.price_cents,
              currency: plan.currency.toLowerCase(),
              recurring: { interval: plan.interval },
            });

            await supabase
              .from('subscription_plans')
              .update({
                stripe_product_id: stripeProduct.id,
                stripe_price_id: stripePrice.id,
                stripe_sync_status: 'synced',
                last_synced_at: new Date().toISOString(),
              })
              .eq('id', plan.id);

            productsCount++;
            pricesCount++;
          } else {
            // Update existing product
            await stripe.products.update(plan.stripe_product_id, {
              name: plan.name,
              description: plan.description,
              active: plan.is_active,
            });

            await supabase
              .from('subscription_plans')
              .update({
                stripe_sync_status: 'synced',
                last_synced_at: new Date().toISOString(),
              })
              .eq('id', plan.id);

            productsCount++;
          }
        } catch (error: any) {
          errors.push(`Plan ${plan.id}: ${error.message}`);
        }
      }
    }

    // Log sync operation
    const syncId = await logSync({
      p_sync_type: 'manual',
      p_direction: direction,
      p_entity_type: 'product',
      p_action: 'sync',
      p_status: errors.length === 0 ? 'success' : 'partial',
      p_response_data: {
        products_synced: productsCount,
        prices_synced: pricesCount,
        errors: errors,
      },
      p_performed_by: userId,
    });

    return res.status(200).json({
      success: true,
      sync_summary: {
        products_synced: productsCount,
        prices_synced: pricesCount,
        errors: errors,
        duration_ms: Date.now() - startTime,
        sync_id: syncId,
      },
    });
  } catch (error: any) {
    throw error;
  }
}

async function handleGetSyncLog(req: VercelRequest, res: VercelResponse) {
  try {
    const limit = Math.min(parseInt(req.query?.limit as string) || 50, 200);
    const offset = parseInt(req.query?.offset as string) || 0;
    const status = req.query?.status || 'all';
    const entity_type = req.query?.entity_type;

    const supabase = createSupabaseClient();
    let query = supabase
      .from('stripe_sync_log')
      .select('*', { count: 'exact' });

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    if (entity_type) {
      query = query.eq('entity_type', entity_type);
    }

    const { data: logs, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      logs: logs || [],
      total: count || 0,
      has_more: (count || 0) > offset + limit,
    });
  } catch (error: any) {
    throw error;
  }
}

async function handleGetSyncStatus(req: VercelRequest, res: VercelResponse) {
  try {
    const supabase = createSupabaseClient();
    
    // Get sync status summary
    const { data: plans } = await supabase
      .from('subscription_plans')
      .select('stripe_sync_status', { count: 'exact' });
    
    const { data: packages } = await supabase
      .from('credit_packages')
      .select('stripe_sync_status', { count: 'exact' });
    
    // Count sync statuses
    const plansSynced = plans?.filter(p => p.stripe_sync_status === 'synced').length || 0;
    const plansPending = plans?.filter(p => p.stripe_sync_status === 'pending').length || 0;
    const plansError = plans?.filter(p => p.stripe_sync_status === 'error').length || 0;
    
    const packagesSynced = packages?.filter(p => p.stripe_sync_status === 'synced').length || 0;
    const packagesPending = packages?.filter(p => p.stripe_sync_status === 'pending').length || 0;
    const packagesError = packages?.filter(p => p.stripe_sync_status === 'error').length || 0;
    
    // Get last sync log
    const { data: lastSync } = await supabase
      .from('stripe_sync_log')
      .select('created_at, status, sync_details')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    return res.status(200).json({
      success: true,
      total_products: (plans?.length || 0) + (packages?.length || 0),
      synced_products: plansSynced + packagesSynced,
      pending_sync: plansPending + packagesPending,
      sync_errors: plansError + packagesError,
      last_sync_at: lastSync?.created_at || null,
      last_sync_status: lastSync?.status || null,
      breakdown: {
        subscription_plans: {
          total: plans?.length || 0,
          synced: plansSynced,
          pending: plansPending,
          error: plansError,
        },
        credit_packages: {
          total: packages?.length || 0,
          synced: packagesSynced,
          pending: packagesPending,
          error: packagesError,
        }
      }
    });
  } catch (error: any) {
    console.error('Failed to get sync status:', error);
    return res.status(500).json({ error: error.message || 'Failed to get sync status' });
  }
}

async function handleProductSync(req: VercelRequest, res: VercelResponse, userId: string) {
  try {
    const productId = req.query.productId as string;
    if (!productId) {
      return res.status(400).json({ error: 'Product ID required' });
    }
    
    const supabase = createSupabaseClient();
    
    // Mark product as needing sync
    await supabase
      .from('subscription_plans')
      .update({ stripe_sync_status: 'pending' })
      .eq('stripe_product_id', productId);
    
    // Fetch product from Stripe
    const stripeProduct = await stripe.products.retrieve(productId);
    const stripePrices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 10,
    });
    
    const activePrice = stripePrices.data[0];
    
    if (!activePrice) {
      return res.status(400).json({ error: 'No active price found for product' });
    }
    
    // Update in database
    const planData = {
      stripe_product_id: stripeProduct.id,
      stripe_price_id: activePrice.id,
      name: stripeProduct.name,
      description: stripeProduct.description,
      price_cents: activePrice.unit_amount || 0,
      currency: activePrice.currency.toUpperCase(),
      interval: activePrice.recurring?.interval || 'month',
      credits_per_period: parseInt(stripeProduct.metadata?.credits_per_period || '0'),
      is_active: stripeProduct.active,
      stripe_sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
    };
    
    const { data: existingPlan } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('stripe_product_id', productId)
      .single();
    
    if (existingPlan) {
      await supabase
        .from('subscription_plans')
        .update(planData)
        .eq('id', existingPlan.id);
    } else {
      await supabase
        .from('subscription_plans')
        .insert({ ...planData, created_via: 'stripe_webhook' });
    }
    
    // Log sync
    await logSync({
      p_sync_type: 'product_refresh',
      p_direction: 'from_stripe',
      p_entity_type: 'product',
      p_entity_id: productId,
      p_action: 'refresh',
      p_status: 'success',
      p_response_data: {
        product: stripeProduct.name,
        price_id: activePrice.id,
      },
      p_performed_by: userId,
    });
    
    return res.status(200).json({
      success: true,
      product: {
        id: productId,
        name: stripeProduct.name,
        synced: true,
      }
    });
  } catch (error: any) {
    console.error('Failed to sync product:', error);
    return res.status(500).json({ error: error.message || 'Failed to sync product' });
  }
}
