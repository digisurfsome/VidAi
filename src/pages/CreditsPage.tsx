import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageLayout from '@/components/PageLayout'
import CreditBalance from '@/components/CreditBalance'
import CreditPackages from '@/components/CreditPackages'
import CreditPurchaseConfirmation from '@/components/CreditPurchaseConfirmation'
import { useAuth } from '@/contexts/AuthContext'
import { purchaseCredits } from '@/lib/stripe'
import { getTestMode } from '@/lib/stripe-test-mode'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { InfoIcon } from 'lucide-react'
import { toast } from 'sonner'

export default function CreditsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, hasActiveSubscription } = useAuth()
  const [processingPurchase, setProcessingPurchase] = useState(false)
  
  // Check for success/cancel parameters
  const purchaseSuccess = searchParams.get('credit_purchase') === 'success' || searchParams.get('success') === 'true'
  const purchaseCancelled = searchParams.get('credit_purchase') === 'cancelled' || searchParams.get('cancelled') === 'true'
  const sessionId = searchParams.get('session_id')

  const handlePackageSelect = async (packageId: string, priceInCents: number) => {
    if (!user) {
      toast.error('Please sign in to purchase credits')
      navigate('/sign-in')
      return
    }

    if (!hasActiveSubscription) {
      toast.error('Please subscribe to a plan before purchasing additional credits')
      navigate('/pricing')
      return
    }

    setProcessingPurchase(true)

    try {
      const result = await purchaseCredits({
        packageId,
        priceInCents,
        userId: user.id,
        userEmail: user.email || '',
        successUrl: `${window.location.origin}/dashboard/credits?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${window.location.origin}/dashboard/credits?cancelled=true`
      })

      if (result.error) {
        throw new Error(result.error)
      }

      if (result.sessionId) {
        // Load Stripe and redirect to checkout
        const { loadStripe } = await import('@stripe/stripe-js')
        // Use test or live key based on current mode
        const isTestMode = getTestMode()
        const stripeKey = isTestMode 
          ? import.meta.env.VITE_STRIPE_TEST_PUBLISHABLE_KEY 
          : import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
        
        const stripe = await loadStripe(stripeKey)
        
        if (stripe) {
          const { error } = await stripe.redirectToCheckout({ 
            sessionId: result.sessionId 
          })
          
          if (error) {
            throw error
          }
        }
      }
    } catch (error: any) {
      console.error('Purchase error:', error)
      toast.error(error.message || 'Failed to initiate credit purchase')
    } finally {
      setProcessingPurchase(false)
    }
  }

  // Show confirmation page if returning from successful purchase
  if (purchaseSuccess || purchaseCancelled) {
    return (
      <PageLayout
        title="Credit Purchase"
        description="Transaction status"
      >
        <CreditPurchaseConfirmation />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Buy Credits"
      description="Top up your credit balance to continue generating amazing videos"
    >
      <div className="space-y-6">
        {/* Current Balance */}
        <div className="max-w-md">
          <CreditBalance showHistory={false} />
        </div>

        {/* Info Alert */}
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertDescription>
            Credits are used to generate videos. Different video models consume different amounts of credits.
            All purchases are processed securely through Stripe.
          </AlertDescription>
        </Alert>

        {/* Credit Packages */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Select a Credit Package</h2>
          <CreditPackages 
            onSelectPackage={handlePackageSelect}
            currentBalance={0} // You could pass actual balance here
          />
        </div>

        {/* Additional Information */}
        <div className="mt-8 p-4 bg-muted/50 rounded-lg">
          <h3 className="font-medium mb-2">How Credits Work</h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>• Basic SD videos: 10 credits</li>
            <li>• Basic HD videos: 25 credits</li>
            <li>• Pro HD videos: 100 credits</li>
            <li>• Premium 4K videos: 500 credits</li>
            <li>• Credits never expire</li>
            <li>• Unused credits roll over each month</li>
          </ul>
        </div>
      </div>
    </PageLayout>
  )
}