import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getTestMode } from '@/lib/stripe-test-mode';
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
import { toast } from 'sonner';
import {
  Plus,
  Edit2,
  Trash2,
  GripVertical,
  TrendingUp,
  Package,
  DollarSign,
  Users,
  Sparkles,
  AlertCircle,
  Check,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  bonus_percentage: number;
  total_credits: number;
  is_active: boolean;
  display_order: number;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  created_at: string;
  updated_at: string;
  // Metrics (calculated client-side for now)
  sales_count?: number;
  total_revenue?: number;
  popularity_rank?: number;
}

interface PackageFormData {
  name: string;
  credits: number;
  price: number;
  bonus_percentage: number;
  is_active: boolean;
}

export default function CreditPackageManager() {
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<CreditPackage | null>(null);
  const [deletePackage, setDeletePackage] = useState<CreditPackage | null>(null);
  const [draggedItem, setDraggedItem] = useState<CreditPackage | null>(null);
  const [formData, setFormData] = useState<PackageFormData>({
    name: '',
    credits: 1000,
    price: 9.99,
    bonus_percentage: 0,
    is_active: true,
  });

  // Fetch packages
  const { data: packages = [], isLoading } = useQuery({
    queryKey: ['admin-credit-packages', getTestMode()],
    queryFn: async () => {
      const isTestMode = getTestMode();
      const { data: session } = await supabase.auth.getSession();
      
      const response = await fetch('/api/admin-credit-packages', {
        headers: {
          'Authorization': `Bearer ${session.session?.access_token}`,
          'Content-Type': 'application/json',
          'X-Test-Mode': String(isTestMode),
        },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch packages');
      }
      
      return response.json() as Promise<CreditPackage[]>;
    },
  });

  // Create package mutation
  const createMutation = useMutation({
    mutationFn: async (data: PackageFormData) => {
      const { data: session } = await supabase.auth.getSession();
      const isTestMode = getTestMode();
      
      const response = await fetch('/api/stripe-admin/packages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.session?.access_token}`,
          'Content-Type': 'application/json',
          'X-Test-Mode': String(isTestMode),
        },
        body: JSON.stringify({
          ...data,
          total_credits: data.credits + (data.credits * data.bonus_percentage / 100),
          display_order: packages.length + 1,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create package');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-credit-packages'] });
      toast.success('Credit package created successfully');
      setCreateDialogOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Update package mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PackageFormData> }) => {
      const { data: session } = await supabase.auth.getSession();
      const isTestMode = getTestMode();
      
      const response = await fetch(`/api/stripe-admin/packages/${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${session.session?.access_token}`,
          'Content-Type': 'application/json',
          'X-Test-Mode': String(isTestMode),
        },
        body: JSON.stringify({
          ...data,
          total_credits: data.credits ? 
            data.credits + (data.credits * (data.bonus_percentage || 0) / 100) : 
            undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update package');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-credit-packages'] });
      toast.success('Package updated successfully');
      setEditingPackage(null);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Delete package mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: session } = await supabase.auth.getSession();
      const isTestMode = getTestMode();
      
      const response = await fetch(`/api/stripe-admin/packages/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.session?.access_token}`,
          'X-Test-Mode': String(isTestMode),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete package');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-credit-packages'] });
      toast.success('Package deleted successfully');
      setDeletePackage(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Update display order mutation
  const updateOrderMutation = useMutation({
    mutationFn: async (packages: { id: string; display_order: number }[]) => {
      // Map display_order to sort_order for database
      const packagesToUpdate = packages.map(pkg => ({
        id: pkg.id,
        sort_order: pkg.display_order
      }));
      
      const { error } = await supabase
        .from('credit_packages')
        .upsert(packagesToUpdate, { onConflict: 'id' });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-credit-packages'] });
      toast.success('Package order updated');
    },
    onError: (error: Error) => {
      toast.error('Failed to update order: ' + error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      credits: 1000,
      price: 9.99,
      bonus_percentage: 0,
      is_active: true,
    });
  };

  const handleCreate = () => {
    if (!formData.name || formData.credits <= 0 || formData.price <= 0) {
      toast.error('Please fill in all required fields');
      return;
    }
    createMutation.mutate(formData);
  };

  const handleUpdate = () => {
    if (!editingPackage) return;
    updateMutation.mutate({
      id: editingPackage.id,
      data: formData,
    });
  };

  const handleDelete = () => {
    if (!deletePackage) return;
    deleteMutation.mutate(deletePackage.id);
  };

  const handleDragStart = (e: React.DragEvent, pkg: CreditPackage) => {
    setDraggedItem(pkg);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetPkg: CreditPackage) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.id === targetPkg.id) return;

    const updatedPackages = [...packages];
    const draggedIndex = updatedPackages.findIndex(p => p.id === draggedItem.id);
    const targetIndex = updatedPackages.findIndex(p => p.id === targetPkg.id);

    // Swap positions
    updatedPackages.splice(draggedIndex, 1);
    updatedPackages.splice(targetIndex, 0, draggedItem);

    // Update display_order for all affected packages
    const packagesToUpdate = updatedPackages.map((pkg, index) => ({
      id: pkg.id,
      display_order: index + 1,
    }));

    updateOrderMutation.mutate(packagesToUpdate);
    setDraggedItem(null);
  };

  const calculateEffectivePrice = (credits: number, price: number, bonus: number) => {
    const totalCredits = credits + (credits * bonus / 100);
    return (price / totalCredits).toFixed(4);
  };

  useEffect(() => {
    if (editingPackage) {
      setFormData({
        name: editingPackage.name,
        credits: editingPackage.credits,
        price: editingPackage.price,
        bonus_percentage: editingPackage.bonus_percentage,
        is_active: editingPackage.is_active,
      });
    }
  }, [editingPackage]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading packages...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Credit Package Management</h2>
          <p className="text-muted-foreground">
            Create and manage credit packages for one-time purchases
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Package
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Packages</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {packages.filter(p => p.is_active).length}
            </div>
            <p className="text-xs text-muted-foreground">
              {packages.length} total packages
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Bonus</CardTitle>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {packages.length > 0
                ? (packages.reduce((sum, p) => sum + p.bonus_percentage, 0) / packages.length).toFixed(1)
                : 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              Across all packages
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Price Range</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${packages.length > 0 ? Math.min(...packages.map(p => p.price)).toFixed(2) : '0.00'} - 
              ${packages.length > 0 ? Math.max(...packages.map(p => p.price)).toFixed(2) : '0.00'}
            </div>
            <p className="text-xs text-muted-foreground">
              Min to max package price
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Packages Table */}
      <Card>
        <CardHeader>
          <CardTitle>Credit Packages</CardTitle>
          <CardDescription>
            Drag and drop to reorder packages. Click to edit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Package Name</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Bonus</TableHead>
                <TableHead>Total Credits</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Per Credit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {packages.map((pkg) => (
                <TableRow
                  key={pkg.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, pkg)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, pkg)}
                  className="cursor-move hover:bg-muted/50"
                >
                  <TableCell>
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                  <TableCell className="font-medium">
                    <div>
                      <div>{pkg.name}</div>
                    </div>
                  </TableCell>
                  <TableCell>{pkg.credits.toLocaleString()}</TableCell>
                  <TableCell>
                    {pkg.bonus_percentage > 0 && (
                      <Badge variant="secondary" className="font-mono">
                        +{pkg.bonus_percentage}%
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {pkg.total_credits.toLocaleString()}
                  </TableCell>
                  <TableCell>${pkg.price.toFixed(2)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    ${calculateEffectivePrice(pkg.credits, pkg.price, pkg.bonus_percentage)}
                  </TableCell>
                  <TableCell>
                    {pkg.is_active ? (
                      <Badge className="bg-green-500">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingPackage(pkg)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletePackage(pkg)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog 
        open={createDialogOpen || !!editingPackage} 
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditingPackage(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingPackage ? 'Edit Credit Package' : 'Create Credit Package'}
            </DialogTitle>
            <DialogDescription>
              Configure the package details and pricing. Bonus credits are automatically calculated.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Package Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Starter Pack"
              />
            </div>


            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="credits">Base Credits</Label>
                <Input
                  id="credits"
                  type="number"
                  value={formData.credits}
                  onChange={(e) => setFormData({ ...formData, credits: parseInt(e.target.value) || 0 })}
                  min="1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="price">Price ($)</Label>
                <Input
                  id="price"
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                  min="0.99"
                  step="0.01"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bonus">Bonus Percentage: {formData.bonus_percentage}%</Label>
              <Slider
                id="bonus"
                value={[formData.bonus_percentage]}
                onValueChange={([value]) => setFormData({ ...formData, bonus_percentage: value })}
                min={0}
                max={100}
                step={5}
                className="py-4"
              />
              {formData.bonus_percentage > 0 && (
                <div className="bg-muted p-3 rounded-md">
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span>Base Credits:</span>
                      <span className="font-mono">{formData.credits.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-green-600">
                      <span>Bonus Credits (+{formData.bonus_percentage}%):</span>
                      <span className="font-mono">
                        +{Math.floor(formData.credits * formData.bonus_percentage / 100).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between font-medium pt-1 border-t">
                      <span>Total Credits:</span>
                      <span className="font-mono">
                        {(formData.credits + Math.floor(formData.credits * formData.bonus_percentage / 100)).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Effective Price per Credit:</span>
                      <span className="font-mono">
                        ${calculateEffectivePrice(formData.credits, formData.price, formData.bonus_percentage)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="active">Active (visible to users)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateDialogOpen(false);
                setEditingPackage(null);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={editingPackage ? handleUpdate : handleCreate}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingPackage ? 'Update Package' : 'Create Package'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletePackage} onOpenChange={(open) => !open && setDeletePackage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Credit Package</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletePackage?.name}"? This action cannot be undone.
              The package will be removed from Stripe as well.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              Delete Package
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}