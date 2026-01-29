import React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlaskConical, X } from 'lucide-react';
import { stripeConfig } from '@/lib/stripe-config';

interface TestModeBannerProps {
  onDismiss?: () => void;
  compact?: boolean;
}

const TestModeBanner: React.FC<TestModeBannerProps> = ({ onDismiss, compact = false }) => {
  const [isDismissed, setIsDismissed] = React.useState(false);

  if (!stripeConfig.isTestMode || isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  if (compact) {
    return (
      <Badge 
        variant="outline" 
        className="bg-amber-50 text-amber-800 border-amber-300"
      >
        <FlaskConical className="h-3 w-3 mr-1" />
        Test Mode
      </Badge>
    );
  }

  return (
    <Alert className="bg-amber-50 border-amber-200 relative">
      <FlaskConical className="h-4 w-4 text-amber-600" />
      <AlertDescription className="text-amber-800 pr-8">
        <strong>Test Mode Active</strong> - You're using Stripe test keys. Transactions are simulated and no real charges will occur.
      </AlertDescription>
      {onDismiss && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2 h-6 w-6 p-0 hover:bg-amber-100"
          onClick={handleDismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </Alert>
  );
};

export default TestModeBanner;