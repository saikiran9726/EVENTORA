import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/lib/api-client';
import { KeyRound, Mail, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface ForgotPasswordPageProps {
  onNavigateLogin: () => void;
}

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({ onNavigateLogin }) => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [devResetToken, setDevResetToken] = useState<string | null>(null);

  // Reset phase
  const [newPassword, setNewPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetCompleted, setResetCompleted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setErrorMessage('Please enter your email.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await apiClient.post<{ message: string; resetToken?: string }>('/api/v1/auth/forgot', { email });
      setSubmitted(true);
      if (res?.resetToken) {
        setDevResetToken(res.resetToken);
      }
    } catch (err: any) {
      setErrorMessage(err.error?.message || 'Failed to submit reset request.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!devResetToken || !newPassword) return;

    setIsResetting(true);
    setErrorMessage(null);

    try {
      await apiClient.post('/api/v1/auth/reset', {
        token: devResetToken,
        newPassword,
      });
      setResetCompleted(true);
    } catch (err: any) {
      setErrorMessage(err.error?.message || 'Failed to reset password.');
    } finally {
      setIsResetting(false);
    }
  };

  if (resetCompleted) {
    return (
      <div className="w-full max-w-md mx-auto py-8 px-4 sm:px-0">
        <Card className="border border-border shadow-md text-center p-6 space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-success/10 text-success mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-text">
            Password Reset Complete
          </CardTitle>
          <p className="text-sm text-muted">
            Your password has been securely updated using Argon2id encryption. You can now log in.
          </p>
          <Button variant="primary" onClick={onNavigateLogin} className="w-full mt-4">
            Sign In with New Password
          </Button>
        </Card>
      </div>
    );
  }

  if (submitted && devResetToken) {
    return (
      <div className="w-full max-w-md mx-auto py-8 px-4 sm:px-0">
        <Card className="border border-border shadow-md">
          <CardHeader className="text-center pb-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-600/10 text-brand-600 mb-3 mx-auto">
              <KeyRound className="w-6 h-6" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight text-text">
              Set New Password
            </CardTitle>
            <p className="text-sm text-muted mt-1">
              Enter your new secure password below
            </p>
          </CardHeader>

          <CardContent className="space-y-4 pt-4">
            {errorMessage && (
              <div
                role="alert"
                className="p-3 rounded-md bg-error/10 border border-error/20 flex items-start gap-2 text-xs text-error"
              >
                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label htmlFor="new-pass" className="block text-xs font-semibold text-text mb-1">
                  New Password (min 8 chars, 1 uppercase, 1 number)
                </label>
                <Input
                  id="new-pass"
                  type="password"
                  placeholder="••••••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={isResetting}
                  required
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                isLoading={isResetting}
                disabled={isResetting || newPassword.length < 8}
              >
                Update Password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto py-8 px-4 sm:px-0">
      <Card className="border border-border shadow-md">
        <CardHeader className="text-center pb-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-600/10 text-brand-600 mb-3 mx-auto">
            <KeyRound className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-text">
            Reset Password
          </CardTitle>
          <p className="text-sm text-muted mt-1">
            Enter your college email address to receive reset instructions
          </p>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          {errorMessage && (
            <div
              role="alert"
              className="p-3 rounded-md bg-error/10 border border-error/20 flex items-start gap-2 text-xs text-error"
            >
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {submitted ? (
            <div className="p-4 rounded-md bg-surface-2 border border-border text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-success mx-auto" />
              <p className="text-sm font-semibold text-text">Link Dispatched</p>
              <p className="text-xs text-muted">
                If that email exists in our system, a password reset link has been dispatched.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="reset-email" className="block text-xs font-semibold text-text mb-1">
                  College Email
                </label>
                <div className="relative">
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="student1@campus.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                    required
                    className="pl-9"
                  />
                  <Mail className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                isLoading={isLoading}
                disabled={isLoading}
              >
                Send Reset Link
              </Button>
            </form>
          )}
        </CardContent>

        <CardFooter className="justify-center border-t border-border pt-4 text-xs text-muted">
          <span>Remember your credentials? </span>
          <button
            type="button"
            onClick={onNavigateLogin}
            className="ml-1 text-brand-600 font-semibold hover:underline"
          >
            Sign In
          </button>
        </CardFooter>
      </Card>
    </div>
  );
};
