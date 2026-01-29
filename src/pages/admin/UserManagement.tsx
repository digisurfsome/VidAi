import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Users, 
  UserPlus, 
  Search, 
  Filter,
  MoreHorizontal,
  Edit,
  Trash2,
  Mail,
  CheckCircle,
  Clock,
  AlertTriangle,
  Loader2,
  ArrowLeft
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { getAllUsers, UserRole, UserMetadata, updateUserRole, deleteUser, cancelInvitation } from '@/lib/admin'
import { toast } from 'sonner'

type UserWithMetadata = UserRole & { metadata?: UserMetadata }

const UserManagement = () => {
  const { user } = useAuth()
  const [users, setUsers] = useState<UserWithMetadata[]>([])
  const [filteredUsers, setFilteredUsers] = useState<UserWithMetadata[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  
  // Dialog states
  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; user?: UserWithMetadata }>({ isOpen: false })
  const [cancelInviteDialog, setCancelInviteDialog] = useState<{ isOpen: boolean; user?: UserWithMetadata }>({ isOpen: false })

  useEffect(() => {
    loadUsers()
  }, [])

  useEffect(() => {
    // Filter users based on search and filters
    let filtered = users

    if (searchTerm) {
      filtered = filtered.filter(user => 
        user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (user.metadata?.notes && user.metadata.notes.toLowerCase().includes(searchTerm.toLowerCase()))
      )
    }

    if (roleFilter !== 'all') {
      filtered = filtered.filter(user => user.role === roleFilter)
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(user => user.status === statusFilter)
    }

    setFilteredUsers(filtered)
  }, [users, searchTerm, roleFilter, statusFilter])

  const loadUsers = async () => {
    try {
      setIsLoading(true)
      const { users: userData } = await getAllUsers()
      setUsers(userData)
    } catch (error) {
      console.error('Error loading users:', error)
      toast.error('Failed to load users')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRoleChange = async (targetUserId: string, newRole: 'admin' | 'user' | 'moderator') => {
    if (!user?.id) return

    try {
      const result = await updateUserRole(user.id, targetUserId, { role: newRole })
      
      if (result.success) {
        toast.success(`User role updated to ${newRole}`)
        loadUsers() // Refresh the list
      } else {
        toast.error(result.error || 'Failed to update role')
      }
    } catch (error) {
      toast.error('Failed to update user role')
    }
  }

  const handleStatusChange = async (targetUserId: string, newStatus: 'active' | 'suspended') => {
    if (!user?.id) return

    try {
      const result = await updateUserRole(user.id, targetUserId, { status: newStatus })
      
      if (result.success) {
        toast.success(`User ${newStatus === 'active' ? 'activated' : 'suspended'}`)
        loadUsers() // Refresh the list
      } else {
        toast.error(result.error || 'Failed to update status')
      }
    } catch (error) {
      toast.error('Failed to update user status')
    }
  }

  const handleDeleteUser = async (targetUserId: string | null, email: string) => {
    if (!user?.id) return

    try {
      const result = await deleteUser(user.id, targetUserId, email)
      
      if (result.success) {
        toast.success(`User ${email} has been permanently deleted`)
        loadUsers() // Refresh the list
        setDeleteDialog({ isOpen: false }) // Close the dialog
      } else {
        toast.error(result.error || 'Failed to delete user')
      }
    } catch (error) {
      toast.error('Failed to delete user')
    }
  }

  const handleCancelInvitation = async (invitationId: string, email: string) => {
    if (!user?.id) return

    try {
      const result = await cancelInvitation(user.id, invitationId)
      
      if (result.success) {
        toast.success('Invitation cancelled')
        loadUsers() // Refresh the list
        setCancelInviteDialog({ isOpen: false }) // Close the dialog
      } else {
        toast.error(result.error || 'Failed to cancel invitation')
      }
    } catch (error) {
      toast.error('Failed to cancel invitation')
    }
  }

  const getRoleBadge = (role: string) => {
    const variants = {
      admin: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20',
      moderator: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/20',
      user: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/20'
    }
    
    return <Badge className={variants[role as keyof typeof variants]}>{role}</Badge>
  }

  const getStatusBadge = (status: string) => {
    const config = {
      active: { 
        icon: <CheckCircle className="h-3 w-3" />,
        className: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/20'
      },
      invited: { 
        icon: <Clock className="h-3 w-3" />,
        className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/20'
      },
      suspended: { 
        icon: <AlertTriangle className="h-3 w-3" />,
        className: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20'
      },
      deleted: { 
        icon: <Trash2 className="h-3 w-3" />,
        className: 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900/20'
      },
      canceled: {
        icon: <Trash2 className="h-3 w-3" />,
        className: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20'
      }
    }
    
    const statusConfig = config[status as keyof typeof config] || config.active
    
    return (
      <Badge className={`${statusConfig.className} flex items-center gap-1`}>
        {statusConfig.icon}
        {status}
      </Badge>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading users...</span>
      </div>
    )
  }

  return (
    <>
    <div className="space-y-6">

        {/* Filters and Search */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Users ({filteredUsers.length})
            </CardTitle>
            <CardDescription>
              Manage user accounts, roles, and permissions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 mb-6">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search users by email or notes..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-40">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="moderator">Moderator</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="invited">Invited</SelectItem>
                  <SelectItem value="canceled">Canceled</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="deleted">Deleted</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Users Table */}
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No users found matching your criteria
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((userData) => (
                      <TableRow key={userData.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col">
                              <span className="font-medium">{userData.email}</span>
                              {userData.status === 'invited' && userData.invitation_id && (
                                <span className="text-xs text-muted-foreground">
                                  Invitation ID: {userData.invitation_id.slice(0, 12)}...
                                </span>
                              )}
                            </div>
                            {userData.status === 'invited' && (
                              <Mail className="h-4 w-4 text-yellow-600" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{getRoleBadge(userData.role)}</TableCell>
                        <TableCell>{getStatusBadge(userData.status || 'active')}</TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {new Date(userData.created_at).toLocaleDateString()}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {userData.metadata?.notes || userData.created_by ? 
                              (userData.metadata?.notes || `Created by: ${userData.created_by}`) : 
                              '-'
                            }
                          </span>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              
                              {userData.status === 'invited' ? (
                                <DropdownMenuItem
                                  className="text-red-600"
                                  onClick={() => setCancelInviteDialog({ isOpen: true, user: userData })}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Cancel Invitation
                                </DropdownMenuItem>
                              ) : (
                                <>
                                  {/* Role Changes */}
                                  {userData.role !== 'user' && (
                                    <DropdownMenuItem
                                      onClick={() => userData.user_id && handleRoleChange(userData.user_id, 'user')}
                                    >
                                      Make User
                                    </DropdownMenuItem>
                                  )}
                                  {userData.role !== 'moderator' && (
                                    <DropdownMenuItem
                                      onClick={() => userData.user_id && handleRoleChange(userData.user_id, 'moderator')}
                                    >
                                      Make Moderator
                                    </DropdownMenuItem>
                                  )}
                                  {userData.role !== 'admin' && userData.user_id !== user?.id && (
                                    <DropdownMenuItem
                                      onClick={() => userData.user_id && handleRoleChange(userData.user_id, 'admin')}
                                    >
                                      Make Admin
                                    </DropdownMenuItem>
                                  )}
                                  
                                  <DropdownMenuSeparator />
                                  
                                  {/* Status Changes */}
                                  {userData.status === 'suspended' ? (
                                    <DropdownMenuItem
                                      onClick={() => userData.user_id && handleStatusChange(userData.user_id, 'active')}
                                    >
                                      <CheckCircle className="h-4 w-4 mr-2" />
                                      Activate
                                    </DropdownMenuItem>
                                  ) : (
                                    userData.user_id !== user?.id && (
                                      <DropdownMenuItem
                                        onClick={() => userData.user_id && handleStatusChange(userData.user_id, 'suspended')}
                                      >
                                        <AlertTriangle className="h-4 w-4 mr-2" />
                                        Suspend
                                      </DropdownMenuItem>
                                    )
                                  )}
                                  
                                  {userData.user_id !== user?.id && (
                                    <DropdownMenuItem
                                      className="text-red-600"
                                      onClick={() => setDeleteDialog({ isOpen: true, user: userData })}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete User
                                    </DropdownMenuItem>
                                  )}
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
    </div>

    {/* Delete User Confirmation Dialog */}
    <AlertDialog open={deleteDialog.isOpen} onOpenChange={(open) => setDeleteDialog({ isOpen: open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">⚠️ Permanently Delete User</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                You are about to permanently delete user: <strong className="text-foreground">{deleteDialog.user?.email}</strong>
              </p>
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md p-3 space-y-2">
                <p className="font-semibold text-red-800 dark:text-red-400">This will immediately and permanently:</p>
                <ul className="list-disc list-inside text-sm space-y-1 text-red-700 dark:text-red-300">
                  <li>Delete the user's authentication account</li>
                  <li>Remove all user profile information</li>
                  <li>Delete all API keys and settings</li>
                  <li>Remove all user metadata and preferences</li>
                  <li>Prevent the user from signing in</li>
                </ul>
              </div>
              <p className="font-semibold">
                ⚠️ This action cannot be undone. All user data will be permanently lost.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (deleteDialog.user) {
                  handleDeleteUser(deleteDialog.user.user_id || null, deleteDialog.user.email)
                }
              }}
            >
              Permanently Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Invitation Confirmation Dialog */}
      <AlertDialog open={cancelInviteDialog.isOpen} onOpenChange={(open) => setCancelInviteDialog({ isOpen: open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel the invitation for <strong>{cancelInviteDialog.user?.email}</strong>?
              This will remove the pending invitation and they will no longer be able to join.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (cancelInviteDialog.user?.invitation_id) {
                  handleCancelInvitation(cancelInviteDialog.user.invitation_id, cancelInviteDialog.user.email)
                }
              }}
            >
              Cancel Invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

export default UserManagement
