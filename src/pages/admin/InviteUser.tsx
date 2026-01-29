import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { UserPlus, Send, ArrowLeft, Loader2 } from 'lucide-react'
import { createUserInvitation } from '@/lib/admin'
import { toast } from 'sonner'

const inviteUserSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  role: z.enum(['admin', 'user', 'moderator'], {
    required_error: 'Please select a role'
  }),
  sendInvitation: z.boolean().default(true),
})

type InviteUserForm = z.infer<typeof inviteUserSchema>

const InviteUser = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<InviteUserForm>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: {
      email: '',
      firstName: '',
      lastName: '',
      role: 'user',
      sendInvitation: true,
    },
  })

  const onSubmit = async (data: InviteUserForm) => {
    if (!user?.id) {
      toast.error('Admin user not authenticated')
      return
    }

    setIsLoading(true)
    try {
      // Create invitation in Supabase
      const result = await createUserInvitation(user.id, {
        email: data.email,
        role: data.role,
        notes: `${data.firstName} ${data.lastName}`
      })
      
      if (result.success) {
        if (data.sendInvitation) {
          toast.success(`Invitation sent to ${data.email}!`)
        } else {
          toast.success(`User ${data.email} added to system!`)
        }
        
        // Reset form
        form.reset()
      } else {
        toast.error(result.error || 'Failed to create invitation')
      }
    } catch (error: any) {
      toast.error('An unexpected error occurred')
      console.error('Error creating user:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="max-w-2xl">

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Add New User
            </CardTitle>
            <CardDescription>
              Create a new user account by sending an invitation email or adding them directly to the system.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input placeholder="John" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Doe" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input 
                          type="email" 
                          placeholder="john.doe@example.com" 
                          {...field} 
                        />
                      </FormControl>
                      <FormDescription>
                        The user will use this email to sign in to their account.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>User Role</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="user">
                            <div className="flex flex-col">
                              <span className="font-medium">User</span>
                              <span className="text-xs text-muted-foreground">
                                Standard access to the application
                              </span>
                            </div>
                          </SelectItem>
                          <SelectItem value="moderator">
                            <div className="flex flex-col">
                              <span className="font-medium">Moderator</span>
                              <span className="text-xs text-muted-foreground">
                                Enhanced permissions for content management
                              </span>
                            </div>
                          </SelectItem>
                          <SelectItem value="admin">
                            <div className="flex flex-col">
                              <span className="font-medium">Administrator</span>
                              <span className="text-xs text-muted-foreground">
                                Full system access and user management
                              </span>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Choose the appropriate role for this user's responsibilities.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sendInvitation"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>
                          Send invitation email
                        </FormLabel>
                        <FormDescription>
                          {field.value 
                            ? "User will receive an email invitation to set up their account"
                            : "User will be created directly and can sign in immediately"
                          }
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <div className="flex gap-3">
                  <Button 
                    type="submit" 
                    disabled={isLoading}
                    className="flex-1"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    {form.watch('sendInvitation') 
                      ? (isLoading ? 'Sending Invitation...' : 'Send Invitation')
                      : (isLoading ? 'Creating User...' : 'Create User')
                    }
                  </Button>
                  
                  <Button 
                    type="button" 
                    variant="outline"
                    onClick={() => form.reset()}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
    </div>
  )
}

export default InviteUser