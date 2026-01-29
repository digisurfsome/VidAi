import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { testCards } from '@/lib/stripe-config';
import { getTestMode, setTestMode, subscribeToTestModeChanges } from '@/lib/stripe-test-mode';
import TestDataGenerator from './TestDataGenerator';
import {
  FlaskConical,
  ShieldCheck,
  CreditCard,
  AlertTriangle,
  Copy,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';

const TestModeSettings: React.FC = () => {
  const { toast } = useToast();
  const [copiedCard, setCopiedCard] = useState<string | null>(null);
  const [isTestMode, setIsTestMode] = useState(getTestMode());
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    // Subscribe to test mode changes
    const unsubscribe = subscribeToTestModeChanges((newTestMode) => {
      setIsTestMode(newTestMode);
    });

    return unsubscribe;
  }, []);

  const handleCopyCard = (cardNumber: string) => {
    navigator.clipboard.writeText(cardNumber);
    setCopiedCard(cardNumber);
    toast({
      title: 'Card number copied',
      description: 'Test card number copied to clipboard',
    });
    setTimeout(() => setCopiedCard(null), 2000);
  };

  const handleToggleTestMode = async (checked: boolean) => {
    setIsChanging(true);
    
    // Update local state immediately
    setIsTestMode(checked);
    
    // Store in localStorage
    setTestMode(checked);
    
    // Show toast
    toast({
      title: checked ? 'Test Mode Enabled' : 'Live Mode Enabled',
      description: checked 
        ? 'Now using Stripe test keys. Page will refresh to apply changes.'
        : 'Now using live Stripe keys. Page will refresh to apply changes.',
    });
    
    // Refresh the page after a short delay to apply the changes
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  };

  return (
    <div className="space-y-6">
      {/* Test Mode Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Test Mode Configuration
          </CardTitle>
          <CardDescription>
            Manage test mode settings for safe development and testing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-1">
              <Label htmlFor="test-mode" className="text-base font-medium">
                Test Mode Status
              </Label>
              <p className="text-sm text-muted-foreground">
                {isTestMode 
                  ? 'Using Stripe test keys - safe for testing' 
                  : 'Using live Stripe keys - real transactions'
                }
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isChanging && (
                <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {isTestMode ? (
                <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                  <FlaskConical className="h-3 w-3 mr-1" />
                  Test Mode
                </Badge>
              ) : (
                <Badge className="bg-green-100 text-green-800 border-green-300">
                  <ShieldCheck className="h-3 w-3 mr-1" />
                  Live Mode
                </Badge>
              )}
              <Switch
                id="test-mode"
                checked={isTestMode}
                onCheckedChange={handleToggleTestMode}
                disabled={isChanging}
              />
            </div>
          </div>

          {!isChanging && (
            <Alert className="border-blue-200 bg-blue-50">
              <AlertTriangle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                Toggle the switch to change between test and live modes. The page will refresh to apply changes.
                {isTestMode && ' Test mode uses Stripe test keys for safe development.'}
                {!isTestMode && ' Live mode uses real Stripe keys and processes real payments.'}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Test Cards */}
      {isTestMode && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Test Credit Cards
            </CardTitle>
            <CardDescription>
              Use these test card numbers to simulate different payment scenarios
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="success" className="w-full">
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="success">Success</TabsTrigger>
                <TabsTrigger value="authentication">3D Secure</TabsTrigger>
                <TabsTrigger value="failures">Failures</TabsTrigger>
              </TabsList>

              <TabsContent value="success" className="space-y-3">
                <TestCardItem
                  label="Standard Success"
                  card={testCards.success}
                  onCopy={handleCopyCard}
                  isCopied={copiedCard === testCards.success.number}
                />
              </TabsContent>

              <TabsContent value="authentication" className="space-y-3">
                <TestCardItem
                  label="Requires Authentication"
                  card={testCards.requiresAuth}
                  onCopy={handleCopyCard}
                  isCopied={copiedCard === testCards.requiresAuth.number}
                />
              </TabsContent>

              <TabsContent value="failures" className="space-y-3">
                <TestCardItem
                  label="Card Declined"
                  card={testCards.declined}
                  onCopy={handleCopyCard}
                  isCopied={copiedCard === testCards.declined.number}
                />
                <TestCardItem
                  label="Insufficient Funds"
                  card={testCards.insufficientFunds}
                  onCopy={handleCopyCard}
                  isCopied={copiedCard === testCards.insufficientFunds.number}
                />
                <TestCardItem
                  label="Expired Card"
                  card={testCards.expiredCard}
                  onCopy={handleCopyCard}
                  isCopied={copiedCard === testCards.expiredCard.number}
                />
                <TestCardItem
                  label="Processing Error"
                  card={testCards.processingError}
                  onCopy={handleCopyCard}
                  isCopied={copiedCard === testCards.processingError.number}
                />
              </TabsContent>
            </Tabs>

            <div className="mt-4 p-3 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                <strong>Test card details:</strong> Use any future expiry date, any 3-digit CVC, and any 5-digit ZIP code.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test Mode Features */}
      <Card>
        <CardHeader>
          <CardTitle>Test Mode Features</CardTitle>
          <CardDescription>
            Available features when running in test mode
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p className="font-medium">Safe Testing Environment</p>
              <p className="text-sm text-muted-foreground">
                All transactions are simulated with no real charges
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p className="font-medium">Test User Isolation</p>
              <p className="text-sm text-muted-foreground">
                Test users and data are marked and separated from production
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p className="font-medium">Webhook Testing</p>
              <p className="text-sm text-muted-foreground">
                Separate webhook endpoint for testing Stripe events
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p className="font-medium">Test Data Generation</p>
              <p className="text-sm text-muted-foreground">
                Generate test subscriptions and transactions for QA
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test Data Generator */}
      {isTestMode && (
        <TestDataGenerator />
      )}
    </div>
  );
};

// Test Card Item Component
interface TestCardItemProps {
  label: string;
  card: { number: string; description: string };
  onCopy: (number: string) => void;
  isCopied: boolean;
}

const TestCardItem: React.FC<TestCardItemProps> = ({ label, card, onCopy, isCopied }) => {
  return (
    <div className="flex items-center justify-between p-3 border rounded-lg">
      <div className="space-y-1">
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{card.description}</p>
        <code className="text-sm font-mono">{card.number}</code>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onCopy(card.number)}
      >
        {isCopied ? (
          <>
            <CheckCircle className="h-4 w-4 mr-1 text-green-600" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-4 w-4 mr-1" />
            Copy
          </>
        )}
      </Button>
    </div>
  );
};

export default TestModeSettings;