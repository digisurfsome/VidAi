import { supabase } from '@/lib/supabase'
import { sendInvitationEmail } from '@/lib/email'

export interface UserRole {
  id: string
  user_id?: string
  invitation_id?: string
  email: string
  role: 'admin' | 'user' | 'moderator'
  permissions: Record<string, boolean>
  status: 'invited' | 'active' | 'suspended' | 'deleted' | 'cancelled'
  created_by?: string
  created_at: string
  updated_at: string
  expires_at?: string
}

export interface UserMetadata {
  id: string
  user_id: string
  status: 'active' | 'suspended' | 'deleted'
  last_login?: string
  login_count: number
  notes?: string
  tags: string[]
  created_by?: string
  created_at: string
  updated_at: string
}

export interface AdminAuditLog {
  id: string
  admin_user_id: string
  action: string
  target_user_id?: string
  target_email?: string
  details: Record<string, any>
  ip_address?: string
  user_agent?: string
  created_at: string
}

// Check if user is admin
export const isAdmin = async (userId: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single()

    if (error || !data) return false
    return data.role === 'admin'
  } catch (error) {
    console.error('Error checking admin status:', error)
    return false
  }
}

// Get user role and permissions
export const getUserRole = async (userId: string): Promise<UserRole | null> => {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error) return null
    return data as UserRole
  } catch (error) {
    console.error('Error fetching user role:', error)
    return null
  }
}

// Log admin actions
export const logAdminAction = async (
  adminUserId: string,
  action: string,
  details: {
    targetUserId?: string
    targetEmail?: string
    metadata?: Record<string, any>
    ipAddress?: string
    userAgent?: string
  } = {}
): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_user_id: adminUserId,
        action,
        target_user_id: details.targetUserId,
        target_email: details.targetEmail,
        details: details.metadata || {},
        ip_address: details.ipAddress,
        user_agent: details.userAgent
      })

    return !error
  } catch (error) {
    console.error('Error logging admin action:', error)
    return false
  }
}

// Get all users with roles and metadata
export const getAllUsers = async (): Promise<{
  users: (UserRole & { metadata?: UserMetadata })[]
  total: number
}> => {
  try {
    // Get the current user to verify they're an admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      console.error('No authenticated user')
      return { users: [], total: 0 }
    }

    // Call the admin API endpoint
    const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin
    const response = await fetch(`${baseUrl}/api/admin-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adminUserId: user.id,
        action: 'getAllUsers'
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('Error fetching users:', errorData)
      return { users: [], total: 0 }
    }

    const data = await response.json()
    return { users: data.users, total: data.total }
  } catch (error) {
    console.error('Error fetching all users:', error)
    return { users: [], total: 0 }
  }
}

// Create user invitation
export const createUserInvitation = async (
  adminUserId: string,
  userData: {
    email: string
    role: 'admin' | 'user' | 'moderator'
    notes?: string
  }
): Promise<{ success: boolean; invitationId?: string; error?: string }> => {
  try {
    // Get admin user details for the invitation email
    const { data: adminUser } = await supabase.auth.getUser()
    const adminName = adminUser?.user?.email?.split('@')[0] || 'Admin'

    // Get app settings for organization name
    const { data: appSettings } = await supabase
      .from('app_settings')
      .select('setting_value')
      .eq('setting_key', 'app_name')
      .single()
    const organizationName = appSettings?.setting_value || 'our platform'

    // Create the invitation through the admin API (uses service role to bypass RLS)
    const response = await fetch('/api/admin-users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adminUserId,
        action: 'createInvitation',
        invitationData: {
          email: userData.email,
          role: userData.role
        }
      })
    })

    const result = await response.json()

    if (!response.ok || !result.success) {
      return { success: false, error: result.error || 'Failed to create invitation' }
    }

    // Use the invitation ID returned from the API
    const invitationId = result.invitationId

    // Generate the sign-up URL with the invitation ID
    const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin
    const signUpUrl = `${baseUrl}/sign-up?invitation=${invitationId}&email=${encodeURIComponent(userData.email)}`

    // Set expiration date for email (7 days from now)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    // Send the invitation email
    const emailResult = await sendInvitationEmail(adminUserId, {
      inviteeName: userData.email.split('@')[0], // Use email prefix as name
      inviterName: adminName,
      organizationName,
      signUpUrl,
      expiresAt,
      recipientEmail: userData.email
    })

    if (!emailResult.success) {
      // If email fails, we should clean up the invitation
      await supabase
        .from('user_roles')
        .delete()
        .eq('invitation_id', invitationId)
      
      return { 
        success: false, 
        error: `Failed to send invitation email: ${emailResult.error}` 
      }
    }

    // Log the admin action
    await logAdminAction(adminUserId, 'user_invited', {
      targetEmail: userData.email,
      metadata: { 
        role: userData.role, 
        notes: userData.notes,
        invitationId,
        emailSent: true
      }
    })

    return { success: true, invitationId }
  } catch (error: any) {
    console.error('Error creating user invitation:', error)
    return { success: false, error: error.message }
  }
}

// Update user role
export const updateUserRole = async (
  adminUserId: string,
  targetUserId: string,
  updates: {
    role?: 'admin' | 'user' | 'moderator'
    status?: 'active' | 'suspended' | 'deleted'
    notes?: string
  }
): Promise<{ success: boolean; error?: string }> => {
  try {
    const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin
    const response = await fetch(`${baseUrl}/api/admin-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adminUserId,
        action: 'updateUserRole',
        targetUserId,
        updates
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      return { success: false, error: errorData.error || 'Failed to update user role' }
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error updating user role:', error)
    return { success: false, error: error.message }
  }
}

// Delete user (permanently from auth or from user_roles if no auth account)
export const deleteUser = async (
  adminUserId: string,
  targetUserId: string | null,
  targetEmail?: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin
    const response = await fetch(`${baseUrl}/api/admin-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adminUserId,
        action: 'deleteUser',
        targetUserId,
        targetEmail
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      return { success: false, error: errorData.error || 'Failed to delete user' }
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting user:', error)
    return { success: false, error: error.message }
  }
}

// Cancel invitation
export const cancelInvitation = async (
  adminUserId: string,
  invitationId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin
    const response = await fetch(`${baseUrl}/api/admin-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adminUserId,
        action: 'cancelInvitation',
        invitationId
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      return { success: false, error: errorData.error || 'Failed to cancel invitation' }
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error cancelling invitation:', error)
    return { success: false, error: error.message }
  }
}

// Get admin audit logs
export const getAuditLogs = async (
  limit: number = 50,
  offset: number = 0
): Promise<AdminAuditLog[]> => {
  try {
    const { data, error } = await supabase
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching audit logs:', error)
      return []
    }

    return data as AdminAuditLog[]
  } catch (error) {
    console.error('Error fetching audit logs:', error)
    return []
  }
}