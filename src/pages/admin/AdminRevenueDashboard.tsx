import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  BarChart, 
  Bar,
  LineChart,
  Line,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { format, subDays, startOfMonth, endOfMonth, eachMonthOfInterval, subMonths } from 'date-fns';
import { formatPrice, formatCredits } from '@/lib/stripe';
import { 
  DollarSign, 
  Users, 
  TrendingUp, 
  CreditCard, 
  Activity,
  Download,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';

interface RevenueData {
  date: string;
  revenue: number;
  transactions: number;
  newSubscriptions: number;
  creditPurchases: number;
}

interface CustomerMetrics {
  totalUsers: number;
  activeSubscriptions: number;
  churnRate: number;
  averageRevenuePerUser: number;
}

interface RevenueByPlan {
  name: string;
  value: number;
  count: number;
  color: string;
}

export default function AdminRevenueDashboard() {
  const { isAdmin } = useAdminPermissions();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7d' | '30d' | '3m' | '1y'>('30d');
  const [revenueData, setRevenueData] = useState<RevenueData[]>([]);
  const [customerMetrics, setCustomerMetrics] = useState<CustomerMetrics | null>(null);
  const [revenueByPlan, setRevenueByPlan] = useState<RevenueByPlan[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [revenueGrowth, setRevenueGrowth] = useState(0);

  useEffect(() => {
    if (isAdmin) {
      loadRevenueData();
    }
  }, [period, isAdmin]);

  const loadRevenueData = async () => {
    try {
      setLoading(true);

      // Get service role client for admin operations
      const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || '';
      if (!serviceRoleKey) {
        toast.error('Service role key not configured');
        return;
      }

      const serviceClient = createClient(
        import.meta.env.VITE_SUPABASE_URL || '',
        serviceRoleKey
      );

      // Calculate date range
      const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '3m' ? 90 : 365;
      const startDate = subDays(new Date(), days);

      // Load payment transactions
      const { data: payments, error: paymentsError } = await serviceClient
        .from('payment_transactions')
        .select('*')
        .eq('status', 'succeeded')
        .gte('created_at', startDate.toISOString())
        .order('created_at');

      if (paymentsError) throw paymentsError;

      // Load subscriptions
      const { data: subscriptions, error: subsError } = await serviceClient
        .from('user_subscriptions')
        .select('*, subscription_plans(*)')
        .gte('created_at', startDate.toISOString());

      if (subsError) throw subsError;

      // Load user metrics
      const { data: allUsers } = await serviceClient
        .from('user_roles')
        .select('user_id')
        .eq('status', 'active');

      const { data: activeSubscriptions } = await serviceClient
        .from('user_subscriptions')
        .select('user_id')
        .eq('status', 'active');

      // Process revenue data
      processRevenueData(payments || [], subscriptions || [], days);
      
      // Calculate customer metrics
      calculateCustomerMetrics(
        allUsers?.length || 0,
        activeSubscriptions?.length || 0,
        payments || [],
        subscriptions || []
      );

      // Process revenue by plan
      processRevenueByPlan(subscriptions || []);

    } catch (error) {
      console.error('Error loading revenue data:', error);
      toast.error('Failed to load revenue data');
    } finally {
      setLoading(false);
    }
  };

  const processRevenueData = (
    payments: any[], 
    subscriptions: any[], 
    days: number
  ) => {
    const dailyRevenue: Record<string, RevenueData> = {};
    
    // Initialize days/months based on period
    if (days <= 30) {
      // Daily view for short periods
      for (let i = 0; i < days; i++) {
        const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
        dailyRevenue[date] = {
          date: format(subDays(new Date(), i), 'MMM dd'),
          revenue: 0,
          transactions: 0,
          newSubscriptions: 0,
          creditPurchases: 0
        };
      }
    } else {
      // Monthly view for longer periods
      const months = Math.ceil(days / 30);
      const monthInterval = eachMonthOfInterval({
        start: subMonths(new Date(), months - 1),
        end: new Date()
      });

      monthInterval.forEach(month => {
        const key = format(month, 'yyyy-MM');
        dailyRevenue[key] = {
          date: format(month, 'MMM yyyy'),
          revenue: 0,
          transactions: 0,
          newSubscriptions: 0,
          creditPurchases: 0
        };
      });
    }

    // Aggregate payment data
    payments.forEach(payment => {
      const key = days <= 30 
        ? format(new Date(payment.created_at), 'yyyy-MM-dd')
        : format(new Date(payment.created_at), 'yyyy-MM');
      
      if (dailyRevenue[key]) {
        dailyRevenue[key].revenue += payment.amount_cents / 100;
        dailyRevenue[key].transactions += 1;
        
        if (payment.type === 'credit_purchase') {
          dailyRevenue[key].creditPurchases += payment.amount_cents / 100;
        }
      }
    });

    // Count new subscriptions
    subscriptions.forEach(sub => {
      const key = days <= 30
        ? format(new Date(sub.created_at), 'yyyy-MM-dd')
        : format(new Date(sub.created_at), 'yyyy-MM');
      
      if (dailyRevenue[key]) {
        dailyRevenue[key].newSubscriptions += 1;
      }
    });

    const revenueArray = Object.values(dailyRevenue).reverse();
    setRevenueData(revenueArray);

    // Calculate totals
    const total = revenueArray.reduce((sum, d) => sum + d.revenue, 0);
    setTotalRevenue(total);

    // Calculate growth
    const midPoint = Math.floor(revenueArray.length / 2);
    const firstHalf = revenueArray.slice(0, midPoint).reduce((sum, d) => sum + d.revenue, 0);
    const secondHalf = revenueArray.slice(midPoint).reduce((sum, d) => sum + d.revenue, 0);
    const growth = firstHalf > 0 
      ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100)
      : 0;
    setRevenueGrowth(growth);
  };

  const calculateCustomerMetrics = (
    totalUsers: number,
    activeSubscriptions: number,
    payments: any[],
    subscriptions: any[]
  ) => {
    // Calculate churn rate (simplified)
    const canceledSubs = subscriptions.filter(s => s.status === 'canceled').length;
    const churnRate = activeSubscriptions > 0
      ? Math.round((canceledSubs / (activeSubscriptions + canceledSubs)) * 100)
      : 0;

    // Calculate ARPU
    const totalRevenue = payments.reduce((sum, p) => sum + p.amount_cents, 0) / 100;
    const arpu = activeSubscriptions > 0
      ? Math.round(totalRevenue / activeSubscriptions)
      : 0;

    setCustomerMetrics({
      totalUsers,
      activeSubscriptions,
      churnRate,
      averageRevenuePerUser: arpu
    });
  };

  const processRevenueByPlan = (subscriptions: any[]) => {
    const planMap: Record<string, { revenue: number; count: number }> = {};

    subscriptions.forEach(sub => {
      if (sub.subscription_plans && sub.status === 'active') {
        const planName = sub.subscription_plans.name;
        const price = sub.subscription_plans.price_cents / 100;
        
        if (!planMap[planName]) {
          planMap[planName] = { revenue: 0, count: 0 };
        }
        
        planMap[planName].revenue += price;
        planMap[planName].count += 1;
      }
    });

    const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c'];
    const planData = Object.entries(planMap).map(([name, data], index) => ({
      name,
      value: data.revenue,
      count: data.count,
      color: colors[index % colors.length]
    }));

    setRevenueByPlan(planData);
  };

  const exportRevenueReport = () => {
    const headers = ['Date', 'Revenue', 'Transactions', 'New Subscriptions', 'Credit Purchases'];
    const rows = revenueData.map(d => [
      d.date,
      `$${d.revenue.toFixed(2)}`,
      d.transactions.toString(),
      d.newSubscriptions.toString(),
      `$${d.creditPurchases.toFixed(2)}`
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast.success('Revenue report exported');
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border rounded-lg p-3 shadow-lg">
          <p className="font-medium">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: ${entry.value.toFixed(2)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="py-12">
          <p className="text-center text-muted-foreground">
            You don't have permission to view revenue data
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Revenue Dashboard</h2>
          <p className="text-muted-foreground">
            Monitor revenue, subscriptions, and customer metrics
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onValueChange={(value: '7d' | '30d' | '3m' | '1y') => setPeriod(value)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="3m">Last 3 months</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportRevenueReport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalRevenue.toFixed(2)}</div>
            <div className="flex items-center text-xs">
              {revenueGrowth >= 0 ? (
                <TrendingUp className="mr-1 h-3 w-3 text-green-500" />
              ) : (
                <TrendingUp className="mr-1 h-3 w-3 text-red-500 rotate-180" />
              )}
              <span className={revenueGrowth >= 0 ? 'text-green-500' : 'text-red-500'}>
                {revenueGrowth > 0 ? '+' : ''}{revenueGrowth}% vs prev period
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Subscriptions</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {customerMetrics?.activeSubscriptions || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              of {customerMetrics?.totalUsers || 0} total users
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Revenue Per User</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${customerMetrics?.averageRevenuePerUser || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Monthly ARPU
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Churn Rate</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {customerMetrics?.churnRate || 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              Customer churn
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Charts */}
      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="revenue">Revenue Over Time</TabsTrigger>
          <TabsTrigger value="breakdown">Revenue Breakdown</TabsTrigger>
          <TabsTrigger value="metrics">Business Metrics</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue">
          <Card>
            <CardHeader>
              <CardTitle>Revenue Trends</CardTitle>
              <CardDescription>
                Track revenue and transaction volume over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="revenue"
                    stroke="#8884d8"
                    strokeWidth={2}
                    name="Revenue ($)"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="transactions"
                    stroke="#82ca9d"
                    strokeWidth={2}
                    name="Transactions"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="breakdown">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Revenue by Plan</CardTitle>
                <CardDescription>
                  Distribution of revenue across subscription plans
                </CardDescription>
              </CardHeader>
              <CardContent>
                {revenueByPlan.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={revenueByPlan}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={(entry) => `${entry.name}: $${entry.value}`}
                      >
                        {revenueByPlan.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                    No plan data available
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Revenue Sources</CardTitle>
                <CardDescription>
                  Subscriptions vs one-time credit purchases
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={revenueData.slice(-7)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Bar 
                      dataKey="revenue" 
                      fill="#8884d8" 
                      name="Total Revenue"
                    />
                    <Bar 
                      dataKey="creditPurchases" 
                      fill="#82ca9d" 
                      name="Credit Purchases"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="metrics">
          <Card>
            <CardHeader>
              <CardTitle>Business Metrics</CardTitle>
              <CardDescription>
                Key performance indicators and growth metrics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Subscription Plans Table */}
                <div>
                  <h3 className="font-medium mb-3">Active Plans Distribution</h3>
                  <div className="space-y-2">
                    {revenueByPlan.map((plan) => (
                      <div key={plan.name} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: plan.color }}
                          />
                          <span className="font-medium">{plan.name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <Badge variant="secondary">
                            {plan.count} users
                          </Badge>
                          <span className="font-medium">
                            ${plan.value.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Growth Metrics */}
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="p-4 border rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">New Subscriptions</p>
                    <p className="text-2xl font-bold">
                      {revenueData.reduce((sum, d) => sum + d.newSubscriptions, 0)}
                    </p>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Total Transactions</p>
                    <p className="text-2xl font-bold">
                      {revenueData.reduce((sum, d) => sum + d.transactions, 0)}
                    </p>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Conversion Rate</p>
                    <p className="text-2xl font-bold">
                      {customerMetrics && customerMetrics.totalUsers > 0
                        ? Math.round((customerMetrics.activeSubscriptions / customerMetrics.totalUsers) * 100)
                        : 0}%
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}