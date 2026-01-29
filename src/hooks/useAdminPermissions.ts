import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

interface UserRole {
  id: string
  user_id: string
  email: string
  role: 'admin' | 'user' | 'moderator'
  status: 'active' | 'inactive' | 'invited'
}

interface AdminPermissions {
  isAdmin: boolean
  isLoading: boolean
  userRole: UserRole | null
  canManageUsers: boolean
  canImpersonate: boolean
  canViewAuditLogs: boolean
  canManageRoles: boolean
}

export const useAdminPermissions = (): AdminPermissions => {
  const { user, loading: authLoading, isAdmin } = useAuth()
  const [userRole, setUserRole] = useState<UserRole | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchUserRole = async () => {
      if (authLoading) return
      
      if (!user) {
        setUserRole(null)
        setIsLoading(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('*')
          .eq('user_id', user.id)
          .single()

        if (error) throw error

        setUserRole(data)
        setIsLoading(false)
      } catch (error) {
        console.error('Error fetching user role:', error)
        setUserRole(null)
        setIsLoading(false)
      }
    }

    fetchUserRole()
  }, [user, authLoading])

  // Use isAdmin from AuthContext as the source of truth
  // Calculate other permissions based on the fetched userRole
  const permissions = {
    isAdmin: isAdmin, // Use the isAdmin from AuthContext
    isLoading: authLoading || isLoading,
    userRole: userRole,
    canManageUsers: isAdmin,
    canImpersonate: isAdmin,
    canViewAuditLogs: isAdmin || userRole?.role === 'moderator',
    canManageRoles: isAdmin
  }

  return permissions
}