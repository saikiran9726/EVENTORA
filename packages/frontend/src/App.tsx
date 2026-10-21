import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { StudentShell } from '@/components/shells/StudentShell';
import { OrganizerShell } from '@/components/shells/OrganizerShell';
import { ReviewerShell } from '@/components/shells/ReviewerShell';
import { AdminShell } from '@/components/shells/AdminShell';
import { CheckinShell } from '@/components/shells/CheckinShell';
import { DiscoveryPage } from '@/pages/DiscoveryPage';
import { EventDetailsPage } from '@/pages/EventDetailsPage';
import { OrganizerDashboardPage } from '@/pages/OrganizerDashboardPage';
import { ComponentGalleryPage } from '@/pages/ComponentGalleryPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { ProfilePreferencesPage } from '@/pages/ProfilePreferencesPage';
import { ExpiredSessionModal } from '@/components/auth/ExpiredSessionModal';
import { ToastProvider } from '@/components/ui/Toast';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { QRDisplay } from '@/components/ui/QRDisplay';
import { QrCode } from 'lucide-react';

export type CurrentRole = 'student' | 'organizer' | 'reviewer' | 'admin' | 'checkin_staff';

const AppInner: React.FC = () => {
  const {
    user,
    isAuthenticated,
    isSessionExpiredModalOpen,
    setIsSessionExpiredModalOpen,
    returnPath,
    setReturnPath,
    logout,
  } = useAuth();

  const [currentRole, setCurrentRole] = useState<CurrentRole>('student');
  const [activeRoute, setActiveRoute] = useState<string>('discover');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Sync currentRole when user authenticates
  useEffect(() => {
    if (user) {
      if (user.globalRole === 'admin') {
        setCurrentRole('admin');
      } else if (user.globalRole === 'reviewer') {
        setCurrentRole('reviewer');
      } else if (user.organizerMemberships && user.organizerMemberships.length > 0) {
        setCurrentRole('organizer');
      } else if (user.staffAssignments && user.staffAssignments.some((s) => s.capability === 'checkin')) {
        setCurrentRole('checkin_staff');
      } else {
        setCurrentRole('student');
      }
    }
  }, [user]);

  // Theme state: respects prefers-color-scheme, persisted choice in localStorage
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('eventora_theme');
      if (saved) return saved === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
      localStorage.setItem('eventora_theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.removeAttribute('data-theme');
      localStorage.setItem('eventora_theme', 'light');
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

  const handleRequireAuth = (targetRoute: string) => {
    if (!isAuthenticated) {
      setReturnPath(targetRoute);
      setActiveRoute('auth-login');
      return false;
    }
    return true;
  };

  const handleLoginSuccess = () => {
    if (returnPath) {
      setActiveRoute(returnPath);
      setReturnPath(null);
    } else {
      setActiveRoute('discover');
    }
  };

  const handleLogout = async () => {
    await logout();
    setActiveRoute('discover');
  };

  const renderContent = () => {
    // Auth Routes
    if (activeRoute === 'auth-login') {
      return (
        <LoginPage
          onSuccess={handleLoginSuccess}
          onNavigateRegister={() => setActiveRoute('auth-register')}
          onNavigateForgot={() => setActiveRoute('auth-forgot')}
        />
      );
    }

    if (activeRoute === 'auth-register') {
      return (
        <RegisterPage
          onSuccess={() => setActiveRoute('auth-login')}
          onNavigateLogin={() => setActiveRoute('auth-login')}
        />
      );
    }

    if (activeRoute === 'auth-forgot') {
      return (
        <ForgotPasswordPage
          onNavigateLogin={() => setActiveRoute('auth-login')}
        />
      );
    }

    if (activeRoute === 'profile') {
      if (!handleRequireAuth('profile')) return null;
      return (
        <ProfilePreferencesPage
          onLogout={handleLogout}
          isDarkMode={isDarkMode}
          onToggleTheme={() => setIsDarkMode(!isDarkMode)}
        />
      );
    }

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

    if (currentRole === 'organizer' && (activeRoute === 'dashboard' || activeRoute === 'roster' || activeRoute === 'insights')) {
      return <OrganizerDashboardPage />;
    }

    if (activeRoute === 'discover') {
      return <DiscoveryPage onSelectEvent={handleSelectEvent} />;
    }

    if (activeRoute === 'calendar') {
      return (
        <div className="space-y-6">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">Campus Event Calendar</h1>
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Sessions & Workshops</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="p-3 bg-surface-2 rounded-md border border-border flex justify-between items-center text-xs">
                <div>
                  <p className="font-semibold text-text">Smart Campus AI Symposium 2026</p>
                  <p className="text-text-muted text-[11px]">28 October 2026 • 09:30 AM • Sir MV Auditorium</p>
                </div>
                <Badge variant="brand" size="sm">Confirmed</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (activeRoute === 'tickets') {
      return (
        <div className="space-y-6">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">My Event Tickets</h1>
          <QRDisplay
            ticketId="TCK-88219-01"
            qrPayloadPreview="dGVzdF9xcl90b2tlbl8zMl9ieXRlc19yYW5kb21fc2VjdXJlX2hhc2g"
            status="VALID"
            eventName="Smart Campus AI & Robotics Symposium"
            attendeeName="Aarav Sharma (CS22B1042)"
          />
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

          <Card className="text-center p-8 max-w-md mx-auto">
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

    if (activeRoute === 'admin-overview') {
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
                Campus System Administration
              </h1>
              <p className="text-xs sm:text-sm text-text-muted mt-1">
                Platform health, role governance, and security audit log.
              </p>
            </div>
            <Badge variant="error" size="sm">Policy: user:manage</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <span className="text-xs text-text-muted font-medium">Database Node</span>
              <p className="text-xl font-bold text-text mt-1">PostgreSQL 16</p>
              <Badge variant="success" size="sm" className="mt-2">Healthy</Badge>
            </Card>
            <Card>
              <span className="text-xs text-text-muted font-medium">Task Outbox Dispatcher</span>
              <p className="text-xl font-bold text-text mt-1">BullMQ Worker</p>
              <Badge variant="success" size="sm" className="mt-2">0 Lag</Badge>
            </Card>
            <Card>
              <span className="text-xs text-text-muted font-medium">Security Boundary</span>
              <p className="text-xl font-bold text-text mt-1">Deny By Default</p>
              <Badge variant="brand" size="sm" className="mt-2">Active</Badge>
            </Card>
          </div>
        </div>
      );
    }

    // Default fallback to discovery
    return <DiscoveryPage onSelectEvent={handleSelectEvent} />;
  };

  const shellProps = {
    currentRole,
    onRoleChange: handleRoleChange,
    activeRoute,
    onRouteChange: (route: string) => {
      setSelectedEventId(null);
      if (route === 'profile') {
        if (!handleRequireAuth('profile')) return;
      }
      setActiveRoute(route);
    },
    isDarkMode,
    onToggleDarkMode: () => setIsDarkMode(!isDarkMode),
    children: renderContent(),
  };

  // Render role-specific shell
  const renderShell = () => {
    switch (currentRole) {
      case 'organizer':
        return <OrganizerShell {...shellProps} />;
      case 'reviewer':
        return <ReviewerShell {...shellProps} />;
      case 'admin':
        return <AdminShell {...shellProps} />;
      case 'checkin_staff':
        return <CheckinShell {...shellProps} />;
      case 'student':
      default:
        return <StudentShell {...shellProps} />;
    }
  };

  return (
    <>
      {renderShell()}
      <ExpiredSessionModal
        isOpen={isSessionExpiredModalOpen}
        onSignIn={() => {
          setIsSessionExpiredModalOpen(false);
          setActiveRoute('auth-login');
        }}
      />
    </>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </AuthProvider>
  );
};

export default App;
