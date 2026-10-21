import React from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

interface ExpiredSessionModalProps {
  isOpen: boolean;
  onSignIn: () => void;
}

export const ExpiredSessionModal: React.FC<ExpiredSessionModalProps> = ({ isOpen, onSignIn }) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {}}
      title="Session Expired"
      description="Your session has expired due to 30 minutes of inactivity or revocation. Please sign in again to continue."
    >
      <div className="pt-4">
        <Button variant="primary" onClick={onSignIn} className="w-full">
          Sign In Again
        </Button>
      </div>
    </Dialog>
  );
};
