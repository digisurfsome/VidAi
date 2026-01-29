import { useEffect, useState } from 'react'
import { useAdminPermissions } from '@/hooks/useAdminPermissions'
import { getAllUsers, getAuditLogs, UserRole, AdminAuditLog } from '@/lib/admin'
import PageLayout from '@/components/PageLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Users, 
  UserPlus, 
  Shield, 
  Activity, 
  Eye,
  Clock,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Settings,
  FileText,
  LayoutDashboard,
  DollarSign,
  CreditCard,
  FlaskConical,
  Package,
  RefreshCw,
  Key
} from 'lucide-react'
import { Link } from 'react-router-dom'
import UserManagement from './UserManagement'
import InviteUser from './InviteUser'
import AdminSettings from './AdminSettings'
import AdminApiKeys from './AdminApiKeys'
import AdminRevenueDashboard from './AdminRevenueDashboard'
import StripePlanManagement from './StripePlanManagement'
import TestModeSettings from './TestModeSettings'
import CreditPackageManager from './CreditPackageManager'
import SyncStatusMonitor from './SyncStatusMonitor'

const AdminDashboard = () => {
  const permissions = useAdminPermissions()
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    pendingInvitations: 0,
    adminUsers: 0
  })
  const [recentActivity, setRecentActivity] = useState<AdminAuditLog[]>([])
  const [allAuditLogs, setAllAuditLogs] = useState<AdminAuditLog[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        const [usersData, auditLogs, fullAuditLogs] = await Promise.all([
          getAllUsers(),
          getAuditLogs(10), // Get last 10 activities for recent
          getAuditLogs(100) // Get more for audit logs tab
        ])

        // Calculate stats
        const stats = {
          totalUsers: usersData.total,
          activeUsers: usersData.users.filter(u => u.status === 'active').length,
          pendingInvitations: usersData.users.filter(u => u.status === 'invited').length,
          adminUsers: usersData.users.filter(u => u.role === 'admin' && u.status === 'active').length
        }

        setStats(stats)
        setRecentActivity(auditLogs)
        setAllAuditLogs(fullAuditLogs)
      } catch (error) {
        console.error('Error loading dashboard data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadDashboardData()
  }, [])

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60))
    
    if (diffInMinutes < 60) {
      return `${diffInMinutes}m ago`
    } else if (diffInMinutes < 1440) {
      return `${Math.floor(diffInMinutes / 60)}h ago`
    } else {
      return `${Math.floor(diffInMinutes / 1440)}d ago`
    }
  }

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'user_invited':
        return <UserPlus className="h-4 w-4" />
      case 'user_updated':
        return <Users className="h-4 w-4" />
      case 'impersonation_start':
        return <Eye className="h-4 w-4" />
      default:
        return <Activity className="h-4 w-4" />
    }
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case 'user_invited':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400'
      case 'user_updated':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
      case 'user_deleted':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
      case 'impersonation_start':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
    }
  }

  if (isLoading) {
    return (
      <PageLayout title="Admin Dashboard" description="System administration and user management">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading admin dashboard...</span>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout 
      title="Admin Dashboard" 
      description="System administration and user management"
    >
      <div className="max-w-7xl">
        <Tabs defaultValue="overview" orientation="vertical" className="flex gap-8">
          {/* Secondary Navigation Column */}
          <div className="w-64 shrink-0">
            <TabsList className="flex-col h-auto w-full justify-start bg-transparent p-0 space-y-1">
              <TabsTrigger 
                value="overview" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <LayoutDashboard className="h-4 w-4 mr-2" />
                Overview
              </TabsTrigger>
              <TabsTrigger 
                value="users" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <Users className="h-4 w-4 mr-2" />
                Users
              </TabsTrigger>
              <TabsTrigger 
                value="invitations" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Invitations
              </TabsTrigger>
              <TabsTrigger 
                value="settings" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </TabsTrigger>
              <TabsTrigger 
                value="api-keys" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <Key className="h-4 w-4 mr-2" />
                API Keys
              </TabsTrigger>
              <TabsTrigger 
                value="audit-logs" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <FileText className="h-4 w-4 mr-2" />
                Audit Logs
              </TabsTrigger>
              <TabsTrigger 
                value="plans" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Subscription Plans
              </TabsTrigger>
              <TabsTrigger 
                value="packages" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <Package className="h-4 w-4 mr-2" />
                Credit Packages
              </TabsTrigger>
              <TabsTrigger 
                value="revenue" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <DollarSign className="h-4 w-4 mr-2" />
                Revenue
              </TabsTrigger>
              <TabsTrigger 
                value="test-mode" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <FlaskConical className="h-4 w-4 mr-2" />
                Test Mode
              </TabsTrigger>
              <TabsTrigger 
                value="sync" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Sync Status
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 space-y-6">
            
            {/* Overview Tab */}
            <TabsContent value="overview">
              <div className="space-y-6">
                {/* Admin Status Banner */}
                <Card className="border-2 border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/10">
                  <CardContent className="flex items-center gap-3 py-4">
                    <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/30">
                      <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="font-medium text-blue-900 dark:text-blue-100">
                        Admin Access Active
                      </p>
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        Welcome back, {permissions.userRole?.email}. You have full administrative privileges.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Stats Cards */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.totalUsers}</div>
                      <p className="text-xs text-muted-foreground">
                        System-wide registered users
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Active Users</CardTitle>
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.activeUsers}</div>
                      <p className="text-xs text-muted-foreground">
                        Currently active accounts
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Pending Invites</CardTitle>
                      <Clock className="h-4 w-4 text-yellow-600" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.pendingInvitations}</div>
                      <p className="text-xs text-muted-foreground">
                        Awaiting user acceptance
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Admin Users</CardTitle>
                      <Shield className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.adminUsers}</div>
                      <p className="text-xs text-muted-foreground">
                        Users with admin privileges
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Recent Activity */}
                <Card>
                  <CardHeader>
                    <CardTitle>Recent Activity</CardTitle>
                    <CardDescription>
                      Latest administrative actions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {recentActivity.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No recent activity to show
                        </p>
                      ) : (
                        recentActivity.slice(0, 5).map((log) => (
                          <div key={log.id} className="flex items-center gap-3">
                            <div className={`rounded-full p-1.5 ${getActionColor(log.action)}`}>
                              {getActionIcon(log.action)}
                            </div>
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-medium">
                                  {log.action.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                </p>
                                <span className="text-xs text-muted-foreground">
                                  {formatRelativeTime(log.created_at)}
                                </span>
                              </div>
                              {log.target_email && (
                                <p className="text-xs text-muted-foreground">
                                  Target: {log.target_email}
                                </p>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Users Tab */}
            <TabsContent value="users">
              <UserManagement />
            </TabsContent>

            {/* Invitations Tab */}
            <TabsContent value="invitations">
              <InviteUser />
            </TabsContent>

            {/* Settings Tab */}
            <TabsContent value="settings">
              <AdminSettings />
            </TabsContent>

            {/* API Keys Tab */}
            <TabsContent value="api-keys">
              <AdminApiKeys />
            </TabsContent>

            {/* Audit Logs Tab */}
            <TabsContent value="audit-logs">
              <Card>
                <CardHeader>
                  <CardTitle>Audit Logs</CardTitle>
                  <CardDescription>
                    Complete history of administrative actions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {allAuditLogs.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        No audit logs to show
                      </p>
                    ) : (
                      <>
                        <div className="space-y-3 max-h-[600px] overflow-y-auto">
                          {allAuditLogs.map((log) => (
                            <div key={log.id} className="flex items-center gap-3 pb-3 border-b last:border-0">
                              <div className={`rounded-full p-1.5 ${getActionColor(log.action)}`}>
                                {getActionIcon(log.action)}
                              </div>
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-medium">
                                    {log.action.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                  </p>
                                  <span className="text-xs text-muted-foreground">
                                    {formatRelativeTime(log.created_at)}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground space-y-0.5">
                                  {log.admin_email && (
                                    <p>Admin: {log.admin_email}</p>
                                  )}
                                  {log.target_email && (
                                    <p>Target: {log.target_email}</p>
                                  )}
                                  {log.details && (
                                    <p>Details: {JSON.stringify(log.details)}</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="pt-4 border-t">
                          <p className="text-xs text-muted-foreground text-center">
                            Showing {allAuditLogs.length} most recent entries
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Plans Tab */}
            <TabsContent value="plans">
              <StripePlanManagement />
            </TabsContent>

            {/* Packages Tab */}
            <TabsContent value="packages">
              <CreditPackageManager />
            </TabsContent>

            {/* Revenue Tab */}
            <TabsContent value="revenue">
              <AdminRevenueDashboard />
            </TabsContent>

            {/* Test Mode Tab */}
            <TabsContent value="test-mode">
              <TestModeSettings />
            </TabsContent>

            {/* Sync Status Tab */}
            <TabsContent value="sync">
              <SyncStatusMonitor />
            </TabsContent>

          </div>
        </Tabs>
      </div>
    </PageLayout>
  )
}

export default AdminDashboard