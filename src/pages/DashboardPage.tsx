import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import PageLayout from "@/components/PageLayout";
import CreditBalance from "@/components/CreditBalance";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from 'lucide-react';

const DashboardPage = () => {
  const { user, hasActiveSubscription } = useAuth();
  const [showLowCreditAlert, setShowLowCreditAlert] = useState(false);

  const handleLowBalance = (balance: number) => {
    setShowLowCreditAlert(balance < 100);
  };

  return (
    <PageLayout 
      title="Dashboard" 
      description={`Welcome back, ${user?.email?.split('@')[0] || "User"}!`}
    >
      {showLowCreditAlert && (
        <Alert className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Your credit balance is running low. Top up credits to continue generating videos without interruption.
          </AlertDescription>
        </Alert>
      )}
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {hasActiveSubscription && (
          <div className="md:col-span-1">
            <CreditBalance onLowBalance={handleLowBalance} />
          </div>
        )}
      </div>
    </PageLayout>
  );
};

export default DashboardPage;