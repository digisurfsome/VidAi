import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Coins, TrendingUp, Sparkles, Zap, Crown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { formatCredits } from '@/lib/credits'
import { getTestMode } from '@/lib/stripe-test-mode'

interface CreditPackage {
  id: string
  name: string
  description: string
  credits: number
  price_cents: number
  bonus_percentage?: number
  is_active: boolean
  sort_order: number
}

interface CreditPackagesProps {
  onSelectPackage: (packageId: string, priceInCents: number) => Promise<void>
  currentBalance?: number
}

export default function CreditPackages({ onSelectPackage, currentBalance = 0 }: CreditPackagesProps) {
  const [packages, setPackages] = useState<CreditPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [purchasingId, setPurchasingId] = useState<string | null>(null)

  useEffect(() => {
    loadPackages()
  }, [])

  const loadPackages = async () => {
    try {
      const isTestMode = getTestMode()
      
      const { data, error } = await supabase
        .from('credit_packages')
        .select('*')
        .eq('is_active', true)
        .eq('is_test', isTestMode)
        .order('sort_order')

      if (error) throw error

      // If no packages exist, create default ones
      if (!data || data.length === 0) {
        const defaultPackages = [
          { 
            name: 'Starter Pack', 
            credits: 500, 
            price_cents: 499, 
            description: 'Perfect for trying out the platform',
            is_active: true,
            sort_order: 1 
          },
          { 
            name: 'Popular Pack', 
            credits: 1100, 
            price_cents: 899, 
            description: 'Most popular choice',
            bonus_percentage: 10,
            is_active: true,
            sort_order: 2 
          },
          { 
            name: 'Value Pack', 
            credits: 6000, 
            price_cents: 3999, 
            description: 'Best value for regular users',
            bonus_percentage: 20,
            is_active: true,
            sort_order: 3 
          },
          { 
            name: 'Bulk Pack', 
            credits: 13000, 
            price_cents: 6999, 
            description: 'Maximum savings for power users',
            bonus_percentage: 30,
            is_active: true,
            sort_order: 4 
          }
        ]

        const { data: insertedData, error: insertError } = await supabase
          .from('credit_packages')
          .insert(defaultPackages)
          .select()

        if (insertError) throw insertError
        setPackages(insertedData || [])
      } else {
        setPackages(data)
      }
    } catch (error) {
      console.error('Error loading credit packages:', error)
      toast.error('Failed to load credit packages')
    } finally {
      setLoading(false)
    }
  }

  const handlePurchase = async (pkg: CreditPackage) => {
    setPurchasingId(pkg.id)
    try {
      await onSelectPackage(pkg.id, pkg.price_cents)
    } catch (error) {
      console.error('Purchase error:', error)
      toast.error('Failed to initiate purchase')
    } finally {
      setPurchasingId(null)
    }
  }

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100)
  }

  const calculatePricePerCredit = (priceInCents: number, credits: number) => {
    const pricePerCredit = priceInCents / credits
    return `$${(pricePerCredit / 100).toFixed(4)}`
  }

  const getPackageIcon = (index: number) => {
    const icons = [Coins, Zap, Sparkles, Crown]
    const Icon = icons[index] || Coins
    return <Icon className="h-5 w-5" />
  }

  const getPackageColor = (index: number) => {
    const colors = [
      'text-slate-600 dark:text-slate-400',
      'text-blue-600 dark:text-blue-400',
      'text-purple-600 dark:text-purple-400',
      'text-amber-600 dark:text-amber-400'
    ]
    return colors[index] || colors[0]
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (packages.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No credit packages available</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {packages.map((pkg, index) => {
        const isPopular = index === 1 // Second package is usually most popular
        const baseCredits = pkg.bonus_percentage 
          ? Math.floor(pkg.credits / (1 + pkg.bonus_percentage / 100))
          : pkg.credits
        const bonusCredits = pkg.credits - baseCredits

        return (
          <Card 
            key={pkg.id} 
            className={`relative ${isPopular ? 'border-primary shadow-lg' : ''}`}
          >
            {isPopular && (
              <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                Most Popular
              </Badge>
            )}

            <CardHeader>
              <div className={`flex items-center gap-2 ${getPackageColor(index)}`}>
                {getPackageIcon(index)}
                <CardTitle className="text-lg">{pkg.name}</CardTitle>
              </div>
              <CardDescription>{pkg.description}</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="text-center">
                <div className="text-3xl font-bold">{formatPrice(pkg.price_cents)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {calculatePricePerCredit(pkg.price_cents, pkg.credits)} per credit
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 bg-muted rounded">
                  <span className="text-sm">Credits</span>
                  <span className="font-semibold">{formatCredits(baseCredits)}</span>
                </div>

                {pkg.bonus_percentage && bonusCredits > 0 && (
                  <div className="flex items-center justify-between p-2 bg-green-500/10 rounded">
                    <span className="text-sm flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      Bonus {pkg.bonus_percentage}%
                    </span>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      +{formatCredits(bonusCredits)}
                    </span>
                  </div>
                )}

                <div className="border-t pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Total Credits</span>
                    <span className="text-lg font-bold">{formatCredits(pkg.credits)}</span>
                  </div>
                </div>
              </div>

              {currentBalance > 0 && (
                <div className="text-xs text-muted-foreground text-center">
                  After purchase: {formatCredits(currentBalance + pkg.credits)} credits
                </div>
              )}
            </CardContent>

            <CardFooter>
              <Button
                className="w-full"
                variant={isPopular ? 'default' : 'outline'}
                onClick={() => handlePurchase(pkg)}
                disabled={purchasingId === pkg.id}
              >
                {purchasingId === pkg.id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Coins className="mr-2 h-4 w-4" />
                    Buy Now
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}