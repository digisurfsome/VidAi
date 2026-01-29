import { supabase } from './supabase';

/**
 * Validates a fal.ai API key format and optionally tests the connection
 */
export async function validateFalApiKey(apiKey: string, testConnection: boolean = false) {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    throw new Error('User not authenticated');
  }

  const response = await fetch('/api/validate-fal-key', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      api_key: apiKey,
      test_connection: testConnection,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || 'Failed to validate API key');
  }

  return data;
}

/**
 * Retrieves the user's fal.ai API key from the database
 */
export async function getFalApiKey(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('key_value')
    .eq('user_id', userId)
    .eq('key_name', 'fal_ai')
    .single();

  if (error || !data) {
    return null;
  }

  return data.key_value;
}

/**
 * Saves or updates the user's fal.ai API key
 */
export async function saveFalApiKey(userId: string, apiKey: string) {
  const { error } = await supabase
    .from('user_api_keys')
    .upsert(
      {
        user_id: userId,
        key_name: 'fal_ai',
        key_value: apiKey,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id,key_name',
        ignoreDuplicates: false,
      }
    );

  if (error) {
    throw error;
  }

  return true;
}