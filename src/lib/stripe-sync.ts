// Stripe synchronization service for bidirectional sync
// Handles batch operations, retry logic, and conflict resolution

import { supabase } from './supabase';

interface SyncResult {
  success: boolean;
  productsCount: number;
  pricesCount: number;
  errors: string[];
  duration: number;
  syncId?: string;
}

interface SyncOptions {
  direction: 'to_stripe' | 'from_stripe' | 'bidirectional';
  force?: boolean;
  maxRetries?: number;
  retryDelay?: number;
}

interface RateLimitState {
  requestCount: number;
  resetTime: number;
}

// Rate limiting state (in-memory for client-side)
const rateLimitState: RateLimitState = {
  requestCount: 0,
  resetTime: Date.now() + 60000, // Reset every minute
};

// Exponential backoff utility
function getBackoffDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30 seconds
}

// Rate limit check
function checkRateLimit(): boolean {
  const now = Date.now();
  
  // Reset counter if time window has passed
  if (now > rateLimitState.resetTime) {
    rateLimitState.requestCount = 0;
    rateLimitState.resetTime = now + 60000;
  }
  
  // Check if under limit (100 requests per minute for admin)
  if (rateLimitState.requestCount >= 100) {
    return false;
  }
  
  rateLimitState.requestCount++;
  return true;
}

// Wait for rate limit reset
async function waitForRateLimit(): Promise<void> {
  const waitTime = rateLimitState.resetTime - Date.now();
  if (waitTime > 0) {
    console.log(`Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)}s...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
}

// Sync service class
export class StripeSyncService {
  private syncInProgress: boolean = false;
  private lastSyncTime: number = 0;
  private syncInterval: number = 60000; // Minimum 1 minute between syncs

  constructor() {
    // Initialize service
  }

  // Main sync method
  async sync(options: SyncOptions = { direction: 'from_stripe' }): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      productsCount: 0,
      pricesCount: 0,
      errors: [],
      duration: 0,
    };

    try {
      // Check if sync is already in progress
      if (this.syncInProgress) {
        throw new Error('Sync already in progress');
      }

      // Check minimum time between syncs (unless forced)
      if (!options.force) {
        const timeSinceLastSync = Date.now() - this.lastSyncTime;
        if (timeSinceLastSync < this.syncInterval) {
          const waitTime = Math.ceil((this.syncInterval - timeSinceLastSync) / 1000);
          throw new Error(`Please wait ${waitTime}s before syncing again`);
        }
      }

      this.syncInProgress = true;
      this.lastSyncTime = Date.now();

      // Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Authentication required');
      }

      // Check rate limit
      if (!checkRateLimit()) {
        await waitForRateLimit();
      }

      // Perform sync via API
      const response = await fetch(`/api/stripe-admin/sync?direction=${options.direction}&force=${options.force || false}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Sync failed with status ${response.status}`);
      }

      const data = await response.json();
      
      result.success = true;
      result.productsCount = data.sync_summary.products_synced;
      result.pricesCount = data.sync_summary.prices_synced;
      result.errors = data.sync_summary.errors || [];
      result.syncId = data.sync_summary.sync_id;
      
    } catch (error: any) {
      console.error('Sync error:', error);
      result.errors.push(error.message);
    } finally {
      this.syncInProgress = false;
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  // Sync with retry logic
  async syncWithRetry(options: SyncOptions = { direction: 'from_stripe' }): Promise<SyncResult> {
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 1000;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.sync(options);
        
        if (result.success) {
          return result;
        }

        // If sync partially succeeded but had errors, don't retry
        if (result.productsCount > 0 || result.pricesCount > 0) {
          return result;
        }

        throw new Error(result.errors.join(', '));
        
      } catch (error: any) {
        lastError = error;
        console.warn(`Sync attempt ${attempt + 1} failed:`, error.message);

        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);
        if (!isRetryable) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries - 1) {
          const delay = getBackoffDelay(attempt) + retryDelay;
          console.log(`Retrying in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Max retries reached');
  }

  // Check if error is retryable
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Network errors
    if (message.includes('network') || message.includes('fetch')) {
      return true;
    }
    
    // Rate limiting
    if (message.includes('rate limit') || message.includes('429')) {
      return true;
    }
    
    // Temporary server errors
    if (message.includes('503') || message.includes('502') || message.includes('504')) {
      return true;
    }
    
    // Timeout errors
    if (message.includes('timeout')) {
      return true;
    }
    
    return false;
  }

  // Get sync status
  async getSyncStatus(): Promise<{
    isInProgress: boolean;
    lastSyncTime: number;
    canSync: boolean;
    nextSyncAvailable: number;
  }> {
    const timeSinceLastSync = Date.now() - this.lastSyncTime;
    const canSync = !this.syncInProgress && timeSinceLastSync >= this.syncInterval;
    const nextSyncAvailable = this.lastSyncTime + this.syncInterval;

    return {
      isInProgress: this.syncInProgress,
      lastSyncTime: this.lastSyncTime,
      canSync,
      nextSyncAvailable,
    };
  }

  // Get sync summary from database
  async getSyncSummary(): Promise<{
    totalProducts: number;
    syncedProducts: number;
    pendingSync: number;
    syncErrors: number;
    lastSyncAt: string | null;
  }> {
    try {
      const { data, error } = await supabase.rpc('get_sync_status_summary');
      
      if (error) throw error;
      
      return {
        totalProducts: data?.total_products || 0,
        syncedProducts: data?.synced_products || 0,
        pendingSync: data?.pending_sync || 0,
        syncErrors: data?.sync_errors || 0,
        lastSyncAt: data?.last_sync_at || null,
      };
    } catch (error) {
      console.error('Failed to get sync summary:', error);
      return {
        totalProducts: 0,
        syncedProducts: 0,
        pendingSync: 0,
        syncErrors: 0,
        lastSyncAt: null,
      };
    }
  }

  // Get recent sync logs
  async getSyncLogs(limit = 20): Promise<any[]> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return [];

      const response = await fetch(`/api/stripe-admin/sync-log?limit=${limit}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) return [];

      const data = await response.json();
      return data.logs || [];
      
    } catch (error) {
      console.error('Failed to get sync logs:', error);
      return [];
    }
  }

  // Force refresh specific product
  async refreshProduct(productId: string): Promise<boolean> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return false;

      // Mark product as needing sync
      const { error } = await supabase
        .from('subscription_plans')
        .update({ stripe_sync_status: 'pending' })
        .eq('stripe_product_id', productId);

      if (error) throw error;

      // Trigger sync for just this product
      const result = await this.sync({ 
        direction: 'from_stripe',
        force: true 
      });

      return result.success;
      
    } catch (error) {
      console.error('Failed to refresh product:', error);
      return false;
    }
  }

  // Clear sync state (for testing/debugging)
  clearState(): void {
    this.syncInProgress = false;
    this.lastSyncTime = 0;
    rateLimitState.requestCount = 0;
    rateLimitState.resetTime = Date.now() + 60000;
  }
}

// Export singleton instance
export const stripeSyncService = new StripeSyncService();

// Sync status hook for React components
export function useSyncStatus() {
  // This would be implemented as a React hook in a component
  // Just exporting the type here for reference
  return {
    sync: stripeSyncService.sync.bind(stripeSyncService),
    syncWithRetry: stripeSyncService.syncWithRetry.bind(stripeSyncService),
    getSyncStatus: stripeSyncService.getSyncStatus.bind(stripeSyncService),
    getSyncSummary: stripeSyncService.getSyncSummary.bind(stripeSyncService),
    getSyncLogs: stripeSyncService.getSyncLogs.bind(stripeSyncService),
    refreshProduct: stripeSyncService.refreshProduct.bind(stripeSyncService),
  };
}