import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdminPermissions } from '@/hooks/useAdminPermissions'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, Shield, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AdminRouteProps {
  children: ReactNode
  requirePermission?: 'admin' | 'moderator' | 'canManageUsers' | 'canImpersonate' | 'canViewAuditLogs'
  fallback?: ReactNode
}

const AdminRoute = ({ 
  children, 
  requirePermission = 'admin',
  fallback 
}: AdminRouteProps) => {
  const permissions = useAdminPermissions()

  // Show loading state while checking permissions
  if (permissions.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mb-4" />
            <p className="text-lg font-medium">Checking permissions...</p>
            <p className="text-sm text-muted-foreground">Please wait while we verify your access.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Check specific permission
  const hasPermission = () => {
    switch (requirePermission) {
      case 'admin':
        return permissions.isAdmin
      case 'moderator':
        return permissions.userRole?.role === 'admin' || permissions.userRole?.role === 'moderator'
      case 'canManageUsers':
        return permissions.canManageUsers
      case 'canImpersonate':
        return permissions.canImpersonate
      case 'canViewAuditLogs':
        return permissions.canViewAuditLogs
      default:
        return permissions.isAdmin
    }
  }

  // If user doesn't have permission, show access denied or fallback
  if (!hasPermission()) {
    if (fallback) {
      return <>{fallback}</>
    }

    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="rounded-full bg-red-100 p-3 mb-4 dark:bg-red-900/20">
              <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-sm text-muted-foreground text-center mb-6">
              You don't have permission to access this area. Admin privileges are required.
            </p>
            <Button 
              onClick={() => window.history.back()}
              variant="outline"
              className="w-full"
            >
              <Shield className="h-4 w-4 mr-2" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // If user has permission, render the protected content
  return <>{children}</>
}

export default AdminRoute