import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Routes, Route } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { CreditProvider } from "@/contexts/CreditContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import SignInPage from "./pages/SignInPage";
import SignUpPage from "./pages/SignUpPage";
import AuthCallback from "./pages/AuthCallback";
import TestAuthCallback from "./pages/TestAuthCallback";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import UpdatePasswordPage from "./pages/UpdatePasswordPage";
import AutoLoginPage from "./pages/auth/AutoLoginPage";
import DashboardPage from "./pages/DashboardPage";
import GeneratePage from "./pages/GeneratePage";
import SettingsPage from "./pages/SettingsPage";
import ProfilePage from "./pages/ProfilePage";
import AdminDashboard from "./pages/admin/AdminDashboard";
import PricingPage from "./pages/PricingPage";
import TransactionsPage from "./pages/TransactionsPage";
import BillingDashboard from "./pages/BillingDashboard";
import PublicLayout from "./components/PublicLayout";
import AuthLayout from "./components/AuthLayout";
import DashboardLayout from "./components/DashboardLayout";
import { Loader2 } from "lucide-react";


const App = () => {
  const { loading } = useAuth();
  useDocumentTitle();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <CreditProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/pricing" element={<PricingPage />} />
          </Route>
          
          <Route element={<AuthLayout />}>
            <Route path="/sign-in" element={<SignInPage />} />
            <Route path="/sign-up" element={<SignUpPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/test-callback" element={<TestAuthCallback />} />
            <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/update-password" element={<UpdatePasswordPage />} />
            <Route path="/auth/auto-login" element={<AutoLoginPage />} />
          </Route>
          
          <Route
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/dashboard/generate" element={<GeneratePage />} />
            <Route path="/dashboard/settings" element={<SettingsPage />} />
            <Route path="/dashboard/profile" element={<ProfilePage />} />
            <Route path="/dashboard/transactions" element={<TransactionsPage />} />
            <Route path="/dashboard/billing" element={<BillingDashboard />} />
            <Route 
              path="/dashboard/admin" 
              element={
                <ProtectedRoute requireAdmin>
                  <AdminDashboard />
                </ProtectedRoute>
              } 
            />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </TooltipProvider>
      </CreditProvider>
    </ThemeProvider>
  );
};


export default App;