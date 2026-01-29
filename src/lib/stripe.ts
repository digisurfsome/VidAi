import { loadStripe, Stripe } from '@stripe/stripe-js';
import { getTestMode, getStripeKeys } from './stripe-test-mode';
import { supabase } from './supabase';

// Initialize Stripe.js with publishable key
let stripePromise: Promise<Stripe | null>;

export const getStripe = () => {
  if (!stripePromise) {
    const { publishableKey } = getStripeKeys();
    if (!publishableKey) {
      console.error('Missing Stripe publishable key');
      return null;
    }
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
};

// Stripe API endpoints
const API_BASE = '/api';

export interface CreateCheckoutSessionParams {
  priceId: string;
  userId?: string;
  userEmail?: string;
  successUrl?: string;
  cancelUrl?: string;
  customerId?: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

export interface CreatePortalSessionParams {
  returnUrl?: string;
}

export interface PurchaseCreditsParams {
  packageId: string;
  priceInCents: number;
  userId: string;
  userEmail: string;
  successUrl: string;
  cancelUrl: string;
  stripePriceId?: string;
  stripeProductId?: string;
}

// Create a Stripe Checkout session for subscription
export async function createCheckoutSession(params: CreateCheckoutSessionParams) {
  const isTestMode = getTestMode();
  const response = await fetch(`${API_BASE}/stripe-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Test-Mode': String(isTestMode),
    },
    credentials: 'include',
    body: JSON.stringify({
      ...params,
      successUrl: params.successUrl || `${window.location.origin}/dashboard?subscription=success`,
      cancelUrl: params.cancelUrl || `${window.location.origin}/pricing?cancelled=true`,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create checkout session');
  }

  return response.json();
}

// Create a Stripe Customer Portal session for subscription management
export async function createPortalSession(params?: CreatePortalSessionParams) {
  // Get the current user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    throw new Error('User not authenticated');
  }

  const isTestMode = getTestMode();
  const response = await fetch(`${API_BASE}/stripe-portal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Test-Mode': String(isTestMode),
    },
    credentials: 'include',
    body: JSON.stringify({
      userId: user.id,
      returnUrl: params?.returnUrl || `${window.location.origin}/dashboard/billing`,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create portal session');
  }

  return response.json();
}

// Purchase credits with one-time payment
export async function purchaseCredits(params: PurchaseCreditsParams) {
  const isTestMode = getTestMode();
  const response = await fetch(`${API_BASE}/credit-purchase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${await getAuthToken()}`,
      'X-Test-Mode': String(isTestMode),
    },
    credentials: 'include',
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json();
    return { error: error.error || 'Failed to purchase credits' };
  }

  return response.json();
}

// Helper to get auth token
async function getAuthToken() {
  const { supabase } = await import('./supabase');
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || '';
}

// Get user's subscription status
export async function getSubscriptionStatus() {
  const response = await fetch(`${API_BASE}/subscription/status`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get subscription status');
  }

  return response.json();
}

// Get available subscription plans
export async function getSubscriptionPlans() {
  const response = await fetch(`${API_BASE}/subscription/plans`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get subscription plans');
  }

  return response.json();
}

// Get available credit packages
export async function getCreditPackages() {
  const response = await fetch(`${API_BASE}/credits/packages`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get credit packages');
  }

  return response.json();
}

// Get user's credit balance
export async function getCreditBalance() {
  const response = await fetch(`${API_BASE}/credits`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${await getAuthToken()}`
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get credit balance');
  }

  return response.json();
}

// Get billing history
export async function getBillingHistory(limit = 20, offset = 0) {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  });

  const response = await fetch(`${API_BASE}/billing/history?${params}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get billing history');
  }

  return response.json();
}

// Format price for display
export function formatPrice(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// Format credits for display
export function formatCredits(credits: number): string {
  return new Intl.NumberFormat('en-US').format(credits);
}