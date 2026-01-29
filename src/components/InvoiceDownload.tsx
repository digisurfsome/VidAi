import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Download, FileText, Loader2, ExternalLink } from 'lucide-react';
import { formatPrice } from '@/lib/stripe';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface Invoice {
  id: string;
  created_at: string;
  amount_cents: number;
  status: string;
  type: string;
  description: string;
  invoice_url?: string;
  invoice_pdf?: string;
}

interface InvoiceDownloadProps {
  limit?: number;
  showGenerateButton?: boolean;
}

export function InvoiceDownload({ 
  limit = 10, 
  showGenerateButton = true 
}: InvoiceDownloadProps) {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);

  React.useEffect(() => {
    if (user?.id) {
      loadInvoices();
    }
  }, [user?.id]);

  const loadInvoices = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);

      // Load payment transactions that could have invoices
      const { data, error } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'succeeded')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      setInvoices(data || []);
    } catch (error) {
      console.error('Error loading invoices:', error);
      toast.error('Failed to load invoice history');
    } finally {
      setLoading(false);
    }
  };

  const generateInvoicePDF = async (invoice: Invoice) => {
    try {
      setGenerating(invoice.id);

      // Call API to generate invoice PDF
      const response = await fetch('/api/generate-invoice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoiceId: invoice.id,
          userId: user?.id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate invoice');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${invoice.id}-${format(new Date(invoice.created_at), 'yyyy-MM-dd')}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);

      toast.success('Invoice downloaded successfully');
    } catch (error) {
      console.error('Error generating invoice:', error);
      toast.error('Failed to generate invoice');
    } finally {
      setGenerating(null);
    }
  };

  const downloadInvoiceHTML = (invoice: Invoice) => {
    const html = generateInvoiceHTML(invoice);
    const blob = new Blob([html], { type: 'text/html' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoice-${invoice.id}-${format(new Date(invoice.created_at), 'yyyy-MM-dd')}.html`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast.success('Invoice downloaded as HTML');
  };

  const generateInvoiceHTML = (invoice: Invoice) => {
    const invoiceDate = new Date(invoice.created_at);
    const invoiceNumber = `INV-${invoice.id.slice(0, 8).toUpperCase()}`;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoiceNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      padding: 40px;
      background: #f9fafb;
    }
    .invoice-container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .invoice-header {
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .invoice-title {
      font-size: 28px;
      font-weight: bold;
      color: #111827;
      margin-bottom: 10px;
    }
    .invoice-meta {
      display: flex;
      justify-content: space-between;
      margin-top: 20px;
    }
    .invoice-meta-item {
      flex: 1;
    }
    .invoice-meta-label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .invoice-meta-value {
      font-size: 14px;
      font-weight: 600;
      color: #111827;
    }
    .invoice-parties {
      display: flex;
      justify-content: space-between;
      margin: 30px 0;
    }
    .invoice-party {
      flex: 1;
    }
    .invoice-party h3 {
      font-size: 14px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .invoice-party p {
      font-size: 14px;
      color: #4b5563;
      margin-bottom: 4px;
    }
    .invoice-items {
      margin: 30px 0;
    }
    .invoice-items table {
      width: 100%;
      border-collapse: collapse;
    }
    .invoice-items th {
      background: #f9fafb;
      padding: 12px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #e5e7eb;
    }
    .invoice-items td {
      padding: 16px 12px;
      font-size: 14px;
      color: #374151;
      border-bottom: 1px solid #f3f4f6;
    }
    .invoice-items .amount {
      text-align: right;
      font-weight: 600;
    }
    .invoice-total {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #e5e7eb;
      text-align: right;
    }
    .invoice-total-row {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 8px;
    }
    .invoice-total-label {
      font-size: 14px;
      color: #6b7280;
      margin-right: 20px;
      min-width: 100px;
      text-align: right;
    }
    .invoice-total-value {
      font-size: 14px;
      color: #374151;
      font-weight: 600;
      min-width: 100px;
      text-align: right;
    }
    .invoice-total-row.grand-total {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }
    .invoice-total-row.grand-total .invoice-total-label {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
    }
    .invoice-total-row.grand-total .invoice-total-value {
      font-size: 20px;
      font-weight: bold;
      color: #111827;
    }
    .invoice-footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 12px;
      color: #9ca3af;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status-badge.paid {
      background: #d1fae5;
      color: #065f46;
    }
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .invoice-container {
        box-shadow: none;
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <div class="invoice-header">
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-meta">
        <div class="invoice-meta-item">
          <div class="invoice-meta-label">Invoice Number</div>
          <div class="invoice-meta-value">${invoiceNumber}</div>
        </div>
        <div class="invoice-meta-item">
          <div class="invoice-meta-label">Date</div>
          <div class="invoice-meta-value">${format(invoiceDate, 'MMMM dd, yyyy')}</div>
        </div>
        <div class="invoice-meta-item">
          <div class="invoice-meta-label">Status</div>
          <div class="invoice-meta-value">
            <span class="status-badge paid">PAID</span>
          </div>
        </div>
      </div>
    </div>

    <div class="invoice-parties">
      <div class="invoice-party">
        <h3>From</h3>
        <p><strong>AI Video Studio</strong></p>
        <p>123 Business Street</p>
        <p>San Francisco, CA 94102</p>
        <p>support@aivideostudio.com</p>
      </div>
      <div class="invoice-party">
        <h3>Bill To</h3>
        <p><strong>${user?.email || 'Customer'}</strong></p>
        <p>User ID: ${user?.id?.slice(0, 8) || 'N/A'}</p>
      </div>
    </div>

    <div class="invoice-items">
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>Type</th>
            <th>Date</th>
            <th class="amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${invoice.description || 'Service Payment'}</td>
            <td>${invoice.type === 'subscription' ? 'Subscription' : invoice.type === 'credit_purchase' ? 'Credit Purchase' : 'Payment'}</td>
            <td>${format(invoiceDate, 'MMM dd, yyyy')}</td>
            <td class="amount">${formatPrice(invoice.amount_cents)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="invoice-total">
      <div class="invoice-total-row">
        <div class="invoice-total-label">Subtotal:</div>
        <div class="invoice-total-value">${formatPrice(invoice.amount_cents)}</div>
      </div>
      <div class="invoice-total-row">
        <div class="invoice-total-label">Tax (0%):</div>
        <div class="invoice-total-value">$0.00</div>
      </div>
      <div class="invoice-total-row grand-total">
        <div class="invoice-total-label">Total:</div>
        <div class="invoice-total-value">${formatPrice(invoice.amount_cents)}</div>
      </div>
    </div>

    <div class="invoice-footer">
      <p>Thank you for your business!</p>
      <p>This is a computer-generated invoice and does not require a signature.</p>
      <p>For questions about this invoice, please contact support@aivideostudio.com</p>
    </div>
  </div>
</body>
</html>
    `;
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="h-20 bg-muted rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>No invoices available</p>
            <p className="text-sm mt-2">
              Invoices will appear here after successful payments
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Invoice History</h3>
          <p className="text-sm text-muted-foreground">
            Download invoices for your records
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {invoices.map((invoice) => (
          <Card key={invoice.id}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      Invoice #{invoice.id.slice(0, 8).toUpperCase()}
                    </span>
                    <Badge variant={invoice.status === 'succeeded' ? 'default' : 'secondary'}>
                      {invoice.status === 'succeeded' ? 'Paid' : invoice.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{format(new Date(invoice.created_at), 'MMM dd, yyyy')}</span>
                    <span>{invoice.description || 'Payment'}</span>
                    <span className="font-medium text-foreground">
                      {formatPrice(invoice.amount_cents)}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {invoice.invoice_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(invoice.invoice_url, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Online
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadInvoiceHTML(invoice)}
                    disabled={generating === invoice.id}
                  >
                    {generating === invoice.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Download
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {invoices.length === limit && (
        <div className="text-center">
          <Button
            variant="outline"
            onClick={() => {
              // Would implement pagination here
              toast.info('Load more functionality would be implemented here');
            }}
          >
            Load More Invoices
          </Button>
        </div>
      )}
    </div>
  );
}