#!/usr/bin/env node

/**
 * Creates test users for development environment
 * This script uses the Supabase Admin API to create users
 * Required: SUPABASE_SERVICE_ROLE_KEY environment variable
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.local
dotenv.config({ path: resolve(__dirname, '..', '.env.local') });

// Validate required environment variables
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing required environment variables');
  console.error('Please ensure the following are set in .env.local:');
  console.error('  - VITE_SUPABASE_URL');
  console.error('  - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Create Supabase client with service role key
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Test users configuration
const TEST_USERS = [
  {
    email: 'admin@example.com',
    password: 'Password01',
    role: 'admin',
    fullName: 'Demo Admin',
    metadata: {
      full_name: 'Demo Admin'
    }
  },
  {
    email: 'user@example.com',
    password: 'Password01',
    role: 'user',
    fullName: 'Demo User',
    metadata: {
      full_name: 'Demo User'
    }
  }
];

async function createTestUsers() {
  console.log('🚀 Starting test user creation...\n');

  for (const testUser of TEST_USERS) {
    try {
      console.log(`Creating user: ${testUser.email}`);
      
      // Step 1: Create the user in auth.users
      const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
        email: testUser.email,
        password: testUser.password,
        email_confirm: true,
        user_metadata: testUser.metadata
      });

      if (createError) {
        // Check if user already exists
        if (createError.message?.includes('already been registered')) {
          console.log(`  ⚠️  User ${testUser.email} already exists, skipping...`);
          continue;
        }
        throw createError;
      }

      console.log(`  ✓ User created with ID: ${authUser.user.id}`);
      console.log(`  ✓ Profile and role created by database triggers`);

      // Step 2: For admin users, update their role using RPC function
      if (testUser.role === 'admin') {
        // Add a delay to ensure triggers have completed
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Use RPC function which bypasses RLS
        const { data, error: roleError } = await supabase.rpc('update_user_role', {
          target_user_id: authUser.user.id,
          new_role: 'admin'
        });

        if (roleError) {
          console.log(`  ⚠️  Could not update role to admin:`, roleError.message);
          console.log(`     Please manually update the role in Supabase dashboard`);
        } else {
          console.log(`  ✓ Role updated to: admin`);
        }
      }

      console.log(`  ✅ Successfully created ${testUser.email}\n`);

    } catch (error) {
      console.error(`  ❌ Error creating ${testUser.email}:`, error.message);
      console.error('     Please check your Supabase configuration and try again.\n');
    }
  }

  console.log('✨ Test user creation complete!');
  console.log('\n📝 Test User Credentials:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  TEST_USERS.forEach(user => {
    console.log(`${user.role.toUpperCase().padEnd(8)} | Email: ${user.email} | Password: ${user.password}`);
  });
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n🎉 You can now sign in with these credentials at http://localhost:8080/sign-in');
}

// Run the script
createTestUsers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });