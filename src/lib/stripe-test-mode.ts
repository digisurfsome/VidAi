// Dynamic test mode management
// Stores preference in localStorage and optionally in database

const TEST_MODE_KEY = 'stripe_test_mode';

// Get test mode from localStorage
export const getTestMode = (): boolean => {
  if (typeof window === 'undefined') {
    // Server-side: check environment variable as fallback
    return process.env.VITE_STRIPE_TEST_MODE === 'true';
  }
  
  // Client-side: check localStorage first, then environment variable as fallback
  const stored = localStorage.getItem(TEST_MODE_KEY);
  if (stored !== null) {
    return stored === 'true';
  }
  
  // If nothing in localStorage, check env variable and store it
  const envValue = import.meta.env.VITE_STRIPE_TEST_MODE === 'true';
  localStorage.setItem(TEST_MODE_KEY, String(envValue));
  return envValue;
};

// Set test mode in localStorage
export const setTestMode = (isTestMode: boolean): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TEST_MODE_KEY, String(isTestMode));
    // Dispatch custom event to notify other components
    window.dispatchEvent(new CustomEvent('testModeChanged', { detail: isTestMode }));
  }
};

// Subscribe to test mode changes
export const subscribeToTestModeChanges = (callback: (isTestMode: boolean) => void) => {
  if (typeof window === 'undefined') return () => {};
  
  const handler = (event: CustomEvent) => {
    callback(event.detail);
  };
  
  window.addEventListener('testModeChanged' as any, handler);
  
  return () => {
    window.removeEventListener('testModeChanged' as any, handler);
  };
};

// Get the appropriate Stripe keys based on current mode
export const getStripeKeys = () => {
  const isTestMode = getTestMode();
  
  return {
    publishableKey: isTestMode 
      ? import.meta.env.VITE_STRIPE_TEST_PUBLISHABLE_KEY 
      : import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY,
    isTestMode,
  };
};

// Server-side function to get the appropriate keys
export const getServerStripeKeys = (forceTestMode?: boolean) => {
  const isTestMode = forceTestMode ?? (process.env.VITE_STRIPE_TEST_MODE === 'true');
  
  return {
    publishableKey: isTestMode 
      ? process.env.VITE_STRIPE_TEST_PUBLISHABLE_KEY
      : process.env.VITE_STRIPE_PUBLISHABLE_KEY,
    secretKey: isTestMode
      ? process.env.STRIPE_TEST_SECRET_KEY
      : process.env.STRIPE_SECRET_KEY,
    webhookSecret: isTestMode
      ? process.env.STRIPE_TEST_WEBHOOK_SECRET
      : process.env.STRIPE_WEBHOOK_SECRET,
    isTestMode,
  };
};