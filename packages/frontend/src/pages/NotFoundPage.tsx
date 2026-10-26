import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FileQuestion, Compass, Award } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="max-w-md w-full bg-surface border border-border shadow-xl rounded-2xl p-6 sm:p-8 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-brand/10 text-brand flex items-center justify-center mx-auto">
          <FileQuestion className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-text">
            404
          </h1>
          <h2 className="text-lg sm:text-xl font-semibold text-text">
            Page Not Found
          </h2>
          <p className="text-sm text-text-muted">
            The event or page you are looking for does not exist or may have been concluded.
          </p>
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
            onClick={() => navigate('/passport')}
            className="w-full flex items-center justify-center gap-2"
          >
            <Award className="w-4 h-4" />
            <span>My Passport</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
