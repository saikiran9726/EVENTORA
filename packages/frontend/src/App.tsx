import React, { useState, useEffect } from 'react';
import { AppShell, CurrentRole } from '@/components/layout/AppShell';
import { DiscoveryPage } from '@/pages/DiscoveryPage';
import { EventDetailsPage } from '@/pages/EventDetailsPage';
import { OrganizerDashboardPage } from '@/pages/OrganizerDashboardPage';
import { ComponentGalleryPage } from '@/pages/ComponentGalleryPage';
import { ToastProvider } from '@/components/ui/Toast';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { QrCode } from 'lucide-react';

export const App: React.FC = () => {
  const [currentRole, setCurrentRole] = useState<CurrentRole>('student');
  const [activeRoute, setActiveRoute] = useState<string>('discover');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const handleRoleChange = (newRole: CurrentRole) => {
    setCurrentRole(newRole);
    if (newRole === 'organizer') {
      setActiveRoute('dashboard');
    } else if (newRole === 'student') {
      setActiveRoute('discover');
    } else if (newRole === 'reviewer') {
      setActiveRoute('review-queue');
    } else if (newRole === 'checkin_staff') {
      setActiveRoute('scanner');
    } else if (newRole === 'admin') {
      setActiveRoute('admin-overview');
    }
  };

  const handleSelectEvent = (id: string) => {
    setSelectedEventId(id);
    setActiveRoute('details');
  };

  const renderContent = () => {
    if (activeRoute === 'details' && selectedEventId) {
      return (
        <EventDetailsPage
          eventId={selectedEventId}
          onBack={() => setActiveRoute('discover')}
        />
      );
    }

    if (activeRoute === 'components') {
      return <ComponentGalleryPage />;
    }

    if (currentRole === 'organizer' && activeRoute === 'dashboard') {
      return <OrganizerDashboardPage />;
    }

    if (activeRoute === 'discover') {
      return <DiscoveryPage onSelectEvent={handleSelectEvent} />;
    }

    if (activeRoute === 'review-queue') {
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
                Faculty Approval & Review Queue
              </h1>
              <p className="text-xs sm:text-sm text-text-muted mt-1">
                Authorized Faculty Coordinator: Dr. S. Ramanujan (CSE Dept)
              </p>
            </div>
            <Badge variant="brand" size="sm">Policy: event:review</Badge>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pending Proposal: Inter-College Robotics Grand Prix</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-text-muted">
                Submitted by Robotics Club • Venue: Sir MV Auditorium • Requested Date: 14 Nov 2026.
              </p>
              <div className="p-3 bg-surface-2 rounded-md border border-border text-xs space-y-1">
                <p className="font-semibold text-text">Automated Conflict Pre-Check:</p>
                <p className="text-success flex items-center gap-1">
                  ✓ Sir MV Auditorium is clear of overlapping events for 14 Nov 2026.
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="primary" size="sm">Approve Event</Button>
                <Button variant="outline" size="sm">Request Changes</Button>
                <Button variant="secondary" size="sm">Reject</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (activeRoute === 'scanner') {
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
                QR Ticket Check-in Scanner
              </h1>
              <p className="text-xs sm:text-sm text-text-muted mt-1">
                Event: Smart Campus AI & Robotics Symposium • Authorized Scanner UI
              </p>
            </div>
            <Badge variant="success" size="sm">Policy: attendance:checkin:assigned</Badge>
          </div>

          <Card className="text-center p-8">
            <div className="w-16 h-16 rounded-full bg-brand/10 text-brand flex items-center justify-center mx-auto mb-4 border border-brand/20">
              <QrCode className="w-8 h-8" />
            </div>
            <h2 className="text-base font-bold text-text">Camera Scanner Ready</h2>
            <p className="text-xs text-text-muted max-w-sm mx-auto mt-1 mb-4">
              Point camera at student QR code (opaque 32-byte base64url token, zero PII, SHA-256 hashed on server).
            </p>
            <Button variant="primary" size="md">
              Start Video Camera
            </Button>
          </Card>
        </div>
      );
    }

    if (activeRoute === 'passport') {
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
                Student Event Passport
              </h1>
              <p className="text-xs sm:text-sm text-text-muted mt-1">
                Verified attendance, volunteer shifts, and cryptographic certificates.
              </p>
            </div>
            <Badge variant="brand" size="sm">Verified Portfolio</Badge>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Verified Achievements (CS22B1042)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="p-3 bg-surface-2 rounded-md border border-border flex justify-between items-center text-xs">
                <div>
                  <p className="font-semibold text-text">Smart Campus AI Symposium 2026</p>
                  <p className="text-text-muted text-[11px]">Attendance verified via QR scan • Issued Certificate #CERT-RAS-9912</p>
                </div>
                <Badge variant="success" size="sm">Verified</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Default fallback to discovery
    return <DiscoveryPage onSelectEvent={handleSelectEvent} />;
  };

  return (
    <ToastProvider>
      <AppShell
        currentRole={currentRole}
        onRoleChange={handleRoleChange}
        activeRoute={activeRoute}
        onRouteChange={(route) => {
          setSelectedEventId(null);
          setActiveRoute(route);
        }}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
      >
        {renderContent()}
      </AppShell>
    </ToastProvider>
  );
};
export default App;
