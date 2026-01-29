import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle2, XCircle, Loader2, Receipt, Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { formatCredits } from '@/lib/credits'
import { toast } from 'sonner'

export default function CreditPurchaseConfirmation() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [purchaseData, setPurchaseData] = useState<any>(null)
  const [sendingReceipt, setSendingReceipt] = useState(false)

  const sessionId = searchParams.get('session_id')
  const success = searchParams.get('credit_purchase') === 'success'
  const cancelled = searchParams.get('credit_purchase') === 'cancelled'

  useEffect(() => {
    if (success && sessionId) {
      verifyPurchase()
    } else {
      setLoading(false)
    }
  }, [success, sessionId])

  const verifyPurchase = async () => {
    if (!user) return

    try {
      // Get the latest transaction for this user
      const { data, error } = await supabase
        .from('credit_transactions')
        .select('*')
        .eq('user_id', user.id)
        .eq('type', 'credit')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (error) throw error

      setPurchaseData(data)
    } catch (error) {
      console.error('Error verifying purchase:', error)
    } finally {
      setLoading(false)
    }
  }

  const sendReceipt = async () => {
    if (!user || !purchaseData) return

    setSendingReceipt(true)
    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: user.email,
          subject: 'Credit Purchase Receipt',
          html: generateReceiptHTML(purchaseData)
        })
      })

      if (response.ok) {
        toast.success('Receipt sent to your email')
      } else {
        throw new Error('Failed to send receipt')
      }
    } catch (error) {
      console.error('Error sending receipt:', error)
      toast.error('Failed to send receipt')
    } finally {
      setSendingReceipt(false)
    }
  }

  const generateReceiptHTML = (transaction: any) => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0ea5e9; color: white; padding: 30px; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px; }
          .receipt-line { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
          .total { font-size: 24px; font-weight: bold; color: #0ea5e9; margin-top: 20px; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Credit Purchase Receipt</h1>
            <p style="margin: 10px 0 0 0;">Thank you for your purchase!</p>
          </div>
          <div class="content">
            <h2>Transaction Details</h2>
            <div class="receipt-line">
              <span>Transaction ID:</span>
              <span>${transaction.id}</span>
            </div>
            <div class="receipt-line">
              <span>Date:</span>
              <span>${new Date(transaction.created_at).toLocaleString()}</span>
            </div>
            <div class="receipt-line">
              <span>Credits Purchased:</span>
              <span>${formatCredits(transaction.amount)}</span>
            </div>
            <div class="receipt-line">
              <span>New Balance:</span>
              <span>${formatCredits(transaction.balance_after)}</span>
            </div>
            <div class="total">
              Total Credits: ${formatCredits(transaction.amount)}
            </div>
            <p style="margin-top: 20px; color: #6b7280;">
              Your credits have been added to your account and are available for immediate use.
            </p>
          </div>
          <div class="footer">
            <p>This is an automated receipt for your records.</p>
            <p>If you have any questions, please contact support.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (cancelled) {
    return (
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <div className="flex items-center gap-2 text-yellow-600">
            <XCircle className="h-6 w-6" />
            <CardTitle>Purchase Cancelled</CardTitle>
          </div>
          <CardDescription>
            Your credit purchase was cancelled. No charges were made.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => navigate('/dashboard')} className="w-full">
            Return to Credits Page
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (success && purchaseData) {
    return (
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-6 w-6" />
            <CardTitle>Purchase Successful!</CardTitle>
          </div>
          <CardDescription>
            Your credits have been added to your account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              <strong>{formatCredits(purchaseData.amount)} credits</strong> have been added to your account.
              Your new balance is <strong>{formatCredits(purchaseData.balance_after)} credits</strong>.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Transaction ID</span>
              <span className="font-mono text-xs">{purchaseData.id.substring(0, 8)}...</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Date</span>
              <span>{new Date(purchaseData.created_at).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Credits Added</span>
              <span className="font-semibold">{formatCredits(purchaseData.amount)}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={sendReceipt}
              variant="outline"
              className="flex-1"
              disabled={sendingReceipt}
            >
              {sendingReceipt ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Email Receipt
                </>
              )}
            </Button>
            <Button
              onClick={() => navigate('/dashboard')}
              className="flex-1"
            >
              <Receipt className="mr-2 h-4 w-4" />
              Go to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Processing Purchase</CardTitle>
        <CardDescription>
          Verifying your credit purchase...
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert>
          <AlertDescription>
            If your purchase was successful, credits will be added to your account shortly.
          </AlertDescription>
        </Alert>
        <Button onClick={() => navigate('/dashboard')} className="w-full mt-4">
          Return to Dashboard
        </Button>
      </CardContent>
    </Card>
  )
}