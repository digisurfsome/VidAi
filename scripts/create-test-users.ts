#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { faker } from '@faker-js/faker';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Initialize Supabase client with service role key
const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

interface TestUserOptions {
  count?: number;
  withSubscription?: boolean;
  withCredits?: boolean;
  role?: 'user' | 'admin' | 'moderator';
}

async function createTestUser(options: {
  email?: string;
  password?: string;
  role?: string;
  credits?: number;
  subscription?: string;
}) {
  const email = options.email || faker.internet.email();
  const password = options.password || 'TestPassword123!';
  
  try {
    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: faker.person.fullName(),
        is_test: true,
      },
    });

    if (authError) {
      console.error(`Failed to create auth user ${email}:`, authError);
      return null;
    }

    const userId = authData.user.id;

    // Create profile
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        email,
        full_name: authData.user.user_metadata.full_name,
        is_test: true,
      });

    if (profileError) {
      console.error(`Failed to create profile for ${email}:`, profileError);
    }

    // Create user role
    const { error: roleError } = await supabase
      .from('user_roles')
      .insert({
        user_id: userId,
        email,
        role: options.role || 'user',
        status: 'active',
      });

    if (roleError) {
      console.error(`Failed to create role for ${email}:`, roleError);
    }

    // Add credits if specified
    if (options.credits && options.credits > 0) {
      const { error: creditsError } = await supabase
        .from('user_credits')
        .insert({
          user_id: userId,
          balance: options.credits,
          lifetime_earned: options.credits,
          lifetime_spent: 0,
          is_test: true,
        });

      if (creditsError) {
        console.error(`Failed to add credits for ${email}:`, creditsError);
      }

      // Create credit transaction
      await supabase
        .from('credit_transactions')
        .insert({
          user_id: userId,
          type: 'bonus',
          amount: options.credits,
          balance_after: options.credits,
          description: 'Test user initial credits',
          is_test: true,
        });
    }

    // Mark all user data as test
    await supabase.rpc('mark_user_as_test', { p_user_id: userId });

    console.log(`✅ Created test user: ${email} (ID: ${userId})`);
    
    return {
      id: userId,
      email,
      password,
      role: options.role || 'user',
      credits: options.credits || 0,
    };
  } catch (error) {
    console.error(`Error creating test user ${email}:`, error);
    return null;
  }
}

async function createTestUsers(options: TestUserOptions = {}) {
  const {
    count = 5,
    withSubscription = false,
    withCredits = true,
    role = 'user',
  } = options;

  console.log(`\n🧪 Creating ${count} test users...\n`);

  const users = [];
  
  for (let i = 0; i < count; i++) {
    const credits = withCredits ? faker.number.int({ min: 100, max: 1000 }) : 0;
    
    const user = await createTestUser({
      role,
      credits,
    });
    
    if (user) {
      users.push(user);
    }
  }

  // Create one test admin
  const adminUser = await createTestUser({
    email: 'testadmin@test.com',
    password: 'TestAdmin123!',
    role: 'admin',
    credits: 10000,
  });

  if (adminUser) {
    users.push(adminUser);
    console.log(`\n✅ Test admin created: testadmin@test.com / TestAdmin123!`);
  }

  console.log(`\n📊 Summary:`);
  console.log(`- Total test users created: ${users.length}`);
  console.log(`- Test admin: testadmin@test.com`);
  console.log(`- Default password: TestPassword123!`);
  
  return users;
}

// Script execution
async function main() {
  console.log('🚀 Test User Generation Script');
  console.log('================================\n');

  // Check environment
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing required environment variables:');
    console.error('   - VITE_SUPABASE_URL');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  const count = parseInt(args.find(arg => arg.startsWith('--count='))?.split('=')[1] || '5');
  const withCredits = !args.includes('--no-credits');
  const withSubscription = args.includes('--with-subscription');

  const options: TestUserOptions = {
    count,
    withCredits,
    withSubscription,
  };

  await createTestUsers(options);
  
  console.log('\n✨ Test user generation complete!\n');
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { createTestUser, createTestUsers };