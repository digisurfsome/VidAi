import { createContext, useContext, useEffect, useState } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signUp: (email: string, password: string) => Promise<any>
  signIn: (email: string, password: string) => Promise<any>
  signInWithProvider: (provider: 'google' | 'github' | 'discord') => Promise<any>
  signOut: () => Promise<void>
  isAdmin: boolean
  subscription: any | null
  hasActiveSubscription: boolean
  checkSubscription: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // Initialize isAdmin from localStorage if available
  const [isAdmin, setIsAdmin] = useState(() => {
    const cached = localStorage.getItem('supabase.auth.isAdmin')
    return cached === 'true'
  })
  const [subscription, setSubscription] = useState<any | null>(null)
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      console.log('Initial session check, user:', session?.user?.email)
      setSession(session)
      setUser(session?.user ?? null)
      
      if (session?.user?.id) {
        // Check admin status without blocking
        checkAdminStatus(session.user.id)
        // Check subscription status without blocking
        checkSubscriptionStatus(session.user.id)
      } else {
        // Clear admin status if no user
        setIsAdmin(false)
        localStorage.removeItem('supabase.auth.isAdmin')
        setSubscription(null)
        setHasActiveSubscription(false)
      }
      
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event, session)
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)  // Set loading to false immediately
        
        if (event === 'SIGNED_IN') {
          // Don't await - let it run in background
          checkAdminStatus(session?.user?.id)
          checkSubscriptionStatus(session?.user?.id)
          navigate('/dashboard')
        } else if (event === 'SIGNED_OUT') {
          setIsAdmin(false)
          localStorage.removeItem('supabase.auth.isAdmin')
          setSubscription(null)
          setHasActiveSubscription(false)
          navigate('/')
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [navigate])

  const checkAdminStatus = async (userId?: string) => {
    console.log('checkAdminStatus called with userId:', userId)
    
    if (!userId) {
      console.log('No userId provided, setting isAdmin to false')
      setIsAdmin(false)
      localStorage.removeItem('supabase.auth.isAdmin')
      return
    }

    try {
      // Just query directly without timeout - the query is fast
      const { data, error } = await supabase
        .from('user_roles')
        .select('role, status')
        .eq('user_id', userId)
        .maybeSingle()  // Use maybeSingle to handle 0 or 1 records gracefully

      console.log('Admin check query result:', { 
        data, 
        error,
        dataRole: data?.role,
        dataStatus: data?.status,
        isError: !!error
      })
      
      // Check admin status in JavaScript after fetching
      const isAdminUser = !error && data?.role === 'admin' && data?.status === 'active'
      console.log('Setting isAdmin to:', isAdminUser)
      setIsAdmin(isAdminUser)
      
      // Cache the result in localStorage
      localStorage.setItem('supabase.auth.isAdmin', isAdminUser.toString())
    } catch (err) {
      console.error('Error in checkAdminStatus:', err)
      setIsAdmin(false)
      localStorage.removeItem('supabase.auth.isAdmin')
    }
  }

  const checkSubscriptionStatus = async (userId?: string) => {
    console.log('checkSubscriptionStatus called with userId:', userId)
    
    if (!userId) {
      console.log('No userId provided, setting subscription to null')
      setSubscription(null)
      setHasActiveSubscription(false)
      return
    }

    try {
      // Check for active subscription (without joining plans to avoid RLS issues)
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle()

      if (error) {
        console.error('Error checking subscription:', error)
        setSubscription(null)
        setHasActiveSubscription(false)
        return
      }

      console.log('Subscription check result:', data)
      setSubscription(data)
      setHasActiveSubscription(!!data)
    } catch (error) {
      console.error('Error checking subscription status:', error)
      setSubscription(null)
      setHasActiveSubscription(false)
    }
  }

  const checkSubscription = async () => {
    if (user?.id) {
      await checkSubscriptionStatus(user.id)
    }
  }

  const value = {
    user,
    session,
    loading,
    isAdmin,
    subscription,
    hasActiveSubscription,
    checkSubscription,
    signUp: async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      })
      return { data, error }
    },
    signIn: async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })
      
      // Prefetch admin status immediately after successful sign-in
      if (!error && data?.user) {
        checkAdminStatus(data.user.id) // Don't await
      }
      
      return { data, error }
    },
    signInWithProvider: async (provider: 'google' | 'github' | 'discord') => {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      })
      return { data, error }
    },
    signOut: async () => {
      console.log('signOut function called in AuthContext')
      
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Sign out timeout')), 5000)
      })
      
      try {
        // Race between signOut and timeout
        const result = await Promise.race([
          supabase.auth.signOut(),
          timeoutPromise
        ]) as { error: any }
        
        if (result?.error) {
          console.error('Sign out error:', result.error)
          // Even if sign out fails, clear local state
          setUser(null)
          setSession(null)
          setIsAdmin(false)
          throw result.error
        }
        
        console.log('Sign out successful')
        // Manually clear state after successful sign out
        setUser(null)
        setSession(null)
        setIsAdmin(false)
        localStorage.removeItem('supabase.auth.isAdmin')
      } catch (error) {
        console.error('Sign out failed:', error)
        // Force clear local state even on error
        setUser(null)
        setSession(null)
        setIsAdmin(false)
        // Clear local storage manually
        localStorage.removeItem('supabase.auth.token')
        localStorage.removeItem('supabase.auth.isAdmin')
        // Don't rethrow - we want to handle this gracefully
      }
    }
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}