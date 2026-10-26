import React, { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/api-client';
import { Eye, EyeOff, Lock, Mail, User, CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';

interface RegisterPageProps {
  onSuccess?: () => void;
  onNavigateLogin?: () => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({
  onSuccess: _onSuccess,
  onNavigateLogin,
}) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const handleNavigateLogin =
    onNavigateLogin ||
    (() => navigate(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login'));
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Verification step state
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedSuccess, setVerifiedSuccess] = useState(false);

  // Password strength calculations
  const passwordCriteria = useMemo(() => {
    return {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
    };
  }, [password]);

  const strengthScore = useMemo(() => {
    let score = 0;
    if (passwordCriteria.length) score += 33;
    if (passwordCriteria.uppercase) score += 33;
    if (passwordCriteria.number) score += 34;
    return score;
  }, [passwordCriteria]);

  const strengthLabel = useMemo(() => {
    if (strengthScore === 0) return { text: 'Empty', color: 'bg-muted' };
    if (strengthScore < 50) return { text: 'Weak', color: 'bg-error' };
    if (strengthScore < 100) return { text: 'Moderate', color: 'bg-warning' };
    return { text: 'Strong', color: 'bg-success' };
  }, [strengthScore]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName || !email || !password) {
      setErrorMessage('All fields are required.');
      return;
    }

    if (strengthScore < 100) {
      setErrorMessage('Please satisfy all password security requirements.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const result = await register({ displayName, email, password });
    setIsLoading(false);

    if (result.success) {
      setVerificationPending(true);
      if (result.verificationToken) {
        setVerificationToken(result.verificationToken);
      }
    } else {
      setErrorMessage(result.error || 'Registration failed.');
    }
  };

  const handleVerify = async () => {
    if (!verificationToken) {
      setErrorMessage('Please provide a verification token.');
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);

    try {
      await apiClient.post('/api/v1/auth/verify-email', { token: verificationToken });
      setVerifiedSuccess(true);
    } catch (err: any) {
      setErrorMessage(err.error?.message || 'Invalid or expired verification token.');
    } finally {
      setIsVerifying(false);
    }
  };

  if (verifiedSuccess) {
    return (
      <div className="w-full max-w-md mx-auto py-8 px-4 sm:px-0">
        <Card className="border border-border shadow-md text-center p-6 space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-success/10 text-success mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-text">
            Email Verified!
          </CardTitle>
          <p className="text-sm text-muted">
            Your college email has been verified. You can now sign in with your credentials.
          </p>
          <Button variant="primary" onClick={handleNavigateLogin} className="w-full mt-4">
            Proceed to Sign In
          </Button>
        </Card>
      </div>
    );
  }

  if (verificationPending) {
    return (
      <div className="w-full max-w-md mx-auto py-8 px-4 sm:px-0">
        <Card className="border border-border shadow-md">
          <CardHeader className="text-center pb-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-600/10 text-brand-600 mb-3 mx-auto">
              <Mail className="w-6 h-6" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight text-text">
              Verify Your College Email
            </CardTitle>
            <p className="text-sm text-muted mt-1">
              We sent a verification link to <span className="font-semibold text-text">{email}</span>.
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

            <div>
              <label htmlFor="verify-token" className="block text-xs font-semibold text-text mb-1">
                Verification Token
              </label>
              <Input
                id="verify-token"
                type="text"
                placeholder="Paste token or use auto-filled token"
                value={verificationToken}
                onChange={(e) => setVerificationToken(e.target.value)}
                disabled={isVerifying}
                required
              />
              <p className="text-xs text-muted mt-1.5">
                (In test/dev mode, your verification token is pre-filled above).
              </p>
            </div>

            <Button
              variant="primary"
              onClick={handleVerify}
              isLoading={isVerifying}
              disabled={isVerifying}
              className="w-full"
            >
              Verify Email & Activate
            </Button>
          </CardContent>

          <CardFooter className="justify-center border-t border-border pt-4 text-xs text-muted">
            <span>Already verified? </span>
            <button
              type="button"
              onClick={handleNavigateLogin}
              className="ml-1 text-brand-600 font-semibold hover:underline"
            >
              Sign In
            </button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto py-8 px-4 sm:px-0">
      <Card className="border border-border shadow-md">
        <CardHeader className="text-center pb-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-600/10 text-brand-600 mb-3 mx-auto">
            <User className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-text">
            Join Eventora
          </CardTitle>
          <p className="text-sm text-muted mt-1">
            Create an account with your official campus domain
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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="reg-name" className="block text-xs font-semibold text-text mb-1">
                Full Name
              </label>
              <div className="relative">
                <Input
                  id="reg-name"
                  type="text"
                  placeholder="e.g. Aarav Sharma"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={isLoading}
                  required
                  className="pl-9"
                  autoComplete="name"
                />
                <User className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div>
              <label htmlFor="reg-email" className="block text-xs font-semibold text-text mb-1">
                Official College Email
              </label>
              <div className="relative">
                <Input
                  id="reg-email"
                  type="email"
                  placeholder="username@campus.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  required
                  className="pl-9"
                  autoComplete="email"
                />
                <Mail className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div>
              <label htmlFor="reg-password" className="block text-xs font-semibold text-text mb-1">
                Password
              </label>
              <div className="relative">
                <Input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                  className="pl-9 pr-10"
                  autoComplete="new-password"
                />
                <Lock className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Password Strength Meter */}
              {password.length > 0 && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Password strength:</span>
                    <span className="font-semibold text-text">{strengthLabel.text}</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${strengthLabel.color}`}
                      style={{ width: `${strengthScore}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-1 pt-1 text-[11px] text-muted">
                    <div className="flex items-center gap-1">
                      {passwordCriteria.length ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-muted shrink-0" />
                      )}
                      <span>8+ chars</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {passwordCriteria.uppercase ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-muted shrink-0" />
                      )}
                      <span>1 uppercase</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {passwordCriteria.number ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-muted shrink-0" />
                      )}
                      <span>1 number</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full mt-2"
              isLoading={isLoading}
              disabled={isLoading || strengthScore < 100}
            >
              Create Account
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center border-t border-border pt-4 text-xs text-muted">
          <span>Already registered? </span>
          <button
            type="button"
            onClick={handleNavigateLogin}
            className="ml-1 text-brand-600 font-semibold hover:underline"
          >
            Sign In
          </button>
        </CardFooter>
      </Card>
    </div>
  );
};
