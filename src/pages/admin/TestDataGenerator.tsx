import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { stripeConfig } from '@/lib/stripe-config';
import {
  UserPlus,
  CreditCard,
  ShoppingCart,
  Package,
  Zap,
  Loader2,
  Database,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';

interface TestDataConfig {
  userCount: number;
  subscriptionType: 'none' | 'random' | 'specific';
  creditBalance: number;
  transactionCount: number;
}

const TestDataGenerator: React.FC = () => {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [config, setConfig] = useState<TestDataConfig>({
    userCount: 5,
    subscriptionType: 'none',
    creditBalance: 500,
    transactionCount: 10,
  });
  const [generationResults, setGenerationResults] = useState<any>(null);

  const generateTestUsers = async () => {
    const users = [];
    for (let i = 0; i < config.userCount; i++) {
      const email = `test.user.${Date.now()}.${i}@example.com`;
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password: 'TestPassword123!',
        email_confirm: true,
        user_metadata: {
          full_name: `Test User ${i + 1}`,
          is_test: true,
        },
      });

      if (authError) {
        console.error('Failed to create test user:', authError);
        continue;
      }

      // Create profile
      await supabase.from('profiles').insert({
        id: authData.user.id,
        email,
        full_name: `Test User ${i + 1}`,
        is_test: true,
      });

      // Create user role
      await supabase.from('user_roles').insert({
        user_id: authData.user.id,
        email,
        role: 'user',
        status: 'active',
      });

      // Add credits if specified
      if (config.creditBalance > 0) {
        await supabase.from('user_credits').insert({
          user_id: authData.user.id,
          balance: config.creditBalance,
          lifetime_earned: config.creditBalance,
          lifetime_spent: 0,
          is_test: true,
        });

        // Create initial credit transaction
        await supabase.from('credit_transactions').insert({
          user_id: authData.user.id,
          type: 'bonus',
          amount: config.creditBalance,
          balance_after: config.creditBalance,
          description: 'Test user initial credits',
          is_test: true,
        });
      }

      // Mark user as test
      await supabase.rpc('mark_user_as_test', { p_user_id: authData.user.id });

      users.push({
        id: authData.user.id,
        email,
        credits: config.creditBalance,
      });
    }
    return users;
  };

  const generateTestTransactions = async (userId: string) => {
    const transactions = [];
    let currentBalance = config.creditBalance;

    for (let i = 0; i < config.transactionCount; i++) {
      const type = Math.random() > 0.7 ? 'purchase' : 'deduction';
      const amount = type === 'purchase' 
        ? Math.floor(Math.random() * 1000) + 100
        : Math.floor(Math.random() * 50) + 1;

      if (type === 'deduction' && currentBalance < amount) {
        continue; // Skip if not enough balance
      }

      const newBalance = type === 'purchase' 
        ? currentBalance + amount 
        : currentBalance - amount;

      const { data, error } = await supabase
        .from('credit_transactions')
        .insert({
          user_id: userId,
          type,
          amount,
          balance_after: newBalance,
          description: `Test ${type} #${i + 1}`,
          stripe_payment_intent_id: type === 'purchase' ? `pi_test_${Date.now()}_${i}` : null,
          is_test: true,
        })
        .select()
        .single();

      if (!error) {
        transactions.push(data);
        currentBalance = newBalance;

        // Update user credits balance
        await supabase
          .from('user_credits')
          .update({ 
            balance: newBalance,
            lifetime_earned: type === 'purchase' ? currentBalance + amount : currentBalance,
            lifetime_spent: type === 'deduction' ? amount : 0,
          })
          .eq('user_id', userId);
      }
    }

    return transactions;
  };

  const generateTestSubscriptions = async (userId: string) => {
    // Get available subscription plans
    const { data: plans } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .limit(1);

    if (!plans || plans.length === 0) {
      return null;
    }

    const plan = plans[0];
    const { data: subscription, error } = await supabase
      .from('user_subscriptions')
      .insert({
        user_id: userId,
        stripe_subscription_id: `sub_test_${Date.now()}`,
        plan_id: plan.id,
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        is_test: true,
      })
      .select()
      .single();

    return subscription;
  };

  const handleGenerateTestData = async () => {
    if (!stripeConfig.isTestMode) {
      toast({
        variant: 'destructive',
        title: 'Test Mode Required',
        description: 'Please enable test mode to generate test data.',
      });
      return;
    }

    setIsGenerating(true);
    setGenerationResults(null);

    try {
      // Generate test users
      const users = await generateTestUsers();
      
      // Generate transactions and subscriptions for each user
      const results = {
        users: users.length,
        transactions: 0,
        subscriptions: 0,
        errors: [],
      };

      for (const user of users) {
        // Generate transactions
        if (config.transactionCount > 0) {
          const transactions = await generateTestTransactions(user.id);
          results.transactions += transactions.length;
        }

        // Generate subscriptions
        if (config.subscriptionType !== 'none') {
          const subscription = await generateTestSubscriptions(user.id);
          if (subscription) {
            results.subscriptions++;
          }
        }
      }

      setGenerationResults(results);
      
      toast({
        title: 'Test Data Generated',
        description: `Created ${results.users} users, ${results.transactions} transactions, and ${results.subscriptions} subscriptions.`,
      });
    } catch (error: any) {
      console.error('Test data generation error:', error);
      toast({
        variant: 'destructive',
        title: 'Generation Failed',
        description: error.message || 'Failed to generate test data',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClearTestData = async () => {
    if (!stripeConfig.isTestMode) {
      toast({
        variant: 'destructive',
        title: 'Test Mode Required',
        description: 'Please enable test mode to clear test data.',
      });
      return;
    }

    setIsGenerating(true);

    try {
      // Delete test transactions
      await supabase
        .from('credit_transactions')
        .delete()
        .eq('is_test', true);

      // Delete test subscriptions
      await supabase
        .from('user_subscriptions')
        .delete()
        .eq('is_test', true);

      // Delete test user credits
      await supabase
        .from('user_credits')
        .delete()
        .eq('is_test', true);

      // Delete test profiles
      await supabase
        .from('profiles')
        .delete()
        .eq('is_test', true);

      // Delete test auth users
      const { data: testUsers } = await supabase
        .from('profiles')
        .select('id')
        .eq('is_test', true);

      if (testUsers) {
        for (const user of testUsers) {
          await supabase.auth.admin.deleteUser(user.id);
        }
      }

      setGenerationResults(null);
      
      toast({
        title: 'Test Data Cleared',
        description: 'All test data has been removed from the database.',
      });
    } catch (error: any) {
      console.error('Test data cleanup error:', error);
      toast({
        variant: 'destructive',
        title: 'Cleanup Failed',
        description: error.message || 'Failed to clear test data',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (!stripeConfig.isTestMode) {
    return (
      <Card>
        <CardContent className="py-12">
          <Alert className="border-amber-200 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              Test data generation is only available in test mode. Please enable test mode in your environment configuration.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Generator Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Test Data Generator
          </CardTitle>
          <CardDescription>
            Generate test users, subscriptions, and transactions for testing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* User Configuration */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="user-count">Number of Test Users</Label>
              <div className="flex items-center gap-4 mt-2">
                <Slider
                  id="user-count"
                  min={1}
                  max={20}
                  step={1}
                  value={[config.userCount]}
                  onValueChange={(value) => setConfig({ ...config, userCount: value[0] })}
                  className="flex-1"
                />
                <span className="w-12 text-right font-mono">{config.userCount}</span>
              </div>
            </div>

            <div>
              <Label htmlFor="credit-balance">Initial Credit Balance</Label>
              <div className="flex items-center gap-4 mt-2">
                <Slider
                  id="credit-balance"
                  min={0}
                  max={5000}
                  step={100}
                  value={[config.creditBalance]}
                  onValueChange={(value) => setConfig({ ...config, creditBalance: value[0] })}
                  className="flex-1"
                />
                <span className="w-16 text-right font-mono">{config.creditBalance}</span>
              </div>
            </div>

            <div>
              <Label htmlFor="transaction-count">Transactions per User</Label>
              <div className="flex items-center gap-4 mt-2">
                <Slider
                  id="transaction-count"
                  min={0}
                  max={50}
                  step={5}
                  value={[config.transactionCount]}
                  onValueChange={(value) => setConfig({ ...config, transactionCount: value[0] })}
                  className="flex-1"
                />
                <span className="w-12 text-right font-mono">{config.transactionCount}</span>
              </div>
            </div>

            <div>
              <Label htmlFor="subscription-type">Subscription Type</Label>
              <Select
                value={config.subscriptionType}
                onValueChange={(value: any) => setConfig({ ...config, subscriptionType: value })}
              >
                <SelectTrigger id="subscription-type" className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Subscription</SelectItem>
                  <SelectItem value="random">Random Plan</SelectItem>
                  <SelectItem value="specific">Specific Plan</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={handleGenerateTestData}
              disabled={isGenerating}
              className="flex-1"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Generate Test Data
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleClearTestData}
              disabled={isGenerating}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Clear All Test Data
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Generation Results */}
      {generationResults && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Generation Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <UserPlus className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                <p className="text-2xl font-bold">{generationResults.users}</p>
                <p className="text-sm text-muted-foreground">Test Users</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <ShoppingCart className="h-8 w-8 mx-auto mb-2 text-green-600" />
                <p className="text-2xl font-bold">{generationResults.transactions}</p>
                <p className="text-sm text-muted-foreground">Transactions</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <Package className="h-8 w-8 mx-auto mb-2 text-purple-600" />
                <p className="text-2xl font-bold">{generationResults.subscriptions}</p>
                <p className="text-sm text-muted-foreground">Subscriptions</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test Mode Notice */}
      <Alert className="border-blue-200 bg-blue-50">
        <AlertTriangle className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800">
          All generated data is marked with <code className="px-1 py-0.5 bg-blue-100 rounded">is_test = true</code> and will be excluded from production reports and analytics.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default TestDataGenerator;