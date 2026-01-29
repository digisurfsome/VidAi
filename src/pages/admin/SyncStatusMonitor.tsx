import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  RefreshCw, 
  Activity, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  ArrowUpDown,
  Package,
  CreditCard,
  Database,
  Cloud,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import { stripeSyncService } from '@/lib/stripe-sync';
import { format } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

interface SyncLog {
  id: string;
  sync_type: string;
  sync_direction: string;
  entity_type: string;
  entity_id?: string;
  action: string;
  status: 'success' | 'error' | 'partial';
  sync_details?: any;
  created_at: string;
  performed_by?: string;
}

interface SyncStatus {
  total_products: number;
  synced_products: number;
  pending_sync: number;
  sync_errors: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  breakdown: {
    subscription_plans: {
      total: number;
      synced: number;
      pending: number;
      error: number;
    };
    credit_packages: {
      total: number;
      synced: number;
      pending: number;
      error: number;
    };
  };
}

export default function SyncStatusMonitor() {
  const queryClient = useQueryClient();
  const [syncDirection, setSyncDirection] = useState<'from_stripe' | 'to_stripe' | 'bidirectional'>('from_stripe');
  const [isManualSyncOpen, setIsManualSyncOpen] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  // Fetch sync status
  const { data: syncStatus, isLoading: statusLoading, error: statusError } = useQuery<SyncStatus>({
    queryKey: ['sync-status'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch('/api/stripe-admin/sync-status', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch sync status');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch sync logs
  const { data: syncLogs, isLoading: logsLoading } = useQuery<{ logs: SyncLog[] }>({
    queryKey: ['sync-logs'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch('/api/stripe-admin/sync-log?limit=20', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch sync logs');
      return response.json();
    },
  });

  // Manual sync mutation
  const syncMutation = useMutation({
    mutationFn: async (options: { direction: string; force: boolean }) => {
      setSyncProgress(10);
      const result = await stripeSyncService.syncWithRetry({
        direction: options.direction as any,
        force: options.force,
        maxRetries: 3,
      });
      setSyncProgress(100);
      return result;
    },
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Sync completed: ${result.productsCount} products, ${result.pricesCount} prices synced`);
      } else if (result.errors.length > 0) {
        toast.warning(`Sync completed with errors: ${result.errors[0]}`);
      }
      queryClient.invalidateQueries({ queryKey: ['sync-status'] });
      queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
      queryClient.invalidateQueries({ queryKey: ['subscription-plans'] });
      queryClient.invalidateQueries({ queryKey: ['credit-packages'] });
      setSyncProgress(0);
      setIsManualSyncOpen(false);
    },
    onError: (error: any) => {
      toast.error(`Sync failed: ${error.message}`);
      setSyncProgress(0);
    },
  });

  // Calculate sync percentage
  const syncPercentage = syncStatus 
    ? Math.round((syncStatus.synced_products / Math.max(syncStatus.total_products, 1)) * 100)
    : 0;

  // Get sync status color
  const getSyncStatusColor = (status: string | null) => {
    switch (status) {
      case 'success': return 'text-green-600 bg-green-50';
      case 'error': return 'text-red-600 bg-red-50';
      case 'partial': return 'text-yellow-600 bg-yellow-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge className="bg-green-100 text-green-800">Success</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      case 'partial':
        return <Badge className="bg-yellow-100 text-yellow-800">Partial</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Update sync progress simulation
  useEffect(() => {
    if (syncMutation.isPending && syncProgress > 0 && syncProgress < 90) {
      const timer = setTimeout(() => {
        setSyncProgress(prev => Math.min(prev + 10, 90));
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [syncMutation.isPending, syncProgress]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Sync Status Monitor</h2>
          <p className="text-muted-foreground">
            Monitor and manage synchronization between your database and Stripe
          </p>
        </div>
        <Button 
          onClick={() => setIsManualSyncOpen(true)}
          disabled={syncMutation.isPending}
        >
          {syncMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Manual Sync
            </>
          )}
        </Button>
      </div>

      {/* Status Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{syncStatus?.total_products || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {syncStatus?.breakdown.subscription_plans.total || 0} plans, {syncStatus?.breakdown.credit_packages.total || 0} packages
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Synced</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {syncStatus?.synced_products || 0}
            </div>
            <Progress value={syncPercentage} className="mt-2" />
            <div className="text-xs text-muted-foreground mt-1">{syncPercentage}% synced</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Sync</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {syncStatus?.pending_sync || 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Awaiting synchronization
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sync Errors</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {syncStatus?.sync_errors || 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Require attention
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Last Sync Info */}
      {syncStatus?.last_sync_at && (
        <Alert>
          <Activity className="h-4 w-4" />
          <AlertDescription>
            Last sync: {format(new Date(syncStatus.last_sync_at), 'PPp')} - 
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${getSyncStatusColor(syncStatus.last_sync_status)}`}>
              {syncStatus.last_sync_status}
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* App Filtering Info */}
      <Alert className="border-blue-200 bg-blue-50/50">
        <AlertCircle className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-900">
          <strong>Note:</strong> Only Stripe products with metadata <code className="px-1 py-0.5 bg-blue-100 rounded text-xs">app: 'video-studio'</code> will be synced. 
          Products from other apps in your Stripe account are automatically filtered out.
        </AlertDescription>
      </Alert>

      {/* Sync Details Tabs */}
      <Tabs defaultValue="breakdown" className="space-y-4">
        <TabsList>
          <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
          <TabsTrigger value="logs">Sync Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="breakdown" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Subscription Plans */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Subscription Plans
                </CardTitle>
                <CardDescription>Sync status for subscription plans</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Total Plans</span>
                    <span className="font-medium">{syncStatus?.breakdown.subscription_plans.total || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-green-600">Synced</span>
                    <span className="font-medium text-green-600">{syncStatus?.breakdown.subscription_plans.synced || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-yellow-600">Pending</span>
                    <span className="font-medium text-yellow-600">{syncStatus?.breakdown.subscription_plans.pending || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-red-600">Errors</span>
                    <span className="font-medium text-red-600">{syncStatus?.breakdown.subscription_plans.error || 0}</span>
                  </div>
                </div>
                <Progress 
                  value={(syncStatus?.breakdown.subscription_plans.synced || 0) / Math.max(syncStatus?.breakdown.subscription_plans.total || 1, 1) * 100} 
                  className="h-2"
                />
              </CardContent>
            </Card>

            {/* Credit Packages */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Credit Packages
                </CardTitle>
                <CardDescription>Sync status for credit packages</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Total Packages</span>
                    <span className="font-medium">{syncStatus?.breakdown.credit_packages.total || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-green-600">Synced</span>
                    <span className="font-medium text-green-600">{syncStatus?.breakdown.credit_packages.synced || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-yellow-600">Pending</span>
                    <span className="font-medium text-yellow-600">{syncStatus?.breakdown.credit_packages.pending || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-red-600">Errors</span>
                    <span className="font-medium text-red-600">{syncStatus?.breakdown.credit_packages.error || 0}</span>
                  </div>
                </div>
                <Progress 
                  value={(syncStatus?.breakdown.credit_packages.synced || 0) / Math.max(syncStatus?.breakdown.credit_packages.total || 1, 1) * 100} 
                  className="h-2"
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>Recent Sync Operations</CardTitle>
              <CardDescription>Last 20 synchronization events</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-4">
                  {logsLoading ? (
                    <div className="text-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                    </div>
                  ) : syncLogs?.logs && syncLogs.logs.length > 0 ? (
                    syncLogs.logs.map((log) => (
                      <div key={log.id} className="flex items-start gap-4 pb-4 border-b last:border-0">
                        <div className="mt-1">
                          {log.status === 'success' ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                          ) : log.status === 'error' ? (
                            <AlertCircle className="h-5 w-5 text-red-600" />
                          ) : (
                            <AlertTriangle className="h-5 w-5 text-yellow-600" />
                          )}
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            {getStatusBadge(log.status)}
                            <Badge variant="outline">{log.sync_type}</Badge>
                            <Badge variant="outline">
                              {log.sync_direction === 'from_stripe' ? (
                                <>
                                  <Cloud className="mr-1 h-3 w-3" />
                                  From Stripe
                                </>
                              ) : log.sync_direction === 'to_stripe' ? (
                                <>
                                  <Database className="mr-1 h-3 w-3" />
                                  To Stripe
                                </>
                              ) : (
                                <>
                                  <ArrowUpDown className="mr-1 h-3 w-3" />
                                  Bidirectional
                                </>
                              )}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {log.entity_type} - {log.action}
                            {log.entity_id && ` (${log.entity_id})`}
                          </p>
                          {log.sync_details && (
                            <div className="text-xs text-muted-foreground">
                              {log.sync_details.products_synced && `${log.sync_details.products_synced} products, `}
                              {log.sync_details.prices_synced && `${log.sync_details.prices_synced} prices`}
                              {log.sync_details.errors?.length > 0 && ` - ${log.sync_details.errors.length} errors`}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(log.created_at), 'PPp')}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      No sync logs available
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Manual Sync Dialog */}
      {isManualSyncOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Manual Sync</CardTitle>
              <CardDescription>
                Choose sync direction and options
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Sync Direction</label>
                <select
                  className="w-full p-2 border rounded-md"
                  value={syncDirection}
                  onChange={(e) => setSyncDirection(e.target.value as any)}
                  disabled={syncMutation.isPending}
                >
                  <option value="from_stripe">From Stripe → Database</option>
                  <option value="to_stripe">From Database → Stripe</option>
                  <option value="bidirectional">Bidirectional</option>
                </select>
              </div>

              {syncMutation.isPending && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Syncing...</span>
                    <span>{syncProgress}%</span>
                  </div>
                  <Progress value={syncProgress} />
                </div>
              )}

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {syncDirection === 'from_stripe' && 'Stripe data will override local changes'}
                  {syncDirection === 'to_stripe' && 'Local changes will be pushed to Stripe'}
                  {syncDirection === 'bidirectional' && 'Two-way sync with Stripe as source of truth for conflicts'}
                </AlertDescription>
              </Alert>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsManualSyncOpen(false)}
                  disabled={syncMutation.isPending}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => syncMutation.mutate({ direction: syncDirection, force: true })}
                  disabled={syncMutation.isPending}
                  className="flex-1"
                >
                  {syncMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    'Start Sync'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}