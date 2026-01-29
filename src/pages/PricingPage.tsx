import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { createCheckoutSession } from '@/lib/stripe'
import { getTestMode, getStripeKeys } from '@/lib/stripe-test-mode'

interface SubscriptionPlan {
  id: string
  stripe_product_id: string
  stripe_price_id: string
  name: string
  description: string
  price_cents: number
  currency: string
  interval: 'month' | 'year'
  credits_per_period: number
  features: string[]
  is_active: boolean
  sort_order: number
}

export default function PricingPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedInterval, setSelectedInterval] = useState<'month' | 'year'>('month')
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)

  useEffect(() => {
    loadPlans()
  }, [])

  const loadPlans = async () => {
    try {
      const isTestMode = getTestMode()
      
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .eq('is_test', isTestMode)
        .order('sort_order')

      if (error) throw error

      if (data) {
        setPlans(data)
      }
    } catch (error) {
      console.error('Error loading plans:', error)
      toast.error('Failed to load subscription plans')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectPlan = async (plan: SubscriptionPlan) => {
    setCheckoutLoading(plan.id)

    try {
      if (!user) {
        // For new users, use the payment-first flow
        const response = await fetch('/api/stripe-checkout-new-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            priceId: plan.stripe_price_id
          })
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to create checkout session')
        }

        const { sessionId, url } = await response.json()

        if (url) {
          // Redirect directly to Stripe Checkout URL
          window.location.href = url
        } else if (sessionId) {
          // Fallback to client-side redirect
          const stripe = await loadStripe()
          if (stripe) {
            const { error } = await stripe.redirectToCheckout({ sessionId })
            if (error) {
              throw error
            }
          }
        }
      } else {
        // For existing users, use the regular checkout flow
        const { sessionId, error } = await createCheckoutSession({
          priceId: plan.stripe_price_id,
          userId: user.id,
          userEmail: user.email || '',
          successUrl: `${window.location.origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/pricing`
        })

        if (error) {
          throw new Error(error)
        }

        if (sessionId) {
          // Redirect to Stripe Checkout
          const stripe = await loadStripe()
          if (stripe) {
            const { error } = await stripe.redirectToCheckout({ sessionId })
            if (error) {
              throw error
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Checkout error:', error)
      toast.error(error.message || 'Failed to start checkout')
    } finally {
      setCheckoutLoading(null)
    }
  }

  const loadStripe = async () => {
    const { publishableKey } = getStripeKeys()
    if (!publishableKey) {
      toast.error('Stripe is not configured')
      return null
    }

    const { loadStripe } = await import('@stripe/stripe-js')
    return loadStripe(publishableKey)
  }

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(cents / 100)
  }

  const formatCredits = (credits: number) => {
    return new Intl.NumberFormat('en-US').format(credits)
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  const filteredPlans = plans.filter(plan => plan.interval === selectedInterval)
  const monthlyPlans = plans.filter(plan => plan.interval === 'month')
  const yearlyPlans = plans.filter(plan => plan.interval === 'year')
  const hasYearlyPlans = yearlyPlans.length > 0

  return (
    <div className="container max-w-7xl mx-auto py-16 px-4">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">Choose Your Plan</h1>
        <p className="text-xl text-muted-foreground">
          Start creating amazing AI-powered videos today
        </p>
      </div>

      {hasYearlyPlans && (
        <div className="flex justify-center mb-8">
          <Tabs value={selectedInterval} onValueChange={(v) => setSelectedInterval(v as 'month' | 'year')}>
            <TabsList>
              <TabsTrigger value="month">Monthly</TabsTrigger>
              <TabsTrigger value="year">
                Yearly
                <Badge variant="secondary" className="ml-2">Save 20%</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-3 lg:gap-6">
        {filteredPlans.map((plan) => {
          const isPopular = plan.name.toLowerCase() === 'pro'
          const pricePerMonth = plan.interval === 'year' ? plan.price_cents / 12 : plan.price_cents

          return (
            <Card 
              key={plan.id} 
              className={`relative ${isPopular ? 'border-primary shadow-lg' : ''}`}
            >
              {isPopular && (
                <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  Most Popular
                </Badge>
              )}
              
              <CardHeader>
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">{formatPrice(pricePerMonth)}</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                  {plan.interval === 'year' && (
                    <div className="text-sm text-muted-foreground">
                      Billed annually ({formatPrice(plan.price_cents)})
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <span className="font-medium">Monthly Credits</span>
                    <span className="text-lg font-bold">{formatCredits(plan.credits_per_period)}</span>
                  </div>
                </div>

                <ul className="space-y-3">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              
              <CardFooter>
                <Button 
                  className="w-full" 
                  size="lg"
                  variant={isPopular ? 'default' : 'outline'}
                  onClick={() => handleSelectPlan(plan)}
                  disabled={checkoutLoading === plan.id}
                >
                  {checkoutLoading === plan.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CreditCard className="mr-2 h-4 w-4" />
                      {user ? 'Subscribe Now' : 'Sign Up & Subscribe'}
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      <div className="mt-12 text-center">
        <p className="text-muted-foreground mb-4">
          All plans include a 7-day free trial. Cancel anytime.
        </p>
        <div className="flex justify-center gap-8 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <Check className="w-4 h-4 text-primary" />
            No credit card required for trial
          </span>
          <span className="flex items-center gap-2">
            <Check className="w-4 h-4 text-primary" />
            Cancel anytime
          </span>
          <span className="flex items-center gap-2">
            <Check className="w-4 h-4 text-primary" />
            Secure payment via Stripe
          </span>
        </div>
      </div>
    </div>
  )
}