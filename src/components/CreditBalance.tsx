import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Coins, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react'
import { getCreditBalance } from '@/lib/stripe'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import TopUpCreditsModal from './TopUpCreditsModal'

interface CreditBalanceProps {
  compact?: boolean
  showHistory?: boolean
  onLowBalance?: (balance: number) => void
}

export default function CreditBalance({ 
  compact = false, 
  showHistory = true,
  onLowBalance 
}: CreditBalanceProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [showTopUpModal, setShowTopUpModal] = useState(false)
  const [credits, setCredits] = useState<{
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
  } | null>(null)

  useEffect(() => {
    if (user) {
      loadCreditBalance()
    }
  }, [user])

  useEffect(() => {
    if (credits && credits.balance < 100 && onLowBalance) {
      onLowBalance(credits.balance)
    }
  }, [credits, onLowBalance])

  // Listen for custom events
  useEffect(() => {
    const handleOpenCreditModal = () => {
      setShowTopUpModal(true)
    }
    
    const handleRefreshCredits = () => {
      if (user) {
        loadCreditBalance()
      }
    }

    window.addEventListener('open-credit-modal', handleOpenCreditModal)
    window.addEventListener('refresh-credits', handleRefreshCredits)
    
    return () => {
      window.removeEventListener('open-credit-modal', handleOpenCreditModal)
      window.removeEventListener('refresh-credits', handleRefreshCredits)
    }
  }, [user])

  const loadCreditBalance = async () => {
    try {
      const data = await getCreditBalance()
      if (data && !data.error) {
        setCredits(data)
      } else {
        setCredits({ balance: 0, lifetime_earned: 0, lifetime_spent: 0 })
      }
    } catch (error) {
      console.error('Error loading credit balance:', error)
      setCredits({ balance: 0, lifetime_earned: 0, lifetime_spent: 0 })
    } finally {
      setLoading(false)
    }
  }

  const formatCredits = (amount: number) => {
    return new Intl.NumberFormat('en-US').format(amount)
  }

  const getBalanceColor = (balance: number) => {
    if (balance >= 500) return 'text-green-600 dark:text-green-400'
    if (balance >= 100) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
  }

  const getBalanceStatus = (balance: number) => {
    if (balance >= 500) return { label: 'Healthy', variant: 'default' as const }
    if (balance >= 100) return { label: 'Low', variant: 'secondary' as const }
    return { label: 'Critical', variant: 'destructive' as const }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!credits) {
    return null
  }

  const status = getBalanceStatus(credits.balance)

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-muted-foreground" />
          <span className={`font-semibold text-lg ${getBalanceColor(credits.balance)}`}>
            {formatCredits(credits.balance)}
          </span>
        </div>
        {credits.balance < 100 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowTopUpModal(true)}
          >
            Top Up
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
    <Card>
      <CardContent className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold">Credit Balance</h3>
            </div>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>

          <div className="text-center py-4">
            <div className={`text-4xl font-bold ${getBalanceColor(credits.balance)}`}>
              {formatCredits(credits.balance)}
            </div>
            <div className="text-sm text-muted-foreground mt-1">Available Credits</div>
          </div>

          {showHistory && (
            <div className="space-y-4 pt-4 border-t">
              {/* Usage Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <TrendingUp className="h-3 w-3" />
                    Total Earned
                  </div>
                  <div className="font-medium">{formatCredits(credits.lifetime_earned)}</div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <TrendingDown className="h-3 w-3" />
                    Total Used
                  </div>
                  <div className="font-medium">{formatCredits(credits.lifetime_spent)}</div>
                </div>
              </div>

              {/* Subscription Info */}
              {credits.sources?.subscription && (
                <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Subscription Plan</span>
                    <Badge variant="outline">{credits.sources.subscription.plan_name}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {credits.sources.subscription.credits_per_period} credits per period
                    {credits.sources.subscription.refill_due && (
                      <span className="text-orange-600 ml-2">• Refill due</span>
                    )}
                  </div>
                  {credits.sources.subscription.next_refill_date && (
                    <div className="text-xs text-muted-foreground">
                      Next refill: {new Date(credits.sources.subscription.next_refill_date).toLocaleDateString()}
                    </div>
                  )}
                </div>
              )}

              {/* Usage Efficiency */}
              {credits.usage_stats && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Usage Efficiency</span>
                  <span className="font-medium">{credits.usage_stats.efficiency_percent}%</span>
                </div>
              )}
            </div>
          )}

          {credits.balance < 100 && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 rounded-lg">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Low Credit Balance</p>
                <p className="text-xs text-muted-foreground">
                  You're running low on credits. Top up now to continue generating videos.
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={() => setShowTopUpModal(true)}
              className="flex-1"
              variant={credits.balance < 100 ? 'default' : 'outline'}
            >
              <Coins className="h-4 w-4 mr-2" />
              Top Up Credits
            </Button>
            <Button
              onClick={() => navigate('/dashboard/transactions')}
              variant="outline"
              className="flex-1"
            >
              View History
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Top Up Modal */}
    <TopUpCreditsModal
      open={showTopUpModal}
      onOpenChange={setShowTopUpModal}
      currentBalance={credits?.balance || 0}
      onSuccess={() => {
        loadCreditBalance()
        setShowTopUpModal(false)
        toast.success('Credits added successfully!')
      }}
    />
  </>
  )
}