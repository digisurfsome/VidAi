import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import {
  Plus,
  Edit,
  MoreHorizontal,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  Trash2,
  Archive,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// Types
interface SubscriptionPlan {
  id: string; // UUID
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  interval: string;
  credits_per_period: number;
  features: any[];
  is_active: boolean;
  sort_order: number;
  stripe_product_id: string;
  stripe_price_id: string;
  created_via: string;
  last_synced_at: string | null;
  stripe_sync_status: string;
  sync_error_message: string | null;
  metadata: any;
  archived_at: string | null;
  archived_by: string | null;
  created_at: string;
  updated_at: string;
}

interface CreatePlanData {
  name: string;
  description: string;
  price_cents: number;
  interval: 'month' | 'year';
  credits_per_period: number;
  is_active: boolean;
}

interface UpdatePlanData {
  description?: string;
  credits_per_period?: number;
  is_active?: boolean;
}

// API functions
const fetchPlans = async (includeArchived = false): Promise<{ plans: SubscriptionPlan[]; sync_status: any }> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const url = includeArchived ? '/api/stripe-admin/plans?include_archived=true' : '/api/stripe-admin/plans';
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch plans');
  }

  return response.json();
};

const createPlan = async (planData: CreatePlanData): Promise<any> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const response = await fetch('/api/stripe-admin/plans', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(planData),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create plan');
  }

  return response.json();
};

const updatePlan = async (planId: string, updateData: UpdatePlanData): Promise<any> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const response = await fetch(`/api/stripe-admin/plans/${planId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updateData),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update plan');
  }

  return response.json();
};

const archivePlan = async (planId: string): Promise<any> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const response = await fetch(`/api/stripe-admin/plans/${planId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to archive plan');
  }

  return response.json();
};

const syncPlans = async (): Promise<any> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const response = await fetch('/api/stripe-admin/sync?direction=from_stripe&force=false', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to sync plans');
  }

  return response.json();
};

// Create Plan Modal Component
const CreatePlanModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreatePlanData) => void;
  isLoading: boolean;
}> = ({ isOpen, onClose, onSubmit, isLoading }) => {
  const [formData, setFormData] = useState<CreatePlanData>({
    name: '',
    description: '',
    price_cents: 999,
    interval: 'month',
    credits_per_period: 500,
    is_active: true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Plan name is required';
    } else if (formData.name.length > 100) {
      newErrors.name = 'Plan name must be 100 characters or less';
    }

    if (!formData.description.trim()) {
      newErrors.description = 'Description is required';
    }

    if (formData.price_cents < 99) {
      newErrors.price_cents = 'Minimum price is $0.99';
    } else if (formData.price_cents > 99999) {
      newErrors.price_cents = 'Maximum price is $999.99';
    }

    if (formData.credits_per_period < 1) {
      newErrors.credits_per_period = 'Credits per period must be at least 1';
    } else if (formData.credits_per_period > 100000) {
      newErrors.credits_per_period = 'Credits per period cannot exceed 100,000';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(formData);
    }
  };

  const handleClose = () => {
    setFormData({
      name: '',
      description: '',
      price_cents: 999,
      interval: 'month',
      credits_per_period: 500,
      is_active: true,
    });
    setErrors({});
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Subscription Plan</DialogTitle>
          <DialogDescription>
            Create a new subscription plan that will be automatically synced with Stripe.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Plan Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Pro Plan"
              className={cn(errors.name && "border-red-500")}
            />
            {errors.name && (
              <p className="text-sm text-red-600 mt-1">{errors.name}</p>
            )}
          </div>

          <div>
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Plan description for users"
              className={cn(errors.description && "border-red-500")}
            />
            {errors.description && (
              <p className="text-sm text-red-600 mt-1">{errors.description}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="price">Price (USD) *</Label>
              <Input
                id="price"
                type="number"
                min="0.99"
                max="999.99"
                step="0.01"
                value={(formData.price_cents / 100).toFixed(2)}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  price_cents: Math.round(parseFloat(e.target.value) * 100) 
                })}
                className={cn(errors.price_cents && "border-red-500")}
              />
              {errors.price_cents && (
                <p className="text-sm text-red-600 mt-1">{errors.price_cents}</p>
              )}
            </div>

            <div>
              <Label htmlFor="interval">Billing Interval</Label>
              <Select 
                value={formData.interval} 
                onValueChange={(value: 'month' | 'year') => 
                  setFormData({ ...formData, interval: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Monthly</SelectItem>
                  <SelectItem value="year">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="credits">Credits per Period *</Label>
            <Input
              id="credits"
              type="number"
              min="1"
              max="100000"
              value={formData.credits_per_period}
              onChange={(e) => setFormData({ 
                ...formData, 
                credits_per_period: parseInt(e.target.value) || 0 
              })}
              className={cn(errors.credits_per_period && "border-red-500")}
            />
            {errors.credits_per_period && (
              <p className="text-sm text-red-600 mt-1">{errors.credits_per_period}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Plan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// Main Component
const StripePlanManagement: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<UpdatePlanData>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [planToArchive, setPlanToArchive] = useState<SubscriptionPlan | null>(null);

  // Queries
  const {
    data: plansData,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['stripe-plans', showArchived],
    queryFn: () => fetchPlans(showArchived),
    refetchInterval: 30000, // Refetch every 30 seconds for real-time sync status
  });

  // Mutations
  const createPlanMutation = useMutation({
    mutationFn: createPlan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stripe-plans'] });
      setCreateModalOpen(false);
      toast({
        title: 'Plan Created',
        description: 'Subscription plan created and synced with Stripe successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Creation Failed',
        description: error.message,
      });
    },
  });

  const updatePlanMutation = useMutation({
    mutationFn: ({ planId, updateData }: { planId: string; updateData: UpdatePlanData }) =>
      updatePlan(planId, updateData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stripe-plans'] });
      setEditingPlan(null);
      setEditFormData({});
      toast({
        title: 'Plan Updated',
        description: 'Subscription plan updated successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: error.message,
      });
    },
  });

  const syncPlansMutation = useMutation({
    mutationFn: syncPlans,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stripe-plans'] });
      toast({
        title: 'Sync Completed',
        description: 'Plans synchronized with Stripe successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Sync Failed',
        description: error.message,
      });
    },
  });

  const archivePlanMutation = useMutation({
    mutationFn: archivePlan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stripe-plans'] });
      setPlanToArchive(null);
      toast({
        title: 'Plan Archived',
        description: 'Subscription plan has been archived successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Archive Failed',
        description: error.message,
      });
    },
  });

  // Handlers
  const handleCreatePlan = (data: CreatePlanData) => {
    createPlanMutation.mutate(data);
  };

  const handleEditPlan = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setEditFormData({
      description: plan.description,
      credits_per_period: plan.credits_per_period,
      is_active: plan.is_active,
    });
  };

  const handleUpdatePlan = () => {
    if (!editingPlan) return;
    updatePlanMutation.mutate({
      planId: editingPlan.id,
      updateData: editFormData,
    });
  };

  const handleSync = () => {
    syncPlansMutation.mutate();
  };

  const handleArchivePlan = () => {
    if (!planToArchive) return;
    archivePlanMutation.mutate(planToArchive.id);
  };

  // Render sync status badge
  const renderSyncStatus = (status: string, lastSynced: string | null) => {
    switch (status) {
      case 'synced':
        return (
          <Badge variant="default" className="text-xs bg-green-100 text-green-800 border-green-300">
            <CheckCircle className="h-3 w-3 mr-1" />
            Synced
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="secondary" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive" className="text-xs">
            <XCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Unknown
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin mr-2" />
          <span>Loading subscription plans...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Failed to load subscription plans: {error.message}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const plans = plansData?.plans || [];
  const activePlans = plans.filter((p) => !p.archived_at);
  const archivedPlans = plans.filter((p) => p.archived_at);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Subscription Plans</h2>
          <p className="text-muted-foreground">
            Manage subscription plans with automatic Stripe synchronization
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? (
              <EyeOff className="h-4 w-4 mr-2" />
            ) : (
              <Eye className="h-4 w-4 mr-2" />
            )}
            {showArchived ? 'Hide' : 'Show'} Archived
          </Button>
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncPlansMutation.isPending}
          >
            {syncPlansMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync with Stripe
          </Button>
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Plan
          </Button>
        </div>
      </div>

      {/* Plans Table */}
      <Card>
        <CardHeader>
          <CardTitle>{showArchived ? 'All Plans' : 'Active Plans'}</CardTitle>
          <CardDescription>
            {activePlans.length} active plan{activePlans.length !== 1 ? 's' : ''}
            {showArchived && archivedPlans.length > 0 && ` • ${archivedPlans.length} archived`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">No subscription plans found</p>
              <Button onClick={() => setCreateModalOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Plan
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan Name</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Interval</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sync Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(showArchived ? plans : activePlans).map((plan) => (
                  <TableRow key={plan.id} className={plan.archived_at ? 'opacity-60' : ''}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{plan.name}</p>
                        <p className="text-sm text-muted-foreground truncate max-w-xs">
                          {plan.description}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      ${(plan.price_cents / 100).toFixed(2)}
                    </TableCell>
                    <TableCell className="capitalize">{plan.interval}ly</TableCell>
                    <TableCell>{plan.credits_per_period.toLocaleString()}</TableCell>
                    <TableCell>
                      {plan.archived_at ? (
                        <Badge variant="outline" className="text-xs">
                          <Archive className="h-3 w-3 mr-1" />
                          Archived
                        </Badge>
                      ) : (
                        <Badge 
                          variant={plan.is_active ? 'default' : 'secondary'}
                          className={plan.is_active ? 'bg-green-100 text-green-800 border-green-300' : ''}
                        >
                          {plan.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {renderSyncStatus(plan.stripe_sync_status, plan.last_synced_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={() => handleEditPlan(plan)}
                            disabled={!!plan.archived_at}
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            Edit Plan
                          </DropdownMenuItem>
                          {!plan.archived_at && (
                            <DropdownMenuItem 
                              onClick={() => setPlanToArchive(plan)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Archive className="h-4 w-4 mr-2" />
                              Archive Plan
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Plan Modal */}
      <CreatePlanModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={handleCreatePlan}
        isLoading={createPlanMutation.isPending}
      />

      {/* Edit Plan Modal */}
      {editingPlan && (
        <Dialog open={!!editingPlan} onOpenChange={() => setEditingPlan(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Plan: {editingPlan.name}</DialogTitle>
              <DialogDescription>
                Update plan details. Note: Price and interval cannot be changed in Stripe.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  value={editFormData.description || ''}
                  onChange={(e) => setEditFormData({ 
                    ...editFormData, 
                    description: e.target.value 
                  })}
                />
              </div>

              <div>
                <Label htmlFor="edit-credits">Credits per Period</Label>
                <Input
                  id="edit-credits"
                  type="number"
                  min="1"
                  value={editFormData.credits_per_period || ''}
                  onChange={(e) => setEditFormData({ 
                    ...editFormData, 
                    credits_per_period: parseInt(e.target.value) || 0 
                  })}
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  id="edit-active"
                  type="checkbox"
                  checked={editFormData.is_active || false}
                  onChange={(e) => setEditFormData({ 
                    ...editFormData, 
                    is_active: e.target.checked 
                  })}
                />
                <Label htmlFor="edit-active">Plan is active</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingPlan(null)}>
                Cancel
              </Button>
              <Button 
                onClick={handleUpdatePlan}
                disabled={updatePlanMutation.isPending}
              >
                {updatePlanMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Update Plan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Archive Confirmation Dialog */}
      {planToArchive && (
        <Dialog open={!!planToArchive} onOpenChange={() => setPlanToArchive(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Archive Plan: {planToArchive.name}</DialogTitle>
              <DialogDescription>
                Are you sure you want to archive this subscription plan? 
                Archived plans cannot be purchased by new customers but existing subscriptions will continue.
              </DialogDescription>
            </DialogHeader>

            <Alert variant="default" className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                This action will:
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Hide the plan from customer view</li>
                  <li>Prevent new subscriptions</li>
                  <li>Keep existing subscriptions active</li>
                  <li>Allow plan restoration later if needed</li>
                </ul>
              </AlertDescription>
            </Alert>

            <DialogFooter>
              <Button variant="outline" onClick={() => setPlanToArchive(null)}>
                Cancel
              </Button>
              <Button 
                variant="destructive"
                onClick={handleArchivePlan}
                disabled={archivePlanMutation.isPending}
              >
                {archivePlanMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Archive Plan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default StripePlanManagement;