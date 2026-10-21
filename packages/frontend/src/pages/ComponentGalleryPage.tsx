import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { Skeleton } from '@/components/ui/Skeleton';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, PermissionDeniedState } from '@/components/ui/FeedbackStates';
import { useToast } from '@/components/ui/Toast';

export const ComponentGalleryPage: React.FC = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('buttons');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="brand" size="sm">
            Design System & Component Tokens
          </Badge>
          <Badge variant="neutral" size="sm">
            WCAG 2.2 AA Verified
          </Badge>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text">
          Eventora UI System & Interaction States
        </h1>
        <p className="text-xs sm:text-sm text-text-muted mt-1 max-w-2xl">
          Strictly compliant design tokens: Deep Indigo primary (#4F46E5 / #818CF8), balanced neutral surfaces, 4px grid spacing, 6/10/16 radii, sm/md shadows, and full dark-mode contrast.
        </p>
      </div>

      {/* Tabs navigation */}
      <Tabs
        tabs={[
          { id: 'buttons', label: 'Buttons & Badges' },
          { id: 'inputs', label: 'Inputs & Forms' },
          { id: 'cards', label: 'Cards & Skeletons' },
          { id: 'states', label: 'System States' },
          { id: 'dialogs', label: 'Modals & Toasts' },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* Tab Panels */}
      {activeTab === 'buttons' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Button Variants & Sizes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-text-muted mb-2">Variant Styles</p>
                <div className="flex flex-wrap gap-2.5 items-center">
                  <Button variant="primary">Primary Brand</Button>
                  <Button variant="secondary">Secondary Surface</Button>
                  <Button variant="outline">Outline Border</Button>
                  <Button variant="ghost">Ghost Neutral</Button>
                  <Button variant="danger">Danger Action</Button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-muted mb-2">Button Sizes & Loading</p>
                <div className="flex flex-wrap gap-2.5 items-center">
                  <Button size="sm">Small (sm: 24px)</Button>
                  <Button size="md">Medium (md: 36px)</Button>
                  <Button size="lg">Large (lg: 44px)</Button>
                  <Button isLoading variant="primary">
                    Saving...
                  </Button>
                  <Button disabled variant="primary">
                    Disabled State
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Semantic Badges</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Badge variant="brand">Brand (#4F46E5)</Badge>
                <Badge variant="success">Success / Valid (#15803D)</Badge>
                <Badge variant="warning">Warning / Hold (#B45309)</Badge>
                <Badge variant="error">Error / Expired (#B91C1C)</Badge>
                <Badge variant="info">Info / Notice (#1D4ED8)</Badge>
                <Badge variant="neutral">Neutral Surface</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'inputs' && (
        <Card>
          <CardHeader>
            <CardTitle>Form Controls & Error Semantics</CardTitle>
          </CardHeader>
          <CardContent className="max-w-md space-y-4">
            <Input
              label="Student Email Address"
              required
              placeholder="student@campus.edu"
              helperText="Must be an active institution roll identifier."
            />

            <Input
              label="Roll Number (With Error Validation)"
              required
              placeholder="e.g. CS22B1042"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (e.target.value.length > 0 && e.target.value.length < 5) {
                  setInputError('Roll number must contain at least 5 alphanumeric characters.');
                } else {
                  setInputError('');
                }
              }}
              error={inputError || undefined}
            />

            <Select
              label="Department Affiliation"
              required
              options={[
                { value: 'cs', label: 'Computer Science & Engineering' },
                { value: 'is', label: 'Information Science & Engineering' },
                { value: 'ec', label: 'Electronics & Communication' },
                { value: 'me', label: 'Mechanical Engineering' },
              ]}
            />
          </CardContent>
        </Card>
      )}

      {activeTab === 'cards' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card variant="surface">
              <CardHeader>
                <CardTitle>Surface Card (Default)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-text-muted">
                  Light: #FFFFFF surface on #FAFAFB background. Rounded-md (10px) with subtle 1px border.
                </p>
              </CardContent>
            </Card>

            <Card variant="surface-2">
              <CardHeader>
                <CardTitle>Surface-2 Card (Recessed)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-text-muted">
                  Light: #F4F4F8 / Dark: #1A1A2B. Used for nested containers and secondary metadata.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Zero-CLS Skeletons (Sized to Final Content)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="grid grid-cols-3 gap-3 pt-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'states' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <EmptyState
            title="No Bookings Yet"
            description="You have not registered for any upcoming campus events. Browse the discovery catalog to find sessions."
            actionLabel="Discover Events"
            onAction={() =>
              toast({
                type: 'info',
                title: 'Action Triggered',
                message: 'Navigating to event discovery catalog.',
              })
            }
          />

          <ErrorState
            title="Connection Interrupted"
            description="Unable to sync live attendance manifest from server. Verify connection or switch to offline scanner."
            onRetry={() =>
              toast({
                type: 'info',
                title: 'Retrying Connection',
                message: 'Attempting connection handshake...',
              })
            }
          />

          <PermissionDeniedState
            title="Access Denied"
            description="You do not have permission to view or manage this resource under Eventora's server-enforced role policy."
            onAction={() =>
              toast({
                type: 'warning',
                title: 'Permission Enforced',
                message: 'Denied under server role policy event:manage:owned.',
              })
            }
          />
        </div>
      )}

      {activeTab === 'dialogs' && (
        <Card>
          <CardHeader>
            <CardTitle>Interactive Modals & Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => setIsModalOpen(true)}>
                Open Responsive Sheet / Dialog
              </Button>

              <Button
                variant="outline"
                onClick={() =>
                  toast({
                    type: 'success',
                    title: 'Ticket Checked In',
                    message: 'Aarav Sharma verified via QR scan.',
                  })
                }
              >
                Trigger Success Toast
              </Button>

              <Button
                variant="outline"
                onClick={() =>
                  toast({
                    type: 'error',
                    title: 'Duplicate Check-in Rejected',
                    message: 'Ticket TCK-88219-01 was already checked in at 09:22 AM.',
                  })
                }
              >
                Trigger Error Toast
              </Button>
            </div>

            <Modal
              isOpen={isModalOpen}
              onClose={() => setIsModalOpen(false)}
              title="Responsive Dialog & Mobile Bottom Sheet"
              description="Demonstrating focus trap, backdrop dismissal, drag handle on phones (<768px), and full keyboard navigation."
            >
              <div className="space-y-3">
                <p className="text-xs text-text-muted leading-relaxed">
                  On mobile viewports, this renders as a natural bottom sheet anchored to the lower screen edge with a drag handle. On desktop viewports, it transitions cleanly to an elevated modal dialog.
                </p>
                <div className="flex justify-end gap-2 pt-3 border-t border-border">
                  <Button variant="secondary" size="sm" onClick={() => setIsModalOpen(false)}>
                    Close Window
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setIsModalOpen(false);
                      toast({
                        type: 'info',
                        title: 'Confirmed',
                        message: 'Action completed inside dialog.',
                      });
                    }}
                  >
                    Confirm
                  </Button>
                </div>
              </div>
            </Modal>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
