import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/lib/api-client';
import { MailCheck, CheckCircle2, ShieldAlert, Loader2 } from 'lucide-react';

export const VerifyEmailPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const verifyToken = async () => {
      if (!token) {
        setErrorMessage('No verification token provided in URL.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        await apiClient.post('/api/v1/auth/verify-email', { token });
        if (!isCancelled) {
          setIsSuccess(true);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setErrorMessage(
            err.error?.message || err.message || 'Verification token is invalid or has expired.'
          );
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    verifyToken();

    return () => {
      isCancelled = true;
    };
  }, [token]);

  return (
    <div className="w-full max-w-md mx-auto py-12 px-4">
      <Card className="border border-border shadow-md">
        <CardHeader className="text-center pb-2">
          <div className="w-12 h-12 rounded-full bg-brand/10 text-brand flex items-center justify-center mx-auto mb-3">
            <MailCheck className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-text">
            Email Verification
          </CardTitle>
          <p className="text-sm text-text-muted mt-1">
            Activating your Eventora campus account
          </p>
        </CardHeader>

        <CardContent className="pt-4 space-y-4">
          {isLoading && (
            <div className="text-center py-8 space-y-3">
              <Loader2 className="w-8 h-8 text-brand animate-spin mx-auto" />
              <p className="text-sm text-text-muted">Verifying your college email address...</p>
            </div>
          )}

          {errorMessage && (
            <div className="space-y-4">
              <div role="alert" className="p-3 rounded-md bg-error/10 border border-error/20 flex items-start gap-2 text-xs sm:text-sm text-error">
                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => navigate('/login')} className="w-full">
                  Go to Sign In
                </Button>
                <Button variant="outline" onClick={() => navigate('/register')} className="w-full">
                  Register
                </Button>
              </div>
            </div>
          )}

          {isSuccess && (
            <div className="text-center space-y-4 py-4">
              <div className="w-12 h-12 rounded-full bg-success/10 text-success flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <p className="text-sm text-text font-medium">
                Email verified successfully! Your account is active and ready for event registrations.
              </p>
              <Button
                variant="primary"
                onClick={() => navigate('/login')}
                className="w-full"
              >
                Sign In Now
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
