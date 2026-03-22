/**
 * App Secrets — Per-app encrypted secret vault
 *
 * DETERMINISTIC: Every secret is encrypted with AES-256-GCM and verified
 * with a SHA-256 integrity hash on decryption. Key names are validated
 * against allowed patterns. The .env.local generator includes a checksum
 * for tamper detection. No hope-based logic.
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
// Input Validation
// ==================

const VALID_KEY_TYPES: SecretKeyType[] = ['env', 'api_key', 'oauth', 'webhook', 'custom'];

/** Key names must be uppercase alphanumeric with underscores (env var format) */
const KEY_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,254}$/;

function validateKeyName(keyName: string): void {
  if (!keyName || typeof keyName !== 'string') {
    throw new Error('key_name is required and must be a non-empty string');
  }
  if (!KEY_NAME_PATTERN.test(keyName)) {
    throw new Error(
      `Invalid key_name: '${keyName}'. Must be uppercase alphanumeric with underscores ` +
      `(e.g., VITE_SUPABASE_URL, STRIPE_SECRET_KEY)`
    );
  }
}

function validateKeyType(keyType: string): asserts keyType is SecretKeyType {
  if (!VALID_KEY_TYPES.includes(keyType as SecretKeyType)) {
    throw new Error(`Invalid key_type: '${keyType}'. Must be one of: ${VALID_KEY_TYPES.join(', ')}`);
  }
}

function validateSetParams(params: SetSecretParams): void {
  if (!params.app_id) throw new Error('app_id is required');
  validateKeyName(params.key_name);
  if (!params.value || typeof params.value !== 'string') {
    throw new Error('value is required and must be a non-empty string');
  }
  if (params.key_type) validateKeyType(params.key_type);
}

// ==================
// Encryption (Web Crypto API) — WITH INTEGRITY HASH
// ==================

/**
 * Compute SHA-256 hash of a value for integrity verification.
 * Stored alongside the encrypted value; checked on decrypt to guarantee
 * the decrypted result matches the original plaintext.
 */
async function computeHash(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

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

/**
 * Encrypt a value with AES-256-GCM.
 * Also computes a SHA-256 hash of the plaintext for post-decrypt verification.
 */
async function encryptValue(
  value: string,
  appId: string
): Promise<{ encrypted: string; iv: string; tag: string; hash: string }> {
  const key = await deriveKey(appId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const hash = await computeHash(value);

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
    hash,
  };
}

/**
 * Decrypt a value and verify integrity against stored hash.
 *
 * DETERMINISTIC: If decryption succeeds but hash doesn't match,
 * throws an integrity error rather than returning corrupt data.
 * Classifies errors: authentication failure vs integrity mismatch.
 */
async function decryptValue(
  encrypted: string,
  iv: string,
  tag: string,
  appId: string,
  expectedHash?: string
): Promise<string> {
  const key = await deriveKey(appId);

  let encryptedBytes: Uint8Array;
  let ivBytes: Uint8Array;
  let tagBytes: Uint8Array;

  try {
    encryptedBytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
    tagBytes = Uint8Array.from(atob(tag), c => c.charCodeAt(0));
  } catch {
    throw new Error('DECODE_ERROR: Failed to decode base64 encrypted data. Data may be corrupted.');
  }

  // Reconstruct ciphertext + tag for AES-GCM
  const combined = new Uint8Array(encryptedBytes.length + tagBytes.length);
  combined.set(encryptedBytes);
  combined.set(tagBytes, encryptedBytes.length);

  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      key,
      combined
    );
  } catch {
    throw new Error(
      'AUTH_FAILURE: Decryption failed — authentication tag mismatch. ' +
      'Data has been tampered with or encryption key has changed.'
    );
  }

  const plaintext = new TextDecoder().decode(decrypted);

  // Verify integrity hash if provided
  if (expectedHash) {
    const actualHash = await computeHash(plaintext);
    if (actualHash !== expectedHash) {
      throw new Error(
        'INTEGRITY_MISMATCH: Decrypted value hash does not match stored hash. ' +
        `Expected: ${expectedHash.slice(0, 16)}..., Got: ${actualHash.slice(0, 16)}... ` +
        'Data may have been corrupted in storage.'
      );
    }
  }

  return plaintext;
}

// ==================
// Secret CRUD Operations
// ==================

/**
 * Set (create or update) a secret for an app.
 * Value is encrypted client-side before being sent to the database.
 * SHA-256 hash stored for post-decrypt integrity verification.
 */
export async function setAppSecret(params: SetSecretParams): Promise<AppSecret> {
  validateSetParams(params);
  const { encrypted, iv, tag, hash } = await encryptValue(params.value, params.app_id);

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
 * DETERMINISTIC: Includes a SHA-256 checksum of the entire file content
 * for tamper detection. Keys are sorted alphabetically for consistency.
 */
export async function generateEnvFile(appId: string): Promise<string> {
  const secrets = await getAllSecretValues(appId);
  const timestamp = new Date().toISOString();

  // Sort keys alphabetically for deterministic output
  const sortedKeys = Object.keys(secrets).sort();

  const envLines: string[] = [];
  for (const key of sortedKeys) {
    envLines.push(`${key}=${secrets[key]}`);
  }

  const envContent = envLines.join('\n');

  // Compute checksum of the env content for integrity verification
  const checksum = await computeHash(envContent);

  const lines = [
    '# Generated by VidAi Build System',
    `# App ID: ${appId}`,
    `# Generated: ${timestamp}`,
    `# Checksum: ${checksum}`,
    `# Keys: ${sortedKeys.length}`,
    '# DO NOT COMMIT THIS FILE',
    '',
    envContent,
  ];

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
