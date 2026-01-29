import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, UserPlus, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export function SignUpForm() {
  const { signUp } = useAuth()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [invitationData, setInvitationData] = useState<any>(null)
  const [checkingInvitation, setCheckingInvitation] = useState(false)

  const invitationId = searchParams.get('invitation')
  const invitedEmail = searchParams.get('email') ? decodeURIComponent(searchParams.get('email')!) : null
  const selectedPlanId = searchParams.get('plan') // Support self-service sign-up with plan

  useEffect(() => {
    // If we have an invitation ID, verify it and pre-fill the email
    if (invitationId && invitedEmail) {
      console.log('Invitation detected:', { invitationId, invitedEmail })
      setCheckingInvitation(true)
      verifyInvitation()
    }
  }, [invitationId, invitedEmail])

  const verifyInvitation = async () => {
    try {
      console.log('Starting verification for:', { 
        invitationId, 
        invitedEmail,
        invitedEmailLength: invitedEmail?.length,
        invitedEmailEncoded: encodeURIComponent(invitedEmail || '')
      })
      
      // First, let's just query by invitation ID to see what's in the database
      const { data: checkData, error: checkError } = await supabase
        .from('user_roles')
        .select('*')
        .eq('invitation_id', invitationId)
        .single()
      
      console.log('Check by invitation ID only:', { checkData, checkError })
      
      if (checkData) {
        console.log('Database email vs URL email:', {
          dbEmail: checkData.email,
          urlEmail: invitedEmail,
          match: checkData.email === invitedEmail
        })
      }
      
      const { data, error } = await supabase
        .from('user_roles')
        .select('*')
        .eq('invitation_id', invitationId)
        .eq('email', invitedEmail!)
        .eq('status', 'invited')
        .single()
      
      console.log('Query result:', { data, error })

      if (error || !data) {
        console.error('Invitation query failed:', error?.message || 'No data returned')
        toast.error('Invalid or expired invitation')
        setCheckingInvitation(false)
        return
      }

      // Check if invitation has expired
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        console.log('Invitation expired check:', {
          expires_at: data.expires_at,
          now: new Date().toISOString(),
          isExpired: new Date(data.expires_at) < new Date()
        })
        toast.error('This invitation has expired')
        setCheckingInvitation(false)
        return
      }

      console.log('Setting invitation data:', data)
      setInvitationData(data)
      setEmail(invitedEmail!)
    } catch (error) {
      console.error('Error verifying invitation:', error)
      toast.error('Failed to verify invitation')
    } finally {
      setCheckingInvitation(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      // Sign up the user
      const { error: signUpError, data } = await signUp(email, password)
      if (signUpError) throw signUpError

      // If we have an invitation, update the user_roles record
      if (invitationData && data?.user) {
        const { error: updateError } = await supabase
          .from('user_roles')
          .update({
            user_id: data.user.id,
            status: 'active',
            updated_at: new Date().toISOString()
          })
          .eq('invitation_id', invitationData.invitation_id)

        if (updateError) {
          console.error('Failed to update invitation status:', updateError)
        }
        
        // Note: user_metadata is created automatically by the handle_new_user() trigger
        // No need to manually insert it here
      }

      // If we have a selected plan, store it in localStorage for after email verification
      if (selectedPlanId && data?.user) {
        localStorage.setItem('pending_plan_id', selectedPlanId)
        localStorage.setItem('pending_user_id', data.user.id)
      }

      toast.success(
        invitationData 
          ? 'Account created! You can now sign in.' 
          : selectedPlanId
          ? 'Check your email to confirm your account! After verification, you will be redirected to complete your subscription.'
          : 'Check your email to confirm your account!'
      )
    } catch (error: any) {
      toast.error(error.message || 'Failed to sign up')
    } finally {
      setLoading(false)
    }
  }

  if (checkingInvitation) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex items-center justify-center space-x-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Verifying invitation...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Block sign-ups without valid invitation OR plan selection (self-service)
  if (!invitationId && !selectedPlanId) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invitation Required</CardTitle>
          <CardDescription>
            Sign-ups are currently by invitation only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This application requires an invitation to join. Please contact an administrator to request access.
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Link
              to="/sign-in"
              className="text-sm text-primary hover:underline"
            >
              Already have an account? Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Also block if invitation verification failed (but allow self-service with plan)
  if (!checkingInvitation && !invitationData && invitationId && !selectedPlanId) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invalid Invitation</CardTitle>
          <CardDescription>
            The invitation link appears to be invalid or expired.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This invitation may have expired or already been used. Please contact an administrator for a new invitation.
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Link
              to="/sign-in"
              className="text-sm text-primary hover:underline"
            >
              Already have an account? Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          Sign Up
        </CardTitle>
        <CardDescription>
          {invitationData 
            ? `You've been invited as ${invitationData.role}. Create your account below.`
            : selectedPlanId
            ? 'Create your account to start your subscription.'
            : 'Create your account below.'
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invitationData && (
          <Alert className="mb-4">
            <UserPlus className="h-4 w-4" />
            <AlertDescription>
              You're accepting an invitation to join with <strong>{invitationData.role}</strong> privileges.
            </AlertDescription>
          </Alert>
        )}
        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">
              Email
              {invitationData && (
                <span className="ml-2 text-xs text-muted-foreground">(locked to invitation)</span>
              )}
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => !invitationData && setEmail(e.target.value)}
              required
              disabled={!!invitationData}
              readOnly={!!invitationData}
              className={invitationData ? "bg-muted cursor-not-allowed" : ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign Up
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <div className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/sign-in" className="text-primary hover:underline">
            Sign in
          </Link>
        </div>
      </CardFooter>
    </Card>
  )
}