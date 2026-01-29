import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Helper to get test mode from request header
function getTestModeFromRequest(req: any): boolean {
  const testModeHeader = req.headers['x-test-mode'];
  return testModeHeader === 'true';
}

// Helper to get Stripe instance based on test mode
function getStripeClient(isTestMode: boolean): Stripe {
  const stripeSecretKey = isTestMode 
    ? process.env.STRIPE_TEST_SECRET_KEY
    : process.env.STRIPE_SECRET_KEY;
  
  return new Stripe(stripeSecretKey!, {
    apiVersion: '2017-08-15' as any, // Your older API version
  });
}

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Manually trigger sync from Stripe
    const isTestMode = getTestModeFromRequest(req);
    const stripe = getStripeClient(isTestMode);
    console.log(`🔄 Manual sync triggered in ${isTestMode ? 'TEST' : 'LIVE'} mode...`);
    
    // Fetch ALL products from Stripe (handle pagination)
    let allProducts = [];
    let hasMore = true;
    let startingAfter = undefined;
    
    while (hasMore) {
      const batch = await stripe.products.list({
        limit: 100,
        expand: ['data.default_price'],
        starting_after: startingAfter
      });
      
      allProducts = allProducts.concat(batch.data);
      hasMore = batch.has_more;
      
      if (batch.data.length > 0) {
        startingAfter = batch.data[batch.data.length - 1].id;
      }
    }
    
    const products = { data: allProducts };

    console.log(`Found ${products.data.length} products in Stripe (${isTestMode ? 'TEST' : 'LIVE'} mode)`);

    // Try to fetch the specific product
    try {
      const specificProduct = await stripe.products.retrieve('prod_SxN8ZS7mAwMUC8', {
        expand: ['default_price']
      });
      console.log('Specific product prod_SxN8ZS7mAwMUC8:', {
        id: specificProduct.id,
        name: specificProduct.name,
        metadata: specificProduct.metadata,
        active: specificProduct.active
      });
      
      // Add it to the list if not already there
      if (!products.data.find(p => p.id === specificProduct.id)) {
        console.log('Adding missing product to list');
        products.data.push(specificProduct);
      }
    } catch (err) {
      console.log('Could not fetch specific product:', err.message);
    }

    // Show all products for debugging
    console.log('All products:', products.data.map(p => ({
      id: p.id,
      name: p.name,
      metadata: p.metadata
    })));

    // Filter for your video app products
    const videoAppProducts = products.data.filter(product => 
      product.metadata?.app === 'video-studio'
    );

    console.log(`Filtered to ${videoAppProducts.length} video-studio products`);

    // Sync each product
    for (const product of videoAppProducts) {
      console.log(`Syncing product: ${product.name}`);
      
      // Check if it's a subscription or one-time product
      const defaultPrice = product.default_price as Stripe.Price;
      
      if (defaultPrice?.recurring) {
        // It's a subscription plan
        const { error } = await supabase
          .from('subscription_plans')
          .upsert({
            stripe_product_id: product.id,
            stripe_price_id: defaultPrice.id,
            name: product.name,
            description: product.description,
            price_cents: defaultPrice.unit_amount,
            currency: defaultPrice.currency,
            interval: defaultPrice.recurring.interval,
            stripe_sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
            metadata: product.metadata
          }, {
            onConflict: 'stripe_product_id'
          });
          
        if (error) {
          console.error(`Error syncing plan ${product.name}:`, error);
        }
      } else {
        // It's a one-time product (credit package)
        const { error } = await supabase
          .from('credit_packages')
          .upsert({
            stripe_product_id: product.id,
            stripe_price_id: defaultPrice?.id,
            name: product.name,
            description: product.description,
            price_cents: defaultPrice?.unit_amount,
            currency: defaultPrice?.currency,
            stripe_sync_status: 'synced',
            last_synced_at: new Date().toISOString()
          }, {
            onConflict: 'stripe_product_id'
          });
          
        if (error) {
          console.error(`Error syncing package ${product.name}:`, error);
        }
      }
    }

    // Log sync operation
    await supabase
      .from('stripe_sync_log')
      .insert({
        sync_type: 'manual',
        direction: 'from_stripe',
        entity_type: 'product',
        status: 'success',
        details: {
          total_products: products.data.length,
          synced_products: videoAppProducts.length
        }
      });

    return res.status(200).json({
      success: true,
      mode: isTestMode ? 'TEST' : 'LIVE',
      message: `Synced ${videoAppProducts.length} products from ${products.data.length} total`,
      totalProductsInStripe: products.data.length,
      allProducts: products.data.map(p => ({
        id: p.id,
        name: p.name,
        metadata: p.metadata,
        hasVideoStudioTag: p.metadata?.app === 'video-studio'
      })),
      syncedProducts: videoAppProducts.map(p => ({
        id: p.id,
        name: p.name,
        type: (p.default_price as any)?.recurring ? 'subscription' : 'one-time'
      }))
    });

  } catch (error: any) {
    console.error('Sync error:', error);
    return res.status(500).json({ 
      error: 'Sync failed', 
      details: error.message 
    });
  }
}