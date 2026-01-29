import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Debug logging to see what env vars are available
console.log('ENV check - Service key exists:', !!supabaseServiceKey)
console.log('ENV check - Service key prefix:', supabaseServiceKey ? supabaseServiceKey.substring(0, 20) + '...' : 'not set')

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase configuration. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.")
}

// Client with anon key for checking admin permissions (subject to RLS)
const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Admin client with service role key to bypass RLS
const supabaseAdmin = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

interface AdminUsersRequest {
  adminUserId: string
  action: 'getAllUsers' | 'updateUserRole' | 'deleteUser' | 'cancelInvitation' | 'createInvitation'
  targetUserId?: string
  invitationId?: string
  invitationData?: {
    email: string
    role: 'admin' | 'user' | 'moderator'
  }
  updates?: {
    role?: 'admin' | 'user' | 'moderator'
    status?: 'active' | 'suspended' | 'deleted' | 'cancelled'
    notes?: string
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Enable CORS for frontend
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { adminUserId, action, targetUserId, invitationId, invitationData, updates } = req.body as AdminUsersRequest

    if (!adminUserId || !action) {
      return res.status(400).json({ error: 'Missing required fields: adminUserId and action' })
    }

    // Check if service role key is available first
    if (!supabaseAdmin) {
      console.error('Service role key not available in environment')
      return res.status(500).json({ error: 'Service role key not configured. Please set SUPABASE_SERVICE_ROLE_KEY environment variable.' })
    }

    // Verify admin permissions using service role key to bypass RLS
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role, status')
      .eq('user_id', adminUserId)
      .single()

    if (roleError) {
      console.error('Admin check error:', roleError)
      console.error('Using service role?', !!supabaseAdmin)
      console.error('Service key length:', supabaseServiceKey?.length)
      return res.status(403).json({ error: 'Admin access required - database error' })
    }

    if (!roleData || roleData.role !== 'admin' || roleData.status !== 'active') {
      console.log('Admin check failed:', { roleData, adminUserId })
      return res.status(403).json({ error: 'Admin access required - insufficient permissions' })
    }


    switch (action) {
      case 'getAllUsers': {
        // Get all user roles using service role key to bypass RLS
        const { data: roles, error: rolesError } = await supabaseAdmin
          .from('user_roles')
          .select('*')
          .order('created_at', { ascending: false })

        if (rolesError) {
          console.error('Error fetching users:', rolesError)
          return res.status(500).json({ error: 'Failed to fetch users' })
        }

        // Get metadata for users who have user_id (not just invited)
        const userIds = (roles || []).filter(r => r.user_id).map(r => r.user_id)
        let metadata: any[] = []
        
        if (userIds.length > 0) {
          const { data: metadataData } = await supabaseAdmin
            .from('user_metadata')
            .select('*')
            .in('user_id', userIds)
          
          metadata = metadataData || []
        }

        // Combine roles with metadata
        const users = (roles || []).map(role => {
          const userMetadata = role.user_id 
            ? metadata.find(m => m.user_id === role.user_id) 
            : null
          
          return {
            ...role,
            metadata: userMetadata || null
          }
        })

        // Log admin action
        await supabaseAdmin
          .from('admin_audit_log')
          .insert({
            admin_user_id: adminUserId,
            action: 'view_all_users',
            details: { count: users.length }
          })

        return res.status(200).json({ 
          success: true, 
          users,
          total: users.length 
        })
      }

      case 'updateUserRole': {
        if (!targetUserId || !updates) {
          return res.status(400).json({ error: 'Missing targetUserId or updates' })
        }

        const { error } = await supabaseAdmin
          .from('user_roles')
          .update({
            ...updates,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', targetUserId)

        if (error) {
          return res.status(500).json({ error: error.message })
        }

        // Log the admin action
        await supabaseAdmin
          .from('admin_audit_log')
          .insert({
            admin_user_id: adminUserId,
            action: 'user_updated',
            target_user_id: targetUserId,
            details: updates
          })

        return res.status(200).json({ success: true })
      }

      case 'deleteUser': {
        // targetUserId might be null for invitations that were never accepted
        // In this case, we need to delete by email from user_roles table
        
        if (!targetUserId) {
          // This is an invitation or user without auth account
          // Delete directly from user_roles table
          const { targetEmail } = req.body
          
          if (!targetEmail) {
            return res.status(400).json({ error: 'Missing targetUserId and targetEmail' })
          }

          // Delete from user_roles table
          const { error: deleteError } = await supabaseAdmin
            .from('user_roles')
            .delete()
            .eq('email', targetEmail)

          if (deleteError) {
            console.error('Failed to delete user record:', deleteError)
            return res.status(500).json({ error: `Failed to delete user: ${deleteError.message}` })
          }

          // Log the admin action
          await supabaseAdmin
            .from('admin_audit_log')
            .insert({
              admin_user_id: adminUserId,
              action: 'user_record_deleted',
              details: { 
                email: targetEmail,
                permanently_deleted: true,
                deleted_at: new Date().toISOString()
              }
            })

          return res.status(200).json({ success: true })
        }

        // User has an auth account - delete from Supabase Auth
        // This will CASCADE DELETE all related records in:
        // - profiles table
        // - user_roles table  
        // - user_metadata table
        // - user_api_keys table
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId)

        if (authError) {
          console.error('Failed to delete user from auth:', authError)
          return res.status(500).json({ error: `Failed to delete user: ${authError.message}` })
        }

        // Log the admin action
        // Note: The user is already deleted, but we preserve the audit trail
        await supabaseAdmin
          .from('admin_audit_log')
          .insert({
            admin_user_id: adminUserId,
            action: 'user_permanently_deleted',
            target_user_id: targetUserId,
            details: { 
              permanently_deleted: true,
              deleted_at: new Date().toISOString()
            }
          })

        return res.status(200).json({ success: true })
      }

      case 'cancelInvitation': {
        if (!invitationId) {
          return res.status(400).json({ error: 'Missing invitationId' })
        }

        // Update invitation status to cancelled
        const { error } = await supabaseAdmin
          .from('user_roles')
          .update({ 
            status: 'cancelled',
            updated_at: new Date().toISOString()
          })
          .eq('invitation_id', invitationId)

        if (error) {
          return res.status(500).json({ error: error.message })
        }

        // Log the admin action
        await supabaseAdmin
          .from('admin_audit_log')
          .insert({
            admin_user_id: adminUserId,
            action: 'invitation_cancelled',
            details: { invitationId }
          })

        return res.status(200).json({ success: true })
      }

      case 'createInvitation': {
        if (!invitationData?.email || !invitationData?.role) {
          return res.status(400).json({ error: 'Missing invitation data' })
        }

        // Generate a UUID for the invitation
        const invitationId = crypto.randomUUID()
        
        // Set expiration to 7 days from now
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + 7)

        // Create the invitation record using service role key to bypass RLS
        const { data, error } = await supabaseAdmin
          .from('user_roles')
          .insert({
            invitation_id: invitationId,
            email: invitationData.email,
            role: invitationData.role,
            status: 'invited',
            created_by: adminUserId,
            expires_at: expiresAt.toISOString(),
            invitation_sent_at: new Date().toISOString()
          })
          .select()
          .single()

        if (error) {
          console.error('Failed to create invitation:', error)
          return res.status(500).json({ error: error.message })
        }

        // Log the admin action (admin_email can be looked up via admin_user_id if needed)
        await supabaseAdmin
          .from('admin_audit_log')
          .insert({
            admin_user_id: adminUserId,
            admin_email: '', // Can be populated via join when displaying logs
            action: 'user_invited',
            target_email: invitationData.email,
            details: { 
              role: invitationData.role,
              invitationId,
              expiresAt: expiresAt.toISOString()
            }
          })

        return res.status(200).json({ 
          success: true, 
          invitationId,
          data 
        })
      }

      default:
        return res.status(400).json({ error: 'Invalid action' })
    }
  } catch (error) {
    console.error('Admin users API error:', error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    })
  }
}