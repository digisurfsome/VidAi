import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreditCard, Calendar, TrendingUp, Download, ExternalLink } from 'lucide-react';
import { formatPrice, formatCredits, createPortalSession, getSubscriptionStatus } from '@/lib/stripe';
import CreditBalance from '@/components/CreditBalance';
import { TransactionHistoryWithFilters } from '@/components/TransactionHistoryWithFilters';
import { UsageAnalyticsChart } from '@/components/UsageAnalyticsChart';
import { InvoiceDownload } from '@/components/InvoiceDownload';
import { useCredits } from '@/hooks/useCredits';
import { toast } from 'sonner';

interface SubscriptionDetails {
  status: string;
  plan_name: string;
  monthly_credits: number;
  price_cents: number;
  current_period_end: string;
  current_period_start: string;
  cancel_at_period_end: boolean;
}

interface UsageStats {
  totalCreditsUsed: number;
  totalCreditsAdded: number;
  averageDailyUsage: number;
  daysUntilRenewal: number;
}

export default function BillingDashboard() {
  const { user } = useAuth();
  const { balance, refreshBalance } = useCredits();
  const [subscription, setSubscription] = useState<SubscriptionDetails | null>(null);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [managingSubscription, setManagingSubscription] = useState(false);

  useEffect(() => {
    if (user?.id) {
      loadBillingData();
    }
  }, [user?.id]);

  const loadBillingData = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);

      // Load subscription details
      const subDetails = await getSubscriptionStatus(user.id);
      if (subDetails) {
        setSubscription(subDetails);
      }

      // Calculate usage statistics
      await calculateUsageStats();
      
      // Refresh credit balance
      await refreshBalance();
    } catch (error) {
      console.error('Error loading billing data:', error);
      toast.error('Failed to load billing information');
    } finally {
      setLoading(false);
    }
  };

  const calculateUsageStats = async () => {
    if (!user?.id) return;

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Get credit transactions for the last 30 days
      const { data: transactions } = await supabase
        .from('credit_transactions')
        .select('amount, type, created_at')
        .eq('user_id', user.id)
        .gte('created_at', thirtyDaysAgo.toISOString());

      if (!transactions) return;

      const creditsUsed = transactions
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + t.amount, 0);

      const creditsAdded = transactions
        .filter(t => t.type === 'credit')
        .reduce((sum, t) => sum + t.amount, 0);

      // Calculate average daily usage
      const daysWithUsage = new Set(
        transactions
          .filter(t => t.type === 'debit')
          .map(t => new Date(t.created_at).toDateString())
      ).size;

      const avgDaily = daysWithUsage > 0 ? Math.round(creditsUsed / daysWithUsage) : 0;

      // Calculate days until renewal
      let daysUntilRenewal = 0;
      if (subscription?.current_period_end) {
        const renewalDate = new Date(subscription.current_period_end);
        const today = new Date();
        daysUntilRenewal = Math.ceil((renewalDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      }

      setUsageStats({
        totalCreditsUsed: creditsUsed,
        totalCreditsAdded: creditsAdded,
        averageDailyUsage: avgDaily,
        daysUntilRenewal
      });
    } catch (error) {
      console.error('Error calculating usage stats:', error);
    }
  };

  const handleManageSubscription = async () => {
    if (!user?.id) return;

    try {
      setManagingSubscription(true);
      const portalUrl = await createPortalSession(user.id);
      if (portalUrl) {
        window.location.href = portalUrl;
      } else {
        toast.error('Unable to open billing portal');
      }
    } catch (error) {
      console.error('Error opening portal:', error);
      toast.error('Failed to open billing portal');
    } finally {
      setManagingSubscription(false);
    }
  };

  const getSubscriptionStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      active: 'default',
      trialing: 'secondary',
      canceled: 'destructive',
      past_due: 'destructive',
      unpaid: 'destructive',
      incomplete: 'outline'
    };

    return (
      <Badge variant={variants[status] || 'outline'}>
        {status.replace('_', ' ').toUpperCase()}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-32 bg-muted rounded"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Billing Dashboard</h1>
        <p className="text-muted-foreground">
          Manage your subscription, credits, and billing history
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Balance</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCredits(balance)}</div>
            <p className="text-xs text-muted-foreground">
              Available credits
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Subscription</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {subscription?.plan_name || 'No Plan'}
            </div>
            {subscription && (
              <p className="text-xs text-muted-foreground">
                {formatPrice(subscription.price_cents)}/month
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Usage</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCredits(usageStats?.totalCreditsUsed || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Last 30 days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Renewal</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {usageStats?.daysUntilRenewal || 0} days
            </div>
            <p className="text-xs text-muted-foreground">
              Until next billing
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Subscription Details */}
      {subscription && (
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Subscription Details</CardTitle>
                <CardDescription>
                  Your current subscription plan and billing information
                </CardDescription>
              </div>
              {getSubscriptionStatusBadge(subscription.status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Plan</p>
                <p className="text-lg font-semibold">{subscription.plan_name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Price</p>
                <p className="text-lg font-semibold">
                  {formatPrice(subscription.price_cents)}/month
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Monthly Credits</p>
                <p className="text-lg font-semibold">
                  {formatCredits(subscription.monthly_credits)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Billing Period</p>
                <p className="text-lg font-semibold">
                  {new Date(subscription.current_period_start).toLocaleDateString()} - {new Date(subscription.current_period_end).toLocaleDateString()}
                </p>
              </div>
            </div>

            {subscription.cancel_at_period_end && (
              <div className="rounded-lg bg-destructive/10 p-4">
                <p className="text-sm text-destructive">
                  Your subscription will be canceled at the end of the current billing period
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button 
                onClick={handleManageSubscription}
                disabled={managingSubscription}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Manage Subscription
              </Button>
              <CreditBalance showHistory={true} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Usage and History Tabs */}
      <Tabs defaultValue="transactions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="transactions">Transaction History</TabsTrigger>
          <TabsTrigger value="usage">Usage Analytics</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <CardTitle>Transaction History</CardTitle>
              <CardDescription>
                Your credit transactions and payment history
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TransactionHistoryWithFilters limit={50} showExport={true} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage">
          <UsageAnalyticsChart />
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardHeader>
              <CardTitle>Invoices & Receipts</CardTitle>
              <CardDescription>
                Download invoices for your payments and subscriptions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InvoiceDownload limit={20} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}