import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Loader2 } from 'lucide-react'

export default function AuthCallback() {
  const navigate = useNavigate()
  
  useEffect(() => {
    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        // Password recovery flow - redirect to update password
        navigate('/auth/update-password')
      } else if (event === 'SIGNED_IN' && session) {
        // Normal sign in - redirect to dashboard
        navigate('/dashboard')
      } else if (!session) {
        // No session - redirect to sign in
        navigate('/sign-in')
      }
    })
    
    // Also check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // Check if the URL still has the type parameter (unlikely but possible)
        const hashParams = new URLSearchParams(window.location.hash.substring(1))
        const type = hashParams.get('type')
        
        if (type === 'recovery') {
          navigate('/auth/update-password')
        } else {
          navigate('/dashboard')
        }
      }
    })
    
    return () => {
      subscription.unsubscribe()
    }
  }, [navigate])

  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin" />
      <span className="ml-2">Authenticating...</span>
    </div>
  )
}