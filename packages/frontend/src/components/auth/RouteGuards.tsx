import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { RouteSkeleton } from '@/components/ui/RouteSkeleton';
import { ForbiddenPage } from '@/pages/ForbiddenPage';

export type UserRole = 'student' | 'organizer' | 'reviewer' | 'admin' | 'checkin_staff';

export interface RequireAuthProps {
  children: React.ReactNode;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({ children }) => {
  const { user, isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <RouteSkeleton />;
  }

  if (!isAuthenticated || !user) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export interface RequireRoleProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

export const RequireRole: React.FC<RequireRoleProps> = ({ allowedRoles, children }) => {
  const { user, isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <RouteSkeleton />;
  }

  if (!isAuthenticated || !user) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} state={{ from: location }} replace />;
  }

  // Authoritatively derive roles from server data only
  const effectiveRoles: UserRole[] = ['student'];

  if (user.globalRole === 'admin') {
    // Admin has administrative access across all campus features
    effectiveRoles.push('admin', 'reviewer', 'organizer', 'checkin_staff');
  } else if (user.globalRole === 'reviewer') {
    effectiveRoles.push('reviewer');
  } else if ((user as { globalRole?: string }).globalRole === 'checkin_staff') {
    effectiveRoles.push('checkin_staff');
  }

  if (user.organizerMemberships && user.organizerMemberships.length > 0) {
    effectiveRoles.push('organizer');
  }

  if (user.staffAssignments && user.staffAssignments.some((s) => s.capability === 'checkin')) {
    effectiveRoles.push('checkin_staff');
  }

  const hasPermission = allowedRoles.some((role) => effectiveRoles.includes(role));

  if (!hasPermission) {
    return <ForbiddenPage allowedRoles={allowedRoles} />;
  }

  return <>{children}</>;
};
