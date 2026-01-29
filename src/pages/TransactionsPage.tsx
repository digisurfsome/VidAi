import PageLayout from '@/components/PageLayout'
import CreditTransactionHistory from '@/components/CreditTransactionHistory'

export default function TransactionsPage() {
  return (
    <PageLayout
      title="Credit Transactions"
      description="View your credit usage history and transaction details"
    >
      <CreditTransactionHistory />
    </PageLayout>
  )
}