import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { getCreditBalance } from '@/lib/stripe'
import { toast } from 'sonner'

interface CreditData {
  balance: number
  lifetime_earned: number
  lifetime_spent: number
  last_refill_at?: string
  expires_at?: string
  is_test?: boolean
  sources?: {
    subscription?: {
      active: boolean
      credits_per_period: number
      plan_name: string
      next_refill_date: string
      refill_due: boolean
    }
    recent_transactions?: Array<{
      type: string
      amount: number
      description: string
      created_at: string
    }>
  }
  usage_stats?: {
    efficiency_percent: number
    remaining_percent: number
  }
}

interface CreditContextType {
  credits: CreditData | null
  loading: boolean
  error: string | null
  refreshCredits: () => Promise<void>
  deductCredits: (amount: number, description?: string) => Promise<boolean>
  addCredits: (amount: number, description?: string) => Promise<boolean>
  canGenerate: (requiredCredits?: number) => boolean
}

const CreditContext = createContext<CreditContextType | undefined>(undefined)

interface CreditProviderProps {
  children: ReactNode
}

export function CreditProvider({ children }: CreditProviderProps) {
  const { user } = useAuth()
  const [credits, setCredits] = useState<CreditData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load credit balance
  const refreshCredits = useCallback(async () => {
    if (!user) {
      setCredits(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await getCreditBalance()
      setCredits(data)
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to load credit balance'
      setError(errorMessage)
      console.error('Error loading credit balance:', err)
      
      // Set fallback data to prevent UI breaking
      setCredits({
        balance: 0,
        lifetime_earned: 0,
        lifetime_spent: 0
      })
    } finally {
      setLoading(false)
    }
  }, [user])

  // Deduct credits (for video generation)
  const deductCredits = useCallback(async (amount: number, description = 'Video generation'): Promise<boolean> => {
    if (!user || !credits || credits.balance < amount) {
      return false
    }

    try {
      const response = await fetch('/api/credits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getAuthToken()}`
        },
        credentials: 'include',
        body: JSON.stringify({
          action: 'deduct',
          amount,
          description
        })
      })

      if (!response.ok) {
        throw new Error('Failed to deduct credits')
      }

      // Optimistic update
      setCredits(prev => prev ? {
        ...prev,
        balance: Math.max(0, prev.balance - amount),
        lifetime_spent: prev.lifetime_spent + amount
      } : null)

      // Refresh full data in background
      setTimeout(() => refreshCredits(), 1000)

      return true
    } catch (err) {
      console.error('Error deducting credits:', err)
      toast.error('Failed to deduct credits')
      return false
    }
  }, [user, credits, refreshCredits])

  // Add credits (for purchases/bonuses)
  const addCredits = useCallback(async (amount: number, description = 'Credit addition'): Promise<boolean> => {
    if (!user) {
      return false
    }

    try {
      const response = await fetch('/api/credits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getAuthToken()}`
        },
        credentials: 'include',
        body: JSON.stringify({
          action: 'add',
          amount,
          description
        })
      })

      if (!response.ok) {
        throw new Error('Failed to add credits')
      }

      // Optimistic update
      setCredits(prev => prev ? {
        ...prev,
        balance: prev.balance + amount,
        lifetime_earned: prev.lifetime_earned + amount
      } : null)

      // Refresh full data in background
      setTimeout(() => refreshCredits(), 1000)

      return true
    } catch (err) {
      console.error('Error adding credits:', err)
      toast.error('Failed to add credits')
      return false
    }
  }, [user, refreshCredits])

  // Check if user can generate (has sufficient credits)
  const canGenerate = useCallback((requiredCredits = 1): boolean => {
    return credits ? credits.balance >= requiredCredits : false
  }, [credits])

  // Helper function to get auth token
  const getAuthToken = async (): Promise<string> => {
    const { supabase } = await import('@/lib/supabase')
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || ''
  }

  // Load credits when user changes
  useEffect(() => {
    if (user) {
      refreshCredits()
    } else {
      setCredits(null)
      setLoading(false)
      setError(null)
    }
  }, [user, refreshCredits])

  // Auto-refresh credits periodically (every 5 minutes)
  useEffect(() => {
    if (!user) return

    const interval = setInterval(() => {
      refreshCredits()
    }, 5 * 60 * 1000) // 5 minutes

    return () => clearInterval(interval)
  }, [user, refreshCredits])

  // Listen for storage events (cross-tab updates)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'credit_update' && e.newValue) {
        refreshCredits()
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [refreshCredits])

  const value: CreditContextType = {
    credits,
    loading,
    error,
    refreshCredits,
    deductCredits,
    addCredits,
    canGenerate
  }

  return (
    <CreditContext.Provider value={value}>
      {children}
    </CreditContext.Provider>
  )
}

export function useCredits(): CreditContextType {
  const context = useContext(CreditContext)
  if (context === undefined) {
    throw new Error('useCredits must be used within a CreditProvider')
  }
  return context
}

// Utility function to trigger cross-tab credit updates
export function triggerCreditUpdate() {
  localStorage.setItem('credit_update', Date.now().toString())
  localStorage.removeItem('credit_update')
}