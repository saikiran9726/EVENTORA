import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { Switch } from '@/components/ui/Switch';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { Dialog } from '@/components/ui/Dialog';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Pagination } from '@/components/ui/Pagination';
import { Stepper } from '@/components/ui/Stepper';
import { DatePicker } from '@/components/ui/DatePicker';
import { QRDisplay } from '@/components/ui/QRDisplay';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState, PermissionDeniedState } from '@/components/ui/FeedbackStates';
import { useToast } from '@/components/ui/Toast';

export const ComponentGalleryPage: React.FC = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('matrix');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isNonDismissibleOpen, setIsNonDismissibleOpen] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [switchVal, setSwitchVal] = useState(true);
  const [checkboxVal, setCheckboxVal] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>('asc');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <Badge variant="brand" size="sm">
            Design Tokens & UI System
          </Badge>
          <Badge variant="neutral" size="sm">
            WCAG 2.2 AA Verified
          </Badge>
          <Badge variant="info" size="sm">
            State Matrix Verified
          </Badge>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text">
          Eventora UI System & Interaction States
        </h1>
        <p className="text-xs sm:text-sm text-text-muted mt-1 max-w-2xl leading-relaxed">
          Deep Indigo primary (#4F46E5 / #818CF8), balanced neutral surfaces, 4px grid spacing, 6/10/16 radii, sm/md/lg shadows, safe-area insets, and full dark-mode AA contrast.
        </p>
      </div>

      {/* Tabs navigation */}
      <Tabs
        tabs={[
          { id: 'matrix', label: 'State Matrix' },
          { id: 'forms', label: 'Inputs & Controls' },
          { id: 'components', label: 'Badges & Buttons' },
          { id: 'tables', label: 'Tables & Pagination' },
          { id: 'overlays', label: 'Dialogs & QR' },
          { id: 'feedback', label: 'System States' },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* Tab: UI State Matrix */}
      <TabPanel id="matrix" activeTab={activeTab}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Component State Matrix: Button</CardTitle>
              <p className="text-xs text-text-muted">
                Visualizing all 8 mandatory interaction states: default, hover, focus, active, disabled with reason, loading, error, and success.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                <div className="p-3 bg-surface-2 rounded-md border border-border text-center space-y-2">
                  <span className="text-[11px] font-semibold text-text-muted block">1. Default</span>
                  <Button variant="primary" size="sm">Default</Button>
                </div>

                <div className="p-3 bg-surface-2 rounded-md border border-border text-center space-y-2">
                  <span className="text-[11px] font-semibold text-text-muted block">2. Hover State</span>
                  <Button variant="primary" size="sm" className="bg-brand-hover">Hovered</Button>
                </div>

                <div className="p-3 bg-surface-2 rounded-md border border-border text-center space-y-2">
                  <span className="text-[11px] font-semibold text-text-muted block">3. Focus State</span>
                  <Button variant="primary" size="sm" className="ring-2 ring-brand ring-offset-2">Focused</Button>
                </div>

                <div className="p-3 bg-surface-2 rounded-md border border-border text-center space-y-2">
                  <span className="text-[11px] font-semibold text-text-muted block">4. Active / Pressed</span>
                  <Button variant="primary" size="sm" className="bg-brand-pressed">Pressed</Button>
                </div>

                <div className="p-3 bg-surface-2 rounded-md border border-border text-center space-y-2">
                  <span className="text-[11px] font-semibold text-text-muted block">5. Disabled (+Reason)</span>
                  <Button variant="primary" size="sm" disabled title="Registration window closed on 20 Oct 2026">
                    Closed
                  </Button>
                  <span className="text-[10px] text-text-muted block">Event full / Closed</span>
                </div>

                <div className="p-3 bg-surface-2 rounded-md border border-border text-center space-y-2">
                  <span className="text-[11px] font-semibold text-text-muted block">6. Loading State</span>
                  <Button variant="primary" size="sm" isLoading>
                    Processing
                  </Button>
                </div>

                <div className="p-3 bg-surface-2 rounded-md border border-border text-center space-y-2">
                  <span className="text-[11px] font-semibold text-text-muted block">7. Error State</span>
                  <Button variant="destructive" size="sm">Failed Action</Button>
                </div>

                <div className="p-3 bg-surface-2 rounded-md border border-border text-center space-y-2">
                  <span className="text-[11px] font-semibold text-text-muted block">8. Success State</span>
                  <Button variant="secondary" size="sm" className="border-success text-success bg-success/10">
                    Confirmed ✓
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workflow Stepper, Skeletons & Offline Indicator</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Stepper
                currentStepIndex={currentStep}
                steps={[
                  { id: '1', title: 'Proposal Details' },
                  { id: '2', title: 'Ticket Tiers' },
                  { id: '3', title: 'Venue Booking' },
                  { id: '4', title: 'Review Submit' },
                ]}
              />

              <div className="flex gap-2 justify-end pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentStep <= 0}
                  onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
                >
                  Previous Step
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={currentStep >= 3}
                  onClick={() => setCurrentStep((prev) => Math.min(3, prev + 1))}
                >
                  Next Step
                </Button>
              </div>

              <div className="pt-3 border-t border-border space-y-2">
                <p className="text-xs font-semibold text-text">Loading Skeletons (Reduced-Motion Compliant):</p>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>

              <div className="pt-3 border-t border-border">
                <OfflineBanner isOffline pendingSyncCount={3} />
              </div>
            </CardContent>
          </Card>
        </div>
      </TabPanel>

      {/* Tab: Form Controls */}
      <TabPanel id="forms" activeTab={activeTab}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Standard Inputs & Form Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Student Email Address"
                required
                placeholder="student@campus.edu"
                helperText="Must be an active institution roll identifier."
              />

              <DatePicker
                label="Event Date"
                required
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

              <Textarea
                label="Event Proposal Abstract"
                placeholder="Provide a concise 2-sentence summary of the activity..."
                helperText="Maximum 300 characters."
              />

              <Checkbox
                label="Public Event Discovery"
                description="Allow students from other participating colleges to discover and register."
                checked={checkboxVal}
                onChange={(e) => setCheckboxVal(e.target.checked)}
              />

              <Switch
                label="Automated Waitlist Promotion"
                description="Automatically dispatch seat offers when confirmed bookings cancel."
                checked={switchVal}
                onChange={setSwitchVal}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Validation & Error States (aria-describedby)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Required Full Name"
                required
                error="Full name cannot be empty."
                defaultValue=""
              />

              <Select
                label="Required College Domain"
                required
                error="Please choose an institution domain."
                options={[
                  { value: '', label: '-- Select College --' },
                  { value: 'tech', label: 'Smart Tech Institute' },
                ]}
              />

              <Textarea
                label="Safety Protocols"
                required
                error="Safety guidelines must contain at least 20 words."
                defaultValue="Too short"
              />

              <Checkbox
                label="Terms & Code of Conduct"
                required
                error="You must agree to the campus safety charter."
                checked={false}
                onChange={() => {}}
              />

              <Switch
                label="Emergency Broadcast Override"
                error="Requires verified faculty administrative authorization."
                checked={false}
                onChange={() => {}}
              />
            </CardContent>
          </Card>
        </div>
      </TabPanel>

      {/* Tab: Badges & Buttons */}
      <TabPanel id="components" activeTab={activeTab}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Semantic Badges (Always with Icon + Label)</CardTitle>
              <p className="text-xs text-text-muted">
                Per non-negotiables: Badges are never color-only. Each variant pairs an accessible icon with high-contrast text.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2.5">
                <Badge variant="brand">Brand Active</Badge>
                <Badge variant="success">Checked In</Badge>
                <Badge variant="warning">Seat Hold (15 min)</Badge>
                <Badge variant="error">Payment Failed</Badge>
                <Badge variant="info">Faculty Notice</Badge>
                <Badge variant="neutral">Draft Proposal</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Button Variants & Sizing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2.5 items-center">
                <Button variant="primary">Primary Brand</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive Action</Button>
              </div>
              <div className="flex flex-wrap gap-2.5 items-center pt-2">
                <Button size="sm">Small (sm)</Button>
                <Button size="md">Medium (md)</Button>
                <Button size="lg">Large (lg)</Button>
                <Button isLoading variant="primary">Saving...</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabPanel>

      {/* Tab: Tables & Pagination */}
      <TabPanel id="tables" activeTab={activeTab}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Responsive Data Table (Scrollable + Mobile Cards)</CardTitle>
              <p className="text-xs text-text-muted">
                Accessible keyboard navigation region, column sort indicators, and mobile-responsive scroll container.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table aria-label="Campus Event Roster Demo" responsiveCards>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      sortDirection={sortDir}
                      onSort={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                    >
                      Attendee Name
                    </TableHead>
                    <TableHead>College Domain</TableHead>
                    <TableHead>Ticket Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Registered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell dataLabel="Attendee Name" className="font-medium">Aarav Sharma</TableCell>
                    <TableCell dataLabel="College Domain">@campus.edu</TableCell>
                    <TableCell dataLabel="Ticket Type">VIP All-Access</TableCell>
                    <TableCell dataLabel="Status">
                      <Badge variant="success" size="sm">CONFIRMED</Badge>
                    </TableCell>
                    <TableCell dataLabel="Registered">24 Oct 2026</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell dataLabel="Attendee Name" className="font-medium">Sneha Patel</TableCell>
                    <TableCell dataLabel="College Domain">@tech.edu</TableCell>
                    <TableCell dataLabel="Ticket Type">Standard Student</TableCell>
                    <TableCell dataLabel="Status">
                      <Badge variant="brand" size="sm">CHECKED_IN</Badge>
                    </TableCell>
                    <TableCell dataLabel="Registered">25 Oct 2026</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell dataLabel="Attendee Name" className="font-medium">Rohan Gupta</TableCell>
                    <TableCell dataLabel="College Domain">@polytechnic.edu</TableCell>
                    <TableCell dataLabel="Ticket Type">Workshop Pass</TableCell>
                    <TableCell dataLabel="Status">
                      <Badge variant="warning" size="sm">WAITLIST</Badge>
                    </TableCell>
                    <TableCell dataLabel="Registered">26 Oct 2026</TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              <Pagination
                currentPage={currentPage}
                totalPages={8}
                onPageChange={setCurrentPage}
              />
            </CardContent>
          </Card>
        </div>
      </TabPanel>

      {/* Tab: Overlays & QR */}
      <TabPanel id="overlays" activeTab={activeTab}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Responsive Dialogs, Sheets & Modals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-text-muted leading-relaxed">
                Overlays with stable onClose references (no focus stealing on re-renders), body scroll-lock with restore, and non-dismissible variants.
              </p>

              <div className="flex flex-wrap gap-3">
                <Button variant="primary" onClick={() => setIsDialogOpen(true)}>
                  Open Centered Dialog
                </Button>
                <Button variant="secondary" onClick={() => setIsSheetOpen(true)}>
                  Open Bottom Sheet
                </Button>
                <Button variant="outline" onClick={() => setIsNonDismissibleOpen(true)}>
                  Open Non-Dismissible
                </Button>
              </div>

              {/* Standard Centered Dialog */}
              <Dialog
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                title="Centered Modal Dialog"
                description="Designed for tablet and desktop viewports with elevated drop shadow."
              >
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">
                    This dialog traps keyboard focus between the close button and action buttons until dismissed.
                  </p>
                  <Input label="Interactive Input (Testing Focus Stability)" placeholder="Type here..." />
                  <div className="flex justify-end gap-2 pt-3 border-t border-border">
                    <Button variant="outline" size="sm" onClick={() => setIsDialogOpen(false)}>
                      Close
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => setIsDialogOpen(false)}>
                      Confirm
                    </Button>
                  </div>
                </div>
              </Dialog>

              {/* Non-Dismissible Dialog */}
              <Dialog
                isOpen={isNonDismissibleOpen}
                onClose={() => setIsNonDismissibleOpen(false)}
                isDismissible={false}
                title="Critical Action Confirmation"
                description="This dialog cannot be dismissed by clicking outside or pressing Escape."
              >
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">
                    Must explicitly choose an action below to proceed.
                  </p>
                  <div className="flex justify-end gap-2 pt-3 border-t border-border">
                    <Button variant="primary" size="sm" onClick={() => setIsNonDismissibleOpen(false)}>
                      Acknowledge & Dismiss
                    </Button>
                  </div>
                </div>
              </Dialog>

              {/* Mobile Bottom Sheet */}
              <BottomSheet
                isOpen={isSheetOpen}
                onClose={() => setIsSheetOpen(false)}
                title="Mobile Bottom Sheet"
                description="Anchored to the screen bottom with drag handle on phones."
              >
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">
                    Natural mobile gesture behavior with backdrop dismissal and focus management.
                  </p>
                  <div className="flex justify-end gap-2 pt-3 border-t border-border">
                    <Button variant="primary" size="md" onClick={() => setIsSheetOpen(false)}>
                      Done
                    </Button>
                  </div>
                </div>
              </BottomSheet>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cryptographic QR Ticket Display</CardTitle>
            </CardHeader>
            <CardContent>
              <QRDisplay
                ticketId="TCK-88219-01"
                qrPayloadPreview="dGVzdF9xcl90b2tlbl8zMl9ieXRlc19yYW5kb21fc2VjdXJlX2hhc2g"
                status="VALID"
                eventName="Smart Campus AI & Robotics Symposium"
                attendeeName="Aarav Sharma (CS22B1042)"
              />
            </CardContent>
          </Card>
        </div>
      </TabPanel>

      {/* Tab: System States */}
      <TabPanel id="feedback" activeTab={activeTab}>
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
            requestId="req-8f92-ae31-77b0-c049d1"
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
            actionLabel="Return to Events"
            onAction={() =>
              toast({
                type: 'warning',
                title: 'Permission Enforced',
                message: 'Denied under server role policy event:manage:owned.',
              })
            }
          />
        </div>
      </TabPanel>
    </div>
  );
};
