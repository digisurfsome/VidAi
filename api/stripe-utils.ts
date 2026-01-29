import { VercelRequest } from '@vercel/node'
import Stripe from 'stripe'

/**
 * Helper to get test mode from request header
 * Checks the x-test-mode header to determine if the request is for test mode
 */
export function getTestModeFromRequest(req: VercelRequest): boolean {
  const testModeHeader = req.headers['x-test-mode']
  return testModeHeader === 'true'
}

/**
 * Helper to get Stripe instance based on test mode
 * Returns a Stripe client configured with either test or live keys
 */
export function getStripeClient(isTestMode: boolean): Stripe {
  const stripeSecretKey = isTestMode 
    ? process.env.STRIPE_TEST_SECRET_KEY
    : process.env.STRIPE_SECRET_KEY
  
  if (!stripeSecretKey) {
    throw new Error(`Stripe ${isTestMode ? 'test' : 'live'} secret key not configured`)
  }
  
  return new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
  })
}

/**
 * Helper to get webhook secret based on test mode
 * Returns the appropriate webhook secret for signature verification
 */
export function getWebhookSecret(isTestMode: boolean): string {
  const webhookSecret = isTestMode
    ? process.env.STRIPE_TEST_WEBHOOK_SECRET
    : process.env.STRIPE_WEBHOOK_SECRET
    
  if (!webhookSecret) {
    throw new Error(`Stripe ${isTestMode ? 'test' : 'live'} webhook secret not configured`)
  }
  
  return webhookSecret
}

/**
 * Helper to detect test mode from webhook payload
 * Stripe webhooks include a livemode field that indicates if it's a test event
 */
export function getTestModeFromWebhook(payload: any): boolean {
  return payload.livemode === false
}

/**
 * Helper to add test mode metadata to Stripe objects
 * Adds consistent metadata for tracking test mode transactions
 */
export function addTestModeMetadata(metadata: Record<string, any>, isTestMode: boolean): Record<string, any> {
  return {
    ...metadata,
    is_test: isTestMode ? 'true' : 'false',
    environment: isTestMode ? 'test' : 'production'
  }
}