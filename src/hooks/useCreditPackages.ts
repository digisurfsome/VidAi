import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { getTestMode } from '@/lib/stripe-test-mode'

export interface CreditPackage {
  id: string
  name: string
  credits: number
  base_credits: number
  price_cents: number
  price?: number // Legacy field support
  bonus_percentage?: number
  description?: string | null
  stripe_product_id?: string | null
  stripe_price_id?: string | null
  popular?: boolean
  display_order?: number
  currency?: string
  is_test?: boolean
}

interface CreditPackagesResponse {
  packages: CreditPackage[]
  test_mode: boolean
  count: number
  warning?: string
}

export function useCreditPackages(enabled: boolean = true) {
  const isTestMode = getTestMode()
  
  return useQuery<CreditPackagesResponse, Error>({
    queryKey: ['credit-packages', isTestMode],
    queryFn: async () => {
      // Get the current session for authentication
      const { data: { session } } = await supabase.auth.getSession()
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'X-Test-Mode': String(isTestMode),
      }
      
      // Add auth header if we have a session
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      
      const response = await fetch('/api/credit-packages', {
        method: 'GET',
        headers,
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch credit packages')
      }
      
      const data = await response.json()
      return data as CreditPackagesResponse
    },
    enabled,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}

// Helper function to format credit package data for display
export function formatCreditPackage(pkg: CreditPackage) {
  const totalCredits = pkg.credits
  const baseCredits = pkg.base_credits || (
    pkg.bonus_percentage 
      ? Math.floor(totalCredits / (1 + pkg.bonus_percentage / 100))
      : totalCredits
  )
  const bonusCredits = totalCredits - baseCredits
  
  return {
    ...pkg,
    totalCredits,
    baseCredits,
    bonusCredits,
    formattedPrice: new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: pkg.currency || 'USD',
    }).format(pkg.price_cents / 100),
    pricePerCredit: pkg.price_cents / totalCredits,
  }
}