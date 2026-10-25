import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { Eye, EyeOff, Lock, Mail, ShieldAlert, Sparkles } from 'lucide-react';

interface LoginPageProps {
  onSuccess: () => void;
  onNavigateRegister: () => void;
  onNavigateForgot: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onSuccess,
  onNavigateRegister,
  onNavigateForgot,
}) => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const result = await login(email, password);
    setIsLoading(false);

    if (result.success) {
      onSuccess();
    } else {
      setErrorMessage(result.error || 'Invalid email or password.');
    }
  };

  const handleQuickLogin = (quickEmail: string) => {
    setEmail(quickEmail);
    setPassword('Eventora#Test2026!');
    setErrorMessage(null);
  };

  return (
    <div className="w-full max-w-md mx-auto py-8 px-4 sm:px-0">
      <Card className="border border-border shadow-md">
        <CardHeader className="text-center pb-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-600/10 text-brand-600 mb-3 mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-text">
            Sign In to Eventora
          </CardTitle>
          <p className="text-sm text-muted mt-1">
            Access your campus events, passes, and organizer tools
          </p>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          {errorMessage && (
            <div
              role="alert"
              className="p-3 rounded-md bg-error/10 border border-error/20 flex items-start gap-2 text-xs sm:text-sm text-error"
            >
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-semibold text-text mb-1">
                College Email Address
              </label>
              <div className="relative">
                <Input
                  id="login-email"
                  type="email"
                  placeholder="student1@campus.edu"
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
              <div className="flex justify-between items-center mb-1">
                <label htmlFor="login-password" className="text-xs font-semibold text-text">
                  Password
                </label>
                <button
                  type="button"
                  onClick={onNavigateForgot}
                  className="text-xs text-brand-600 hover:underline font-medium"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                  className="pl-9 pr-10"
                  autoComplete="current-password"
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
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full mt-2"
              isLoading={isLoading}
              disabled={isLoading}
            >
              Sign In
            </Button>
          </form>

          {/* Quick Demo Accounts Selection */}
          <div className="pt-4 border-t border-border mt-6">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted mb-2">
              <Sparkles className="w-3.5 h-3.5 text-brand-600" />
              <span>One-Click Test Account Fill (Dev Mode):</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => handleQuickLogin('student1@campus.edu')}
                className="text-xs px-2.5 py-1 rounded bg-surface-2 border border-border hover:border-brand-600 text-text font-medium"
              >
                Student
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin('organizer.ras@campus.edu')}
                className="text-xs px-2.5 py-1 rounded bg-surface-2 border border-border hover:border-brand-600 text-text font-medium"
              >
                Organizer (RAS)
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin('reviewer.faculty@campus.edu')}
                className="text-xs px-2.5 py-1 rounded bg-surface-2 border border-border hover:border-brand-600 text-text font-medium"
              >
                Faculty Reviewer
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin('admin.system@campus.edu')}
                className="text-xs px-2.5 py-1 rounded bg-surface-2 border border-border hover:border-brand-600 text-text font-medium"
              >
                System Admin
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin('checkin.gate@campus.edu')}
                className="text-xs px-2.5 py-1 rounded bg-surface-2 border border-border hover:border-brand-600 text-text font-medium"
              >
                Check-in Staff
              </button>
            </div>
          </div>
        </CardContent>

        <CardFooter className="justify-center border-t border-border pt-4 text-xs text-muted">
          <span>Don&apos;t have an account? </span>
          <button
            type="button"
            onClick={onNavigateRegister}
            className="ml-1 text-brand-600 font-semibold hover:underline"
          >
            Create campus account
          </button>
        </CardFooter>
      </Card>
    </div>
  );
};
