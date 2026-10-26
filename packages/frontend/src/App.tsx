import React, { useState, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
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
import { PublicPassportPage } from '@/pages/PublicPassportPage';
import { PublicVerifyPage } from '@/pages/PublicVerifyPage';
import { VolunteerHubPage } from '@/pages/VolunteerHubPage';
import { AdminPortalPage } from '@/pages/admin/AdminPortalPage';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { ExpiredSessionModal } from '@/components/auth/ExpiredSessionModal';
import { ToastProvider } from '@/components/ui/Toast';
// Card and Badge used inside sub-pages

export type CurrentRole = 'student' | 'organizer' | 'reviewer' | 'admin' | 'checkin_staff';

const AppInner: React.FC = () => {
  const {
    user,
    isLoading,
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
  const [publicPassportSlug, setPublicPassportSlug] = useState<string>('');
  const [isServerWaking, setIsServerWaking] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleWaking = () => setIsServerWaking(true);
    const handleReady = () => setIsServerWaking(false);
    window.addEventListener('eventora:server-waking', handleWaking);
    window.addEventListener('eventora:server-ready', handleReady);
    return () => {
      window.removeEventListener('eventora:server-waking', handleWaking);
      window.removeEventListener('eventora:server-ready', handleReady);
    };
  }, []);

  // Route-to-path and path-to-route synchronization
  const syncRouteFromPath = () => {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname;
    if (path.startsWith('/p/')) {
      const slug = path.replace('/p/', '').trim();
      if (slug) {
        setPublicPassportSlug(slug);
        setActiveRoute('public-passport');
      }
    } else if (path.startsWith('/events/')) {
      const id = path.replace('/events/', '').trim();
      if (id && id !== 'create') {
        setSelectedEventId(id);
        setActiveRoute('details');
      } else if (id === 'create') {
        setActiveRoute('create-event');
      }
    } else if (path === '/register' || path === '/auth/register') {
      setActiveRoute('auth-register');
    } else if (path === '/login' || path === '/auth/login') {
      setActiveRoute('auth-login');
    } else if (path === '/forgot' || path === '/auth/forgot') {
      setActiveRoute('auth-forgot');
    } else if (path === '/calendar') {
      setActiveRoute('calendar');
    } else if (path === '/tickets') {
      setActiveRoute('tickets');
    } else if (path === '/teams') {
      setActiveRoute('teams');
    } else if (path === '/volunteers') {
      setActiveRoute('volunteers');
    } else if (path === '/passport') {
      setActiveRoute('passport');
    } else if (path === '/profile') {
      setActiveRoute('profile');
    } else if (path === '/dashboard') {
      setActiveRoute('dashboard');
    } else if (path === '/verify') {
      setActiveRoute('verify');
    } else if (path === '/admin' || path === '/admin/overview') {
      setActiveRoute('admin-overview');
    } else if (path === '/admin/users') {
      setActiveRoute('admin-users');
    } else if (path === '/admin/clubs') {
      setActiveRoute('admin-clubs');
    } else if (path === '/admin/events') {
      setActiveRoute('admin-events');
    } else if (path === '/admin/audit') {
      setActiveRoute('admin-audit');
    } else if (path === '/components') {
      setActiveRoute('components');
    } else if (path === '/' || path === '/discover') {
      setActiveRoute('discover');
    }
  };

  useEffect(() => {
    syncRouteFromPath();
    window.addEventListener('popstate', syncRouteFromPath);
    return () => window.removeEventListener('popstate', syncRouteFromPath);
  }, []);

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
    if (isLoading) return false;
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

    if (activeRoute === 'notifications') {
      return (
        <NotificationCenter
          isOpen={true}
          onClose={() => setActiveRoute('discover')}
        />
      );
    }

    if (activeRoute === 'verify') {
      return (
        <PublicVerifyPage
          initialCode={verifyCode}
          onBack={() => setActiveRoute('passport')}
        />
      );
    }

    if (activeRoute === 'public-passport' && publicPassportSlug) {
      return (
        <PublicPassportPage
          slug={publicPassportSlug}
          onBack={() => setActiveRoute('passport')}
          onNavigateToVerify={(code) => {
            setVerifyCode(code);
            setActiveRoute('verify');
          }}
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
          onNavigateToPublicPassport={(slug) => {
            setPublicPassportSlug(slug);
            setActiveRoute('public-passport');
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

    if (
      activeRoute === 'admin-overview' ||
      activeRoute === 'admin-users' ||
      activeRoute === 'admin-clubs' ||
      activeRoute === 'admin-events' ||
      activeRoute === 'admin-audit'
    ) {
      return (
        <AdminPortalPage
          initialTab={activeRoute}
          onNavigateTab={(tab) => {
            setActiveRoute(tab);
          }}
        />
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
      if (typeof window !== 'undefined') {
        const pathMap: Record<string, string> = {
          discover: '/',
          'auth-login': '/login',
          'auth-register': '/register',
          'auth-forgot': '/forgot',
          calendar: '/calendar',
          tickets: '/tickets',
          teams: '/teams',
          volunteers: '/volunteers',
          passport: '/passport',
          profile: '/profile',
          dashboard: '/dashboard',
          components: '/components',
          verify: '/verify',
          'admin-overview': '/admin',
          'admin-users': '/admin/users',
          'admin-clubs': '/admin/clubs',
          'admin-events': '/admin/events',
          'admin-audit': '/admin/audit',
        };
        const targetPath = pathMap[route];
        if (targetPath && window.location.pathname !== targetPath) {
          window.history.pushState(null, '', targetPath);
        }
      }
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg text-text">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-brand border-t-transparent animate-spin" />
          <p className="text-sm font-medium text-text-muted">Loading Eventora session...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {isServerWaking && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-white text-xs font-medium py-1.5 px-4 text-center shadow flex items-center justify-center gap-2"
        >
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          Eventora server is spinning up (Render cold start)... First request may take 15–30s.
        </div>
      )}
      {renderShell()}
      <ExpiredSessionModal
        isOpen={isSessionExpiredModalOpen}
        onSignIn={() => {
          setIsSessionExpiredModalOpen(false);
          if (!returnPath) {
            setReturnPath(activeRoute);
          }
          setActiveRoute('auth-login');
        }}
      />
    </>
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <AppInner />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
