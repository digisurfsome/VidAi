/**
 * BuildAnalyticsDashboard — Internal admin analytics for build system
 *
 * Displays build success rates, timing, failure patterns, and quality scores.
 * Data-driven dashboard for improving the builder.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import {
  TrendingUp, Clock, CheckCircle2, XCircle,
  Activity, Zap, Target, RefreshCw, Loader2,
} from 'lucide-react';

interface AnalyticsSummary {
  total_builds: number;
  successful_builds: number;
  failed_builds: number;
  success_rate: number;
  avg_build_time_ms: number;
  avg_visual_score: number;
  retry_rate: number;
  first_attempt_success_rate: number;
  avg_tests_passed_pct: number;
  builds_by_complexity: Record<string, number>;
  failure_distribution: Record<string, number>;
  avg_phase_times: { phase_1: number; phase_2: number; phase_3: number; phase_4: number };
}

interface TimeSeriesPoint {
  date: string;
  total: number;
  successful: number;
  failed: number;
  avg_duration_ms: number;
}

const COLORS = ['#22c55e', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899'];

export default function BuildAnalyticsDashboard() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [timeseries, setTimeseries] = useState<TimeSeriesPoint[]>([]);
  const [daysBack, setDaysBack] = useState('30');
  const [isLoading, setIsLoading] = useState(true);

  async function loadAnalytics() {
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const headers = {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      };

      const [summaryRes, timeseriesRes] = await Promise.all([
        fetch(`/api/build-analytics?type=summary&days=${daysBack}`, { headers }),
        fetch(`/api/build-analytics?type=timeseries&days=${daysBack}`, { headers }),
      ]);

      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setSummary(data.summary);
      }
      if (timeseriesRes.ok) {
        const data = await timeseriesRes.json();
        setTimeseries(data.timeseries);
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAnalytics();
  }, [daysBack]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const s = summary || {
    total_builds: 0, successful_builds: 0, failed_builds: 0, success_rate: 0,
    avg_build_time_ms: 0, avg_visual_score: 0, retry_rate: 0,
    first_attempt_success_rate: 0, avg_tests_passed_pct: 0,
    builds_by_complexity: {}, failure_distribution: {},
    avg_phase_times: { phase_1: 0, phase_2: 0, phase_3: 0, phase_4: 0 },
  };

  // Prepare chart data
  const complexityData = Object.entries(s.builds_by_complexity).map(([name, value]) => ({ name, value }));
  const failureData = Object.entries(s.failure_distribution).map(([name, value]) => ({ name, value }));
  const phaseTimeData = [
    { name: 'Build Validation', time: s.avg_phase_times.phase_1 },
    { name: 'Functional Tests', time: s.avg_phase_times.phase_2 },
    { name: 'Interactive QA', time: s.avg_phase_times.phase_3 },
    { name: 'Deployment', time: s.avg_phase_times.phase_4 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Build Analytics</h2>
          <p className="text-muted-foreground">Internal metrics — last {daysBack} days</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={daysBack} onValueChange={setDaysBack}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={loadAnalytics}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Builds"
          value={s.total_builds.toString()}
          icon={<Activity className="h-4 w-4" />}
          subtitle={`${s.successful_builds} successful`}
        />
        <KPICard
          title="Success Rate"
          value={`${s.success_rate}%`}
          icon={<Target className="h-4 w-4" />}
          subtitle={`${s.first_attempt_success_rate}% first attempt`}
          valueColor={s.success_rate >= 90 ? 'text-green-600' : s.success_rate >= 70 ? 'text-yellow-600' : 'text-red-600'}
        />
        <KPICard
          title="Avg Build Time"
          value={formatDuration(s.avg_build_time_ms)}
          icon={<Clock className="h-4 w-4" />}
          subtitle="prompt to delivery"
        />
        <KPICard
          title="Avg Visual Score"
          value={s.avg_visual_score ? `${s.avg_visual_score}/100` : 'N/A'}
          icon={<Zap className="h-4 w-4" />}
          subtitle={`${s.retry_rate}% retry rate`}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Build volume over time */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Build Volume</CardTitle>
          </CardHeader>
          <CardContent>
            {timeseries.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={timeseries}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    labelFormatter={(d) => new Date(d).toLocaleDateString()}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="successful" stackId="a" fill="#22c55e" name="Successful" />
                  <Bar dataKey="failed" stackId="a" fill="#ef4444" name="Failed" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No build data yet" />
            )}
          </CardContent>
        </Card>

        {/* Build time trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Build Time Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {timeseries.some(t => t.avg_duration_ms > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timeseries.filter(t => t.avg_duration_ms > 0)}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => formatDuration(v)}
                  />
                  <Tooltip
                    labelFormatter={(d) => new Date(d).toLocaleDateString()}
                    formatter={(v: number) => [formatDuration(v), 'Avg Duration']}
                  />
                  <Line type="monotone" dataKey="avg_duration_ms" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No timing data yet" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Phase timing breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Avg Phase Duration</CardTitle>
          </CardHeader>
          <CardContent>
            {phaseTimeData.some(p => p.time > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={phaseTimeData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tickFormatter={(v) => formatDuration(v)} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [formatDuration(v), 'Duration']} />
                  <Bar dataKey="time" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No phase data yet" />
            )}
          </CardContent>
        </Card>

        {/* Complexity distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">By Complexity</CardTitle>
          </CardHeader>
          <CardContent>
            {complexityData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={complexityData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {complexityData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No complexity data" />
            )}
          </CardContent>
        </Card>

        {/* Failure distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Failure Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {failureData.length > 0 ? (
              <div className="space-y-3 pt-4">
                {failureData.map((item) => (
                  <div key={item.name} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{item.name}</span>
                      <span className="font-medium">{item.value}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-destructive rounded-full"
                        style={{ width: `${(item.value / s.failed_builds) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No failures recorded" icon={<CheckCircle2 className="h-8 w-8 text-green-500" />} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Test Pass Rate" value={`${s.avg_tests_passed_pct}%`} />
        <StatCard label="Retry Rate" value={`${s.retry_rate}%`} />
        <StatCard label="1st Attempt Pass" value={`${s.first_attempt_success_rate}%`} />
        <StatCard label="Failed Builds" value={s.failed_builds.toString()} />
      </div>
    </div>
  );
}

// ==================
// Sub-components
// ==================

function KPICard({
  title, value, icon, subtitle, valueColor = ''
}: {
  title: string; value: string; icon: React.ReactNode; subtitle: string; valueColor?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          {icon}
          <span className="text-sm">{title}</span>
        </div>
        <p className={`text-3xl font-bold ${valueColor}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-lg font-bold">{value}</span>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message, icon }: { message: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
      {icon || <Activity className="h-8 w-8 mb-2 opacity-40" />}
      <p className="text-sm">{message}</p>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms === 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
