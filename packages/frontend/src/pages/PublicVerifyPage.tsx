import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient, ApiError } from '@/lib/api-client';
import { reportError } from '@/lib/error-reporter';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  Lock,
  Building,
  ArrowLeft,
} from 'lucide-react';

export interface VerifyResult {
  found: boolean;
  valid: boolean;
  status: 'VALID' | 'REVOKED';
  verificationCode?: string;
  issuedAt?: string;
  eventTitle?: string;
  eventDate?: string;
  attendeeInitials?: string;
  revokeReason?: string;
  message?: string;
}

export const PublicVerifyPage: React.FC<{
  initialCode?: string;
  onBack?: () => void;
}> = ({ initialCode: propInitialCode, onBack: propOnBack }) => {
  const params = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const initialCode = propInitialCode || params.code || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('code') || '' : '');
  const onBack = propOnBack || (() => navigate('/passport'));
  const [code, setCode] = useState(initialCode);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const performVerification = async (codeToVerify: string) => {
    const clean = codeToVerify.trim();
    if (!clean) return;

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const data = await apiClient.get<VerifyResult>(`/api/v1/verify/${encodeURIComponent(clean)}`);
      setResult(data);
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setResult({
            found: false,
            valid: false,
            status: 'REVOKED',
            message: err.message || 'Certificate code not found in campus database.',
          });
        } else if (err.status === 429) {
          setErrorMsg('Rate limit exceeded (max 30 verifications/minute). Please wait 1 minute before retrying.');
        } else {
          setErrorMsg(err.message || 'An error occurred during verification.');
        }
      } else {
        reportError(err, { context: 'verifyCode', clean });
        setErrorMsg('Could not communicate with the verification server. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (initialCode) {
      performVerification(initialCode);
    }
  }, [initialCode]);

  return (
    <div className="min-h-screen bg-bg text-text py-12 px-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-lg space-y-6">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Eventora</span>
          </button>
        )}

        {/* Verification Portal Header */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-brand/10 text-brand flex items-center justify-center mx-auto border border-brand/20 shadow-sm">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text">
            Public Certificate Verification
          </h1>
          <p className="text-xs text-text-muted max-w-sm mx-auto">
            Authenticates official credentials issued by campus organizers via Crockford Base32 cryptographic integrity.
          </p>
        </div>

        {/* Code Input Card */}
        <Card className="p-5 shadow-sm space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text">
              12-Character Verification Code
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. 7H9K-2M4N-8PQR"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') performVerification(code);
                }}
                className="font-mono text-sm tracking-widest text-center"
              />
              <Button
                variant="primary"
                size="md"
                disabled={isLoading || !code.trim()}
                onClick={() => performVerification(code)}
              >
                <Search className="w-4 h-4 mr-1" />
                <span>Verify</span>
              </Button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-error/10 border border-error/30 rounded-md text-xs text-error flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </Card>

        {/* Verification Result Display */}
        {result && (
          <Card
            className={`p-6 border-2 transition-all ${
              result.valid
                ? 'border-success bg-success/5'
                : 'border-error bg-error/5'
            }`}
          >
            <div className="flex flex-col items-center text-center space-y-4">
              {result.valid ? (
                <div className="w-16 h-16 rounded-full bg-success/20 text-success flex items-center justify-center border-2 border-success">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-full bg-error/20 text-error flex items-center justify-center border-2 border-error">
                  <XCircle className="w-10 h-10" />
                </div>
              )}

              <div className="space-y-1">
                <Badge
                  variant={result.valid ? 'success' : 'error'}
                  size="md"
                  className="px-3 py-1 text-xs uppercase font-mono tracking-wider"
                >
                  {result.valid ? 'Official Valid Credential' : 'Invalid / Revoked'}
                </Badge>
                <h2 className="text-lg font-bold text-text pt-2">
                  {result.valid ? 'Authentic Campus Record' : 'Credential Invalid'}
                </h2>
                <p className="text-xs text-text-muted">
                  {result.valid
                    ? 'This certificate has been cryptographically confirmed against the campus registry.'
                    : result.message || 'The specified verification code is invalid or has been revoked.'}
                </p>
              </div>

              {result.valid && (
                <div className="w-full bg-surface rounded-xl p-4 border border-border text-left space-y-3 text-xs">
                  <div className="flex items-start gap-2">
                    <Building className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[10px] text-text-muted font-medium block">Event Title</span>
                      <p className="font-bold text-text">{result.eventTitle}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                    <div>
                      <span className="text-[10px] text-text-muted font-medium block">Event Date</span>
                      <p className="font-semibold text-text">
                        {result.eventDate ? new Date(result.eventDate).toLocaleDateString() : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-text-muted font-medium block">Attendee Initials</span>
                      <p className="font-bold text-brand tracking-widest text-sm">
                        {result.attendeeInitials}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-text-muted">
                    <span className="font-mono">Code: {result.verificationCode}</span>
                    <Badge variant="neutral" size="sm">Zero PII Leak Verified</Badge>
                  </div>
                </div>
              )}

              {!result.valid && result.revokeReason && (
                <div className="w-full bg-surface rounded-xl p-3 border border-error/40 text-left text-xs">
                  <span className="text-[10px] font-bold text-error uppercase tracking-wider block mb-1">
                    Revocation Details
                  </span>
                  <p className="text-text-muted">{result.revokeReason}</p>
                </div>
              )}

              {/* Privacy Notice */}
              <div className="flex items-center gap-1.5 text-[11px] text-text-muted pt-2">
                <Lock className="w-3.5 h-3.5 text-brand" />
                <span>Zero PII Protection: Student names and IDs are withheld from public logs.</span>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
