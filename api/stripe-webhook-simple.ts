import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase with service role key
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // For Vite dev server, the raw body is provided directly
    const rawBody = (req as any).rawBody || req.body || '';
    const sig = req.headers['stripe-signature'] as string;
    
    if (!rawBody) {
      console.error('[Webhook] No body received');
      return res.status(400).json({ error: 'No body received' });
    }
    
    // Parse the body to check if it's test mode
    const eventData = JSON.parse(rawBody);
    const isTestMode = eventData.livemode === false;
    
    // Get the appropriate Stripe client and webhook secret
    const stripeKey = isTestMode 
      ? process.env.STRIPE_TEST_SECRET_KEY 
      : process.env.STRIPE_SECRET_KEY;
    
    const webhookSecret = isTestMode
      ? process.env.STRIPE_TEST_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
      : process.env.STRIPE_WEBHOOK_SECRET;
    
    console.log('[Webhook] Test mode:', isTestMode);
    console.log('[Webhook] Has stripe key:', !!stripeKey);
    console.log('[Webhook] Has webhook secret:', !!webhookSecret);
    
    const stripe = new Stripe(stripeKey!, { apiVersion: '2023-10-16' });
    
    // Construct the event
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret!);
    } catch (err: any) {
      console.error('[Webhook] Signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }
    
    console.log('[Webhook] Event type:', event.type);
    
    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log('[Webhook] Checkout session completed:', session.id);
        
        // Get user email from session
        const userEmail = session.customer_email || session.customer_details?.email;
        if (!userEmail) {
          console.error('[Webhook] No email found in session');
          break;
        }
        
        // Get user from Supabase using auth admin API
        const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
        
        if (userError) {
          console.error('[Webhook] Error fetching users:', userError);
          break;
        }
        
        const user = users.find(u => u.email === userEmail);
        
        if (!user) {
          console.error('[Webhook] User not found:', userEmail);
          break;
        }
        
        const userId = user.id;
        
        // Handle subscription checkout
        if (session.mode === 'subscription' && session.subscription) {
          const subscriptionId = typeof session.subscription === 'string' 
            ? session.subscription 
            : session.subscription.id;
          
          // Get subscription details from Stripe
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          
          // Insert/update subscription in database
          const { error: subError } = await supabase
            .from('user_subscriptions')
            .upsert({
              user_id: userId,
              stripe_subscription_id: subscription.id,
              stripe_customer_id: subscription.customer as string,
              stripe_price_id: subscription.items.data[0].price.id,
              status: subscription.status,
              current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              cancel_at_period_end: subscription.cancel_at_period_end,
              canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
              trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
              is_test: isTestMode
            }, {
              onConflict: 'user_id'
            });
          
          if (subError) {
            console.error('[Webhook] Failed to save subscription:', subError);
          } else {
            console.log('[Webhook] Subscription saved for user:', userId);
          }
        }
        
        // Handle one-time payment (credit package)
        if (session.mode === 'payment') {
          // Get credits from metadata - this is set when creating the checkout session
          const creditsFromMetadata = session.metadata?.credits || session.payment_intent_details?.metadata?.credits;
          
          if (!creditsFromMetadata) {
            console.error('[Webhook] No credits found in metadata for session:', session.id);
            break;
          }
          
          const credits = parseInt(creditsFromMetadata, 10);
          
          if (isNaN(credits) || credits <= 0) {
            console.error('[Webhook] Invalid credits value:', creditsFromMetadata);
            break;
          }
          
          console.log('[Webhook] Processing credit purchase:', { userId, credits, sessionId: session.id });
          
          // Add credits to user
          const { error: creditError } = await supabase.rpc('add_credits', {
            p_user_id: userId,
            p_amount: credits,
            p_description: `Purchased ${credits} credits`,
            p_type: 'purchase',
            p_stripe_payment_intent_id: session.payment_intent as string || null
          });
          
          if (creditError) {
            console.error('[Webhook] Failed to add credits:', creditError);
          } else {
            console.log('[Webhook] Successfully added', credits, 'credits to user:', userId);
          }
        }
        
        break;
      }
      
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('[Webhook] Subscription update:', subscription.id);
        
        // Find user by customer ID
        const { data: userData, error: userError } = await supabase
          .from('user_subscriptions')
          .select('user_id')
          .eq('stripe_customer_id', subscription.customer)
          .single();
        
        if (userError || !userData) {
          console.error('[Webhook] User subscription not found for customer:', subscription.customer);
          break;
        }
        
        // Update subscription
        const { error: updateError } = await supabase
          .from('user_subscriptions')
          .update({
            status: subscription.status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
            trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null
          })
          .eq('stripe_subscription_id', subscription.id);
        
        if (updateError) {
          console.error('[Webhook] Failed to update subscription:', updateError);
        } else {
          console.log('[Webhook] Updated subscription:', subscription.id);
        }
        
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('[Webhook] Subscription deleted:', subscription.id);
        
        // Update subscription status
        const { error: updateError } = await supabase
          .from('user_subscriptions')
          .update({
            status: 'canceled',
            canceled_at: new Date().toISOString()
          })
          .eq('stripe_subscription_id', subscription.id);
        
        if (updateError) {
          console.error('[Webhook] Failed to cancel subscription:', updateError);
        } else {
          console.log('[Webhook] Canceled subscription:', subscription.id);
        }
        
        break;
      }
      
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log('[Webhook] Invoice payment succeeded:', invoice.id);
        
        // If this is a subscription invoice, add credits
        if (invoice.subscription) {
          const subscriptionId = typeof invoice.subscription === 'string' 
            ? invoice.subscription 
            : invoice.subscription.id;
          
          // Get subscription from database
          const { data: subData, error: subError } = await supabase
            .from('user_subscriptions')
            .select('user_id')
            .eq('stripe_subscription_id', subscriptionId)
            .single();
          
          if (subError || !subData) {
            console.error('[Webhook] Subscription not found:', subscriptionId);
            break;
          }
          
          // Get plan details to know how many credits to add
          const { data: planData, error: planError } = await supabase
            .from('subscription_plans')
            .select('credits_per_period')
            .eq('stripe_price_id', invoice.lines.data[0].price?.id)
            .eq('is_test', isTestMode)
            .single();
          
          if (planError || !planData) {
            console.error('[Webhook] Plan not found for price:', invoice.lines.data[0].price?.id);
            break;
          }
          
          // Add credits
          const { error: creditError } = await supabase.rpc('add_credits', {
            p_user_id: subData.user_id,
            p_amount: planData.credits_per_period,
            p_description: `Subscription renewal - ${planData.credits_per_period} credits`,
            p_type: 'subscription',
            p_stripe_payment_intent_id: invoice.payment_intent as string || null
          });
          
          if (creditError) {
            console.error('[Webhook] Failed to add subscription credits:', creditError);
          } else {
            console.log('[Webhook] Added', planData.credits_per_period, 'credits for subscription renewal');
          }
        }
        
        break;
      }
      
      default:
        console.log('[Webhook] Unhandled event type:', event.type);
    }
    
    return res.status(200).json({ received: true });
    
  } catch (error: any) {
    console.error('[Webhook] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}