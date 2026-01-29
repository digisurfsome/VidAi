import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, CreditCard, Calendar, AlertCircle, CheckCircle, XCircle, Coins } from 'lucide-react'
import { createPortalSession, getCreditBalance } from '@/lib/stripe'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import TopUpCreditsModal from '@/components/TopUpCreditsModal'

export default function SubscriptionSettings() {
  const { user, subscription, hasActiveSubscription, checkSubscription } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [showTopUpModal, setShowTopUpModal] = useState(false)
  const [credits, setCredits] = useState<{ balance: number; lifetime_earned: number; lifetime_spent: number } | null>(null)
  
  useEffect(() => {
    if (user) {
      loadSubscriptionData()
    }
  }, [user])

  const loadSubscriptionData = async () => {
    setLoading(true)
    try {
      // Refresh subscription status
      await checkSubscription()
      
      // Get credit balance
      const creditData = await getCreditBalance()
      if (creditData && !creditData.error) {
        setCredits(creditData)
      }
    } catch (error) {
      console.error('Error loading subscription data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleManageSubscription = async () => {
    if (!user) {
      toast.error('Please sign in to manage your subscription')
      return
    }

    setPortalLoading(true)
    try {
      const { url, error } = await createPortalSession({
        returnUrl: window.location.href
      })

      if (error) {
        throw new Error(error)
      }

      if (url) {
        window.location.href = url
      }
    } catch (error: any) {
      console.error('Portal error:', error)
      toast.error(error.message || 'Failed to open billing portal')
    } finally {
      setPortalLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const formatCredits = (amount: number) => {
    return new Intl.NumberFormat('en-US').format(amount)
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>
      case 'trialing':
        return <Badge className="bg-blue-500"><AlertCircle className="w-3 h-3 mr-1" />Trial</Badge>
      case 'past_due':
        return <Badge className="bg-yellow-500"><AlertCircle className="w-3 h-3 mr-1" />Past Due</Badge>
      case 'cancelled':
      case 'canceled':
        return <Badge className="bg-red-500"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  if (!hasActiveSubscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Active Subscription</CardTitle>
          <CardDescription>
            Subscribe to a plan to start creating AI-powered videos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              You don't have an active subscription. Choose a plan to get started with video generation.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Button onClick={() => navigate('/pricing')} className="w-full">
            <CreditCard className="mr-2 h-4 w-4" />
            View Pricing Plans
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Subscription Status Card */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Subscription Status</CardTitle>
              <CardDescription>
                Manage your subscription and billing details
              </CardDescription>
            </div>
            {subscription && getStatusBadge(subscription.status)}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {subscription?.plan && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Current Plan</span>
                <span className="font-semibold text-lg">{subscription.plan.name}</span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Monthly Credits</span>
                <span className="font-medium">{formatCredits(subscription.plan.credits_per_period)}</span>
              </div>

              {subscription.current_period_end && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">
                    {subscription.cancel_at_period_end ? 'Expires' : 'Renews'} On
                  </span>
                  <span className="font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {formatDate(subscription.current_period_end)}
                  </span>
                </div>
              )}

              {subscription.cancel_at_period_end && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Your subscription will end on {formatDate(subscription.current_period_end)}. 
                    You can reactivate it anytime before then.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button 
            onClick={handleManageSubscription} 
            disabled={portalLoading}
            className="w-full"
          >
            {portalLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Opening Portal...
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-4 w-4" />
                Manage Subscription
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Credit Balance Card */}
      {credits && (
        <Card>
          <CardHeader>
            <CardTitle>Credit Balance</CardTitle>
            <CardDescription>
              Your current credit balance and usage statistics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className="text-4xl font-bold">{formatCredits(credits.balance)}</div>
                <div className="text-muted-foreground">Available Credits</div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <div className="text-muted-foreground">Total Earned</div>
                  <div className="font-medium">{formatCredits(credits.lifetime_earned)}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground">Total Used</div>
                  <div className="font-medium">{formatCredits(credits.lifetime_spent)}</div>
                </div>
              </div>

              {credits.balance < 100 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Your credit balance is running low. Consider purchasing additional credits.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
          {credits.balance < 500 && (
            <CardFooter>
              <Button variant="outline" onClick={() => setShowTopUpModal(true)} className="w-full">
                <Coins className="mr-2 h-4 w-4" />
                Top Up Credits
              </Button>
            </CardFooter>
          )}
        </Card>
      )}
      
      {/* Top Up Modal */}
      <TopUpCreditsModal
        open={showTopUpModal}
        onOpenChange={setShowTopUpModal}
        currentBalance={credits?.balance || 0}
        onSuccess={() => {
          loadSubscriptionData()
          setShowTopUpModal(false)
          toast.success('Credits added successfully!')
        }}
      />
    </div>
  )
}