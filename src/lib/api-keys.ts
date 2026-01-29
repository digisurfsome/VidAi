import { createClient } from '@supabase/supabase-js';

// TypeScript interfaces for API key objects
export interface ApiKey {
  key: string;
  source: 'user' | 'admin';
}

export interface ApiKeys {
  openai: ApiKey | null;
  fal: ApiKey | null;
}

interface UserApiKeyRow {
  key_name: string;
  key_value: string;
}

interface AppSettingRow {
  setting_key: string;
  setting_value: string | null;
}

/**
 * Get API keys for a user with admin fallback logic
 * Priority: User keys > Admin keys > null
 * 
 * @param userId - The user ID to get keys for
 * @param supabaseUrl - Supabase project URL
 * @param supabaseServiceKey - Service role key for accessing admin settings
 * @returns Object with OpenAI and fal.ai keys, including their source
 */
export async function getApiKeys(
  userId: string | undefined,
  supabaseUrl: string,
  supabaseServiceKey: string
): Promise<ApiKeys> {
  console.log('getApiKeys called with:', { userId, hasUrl: !!supabaseUrl, hasServiceKey: !!supabaseServiceKey });
  
  if (!userId || !supabaseUrl || !supabaseServiceKey) {
    console.warn('Missing required parameters for getApiKeys');
    return { openai: null, fal: null };
  }

  // Create Supabase client with service role key to bypass RLS
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Fetch user's API keys
    const { data: userKeys, error: userError } = await supabase
      .from('user_api_keys')
      .select('key_name, key_value')
      .eq('user_id', userId)
      .in('key_name', ['openai_api_key', 'fal_ai']);

    console.log('User keys query result:', { data: userKeys, error: userError });

    if (userError && userError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
      console.error('Error fetching user API keys:', userError);
    }

    // Parse user keys
    const userApiKeys: { openai?: string; fal?: string } = {};
    if (userKeys && userKeys.length > 0) {
      userKeys.forEach((row: UserApiKeyRow) => {
        if (row.key_name === 'openai_api_key' && row.key_value) {
          userApiKeys.openai = row.key_value;
        } else if (row.key_name === 'fal_ai' && row.key_value) {
          userApiKeys.fal = row.key_value;
        }
      });
    }

    // If user has both keys, return them immediately
    if (userApiKeys.openai && userApiKeys.fal) {
      return {
        openai: { key: userApiKeys.openai, source: 'user' },
        fal: { key: userApiKeys.fal, source: 'user' }
      };
    }

    // Fetch admin keys for fallback
    const { data: adminKeys, error: adminError } = await supabase
      .from('app_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['admin_openai_api_key', 'admin_fal_api_key']);

    console.log('Admin keys query result:', { data: adminKeys, error: adminError });

    if (adminError && adminError.code !== 'PGRST116') {
      console.error('Error fetching admin API keys:', adminError);
    }

    // Parse admin keys
    const adminApiKeys: { openai?: string; fal?: string } = {};
    if (adminKeys && adminKeys.length > 0) {
      adminKeys.forEach((row: AppSettingRow) => {
        if (row.setting_key === 'admin_openai_api_key' && row.setting_value) {
          adminApiKeys.openai = row.setting_value;
        } else if (row.setting_key === 'admin_fal_api_key' && row.setting_value) {
          adminApiKeys.fal = row.setting_value;
        }
      });
    }

    // Build response with fallback logic
    const result: ApiKeys = {
      openai: userApiKeys.openai
        ? { key: userApiKeys.openai, source: 'user' }
        : adminApiKeys.openai
          ? { key: adminApiKeys.openai, source: 'admin' }
          : null,
      fal: userApiKeys.fal
        ? { key: userApiKeys.fal, source: 'user' }
        : adminApiKeys.fal
          ? { key: adminApiKeys.fal, source: 'admin' }
          : null
    };

    // Log key sources for debugging (without exposing actual keys)
    if (result.openai || result.fal) {
      console.log('API keys resolved:', {
        openai: result.openai ? `${result.openai.source} key` : 'not available',
        fal: result.fal ? `${result.fal.source} key` : 'not available'
      });
    }

    return result;
  } catch (error) {
    console.error('Error in getApiKeys:', error);
    return { openai: null, fal: null };
  }
}

/**
 * Get API keys for the current user from client-side
 * This function is for client-side use and only returns user keys and masked admin keys
 * 
 * @param userId - The user ID to get keys for
 * @param supabaseClient - Authenticated Supabase client
 * @returns Object with information about available keys
 */
export async function getApiKeysInfo(
  userId: string | undefined,
  supabaseClient: any
): Promise<{
  openai: { hasUserKey: boolean; hasAdminKey: boolean; maskedAdminKey?: string } | null;
  fal: { hasUserKey: boolean; hasAdminKey: boolean; maskedAdminKey?: string } | null;
}> {
  if (!userId) {
    return { openai: null, fal: null };
  }

  try {
    // Fetch user's API keys
    const { data: userKeys, error: userError } = await supabaseClient
      .from('user_api_keys')
      .select('key_name, key_value')
      .eq('user_id', userId)
      .in('key_name', ['openai_api_key', 'fal_ai']);

    if (userError && userError.code !== 'PGRST116') {
      console.error('Error fetching user API keys:', userError);
    }

    // Parse user keys
    const userApiKeys: { openai?: string; fal?: string } = {};
    if (userKeys && userKeys.length > 0) {
      userKeys.forEach((row: UserApiKeyRow) => {
        if (row.key_name === 'openai_api_key' && row.key_value) {
          userApiKeys.openai = row.key_value;
        } else if (row.key_name === 'fal_ai' && row.key_value) {
          userApiKeys.fal = row.key_value;
        }
      });
    }

    // Fetch admin keys info (public settings only)
    const { data: adminKeys, error: adminError } = await supabaseClient
      .from('app_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['admin_openai_api_key', 'admin_fal_api_key']);

    // Parse admin keys (will be masked)
    const adminApiKeys: { openai?: string; fal?: string } = {};
    if (adminKeys && adminKeys.length > 0) {
      adminKeys.forEach((row: AppSettingRow) => {
        if (row.setting_key === 'admin_openai_api_key' && row.setting_value) {
          // Mask the admin key for display
          adminApiKeys.openai = maskApiKey(row.setting_value);
        } else if (row.setting_key === 'admin_fal_api_key' && row.setting_value) {
          adminApiKeys.fal = maskApiKey(row.setting_value);
        }
      });
    }

    return {
      openai: {
        hasUserKey: !!userApiKeys.openai,
        hasAdminKey: !!adminApiKeys.openai,
        maskedAdminKey: adminApiKeys.openai
      },
      fal: {
        hasUserKey: !!userApiKeys.fal,
        hasAdminKey: !!adminApiKeys.fal,
        maskedAdminKey: adminApiKeys.fal
      }
    };
  } catch (error) {
    console.error('Error in getApiKeysInfo:', error);
    return { openai: null, fal: null };
  }
}

/**
 * Mask an API key for display purposes
 * Shows only the last 6 characters
 * 
 * @param key - The API key to mask
 * @returns Masked key string
 */
function maskApiKey(key: string): string {
  if (!key || key.length < 10) {
    return '••••••••';
  }
  const lastChars = key.slice(-6);
  return `••••••••••••${lastChars}`;
}

/**
 * Log API key usage for audit purposes
 * 
 * @param userId - The user making the request
 * @param keyType - Type of API key (openai or fal)
 * @param source - Source of the key (user or admin)
 * @param supabaseClient - Supabase client for logging
 */
export async function logApiKeyUsage(
  userId: string,
  keyType: 'openai' | 'fal',
  source: 'user' | 'admin',
  supabaseClient: any
): Promise<void> {
  try {
    // Only log admin key usage for audit purposes
    if (source === 'admin') {
      await supabaseClient
        .from('admin_audit_log')
        .insert({
          admin_user_id: userId,
          action: 'use',
          entity_type: 'admin_api_key',
          entity_id: `admin_${keyType}_api_key`,
          details: {
            key_type: keyType === 'openai' ? 'OpenAI' : 'fal.ai',
            user_id: userId,
            timestamp: new Date().toISOString()
          }
        });
    }
  } catch (error) {
    // Don't fail the request if logging fails
    console.error('Failed to log API key usage:', error);
  }
}