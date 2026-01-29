import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Helper to get Stripe instance based on mode
function getStripeClient(isTestMode: boolean): Stripe {
  const stripeSecretKey = isTestMode 
    ? process.env.STRIPE_TEST_SECRET_KEY
    : process.env.STRIPE_SECRET_KEY;
  
  return new Stripe(stripeSecretKey!, {
    apiVersion: '2023-10-16',
  });
}

// Initialize Supabase with service role key for admin operations
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper to get webhook secret based on mode
function getWebhookSecret(isTestMode: boolean): string {
  return isTestMode
    ? process.env.STRIPE_TEST_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET!
    : process.env.STRIPE_WEBHOOK_SECRET!;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('[Webhook] Received request');
  console.log('[Webhook] Headers:', req.headers);
  
  const sig = req.headers['stripe-signature'] as string;
  const rawBody = await getRawBody(req);
  
  console.log('[Webhook] Raw body length:', rawBody.length);
  console.log('[Webhook] Raw body preview:', rawBody.substring(0, 100));

  let event: Stripe.Event;

  // First, parse the event to determine if it's test mode
  const parsedBody = JSON.parse(rawBody);
  const isTestMode = parsedBody.livemode === false;
  console.log('[Webhook] Test mode:', isTestMode);
  
  // Get appropriate Stripe client and webhook secret
  const stripe = getStripeClient(isTestMode);
  const webhookSecret = getWebhookSecret(isTestMode);
  
  console.log('[Webhook] Webhook secret exists:', !!webhookSecret);
  console.log('[Webhook] Stripe client initialized:', !!stripe);

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    // Handle different event types
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription, stripe);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentSucceeded(invoice, stripe);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(invoice, stripe);
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentSucceeded(paymentIntent);
        break;
      }

      case 'product.created':
      case 'product.updated': {
        const product = event.data.object as Stripe.Product;
        await handleProductUpdate(product);
        break;
      }

      case 'price.created':
      case 'price.updated': {
        const price = event.data.object as Stripe.Price;
        await handlePriceUpdate(price);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error(`Error processing webhook: ${error.message}`);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription, stripe: Stripe) {
  console.log('Processing subscription update:', subscription.id);
  
  // Get customer email
  const customer = await stripe.customers.retrieve(subscription.customer as string) as Stripe.Customer;
  if (!customer || customer.deleted) {
    throw new Error('Customer not found or deleted');
  }

  // Find user by email in profiles table
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', customer.email!)
    .single();

  if (profileError || !profile) {
    console.error('User profile not found for email:', customer.email);
    // Try to create a pending subscription record for later linking
    console.log('Creating pending subscription for later user linking');
    // For now, we'll return - but this is where we could store pending subscription
    return;
  }

  const userId = profile.id;

  // Get the subscription plan
  const priceId = subscription.items.data[0]?.price.id;
  const { data: plan } = await supabase
    .from('subscription_plans')
    .select('id')
    .eq('stripe_price_id', priceId)
    .single();

  // Ensure stripe_customers record exists
  await supabase
    .from('stripe_customers')
    .upsert({
      user_id: userId,
      stripe_customer_id: customer.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    });

  // Update or create user subscription
  const subscriptionData = {
    user_id: userId,
    stripe_subscription_id: subscription.id,
    plan_id: plan?.id,
    status: subscription.status,
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    cancel_at_period_end: subscription.cancel_at_period_end,
    canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
    trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('user_subscriptions')
    .upsert({
      ...subscriptionData,
      id: crypto.randomUUID(), // Generate ID for new records
    }, {
      onConflict: 'stripe_subscription_id',
    });

  if (error) {
    console.error('Error updating subscription:', error);
    throw error;
  }

  // Also ensure stripe_customers record exists
  await supabase
    .from('stripe_customers')
    .upsert({
      user_id: user.user_id,
      stripe_customer_id: subscription.customer as string,
      email: customer.email!,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'stripe_customer_id',
    });

  console.log('Subscription updated successfully');
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log('Processing subscription deletion:', subscription.id);
  
  // Update subscription status to cancelled
  const { error } = await supabase
    .from('user_subscriptions')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id);

  if (error) {
    console.error('Error updating subscription status:', error);
    throw error;
  }

  console.log('Subscription cancelled successfully');
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice, stripe: Stripe) {
  console.log('Processing successful invoice payment:', invoice.id);
  
  // Only process subscription invoices
  if (!invoice.subscription) return;

  // Get the subscription
  const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
  
  // Get customer
  const customer = await stripe.customers.retrieve(invoice.customer as string) as Stripe.Customer;
  if (!customer || customer.deleted) return;

  // Find user by email in profiles table
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', customer.email!)
    .single();

  if (!profile) {
    console.error('User profile not found for invoice payment:', customer.email);
    return;
  }

  const userId = profile.id;

  // Get subscription plan to know credit allocation
  const priceId = subscription.items.data[0]?.price.id;
  const { data: plan } = await supabase
    .from('subscription_plans')
    .select('credits_per_period, name')
    .eq('stripe_price_id', priceId)
    .single();

  if (plan && plan.credits_per_period > 0) {
    // Add subscription credits using the add_credits function
    const { data, error } = await supabase.rpc('add_credits', {
      p_user_id: userId,
      p_amount: plan.credits_per_period,
      p_type: 'subscription',
      p_description: `Monthly subscription renewal - ${plan.name}`,
      p_stripe_payment_intent_id: invoice.payment_intent as string,
    });

    if (error) {
      console.error('Error adding subscription credits:', error);
    } else {
      console.log(`Added ${plan.credits_per_period} credits for subscription renewal`);
    }
  }

  // Record payment transaction
  await supabase
    .from('payment_transactions')
    .insert({
      user_id: userId,
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id: invoice.payment_intent as string,
      amount_cents: invoice.amount_paid,
      currency: invoice.currency,
      status: 'succeeded',
      description: `Subscription payment - ${invoice.lines.data[0]?.description}`,
      metadata: {
        subscription_id: invoice.subscription,
        billing_period_start: invoice.period_start,
        billing_period_end: invoice.period_end,
      },
    });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, stripe: Stripe) {
  console.log('Processing failed invoice payment:', invoice.id);
  
  // Get customer
  const customer = await stripe.customers.retrieve(invoice.customer as string) as Stripe.Customer;
  if (!customer || customer.deleted) return;

  // Find user by email in profiles table
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', customer.email!)
    .single();

  if (!profile) {
    console.error('User profile not found for failed payment:', customer.email);
    return;
  }

  const userId = profile.id;

  // Record failed payment
  await supabase
    .from('payment_transactions')
    .insert({
      user_id: userId,
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id: invoice.payment_intent as string,
      amount_cents: invoice.amount_due,
      currency: invoice.currency,
      status: 'failed',
      description: `Failed subscription payment - ${invoice.lines.data[0]?.description}`,
      metadata: {
        subscription_id: invoice.subscription,
        failure_reason: invoice.last_finalization_error?.message,
      },
    });

  // TODO: Send notification email about failed payment
  console.log('Payment failed notification should be sent to:', customer.email);
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log('Processing checkout session completion:', session.id);
  
  // Session completed successfully
  if (session.mode === 'subscription') {
    console.log('Subscription checkout completed for customer:', session.customer);
    
    // Get the stripe instance based on mode
    const isTestMode = session.livemode === false;
    const stripeSecretKey = isTestMode 
      ? process.env.STRIPE_TEST_SECRET_KEY
      : process.env.STRIPE_SECRET_KEY;
    const stripe = new Stripe(stripeSecretKey!, { apiVersion: '2023-10-16' });
    
    // Retrieve the subscription to ensure it's processed
    if (session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
      await handleSubscriptionUpdate(subscription, stripe);
      console.log('Triggered subscription update from checkout completion');
    }
  } else if (session.mode === 'payment') {
    // One-time payment for credits
    console.log('One-time payment completed:', session.payment_intent);
    // Credit addition will be handled by payment_intent.succeeded event
  }
}

async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  console.log('Processing successful payment intent:', paymentIntent.id);
  
  // Check if this is a credit purchase (not a subscription payment)
  if (paymentIntent.invoice) {
    // This is a subscription payment, handled by invoice webhooks
    return;
  }

  // Extract metadata for credit purchase
  const { user_id, package_id, credits, type } = paymentIntent.metadata || {};
  
  // Check if this is a credit purchase
  if (type === 'credit_purchase' && user_id && credits) {
    const creditsToAdd = parseInt(credits);
    
    // Add credits to user account
    const { data, error } = await supabase.rpc('add_credits', {
      p_user_id: user_id,
      p_amount: creditsToAdd,
      p_description: `Credit package purchase - ${package_id}`,
    });

    if (error) {
      console.error('Error adding purchased credits:', error);
      // Note: In production, you might want to handle this error more robustly
      // such as sending an alert or creating a manual review queue
    } else {
      console.log(`Successfully added ${creditsToAdd} credits for user ${user_id}`);
    }

      // Record payment transaction
      await supabase
        .from('payment_transactions')
        .insert({
          user_id,
          stripe_payment_intent_id: paymentIntent.id,
          amount_cents: paymentIntent.amount,
          currency: paymentIntent.currency,
          status: 'succeeded',
          description: `Credit purchase - ${creditPackage.name}`,
          metadata: {
            credit_package_id,
            credits_purchased: creditPackage.credits,
          },
        });
    }
  }
}

async function handleProductUpdate(product: Stripe.Product) {
  console.log('Processing product update from Stripe:', product.id);
  
  try {
    // Check if this is a subscription product (not a credit package)
    const isSubscription = !product.metadata?.type || product.metadata?.type !== 'credit_package';
    
    if (isSubscription) {
      // Check if product exists in database
      const { data: existingPlan } = await supabase
        .from('subscription_plans')
        .select('id')
        .eq('stripe_product_id', product.id)
        .single();

      if (existingPlan) {
        // Update existing plan
        const { error } = await supabase
          .from('subscription_plans')
          .update({
            name: product.name,
            description: product.description,
            is_active: product.active,
            credits_per_period: parseInt(product.metadata?.credits_per_period || '0'),
            stripe_sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
          })
          .eq('stripe_product_id', product.id);

        if (error) {
          console.error('Error updating plan from webhook:', error);
          throw error;
        }
      } else {
        // Create new plan (will need price info, so mark as pending)
        const { error } = await supabase
          .from('subscription_plans')
          .insert({
            stripe_product_id: product.id,
            name: product.name,
            description: product.description,
            is_active: product.active,
            credits_per_period: parseInt(product.metadata?.credits_per_period || '0'),
            created_via: 'stripe_webhook',
            stripe_sync_status: 'pending', // Will be updated when price is created
            price_cents: 0, // Placeholder until price is created
            currency: 'USD',
            interval: 'month',
          });

        if (error && error.code !== '23505') { // Ignore duplicate key errors
          console.error('Error creating plan from webhook:', error);
          throw error;
        }
      }
    } else {
      // Handle credit package update
      const { data: existingPackage } = await supabase
        .from('credit_packages')
        .select('id')
        .eq('stripe_product_id', product.id)
        .single();

      if (existingPackage) {
        await supabase
          .from('credit_packages')
          .update({
            name: product.name,
            is_active: product.active,
            credits: parseInt(product.metadata?.credits || '0'),
            bonus_percentage: parseInt(product.metadata?.bonus_percentage || '0'),
            stripe_sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
          })
          .eq('stripe_product_id', product.id);
      }
    }

    // Log sync operation
    await supabase.rpc('log_stripe_sync', {
      p_sync_type: 'webhook',
      p_direction: 'from_stripe',
      p_entity_type: 'product',
      p_entity_id: product.id,
      p_action: existingPlan ? 'update' : 'create',
      p_status: 'success',
    });

    console.log('Product sync completed successfully');
  } catch (error) {
    console.error('Error in handleProductUpdate:', error);
    
    // Log failed sync
    await supabase.rpc('log_stripe_sync', {
      p_sync_type: 'webhook',
      p_direction: 'from_stripe',
      p_entity_type: 'product',
      p_entity_id: product.id,
      p_action: 'update',
      p_status: 'failure',
      p_error_message: error.message,
    });
  }
}

async function handlePriceUpdate(price: Stripe.Price) {
  console.log('Processing price update from Stripe:', price.id);
  
  try {
    // Only handle recurring prices for subscriptions
    if (price.type === 'recurring' && price.recurring) {
      // Check if this price's product exists in our plans
      const { data: plan } = await supabase
        .from('subscription_plans')
        .select('id, stripe_price_id, price_cents')
        .eq('stripe_product_id', price.product as string)
        .single();

      if (plan) {
        const isNewPrice = plan.stripe_price_id !== price.id;
        
        if (isNewPrice && plan.price_cents !== price.unit_amount) {
          // Record old price in history before updating
          await supabase
            .from('price_history')
            .insert({
              plan_id: plan.id,
              stripe_price_id: plan.stripe_price_id,
              price_cents: plan.price_cents,
              currency: 'USD',
              active_from: new Date().toISOString(),
              active_until: new Date().toISOString(),
              reason_for_change: 'New price created in Stripe',
            });
        }

        // Update plan with new price
        const { error } = await supabase
          .from('subscription_plans')
          .update({
            stripe_price_id: price.id,
            price_cents: price.unit_amount || 0,
            currency: price.currency.toUpperCase(),
            interval: price.recurring.interval,
            stripe_sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
          })
          .eq('stripe_product_id', price.product as string);

        if (error) {
          console.error('Error updating plan price from webhook:', error);
          throw error;
        }

        console.log(`Plan price updated: ${price.id}`);
      }
    } else if (price.type === 'one_time') {
      // Handle one-time prices for credit packages
      const { data: package_ } = await supabase
        .from('credit_packages')
        .select('id')
        .eq('stripe_product_id', price.product as string)
        .single();

      if (package_) {
        await supabase
          .from('credit_packages')
          .update({
            stripe_price_id: price.id,
            price_cents: price.unit_amount || 0,
            currency: price.currency.toUpperCase(),
            stripe_sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
          })
          .eq('stripe_product_id', price.product as string);

        console.log(`Package price updated: ${price.id}`);
      }
    }

    // Log sync operation
    await supabase.rpc('log_stripe_sync', {
      p_sync_type: 'webhook',
      p_direction: 'from_stripe',
      p_entity_type: 'price',
      p_entity_id: price.id,
      p_action: 'update',
      p_status: 'success',
    });
  } catch (error) {
    console.error('Error in handlePriceUpdate:', error);
    
    // Log failed sync
    await supabase.rpc('log_stripe_sync', {
      p_sync_type: 'webhook',
      p_direction: 'from_stripe',
      p_entity_type: 'price',
      p_entity_id: price.id,
      p_action: 'update',
      p_status: 'failure',
      p_error_message: error.message,
    });
  }
}

// Helper function to get raw body for webhook signature verification
async function getRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', reject);
  });
}