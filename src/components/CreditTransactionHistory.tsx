import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, TrendingUp, TrendingDown, RefreshCw, Download, Filter } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Transaction {
  id: string
  user_id: string
  amount: number
  description: string
  balance_after: number
  reference_id?: string
  created_at: string
}

export default function CreditTransactionHistory() {
  const { user } = useAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'credits' | 'debits'>('all')
  const [limit, setLimit] = useState(20)
  const [totalTransactions, setTotalTransactions] = useState(0)

  useEffect(() => {
    if (user) {
      loadTransactions()
    }
  }, [user, filter, limit])

  const loadTransactions = async () => {
    if (!user) return

    setLoading(true)
    try {
      // Get user token for API authentication
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No access token available');
      }

      // Build query parameters
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: '0'
      });

      if (filter !== 'all') {
        params.append('filter', filter);
      }

      // Call transactions API endpoint
      const response = await fetch(`/api/transactions?${params}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      setTransactions(data.transactions || [])
      setTotalTransactions(data.total || 0)
    } catch (error: unknown) {
      console.error('Error loading transactions:', error)
      toast.error('Failed to load transaction history')
    } finally {
      setLoading(false)
    }
  }

  const exportTransactions = () => {
    if (transactions.length === 0) {
      toast.error('No transactions to export')
      return
    }

    // Create CSV content
    const headers = ['Date', 'Description', 'Amount', 'Balance After', 'Reference ID']
    const rows = transactions.map(tx => [
      format(new Date(tx.created_at), 'yyyy-MM-dd HH:mm:ss'),
      tx.description,
      tx.amount.toString(),
      tx.balance_after.toString(),
      tx.reference_id || ''
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `credit-transactions-${format(new Date(), 'yyyy-MM-dd')}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast.success('Transactions exported successfully')
  }

  const formatCredits = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      signDisplay: 'always'
    }).format(amount)
  }

  const getTransactionType = (amount: number) => {
    return amount > 0 ? 'credit' : 'debit'
  }

  const getTransactionBadge = (amount: number) => {
    if (amount > 0) {
      return (
        <Badge variant="default" className="bg-green-500">
          <TrendingUp className="w-3 h-3 mr-1" />
          Credit
        </Badge>
      )
    } else {
      return (
        <Badge variant="destructive">
          <TrendingDown className="w-3 h-3 mr-1" />
          Debit
        </Badge>
      )
    }
  }

  if (loading && transactions.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Transaction History</CardTitle>
            <CardDescription>
              Your complete credit transaction history
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={loadTransactions}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={exportTransactions}
              disabled={transactions.length === 0}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-2">
            <Select value={filter} onValueChange={(value: 'all' | 'credits' | 'debits') => setFilter(value)}>
              <SelectTrigger className="w-[180px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter transactions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Transactions</SelectItem>
                <SelectItem value="credits">Credits Only</SelectItem>
                <SelectItem value="debits">Debits Only</SelectItem>
              </SelectContent>
            </Select>

            <Select value={limit.toString()} onValueChange={(value) => setLimit(parseInt(value))}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Show" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">Show 20</SelectItem>
                <SelectItem value="50">Show 50</SelectItem>
                <SelectItem value="100">Show 100</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Transaction Table */}
          {transactions.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(transaction.created_at), 'MMM d, yyyy HH:mm')}
                      </TableCell>
                      <TableCell>{transaction.description}</TableCell>
                      <TableCell>{getTransactionBadge(transaction.amount)}</TableCell>
                      <TableCell className={`text-right font-medium ${
                        transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {formatCredits(transaction.amount)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {transaction.balance_after.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              No transactions found
            </div>
          )}

          {/* Pagination Info */}
          {totalTransactions > limit && (
            <div className="text-center text-sm text-muted-foreground">
              Showing {Math.min(limit, transactions.length)} of {totalTransactions} transactions
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}