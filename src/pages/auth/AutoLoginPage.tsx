import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function AutoLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleAutoLogin = async () => {
      const token = searchParams.get('token');
      const type = searchParams.get('type');

      if (!token || type !== 'magiclink') {
        setError('Invalid login link');
        setTimeout(() => navigate('/sign-in'), 3000);
        return;
      }

      try {
        // Verify the magic link token
        const { error } = await supabase.auth.verifyOtp({
          token_hash: token,
          type: 'magiclink',
        });

        if (error) {
          console.error('Auto-login error:', error);
          setError('Login link expired or invalid');
          setTimeout(() => navigate('/sign-in'), 3000);
          return;
        }

        // Success! The user is now logged in
        toast.success('Welcome! Your account has been created and you are now logged in.');
        
        // Redirect to dashboard with welcome message
        navigate('/dashboard?welcome=true', { replace: true });
      } catch (err: any) {
        console.error('Auto-login error:', err);
        setError('Failed to log in automatically');
        setTimeout(() => navigate('/sign-in'), 3000);
      }
    };

    handleAutoLogin();
  }, [navigate, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        {error ? (
          <div className="space-y-4">
            <p className="text-red-500">{error}</p>
            <p className="text-sm text-muted-foreground">Redirecting to sign in...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto" />
            <p className="text-lg">Logging you in...</p>
            <p className="text-sm text-muted-foreground">Please wait while we set up your account</p>
          </div>
        )}
      </div>
    </div>
  );
}