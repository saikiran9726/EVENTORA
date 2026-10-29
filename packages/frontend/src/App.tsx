import React, { useState, useEffect, Suspense } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { RouteSkeleton } from '@/components/ui/RouteSkeleton';
import { RequireAuth, RequireRole } from '@/components/auth/RouteGuards';
import { ExpiredSessionModal } from '@/components/auth/ExpiredSessionModal';

// Shell Layouts
import { StudentShell } from '@/components/shells/StudentShell';
import { OrganizerShell } from '@/components/shells/OrganizerShell';
import { ReviewerShell } from '@/components/shells/ReviewerShell';
import { AdminShell } from '@/components/shells/AdminShell';
import { CheckinShell } from '@/components/shells/CheckinShell';

// Lazy-loaded route components
const DiscoveryPage = React.lazy(() =>
  import('@/pages/DiscoveryPage').then((m) => ({ default: m.DiscoveryPage }))
);
const EventDetailsPage = React.lazy(() =>
  import('@/pages/EventDetailsPage').then((m) => ({ default: m.EventDetailsPage }))
);
const CheckoutPage = React.lazy(() =>
  import('@/pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage }))
);
const MyBookingsPage = React.lazy(() =>
  import('@/pages/MyBookingsPage').then((m) => ({ default: m.MyBookingsPage }))
);
const CalendarPage = React.lazy(() =>
  import('@/pages/CalendarPage').then((m) => ({ default: m.CalendarPage }))
);
const TeamsPage = React.lazy(() =>
  import('@/pages/teams/TeamsPage').then((m) => ({ default: m.TeamsPage }))
);
const VolunteerHubPage = React.lazy(() =>
  import('@/pages/VolunteerHubPage').then((m) => ({ default: m.VolunteerHubPage }))
);
const PassportPage = React.lazy(() =>
  import('@/pages/PassportPage').then((m) => ({ default: m.PassportPage }))
);
const PublicPassportPage = React.lazy(() =>
  import('@/pages/PublicPassportPage').then((m) => ({ default: m.PublicPassportPage }))
);
const PublicVerifyPage = React.lazy(() =>
  import('@/pages/PublicVerifyPage').then((m) => ({ default: m.PublicVerifyPage }))
);
const ProfilePreferencesPage = React.lazy(() =>
  import('@/pages/ProfilePreferencesPage').then((m) => ({ default: m.ProfilePreferencesPage }))
);
const OrganizerDashboardPage = React.lazy(() =>
  import('@/pages/OrganizerDashboardPage').then((m) => ({ default: m.OrganizerDashboardPage }))
);
const CreateEventPage = React.lazy(() =>
  import('@/pages/events/CreateEventPage').then((m) => ({ default: m.CreateEventPage }))
);
const ReviewQueuePage = React.lazy(() =>
  import('@/pages/reviewer/ReviewQueuePage').then((m) => ({ default: m.ReviewQueuePage }))
);
const AdminPortalPage = React.lazy(() =>
  import('@/pages/admin/AdminPortalPage').then((m) => ({ default: m.AdminPortalPage }))
);
const ScannerPage = React.lazy(() =>
  import('@/pages/ScannerPage').then((m) => ({ default: m.ScannerPage }))
);
const LoginPage = React.lazy(() =>
  import('@/pages/auth/LoginPage').then((m) => ({ default: m.LoginPage }))
);
const RegisterPage = React.lazy(() =>
  import('@/pages/auth/RegisterPage').then((m) => ({ default: m.RegisterPage }))
);
const ForgotPasswordPage = React.lazy(() =>
  import('@/pages/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage }))
);
const ResetPasswordPage = React.lazy(() =>
  import('@/pages/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage }))
);
const VerifyEmailPage = React.lazy(() =>
  import('@/pages/auth/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage }))
);
const ComponentGalleryPage = React.lazy(() =>
  import('@/pages/ComponentGalleryPage').then((m) => ({ default: m.ComponentGalleryPage }))
);
const NotFoundPage = React.lazy(() =>
  import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage }))
);

const RouteView: React.FC<{
  children: React.ReactNode;
  fallbackTitle?: string;
}> = ({ children, fallbackTitle }) => (
  <ErrorBoundary fallbackTitle={fallbackTitle}>
    <Suspense fallback={<RouteSkeleton />}>{children}</Suspense>
  </ErrorBoundary>
);

interface ShellWrapperProps {
  shell: 'student' | 'organizer' | 'reviewer' | 'admin' | 'checkin_staff';
  activeRoute?: string;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  children: React.ReactNode;
}

const ShellWrapper: React.FC<ShellWrapperProps> = ({
  shell,
  activeRoute,
  isDarkMode,
  onToggleDarkMode,
  children,
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleRouteChange = (route: string) => {
    const routeMap: Record<string, string> = {
      discover: '/',
      'my-events': '/calendar',
      calendar: '/calendar',
      tickets: '/tickets',
      passport: '/passport',
      profile: '/profile',
      dashboard: '/organizer',
      roster: '/organizer',
      checkin: '/scan',
      volunteers: '/volunteers',
      insights: '/organizer',
      'review-queue': '/review',
      scanner: '/scan',
      'admin-overview': '/admin',
      'admin-users': '/admin/users',
      'admin-clubs': '/admin/clubs',
      'admin-events': '/admin/events',
      'admin-audit': '/admin/audit',
      teams: '/teams',
      components: '/components',
      verify: '/verify',
    };
    const target = routeMap[route] || `/${route}`;
    navigate(target);
  };

  const shellProps = {
    activeRoute: activeRoute || location.pathname,
    onRouteChange: handleRouteChange,
    isDarkMode,
    onToggleDarkMode,
    children,
  };

  switch (shell) {
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

const AppContent: React.FC = () => {
  const {
    isLoading,
    isSessionExpiredModalOpen,
    setIsSessionExpiredModalOpen,
    returnPath,
    setReturnPath,
    logout,
  } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();

  // Theme state: persists choice in localStorage, honors system dark preference
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

  // Render cold-start notification state
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

      <ExpiredSessionModal
        isOpen={isSessionExpiredModalOpen}
        onSignIn={() => {
          setIsSessionExpiredModalOpen(false);
          const currentUrl = location.pathname + location.search;
          if (!returnPath) {
            setReturnPath(currentUrl);
          }
          navigate(`/login?returnTo=${encodeURIComponent(currentUrl)}`);
        }}
      />

      <Routes>
        {/* Public & Student Routes */}
        <Route
          path="/"
          element={
            <ShellWrapper shell="student" activeRoute="discover" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
              <RouteView fallbackTitle="Could not load event discovery">
                <DiscoveryPage />
              </RouteView>
            </ShellWrapper>
          }
        />

        <Route
          path="/events/:slug"
          element={
            <ShellWrapper shell="student" activeRoute="details" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
              <RouteView fallbackTitle="Could not load event details">
                <EventDetailsPage />
              </RouteView>
            </ShellWrapper>
          }
        />

        <Route
          path="/checkout/:bookingId"
          element={
            <RequireAuth>
              <ShellWrapper shell="student" activeRoute="checkout" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Checkout Error">
                  <CheckoutPage />
                </RouteView>
              </ShellWrapper>
            </RequireAuth>
          }
        />

        <Route
          path="/tickets"
          element={
            <RequireAuth>
              <ShellWrapper shell="student" activeRoute="tickets" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Could not load tickets">
                  <MyBookingsPage />
                </RouteView>
              </ShellWrapper>
            </RequireAuth>
          }
        />

        <Route
          path="/tickets/:id"
          element={
            <RequireAuth>
              <ShellWrapper shell="student" activeRoute="tickets" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Could not load ticket">
                  <MyBookingsPage />
                </RouteView>
              </ShellWrapper>
            </RequireAuth>
          }
        />

        <Route
          path="/calendar"
          element={
            <ShellWrapper shell="student" activeRoute="calendar" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
              <RouteView fallbackTitle="Could not load campus calendar">
                <CalendarPage />
              </RouteView>
            </ShellWrapper>
          }
        />

        <Route
          path="/teams"
          element={
            <ShellWrapper shell="student" activeRoute="teams" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
              <RouteView fallbackTitle="Could not load teams hub">
                <TeamsPage />
              </RouteView>
            </ShellWrapper>
          }
        />

        <Route
          path="/volunteers"
          element={
            <ShellWrapper shell="student" activeRoute="volunteers" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
              <RouteView fallbackTitle="Could not load volunteer hub">
                <VolunteerHubPage />
              </RouteView>
            </ShellWrapper>
          }
        />

        <Route
          path="/passport"
          element={
            <RequireAuth>
              <ShellWrapper shell="student" activeRoute="passport" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Could not load passport">
                  <PassportPage />
                </RouteView>
              </ShellWrapper>
            </RequireAuth>
          }
        />

        <Route
          path="/p/:slug"
          element={
            <RouteView fallbackTitle="Could not load public passport">
              <PublicPassportPage />
            </RouteView>
          }
        />

        <Route
          path="/verify"
          element={
            <ShellWrapper shell="student" activeRoute="verify" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
              <RouteView fallbackTitle="Certificate Verification Error">
                <PublicVerifyPage />
              </RouteView>
            </ShellWrapper>
          }
        />

        <Route
          path="/verify/:code"
          element={
            <ShellWrapper shell="student" activeRoute="verify" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
              <RouteView fallbackTitle="Certificate Verification Error">
                <PublicVerifyPage />
              </RouteView>
            </ShellWrapper>
          }
        />

        <Route
          path="/profile"
          element={
            <RequireAuth>
              <ShellWrapper shell="student" activeRoute="profile" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Profile Error">
                  <ProfilePreferencesPage
                    onLogout={async () => {
                      await logout();
                      navigate('/');
                    }}
                    isDarkMode={isDarkMode}
                    onToggleTheme={() => setIsDarkMode(!isDarkMode)}
                  />
                </RouteView>
              </ShellWrapper>
            </RequireAuth>
          }
        />

        <Route
          path="/components"
          element={
            <ShellWrapper shell="student" activeRoute="components" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
              <RouteView fallbackTitle="UI Gallery Error">
                <ComponentGalleryPage />
              </RouteView>
            </ShellWrapper>
          }
        />

        {/* Organizer Routes (Role-Guarded: Organizer or Admin) */}
        <Route
          path="/organizer"
          element={
            <RequireRole allowedRoles={['admin', 'organizer']}>
              <ShellWrapper shell="organizer" activeRoute="dashboard" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Organizer Dashboard Error">
                  <OrganizerDashboardPage onProposeEvent={() => navigate('/organizer/create')} />
                </RouteView>
              </ShellWrapper>
            </RequireRole>
          }
        />

        <Route
          path="/organizer/create"
          element={
            <RequireRole allowedRoles={['admin', 'organizer']}>
              <ShellWrapper shell="organizer" activeRoute="create-event" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Event Proposal Error">
                  <CreateEventPage />
                </RouteView>
              </ShellWrapper>
            </RequireRole>
          }
        />

        <Route
          path="/events/create"
          element={
            <RequireRole allowedRoles={['admin', 'organizer']}>
              <ShellWrapper shell="organizer" activeRoute="create-event" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Event Proposal Error">
                  <CreateEventPage />
                </RouteView>
              </ShellWrapper>
            </RequireRole>
          }
        />

        {/* Reviewer Routes (Role-Guarded: Reviewer or Admin) */}
        <Route
          path="/review"
          element={
            <RequireRole allowedRoles={['admin', 'reviewer']}>
              <ShellWrapper shell="reviewer" activeRoute="review-queue" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Faculty Review Queue Error">
                  <ReviewQueuePage />
                </RouteView>
              </ShellWrapper>
            </RequireRole>
          }
        />

        {/* Admin Routes (Role-Guarded: Admin) */}
        <Route
          path="/admin"
          element={
            <RequireRole allowedRoles={['admin']}>
              <ShellWrapper shell="admin" activeRoute="admin-overview" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Campus Admin Portal Error">
                  <AdminPortalPage />
                </RouteView>
              </ShellWrapper>
            </RequireRole>
          }
        />

        <Route
          path="/admin/:tab"
          element={
            <RequireRole allowedRoles={['admin']}>
              <ShellWrapper shell="admin" activeRoute="admin-overview" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Campus Admin Portal Error">
                  <AdminPortalPage />
                </RouteView>
              </ShellWrapper>
            </RequireRole>
          }
        />

        {/* Check-in Staff Routes (Role-Guarded: Checkin Staff or Admin) */}
        <Route
          path="/scan"
          element={
            <RequireRole allowedRoles={['admin', 'checkin_staff']}>
              <ShellWrapper shell="checkin_staff" activeRoute="scanner" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Turnstile Scanner Error">
                  <ScannerPage />
                </RouteView>
              </ShellWrapper>
            </RequireRole>
          }
        />

        <Route
          path="/scan/:eventId"
          element={
            <RequireRole allowedRoles={['admin', 'checkin_staff']}>
              <ShellWrapper shell="checkin_staff" activeRoute="scanner" isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}>
                <RouteView fallbackTitle="Turnstile Scanner Error">
                  <ScannerPage />
                </RouteView>
              </ShellWrapper>
            </RequireRole>
          }
        />

        {/* Auth Routes */}
        <Route
          path="/login"
          element={
            <RouteView fallbackTitle="Login Error">
              <LoginPage />
            </RouteView>
          }
        />

        <Route
          path="/register"
          element={
            <RouteView fallbackTitle="Registration Error">
              <RegisterPage />
            </RouteView>
          }
        />

        <Route
          path="/forgot"
          element={
            <RouteView fallbackTitle="Password Reset Error">
              <ForgotPasswordPage />
            </RouteView>
          }
        />

        <Route
          path="/reset/:token"
          element={
            <RouteView fallbackTitle="Password Reset Error">
              <ResetPasswordPage />
            </RouteView>
          }
        />

        <Route
          path="/verify-email/:token"
          element={
            <RouteView fallbackTitle="Email Verification Error">
              <VerifyEmailPage />
            </RouteView>
          }
        />

        {/* Legacy Redirects */}
        <Route path="/dashboard" element={<Navigate to="/organizer" replace />} />
        <Route path="/auth/login" element={<Navigate to="/login" replace />} />
        <Route path="/auth/register" element={<Navigate to="/register" replace />} />
        <Route path="/auth/forgot" element={<Navigate to="/forgot" replace />} />

        {/* 404 Catch-All */}
        <Route
          path="*"
          element={
            <RouteView fallbackTitle="Page Not Found">
              <NotFoundPage />
            </RouteView>
          }
        />
      </Routes>
    </>
  );
};

export const App: React.FC = () => {
  return (
    <ErrorBoundary fallbackTitle="Eventora Platform Initialization Error">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <AppContent />
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
