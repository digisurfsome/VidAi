/**
 * App Secrets — Per-app encrypted secret vault
 *
 * Securely stores API keys and credentials for each built app.
 * Keys are encrypted client-side before storage and injected
 * into .env.local at build time. Never hardcoded in source code.
 */

import { supabase } from './supabase';

// ==================
// Types
// ==================

export type SecretKeyType = 'env' | 'api_key' | 'oauth' | 'webhook' | 'custom';

export interface AppSecret {
  id: string;
  app_id: string;
  user_id: string;
  key_name: string;
  key_type: SecretKeyType;
  description: string | null;
  is_required: boolean;
  last_rotated_at: string | null;
  created_at: string;
  updated_at: string;
  // Note: encrypted_value, iv, tag are NOT returned to the client
}

export interface AppSecretWithValue extends AppSecret {
  decrypted_value: string;
}

export interface SetSecretParams {
  app_id: string;
  key_name: string;
  value: string;
  key_type?: SecretKeyType;
  description?: string;
  is_required?: boolean;
}

// ==================
// Common App Secret Templates
// ==================

export const SECRET_TEMPLATES: Record<string, { key_name: string; description: string; key_type: SecretKeyType; is_required: boolean }[]> = {
  supabase: [
    { key_name: 'VITE_SUPABASE_URL', description: 'Supabase project URL', key_type: 'env', is_required: true },
    { key_name: 'VITE_SUPABASE_ANON_KEY', description: 'Supabase anonymous key (public)', key_type: 'api_key', is_required: true },
    { key_name: 'SUPABASE_SERVICE_ROLE_KEY', description: 'Supabase service role key (server-side only)', key_type: 'api_key', is_required: false },
  ],
  stripe: [
    { key_name: 'VITE_STRIPE_PUBLISHABLE_KEY', description: 'Stripe publishable key', key_type: 'api_key', is_required: true },
    { key_name: 'STRIPE_SECRET_KEY', description: 'Stripe secret key (server-side only)', key_type: 'api_key', is_required: true },
    { key_name: 'STRIPE_WEBHOOK_SECRET', description: 'Stripe webhook signing secret', key_type: 'webhook', is_required: false },
  ],
  resend: [
    { key_name: 'RESEND_API_KEY', description: 'Resend email API key', key_type: 'api_key', is_required: true },
  ],
  openai: [
    { key_name: 'OPENAI_API_KEY', description: 'OpenAI API key', key_type: 'api_key', is_required: true },
  ],
  fal: [
    { key_name: 'FAL_KEY', description: 'fal.ai API key', key_type: 'api_key', is_required: true },
  ],
};

// ==================
// Encryption (Web Crypto API)
// ==================

/**
 * Derive an encryption key from the app_id + user's auth token.
 * This ensures secrets can only be decrypted by the owning user for the specific app.
 */
async function deriveKey(appId: string): Promise<CryptoKey> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required to manage secrets');

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${session.user.id}:${appId}`),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode('vidai-vault-v1'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptValue(value: string, appId: string): Promise<{ encrypted: string; iv: string; tag: string }> {
  const key = await deriveKey(appId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // AES-GCM appends the auth tag to the ciphertext
  const ctArray = new Uint8Array(ciphertext);
  const encryptedData = ctArray.slice(0, -16);
  const authTag = ctArray.slice(-16);

  return {
    encrypted: btoa(String.fromCharCode(...encryptedData)),
    iv: btoa(String.fromCharCode(...iv)),
    tag: btoa(String.fromCharCode(...authTag)),
  };
}

async function decryptValue(encrypted: string, iv: string, tag: string, appId: string): Promise<string> {
  const key = await deriveKey(appId);

  const encryptedBytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
  const tagBytes = Uint8Array.from(atob(tag), c => c.charCodeAt(0));

  // Reconstruct ciphertext + tag for AES-GCM
  const combined = new Uint8Array(encryptedBytes.length + tagBytes.length);
  combined.set(encryptedBytes);
  combined.set(tagBytes, encryptedBytes.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    combined
  );

  return new TextDecoder().decode(decrypted);
}

// ==================
// Secret CRUD Operations
// ==================

/**
 * Set (create or update) a secret for an app.
 * Value is encrypted client-side before being sent to the database.
 */
export async function setAppSecret(params: SetSecretParams): Promise<AppSecret> {
  const { encrypted, iv, tag } = await encryptValue(params.value, params.app_id);

  const { data, error } = await supabase
    .from('app_secrets')
    .upsert(
      {
        app_id: params.app_id,
        key_name: params.key_name,
        encrypted_value: encrypted,
        iv,
        tag,
        key_type: params.key_type || 'env',
        description: params.description || null,
        is_required: params.is_required ?? false,
        last_rotated_at: new Date().toISOString(),
      },
      { onConflict: 'app_id,key_name' }
    )
    .select('id, app_id, user_id, key_name, key_type, description, is_required, last_rotated_at, created_at, updated_at')
    .single();

  if (error) throw new Error(`Failed to set secret: ${error.message}`);
  return data as AppSecret;
}

/**
 * Get all secrets for an app (metadata only — no decrypted values).
 */
export async function getAppSecrets(appId: string): Promise<AppSecret[]> {
  const { data, error } = await supabase
    .from('app_secrets')
    .select('id, app_id, user_id, key_name, key_type, description, is_required, last_rotated_at, created_at, updated_at')
    .eq('app_id', appId)
    .order('key_name');

  if (error) throw new Error(`Failed to fetch secrets: ${error.message}`);
  return (data || []) as AppSecret[];
}

/**
 * Get a single secret's decrypted value. Use sparingly — only when injecting into builds.
 */
export async function getSecretValue(appId: string, keyName: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_secrets')
    .select('encrypted_value, iv, tag')
    .eq('app_id', appId)
    .eq('key_name', keyName)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch secret: ${error.message}`);
  if (!data) return null;

  return decryptValue(data.encrypted_value, data.iv, data.tag, appId);
}

/**
 * Get all secrets for an app with decrypted values.
 * Used at build time to generate .env.local
 */
export async function getAllSecretValues(appId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('app_secrets')
    .select('key_name, encrypted_value, iv, tag')
    .eq('app_id', appId);

  if (error) throw new Error(`Failed to fetch secrets: ${error.message}`);
  if (!data || data.length === 0) return {};

  const secrets: Record<string, string> = {};
  for (const row of data) {
    secrets[row.key_name] = await decryptValue(row.encrypted_value, row.iv, row.tag, appId);
  }
  return secrets;
}

/**
 * Delete a secret.
 */
export async function deleteAppSecret(appId: string, keyName: string): Promise<void> {
  const { error } = await supabase
    .from('app_secrets')
    .delete()
    .eq('app_id', appId)
    .eq('key_name', keyName);

  if (error) throw new Error(`Failed to delete secret: ${error.message}`);
}

/**
 * Generate .env.local content from all stored secrets.
 * Used during build Phase 1 to inject environment variables.
 */
export async function generateEnvFile(appId: string): Promise<string> {
  const secrets = await getAllSecretValues(appId);
  const lines = [
    '# Generated by VidAi Build System',
    `# App ID: ${appId}`,
    `# Generated: ${new Date().toISOString()}`,
    '# DO NOT COMMIT THIS FILE',
    '',
  ];

  for (const [key, value] of Object.entries(secrets)) {
    lines.push(`${key}=${value}`);
  }

  return lines.join('\n');
}

/**
 * Check which required secrets are missing for an app.
 * Returns template entries that don't have stored values.
 */
export async function getMissingSecrets(
  appId: string,
  requiredTemplates: string[]
): Promise<{ key_name: string; description: string }[]> {
  const stored = await getAppSecrets(appId);
  const storedNames = new Set(stored.map(s => s.key_name));

  const missing: { key_name: string; description: string }[] = [];
  for (const templateName of requiredTemplates) {
    const template = SECRET_TEMPLATES[templateName];
    if (!template) continue;

    for (const entry of template) {
      if (entry.is_required && !storedNames.has(entry.key_name)) {
        missing.push({ key_name: entry.key_name, description: entry.description });
      }
    }
  }

  return missing;
}
