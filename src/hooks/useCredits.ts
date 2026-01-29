import { useState, useCallback, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getCreditBalance } from '@/lib/stripe'
import {
  VideoModel,
  VIDEO_GENERATION_COSTS,
  checkCredits,
  deductCredits,
  refundCredits,
  getCreditInfo,
  showInsufficientCreditsNotification,
  showLowCreditWarning
} from '@/lib/credits'

interface UseCreditsReturn {
  balance: number
  loading: boolean
  error: string | null
  checkSufficientCredits: (model?: VideoModel) => Promise<boolean>
  deductForGeneration: (model?: VideoModel, description?: string) => Promise<boolean>
  refundForFailure: (amount: number, reason?: string) => Promise<boolean>
  refreshBalance: () => Promise<void>
  getCost: (model?: VideoModel) => number
  canAfford: (model?: VideoModel) => boolean
  transactions: any[]
}

export function useCredits(): UseCreditsReturn {
  const { user } = useAuth()
  const [balance, setBalance] = useState(0)
  const [transactions, setTransactions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load initial balance
  useEffect(() => {
    if (user) {
      refreshBalance()
    }
  }, [user])

  // Refresh balance and transactions
  const refreshBalance = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError(null)

    try {
      // First try to get from our credit info function
      const creditInfo = await getCreditInfo(user.id)
      
      if (creditInfo) {
        setBalance(creditInfo.balance)
        setTransactions(creditInfo.transactions)
      } else {
        // Fallback to stripe function
        const data = await getCreditBalance()
        if (data && !data.error) {
          setBalance(data.balance)
        }
      }

      // Show warning if low balance
      if (balance < 100 && balance > 0) {
        showLowCreditWarning(balance)
      }
    } catch (err: any) {
      console.error('Error refreshing balance:', err)
      setError(err.message || 'Failed to load credit balance')
    } finally {
      setLoading(false)
    }
  }, [user, balance])

  // Check if user has sufficient credits
  const checkSufficientCredits = useCallback(async (
    model: VideoModel = 'default'
  ): Promise<boolean> => {
    if (!user) return false

    const hasCredits = await checkCredits(user.id, model)
    
    if (!hasCredits) {
      const cost = VIDEO_GENERATION_COSTS[model] || VIDEO_GENERATION_COSTS.default
      showInsufficientCreditsNotification(cost, balance)
    }

    return hasCredits
  }, [user, balance])

  // Deduct credits for video generation
  const deductForGeneration = useCallback(async (
    model: VideoModel = 'default',
    description?: string
  ): Promise<boolean> => {
    if (!user) return false

    const result = await deductCredits(user.id, model, description)

    if (result.success) {
      if (result.newBalance !== undefined) {
        setBalance(result.newBalance)
        
        // Show warning if balance is now low
        if (result.newBalance < 100) {
          showLowCreditWarning(result.newBalance)
        }
      }
      return true
    } else {
      if (result.insufficientCredits) {
        const cost = VIDEO_GENERATION_COSTS[model] || VIDEO_GENERATION_COSTS.default
        showInsufficientCreditsNotification(cost, balance)
      }
      setError(result.error || 'Failed to deduct credits')
      return false
    }
  }, [user, balance])

  // Refund credits for failed generation
  const refundForFailure = useCallback(async (
    amount: number,
    reason: string = 'Generation failed'
  ): Promise<boolean> => {
    if (!user) return false

    const success = await refundCredits(user.id, amount, reason)
    
    if (success) {
      await refreshBalance()
    }

    return success
  }, [user, refreshBalance])

  // Get cost for a model
  const getCost = useCallback((model: VideoModel = 'default'): number => {
    return VIDEO_GENERATION_COSTS[model] || VIDEO_GENERATION_COSTS.default
  }, [])

  // Check if user can afford a model
  const canAfford = useCallback((model: VideoModel = 'default'): boolean => {
    const cost = VIDEO_GENERATION_COSTS[model] || VIDEO_GENERATION_COSTS.default
    return balance >= cost
  }, [balance])

  return {
    balance,
    loading,
    error,
    checkSufficientCredits,
    deductForGeneration,
    refundForFailure,
    refreshBalance,
    getCost,
    canAfford,
    transactions
  }
}