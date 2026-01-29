import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Coins, TrendingUp, Check, CreditCard, AlertCircle, RefreshCw } from 'lucide-react'
import { purchaseCredits } from '@/lib/stripe'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { formatCredits } from '@/lib/credits'
import { useCreditPackages, type CreditPackage, formatCreditPackage } from '@/hooks/useCreditPackages'
import { getTestMode } from '@/lib/stripe-test-mode'
import { Skeleton } from '@/components/ui/skeleton'

interface TopUpCreditsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentBalance?: number
  onSuccess?: () => void
}

export default function TopUpCreditsModal({ 
  open, 
  onOpenChange, 
  currentBalance = 0,
  onSuccess 
}: TopUpCreditsModalProps) {
  const { user } = useAuth()
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null)
  const [processing, setProcessing] = useState(false)
  const isTestMode = getTestMode()
  
  // Fetch credit packages from API
  const { data, isLoading, error, refetch } = useCreditPackages(open)
  const packages = data?.packages || []
  
  // Reset selection when packages change
  useEffect(() => {
    if (packages.length > 0 && !selectedPackage) {
      // Auto-select popular package if available
      const popularPackage = packages.find(pkg => pkg.popular)
      if (popularPackage) {
        setSelectedPackage(popularPackage)
      }
    }
  }, [packages, selectedPackage])

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100)
  }

  const handlePurchase = async () => {
    if (!selectedPackage || !user) return

    setProcessing(true)
    try {
      const result = await purchaseCredits({
        packageId: selectedPackage.id,
        priceInCents: selectedPackage.price_cents,
        userId: user.id,
        userEmail: user.email || '',
        successUrl: `${window.location.origin}/dashboard?credit_purchase=success`,
        cancelUrl: `${window.location.origin}/dashboard?credit_purchase=cancelled`,
        stripePriceId: selectedPackage.stripe_price_id || undefined,
        stripeProductId: selectedPackage.stripe_product_id || undefined
      })

      if (result.error) {
        throw new Error(result.error)
      }

      if (result.sessionId) {
        // Load Stripe and redirect to checkout
        const { loadStripe } = await import('@stripe/stripe-js')
        // Use test or live key based on current mode
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
      setProcessing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            Top Up Credits
          </DialogTitle>
          <DialogDescription>
            Select a credit package to continue creating amazing videos
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Test Mode Banner */}
          {isTestMode && (
            <Alert className="border-yellow-500 bg-yellow-500/10">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Test Mode:</strong> You are viewing test credit packages. No real charges will occur.
              </AlertDescription>
            </Alert>
          )}
          
          {/* Current Balance Display */}
          {currentBalance !== undefined && (
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Current Balance</span>
                <span className="font-semibold">{formatCredits(currentBalance)} credits</span>
              </div>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="grid gap-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          )}
          
          {/* Error State */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>Failed to load credit packages</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refetch()}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          
          {/* No Packages Available */}
          {!isLoading && !error && packages.length === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No credit packages available at this time. Please contact support.
              </AlertDescription>
            </Alert>
          )}

          {/* Package Selection */}
          {!isLoading && !error && packages.length > 0 && (
            <div className="grid gap-3">
              {packages.map((pkg) => {
                const formattedPkg = formatCreditPackage(pkg)
                const isSelected = selectedPackage?.id === pkg.id

                return (
                  <button
                    key={pkg.id}
                    onClick={() => setSelectedPackage(pkg)}
                    className={`
                      relative p-4 rounded-lg border-2 transition-all text-left
                      ${isSelected 
                        ? 'border-primary bg-primary/5' 
                        : 'border-border hover:border-muted-foreground/50'
                      }
                    `}
                    disabled={processing}
                  >
                    {pkg.popular && (
                      <Badge className="absolute -top-2 right-4" variant="default">
                        Most Popular
                      </Badge>
                    )}

                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className={`
                            w-5 h-5 rounded-full border-2 flex items-center justify-center
                            ${isSelected ? 'border-primary' : 'border-muted-foreground'}
                          `}>
                            {isSelected && (
                              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                            )}
                          </div>
                          <span className="font-medium">{pkg.name} Pack</span>
                          {pkg.bonus_percentage && (
                            <Badge variant="secondary" className="ml-1">
                              +{pkg.bonus_percentage}% bonus
                            </Badge>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>{formatCredits(formattedPkg.baseCredits)} credits</span>
                          {formattedPkg.bonusCredits > 0 && (
                            <>
                              <span>+</span>
                              <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                                <TrendingUp className="h-3 w-3" />
                                {formatCredits(formattedPkg.bonusCredits)} bonus
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-bold text-lg">{formatPrice(pkg.price_cents)}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCredits(pkg.credits)} total
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Selected Package Summary */}
          {selectedPackage && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Package</span>
                  <span className="font-medium">{selectedPackage.name} Pack</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Credits</span>
                  <span className="font-medium">{formatCredits(selectedPackage.credits)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Price</span>
                  <span className="font-medium">{formatPrice(selectedPackage.price_cents)}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="font-medium">New Balance</span>
                  <span className="font-bold text-lg">
                    {formatCredits(currentBalance + selectedPackage.credits)} credits
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={processing}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePurchase}
              disabled={!selectedPackage || processing}
              className="flex-1"
            >
              {processing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Continue to Payment
                </>
              )}
            </Button>
          </div>

          {/* Security Note */}
          <p className="text-xs text-center text-muted-foreground">
            Secure payment powered by Stripe. Credits are added instantly after payment.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}