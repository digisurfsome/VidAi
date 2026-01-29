import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

// Credit costs per video generation model
export const VIDEO_GENERATION_COSTS = {
  // fal.ai models - all cost 1 credit per generation
  'fal-ai/minimax-video': 1,
  'fal-ai/minimax-video/image-to-video': 1,
  'fal-ai/wan-t2v': 1,
  
  // Legacy model mappings (for backward compatibility)
  'basic-sd': 1,
  'basic-hd': 1,
  'pro-sd': 1,
  'pro-hd': 1,
  'pro-4k': 1,
  'premium-sd': 1,
  'premium-hd': 1,
  'premium-4k': 1,
  
  // Default cost if model not specified
  'default': 1
} as const

export type VideoModel = keyof typeof VIDEO_GENERATION_COSTS

export interface CreditDeductionResult {
  success: boolean
  newBalance?: number
  error?: string
  insufficientCredits?: boolean
}

/**
 * Get the credit cost for a video generation model
 */
export function getVideoGenerationCost(model?: string): number {
  if (!model) return VIDEO_GENERATION_COSTS.default
  
  // Check if model is in our cost mapping
  const modelKey = model as VideoModel
  if (modelKey in VIDEO_GENERATION_COSTS) {
    return VIDEO_GENERATION_COSTS[modelKey]
  }
  
  // Default to 1 credit for any unknown model
  return VIDEO_GENERATION_COSTS.default
}

/**
 * Check if user has enough credits for a video generation
 */
export async function checkCredits(userId: string, model: VideoModel = 'default'): Promise<boolean> {
  try {
    const cost = VIDEO_GENERATION_COSTS[model] || VIDEO_GENERATION_COSTS.default
    
    // Get auth token
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      console.error('No auth token available')
      return false
    }
    
    // Use API endpoint instead of direct query (bypasses RLS)
    const response = await fetch('/api/credits', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (!response.ok) {
      console.error('Error fetching credits:', response.statusText)
      return false
    }
    
    const data = await response.json()
    return data.balance >= cost
  } catch (error) {
    console.error('Error in checkCredits:', error)
    return false
  }
}

/**
 * Deduct credits for video generation
 */
export async function deductCredits(
  userId: string, 
  model: VideoModel = 'default',
  description?: string
): Promise<CreditDeductionResult> {
  try {
    const cost = VIDEO_GENERATION_COSTS[model] || VIDEO_GENERATION_COSTS.default
    const desc = description || `Video generation (${model})`

    // Get auth token
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return {
        success: false,
        error: 'Not authenticated'
      }
    }

    // Use API endpoint for credit deduction (bypasses RLS)
    const response = await fetch('/api/credits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'deduct',
        amount: cost,
        description: desc
      })
    })

    if (!response.ok) {
      const error = await response.json()
      if (error.error?.includes('Insufficient credits')) {
        return {
          success: false,
          error: 'Insufficient credits for this operation',
          insufficientCredits: true
        }
      }
      return {
        success: false,
        error: error.error || 'Failed to deduct credits'
      }
    }

    const data = await response.json()
    
    // Get updated balance
    const balanceResponse = await fetch('/api/credits', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (balanceResponse.ok) {
      const creditData = await balanceResponse.json()
      return {
        success: true,
        newBalance: creditData.balance || 0
      }
    }
    
    return {
      success: true,
      newBalance: undefined
    }
  } catch (error) {
    console.error('Error in deductCredits:', error)
    return {
      success: false,
      error: 'An unexpected error occurred'
    }
  }
}

/**
 * Refund credits (for failed generations or cancellations)
 */
export async function refundCredits(
  userId: string,
  amount: number,
  description: string = 'Refund for failed generation'
): Promise<boolean> {
  try {
    // Get auth token
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      console.error('No auth token available')
      return false
    }

    // Use API endpoint for credit refund (bypasses RLS)
    const response = await fetch('/api/credits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'add',
        amount: amount,
        description: description
      })
    })

    if (!response.ok) {
      const error = await response.json()
      console.error('Error refunding credits:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error in refundCredits:', error)
    return false
  }
}

/**
 * Get user's credit balance and transaction history
 */
export async function getCreditInfo(userId: string) {
  try {
    // Get auth token
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      console.error('No auth token available')
      return null
    }
    
    // Use API endpoint instead of direct query (bypasses RLS)
    const response = await fetch('/api/credits', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (!response.ok) {
      console.error('Error fetching credit info:', response.statusText)
      return null
    }
    
    const data = await response.json()
    
    return {
      balance: data.balance || 0,
      lifetime_earned: data.lifetime_earned || 0,
      lifetime_spent: data.lifetime_spent || 0,
      transactions: data.sources?.recent_transactions || []
    }
  } catch (error) {
    console.error('Error in getCreditInfo:', error)
    return null
  }
}

/**
 * Show insufficient credits notification
 */
export function showInsufficientCreditsNotification(
  requiredCredits: number,
  currentBalance: number
) {
  const needed = requiredCredits - currentBalance
  
  toast.error('Insufficient Credits', {
    description: `You need ${needed} more credits to generate this video. Top up your credits to continue.`,
    action: {
      label: 'Top Up',
      onClick: () => {
        // Trigger credit modal open event
        window.dispatchEvent(new CustomEvent('open-credit-modal'))
      }
    },
    duration: 5000
  })
}

/**
 * Show low credit warning
 */
export function showLowCreditWarning(balance: number) {
  if (balance < 100) {
    toast.warning('Low Credit Balance', {
      description: `You have ${balance} credits remaining. Consider topping up soon.`,
      action: {
        label: 'Top Up',
        onClick: () => {
          window.location.href = '/dashboard/credits'
        }
      },
      duration: 4000
    })
  }
}

/**
 * Format credit amount for display
 */
export function formatCredits(amount: number): string {
  return new Intl.NumberFormat('en-US').format(amount)
}

/**
 * Calculate estimated generations remaining
 */
export function estimateGenerationsRemaining(
  balance: number, 
  model: VideoModel = 'default'
): number {
  const cost = VIDEO_GENERATION_COSTS[model] || VIDEO_GENERATION_COSTS.default
  return Math.floor(balance / cost)
}