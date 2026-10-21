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
import { CreateEventPage } from '@/pages/events/CreateEventPage';
import { ReviewQueuePage } from '@/pages/reviewer/ReviewQueuePage';
import { CalendarPage } from '@/pages/CalendarPage';
import { ComponentGalleryPage } from '@/pages/ComponentGalleryPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { ProfilePreferencesPage } from '@/pages/ProfilePreferencesPage';
import { MyBookingsPage } from '@/pages/MyBookingsPage';
import { TeamsPage } from '@/pages/teams/TeamsPage';
import { CheckoutPage } from '@/pages/CheckoutPage';
import { ScannerPage } from '@/pages/ScannerPage';
import { PassportPage } from '@/pages/PassportPage';
import { PublicVerifyPage } from '@/pages/PublicVerifyPage';
import { VolunteerHubPage } from '@/pages/VolunteerHubPage';
import { ExpiredSessionModal } from '@/components/auth/ExpiredSessionModal';
import { ToastProvider } from '@/components/ui/Toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

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
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState<string>('');

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
          onProceedToCheckout={(bId) => {
            setActiveBookingId(bId);
            setActiveRoute('checkout');
          }}
        />
      );
    }

    if (activeRoute === 'checkout' && activeBookingId) {
      return (
        <CheckoutPage
          bookingId={activeBookingId}
          onNavigateToTickets={() => setActiveRoute('tickets')}
          onBack={() => setActiveRoute('discover')}
        />
      );
    }

    if (activeRoute === 'components') {
      return <ComponentGalleryPage />;
    }

    if (activeRoute === 'create-event') {
      return (
        <CreateEventPage
          onBack={() => setActiveRoute('dashboard')}
          onSuccess={(id) => {
            setSelectedEventId(id);
            setActiveRoute('details');
          }}
        />
      );
    }

    if (currentRole === 'organizer' && (activeRoute === 'dashboard' || activeRoute === 'roster' || activeRoute === 'insights' || activeRoute === 'volunteers')) {
      return (
        <OrganizerDashboardPage
          onProposeEvent={() => setActiveRoute('create-event')}
        />
      );
    }

    if (activeRoute === 'discover') {
      return <DiscoveryPage onSelectEvent={handleSelectEvent} />;
    }

    if (activeRoute === 'calendar') {
      return <CalendarPage onSelectEvent={handleSelectEvent} />;
    }

    if (activeRoute === 'tickets') {
      return <MyBookingsPage onNavigateToDiscovery={() => setActiveRoute('discover')} />;
    }

    if (activeRoute === 'teams') {
      return <TeamsPage />;
    }

    if (activeRoute === 'volunteers') {
      return <VolunteerHubPage />;
    }

    if (activeRoute === 'verify') {
      return (
        <PublicVerifyPage
          initialCode={verifyCode}
          onBack={() => setActiveRoute('passport')}
        />
      );
    }

    if (activeRoute === 'passport') {
      return (
        <PassportPage
          onNavigateToVerify={(code) => {
            setVerifyCode(code);
            setActiveRoute('verify');
          }}
        />
      );
    }

    if (activeRoute === 'review-queue') {
      return <ReviewQueuePage />;
    }

    if (activeRoute === 'scanner') {
      return <ScannerPage eventId={selectedEventId || 'mock-event-id'} />;
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
