import React from 'react';
import { Shield, Lock, FileText, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const PrivacyPolicyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-background text-text py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.history.back()}
            className="flex items-center gap-2 text-xs"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </Button>
          <span className="text-xs text-text-muted">Effective Date: October 29, 2026</span>
        </div>

        <div className="border-b border-border pb-6 space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-brand/10 text-brand">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-text">Privacy Policy & Data Protection</h1>
              <p className="text-xs text-text-muted">
                Compliance with Digital Personal Data Protection (DPDP) Act 2023 & GDPR Privacy Principles
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6 text-sm text-text-muted leading-relaxed">
          <Card className="p-6 space-y-4 border border-border">
            <h2 className="text-base font-semibold text-text flex items-center gap-2">
              <Lock className="w-4 h-4 text-brand" />
              1. Principles of Data Minimization & Security
            </h2>
            <p>
              Eventora processes personal information solely for facilitating collegiate events, issuing digital verifiable passes, and maintaining campus safety. We do not sell, rent, or monetize personal data under any circumstances.
            </p>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              <li>IP addresses are subnet-truncated (/24 for IPv4, /48 for IPv6) and irreversibly hashed with cryptographic salt before persistence.</li>
              <li>Passwords are protected using Argon2id with strict parameters (64 MiB memory, t=3, p=1).</li>
              <li>Authentication sessions are managed via authoritative HTTP-only SameSite cookies with double-submit CSRF tokens.</li>
            </ul>
          </Card>

          <Card className="p-6 space-y-4 border border-border">
            <h2 className="text-base font-semibold text-text flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand" />
              2. Data Collected & Legal Basis
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-surface-2 rounded-lg border border-border space-y-1">
                <span className="font-semibold text-text">Account Information</span>
                <p>College email address, student display name, department, academic year, and verified institution charter.</p>
              </div>
              <div className="p-3 bg-surface-2 rounded-lg border border-border space-y-1">
                <span className="font-semibold text-text">Event Participation</span>
                <p>Booked tickets, waitlist positions, dynamic questionnaire responses, and check-in audit timestamps.</p>
              </div>
            </div>
          </Card>

          <Card className="p-6 space-y-4 border border-border">
            <h2 className="text-base font-semibold text-text flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-brand" />
              3. Data Retention Schedules
            </h2>
            <p className="text-xs">
              In accordance with DPDP storage limitation mandates:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border border-border rounded">
                <thead className="bg-surface-2 text-text font-semibold">
                  <tr>
                    <th className="p-2.5 border-b border-border">Data Category</th>
                    <th className="p-2.5 border-b border-border">Retention Period</th>
                    <th className="p-2.5 border-b border-border">Action Post-Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="p-2.5 font-medium text-text">Scan Logs & Turnstile Records</td>
                    <td className="p-2.5">90 Days</td>
                    <td className="p-2.5">Automated Purge</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-medium text-text">Outbox & Notifications</td>
                    <td className="p-2.5">30 Days</td>
                    <td className="p-2.5">Automated Purge</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-medium text-text">Financial Ledger Rows</td>
                    <td className="p-2.5">7 Years (Statutory Tax Law)</td>
                    <td className="p-2.5">Retained Anonymized</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-medium text-text">Expired Auth Tokens & Sessions</td>
                    <td className="p-2.5">7–30 Days</td>
                    <td className="p-2.5">Automated Cleanup</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-6 space-y-4 border border-border">
            <h2 className="text-base font-semibold text-text">4. Your Rights as a Data Principal</h2>
            <p className="text-xs">
              Under DPDP 2023 and GDPR, you have unconditional rights regarding your personal information:
            </p>
            <div className="space-y-2 text-xs">
              <p><strong className="text-text">Right to Data Portability:</strong> You may download your complete personal data dossier at any time in machine-readable JSON format via <code>GET /api/v1/me/data-export</code>.</p>
              <p><strong className="text-text">Right to Erasure:</strong> You can permanently delete and anonymize your account via <code>DELETE /api/v1/me</code>. Personal identifiers are expunged while preserving required financial ledger integrity.</p>
              <p><strong className="text-text">Grievance Redressal Officer:</strong> For privacy inquiries or compliance concerns, contact the Data Protection Officer at <code>privacy@eventora.internal</code>.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
