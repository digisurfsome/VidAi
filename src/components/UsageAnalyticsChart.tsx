import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar,
  AreaChart,
  Area,
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
import { format, subDays, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';
import { formatCredits } from '@/lib/stripe';
import { Loader2, TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface DailyUsage {
  date: string;
  credits: number;
  debits: number;
  balance: number;
}

interface UsageByType {
  name: string;
  value: number;
  color: string;
}

interface UsageAnalyticsChartProps {
  userId?: string;
  isAdmin?: boolean;
}

export function UsageAnalyticsChart({ userId, isAdmin = false }: UsageAnalyticsChartProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [usageByType, setUsageByType] = useState<UsageByType[]>([]);
  const [stats, setStats] = useState({
    totalCredits: 0,
    totalDebits: 0,
    avgDaily: 0,
    trend: 0
  });

  const effectiveUserId = userId || user?.id;

  useEffect(() => {
    if (effectiveUserId) {
      loadAnalytics();
    }
  }, [effectiveUserId, period]);

  const loadAnalytics = async () => {
    if (!effectiveUserId) return;

    try {
      setLoading(true);

      const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      const startDate = startOfDay(subDays(new Date(), days - 1));
      const endDate = endOfDay(new Date());

      // Load transactions
      let query = supabase
        .from('credit_transactions')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at');

      // If admin viewing all users, don't filter by user_id
      if (!isAdmin || userId) {
        query = query.eq('user_id', effectiveUserId);
      }

      const { data: transactions, error } = await query;

      if (error) throw error;

      // Process daily usage
      const dailyData = processDailyUsage(transactions || [], startDate, endDate);
      setDailyUsage(dailyData);

      // Process usage by type
      const typeData = processUsageByType(transactions || []);
      setUsageByType(typeData);

      // Calculate statistics
      calculateStats(transactions || [], dailyData);
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const processDailyUsage = (
    transactions: any[], 
    startDate: Date, 
    endDate: Date
  ): DailyUsage[] => {
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const dailyMap: Record<string, DailyUsage> = {};

    // Initialize all days
    days.forEach(day => {
      const dateKey = format(day, 'yyyy-MM-dd');
      dailyMap[dateKey] = {
        date: format(day, 'MMM dd'),
        credits: 0,
        debits: 0,
        balance: 0
      };
    });

    // Aggregate transactions by day
    let runningBalance = 0;
    transactions.forEach(tx => {
      const dateKey = format(new Date(tx.created_at), 'yyyy-MM-dd');
      if (dailyMap[dateKey]) {
        if (tx.type === 'credit') {
          dailyMap[dateKey].credits += tx.amount;
        } else {
          dailyMap[dateKey].debits += tx.amount;
        }
        runningBalance = tx.balance_after || runningBalance;
        dailyMap[dateKey].balance = runningBalance;
      }
    });

    // Fill in balance for days without transactions
    let lastBalance = 0;
    Object.values(dailyMap).forEach(day => {
      if (day.balance === 0 && lastBalance > 0) {
        day.balance = lastBalance;
      }
      lastBalance = day.balance;
    });

    return Object.values(dailyMap);
  };

  const processUsageByType = (transactions: any[]): UsageByType[] => {
    const typeMap: Record<string, number> = {};

    transactions.forEach(tx => {
      if (tx.type === 'debit' && tx.description) {
        const type = extractUsageType(tx.description);
        typeMap[type] = (typeMap[type] || 0) + tx.amount;
      }
    });

    const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1'];
    return Object.entries(typeMap)
      .map(([name, value], index) => ({
        name,
        value,
        color: colors[index % colors.length]
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  };

  const extractUsageType = (description: string): string => {
    if (description.toLowerCase().includes('video')) return 'Video Generation';
    if (description.toLowerCase().includes('subscription')) return 'Subscription';
    if (description.toLowerCase().includes('purchase')) return 'Credit Purchase';
    if (description.toLowerCase().includes('refund')) return 'Refund';
    return 'Other';
  };

  const calculateStats = (transactions: any[], dailyData: DailyUsage[]) => {
    const totalCredits = transactions
      .filter(t => t.type === 'credit')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalDebits = transactions
      .filter(t => t.type === 'debit')
      .reduce((sum, t) => sum + t.amount, 0);

    const daysWithUsage = dailyData.filter(d => d.debits > 0).length;
    const avgDaily = daysWithUsage > 0 ? Math.round(totalDebits / daysWithUsage) : 0;

    // Calculate trend (comparing last week to previous week)
    const midPoint = Math.floor(dailyData.length / 2);
    const firstHalfDebits = dailyData.slice(0, midPoint).reduce((sum, d) => sum + d.debits, 0);
    const secondHalfDebits = dailyData.slice(midPoint).reduce((sum, d) => sum + d.debits, 0);
    const trend = firstHalfDebits > 0 
      ? Math.round(((secondHalfDebits - firstHalfDebits) / firstHalfDebits) * 100)
      : 0;

    setStats({
      totalCredits,
      totalDebits,
      avgDaily,
      trend
    });
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border rounded-lg p-3 shadow-lg">
          <p className="font-medium">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {formatCredits(entry.value)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

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
      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Credits Added</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCredits(stats.totalCredits)}</div>
            <p className="text-xs text-muted-foreground">
              Last {period === '7d' ? '7 days' : period === '30d' ? '30 days' : '90 days'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Credits Used</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCredits(stats.totalDebits)}</div>
            <p className="text-xs text-muted-foreground">
              Last {period === '7d' ? '7 days' : period === '30d' ? '30 days' : '90 days'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Daily Usage</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCredits(stats.avgDaily)}</div>
            <p className="text-xs text-muted-foreground">
              Credits per active day
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Usage Trend</CardTitle>
            {stats.trend >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.trend > 0 ? '+' : ''}{stats.trend}%
            </div>
            <p className="text-xs text-muted-foreground">
              vs previous period
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Usage Analytics</CardTitle>
              <CardDescription>
                Credit consumption patterns and trends
              </CardDescription>
            </div>
            <Select value={period} onValueChange={(value: '7d' | '30d' | '90d') => setPeriod(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="usage" className="space-y-4">
            <TabsList>
              <TabsTrigger value="usage">Usage Over Time</TabsTrigger>
              <TabsTrigger value="balance">Balance Trend</TabsTrigger>
              <TabsTrigger value="breakdown">Usage Breakdown</TabsTrigger>
            </TabsList>

            <TabsContent value="usage" className="space-y-4">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={dailyUsage}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Area 
                    type="monotone" 
                    dataKey="credits" 
                    stackId="1"
                    stroke="#82ca9d" 
                    fill="#82ca9d" 
                    fillOpacity={0.6}
                    name="Credits Added"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="debits" 
                    stackId="2"
                    stroke="#ff7c7c" 
                    fill="#ff7c7c" 
                    fillOpacity={0.6}
                    name="Credits Used"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </TabsContent>

            <TabsContent value="balance" className="space-y-4">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dailyUsage}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="balance" 
                    stroke="#8884d8" 
                    strokeWidth={2}
                    name="Credit Balance"
                  />
                </LineChart>
              </ResponsiveContainer>
            </TabsContent>

            <TabsContent value="breakdown" className="space-y-4">
              {usageByType.length > 0 ? (
                <div className="grid md:grid-cols-2 gap-4">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={usageByType}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={(entry) => `${entry.name}: ${formatCredits(entry.value)}`}
                      >
                        {usageByType.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>

                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={usageByType}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="value" fill="#8884d8" name="Credits Used" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  No usage data available for the selected period
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}