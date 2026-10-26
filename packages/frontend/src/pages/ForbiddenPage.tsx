import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ShieldX, Compass, ArrowLeft } from 'lucide-react';

export interface ForbiddenPageProps {
  allowedRoles?: string[];
}

export const ForbiddenPage: React.FC<ForbiddenPageProps> = ({ allowedRoles }) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="max-w-md w-full bg-surface border border-error/20 shadow-xl rounded-2xl p-6 sm:p-8 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-error/10 text-error flex items-center justify-center mx-auto">
          <ShieldX className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text">
            403 — Access Denied
          </h1>
          <p className="text-sm text-text-muted">
            You do not have the required role privileges to access this campus portal.
          </p>
          {allowedRoles && allowedRoles.length > 0 && (
            <p className="text-xs text-text-muted font-mono bg-surface-2 py-1 px-2 rounded-md inline-block">
              Required: {allowedRoles.join(' or ')}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button
            variant="primary"
            onClick={() => navigate('/')}
            className="w-full flex items-center justify-center gap-2"
          >
            <Compass className="w-4 h-4" />
            <span>Discover Events</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="w-full flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go Back</span>
          </Button>
        </div>

        <div className="pt-2 text-xs text-text-muted border-t border-border">
          Need organizer or reviewer access? Contact your campus student activities administrator.
        </div>
      </div>
    </div>
  );
};
