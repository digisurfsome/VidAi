// Stripe configuration with test/production mode support
import { getTestMode, getStripeKeys, getServerStripeKeys } from './stripe-test-mode';

interface StripeConfig {
  publishableKey: string;
  secretKey?: string;
  webhookSecret?: string;
  isTestMode: boolean;
}

// Get dynamic test mode and keys
const dynamicConfig = getStripeKeys();

// Select appropriate keys based on mode
export const stripeConfig: StripeConfig = {
  publishableKey: dynamicConfig.publishableKey,
  isTestMode: dynamicConfig.isTestMode,
};

// Server-side configuration (for API routes)
export const getServerStripeConfig = (): StripeConfig => {
  // Check for test mode header from client
  const testModeHeader = typeof window === 'undefined' && 
    global.process?.env?.STRIPE_TEST_MODE_HEADER;
  
  return getServerStripeKeys(testModeHeader === 'true');
};

// Helper to get Stripe dashboard URL
export const getStripeDashboardUrl = (path = ''): string => {
  const baseUrl = 'https://dashboard.stripe.com';
  const modePrefix = getTestMode() ? '/test' : '';
  return `${baseUrl}${modePrefix}${path}`;
};

// Helper to check if a Stripe ID is from test mode
export const isTestStripeId = (id: string): boolean => {
  if (!id) return false;
  
  // Test mode IDs contain '_test_' or start with test prefixes
  const testPrefixes = [
    'pk_test_',
    'sk_test_',
    'price_test_',
    'prod_test_',
    'sub_test_',
    'cus_test_',
    'pi_test_',
  ];
  
  return testPrefixes.some(prefix => id.startsWith(prefix)) || 
         id.includes('_test_');
};

// Test card numbers for sandbox testing
export const testCards = {
  success: {
    number: '4242424242424242',
    description: 'Succeeds and immediately processes the payment',
  },
  requiresAuth: {
    number: '4000002500003155',
    description: 'Requires 3D Secure authentication',
  },
  declined: {
    number: '4000000000000002',
    description: 'Card declined',
  },
  insufficientFunds: {
    number: '4000000000009995',
    description: 'Insufficient funds',
  },
  expiredCard: {
    number: '4000000000000069',
    description: 'Expired card',
  },
  processingError: {
    number: '4000000000000119',
    description: 'Processing error',
  },
};

export default stripeConfig;