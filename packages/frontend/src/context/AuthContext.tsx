import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { reportError } from '@/lib/error-reporter';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  globalRole: 'student' | 'reviewer' | 'admin';
  status: 'active' | 'suspended' | 'pending';
  department?: string | null;
  year?: number | null;
  college?: {
    id: string;
    name: string;
    domain: string;
  } | null;
  organizerMemberships?: Array<{
    organizerId: string;
    role: string;
    organizerName: string;
  }>;
  staffAssignments?: Array<{
    capability: string;
  }>;
  preferences?: {
    emailEnabled: boolean;
    inappEnabled: boolean;
    theme: string;
    locale: string;
  };
}

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSessionExpiredModalOpen: boolean;
  returnPath: string | null;
  setReturnPath: (path: string | null) => void;
  setIsSessionExpiredModalOpen: (open: boolean) => void;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (data: { email: string; password: string; displayName: string }) => Promise<{ success: boolean; verificationToken?: string; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateProfile: (data: string | { displayName?: string; department?: string | null; year?: number | null }) => Promise<{ success: boolean; error?: string }>;
  updatePreferences: (prefs: { emailEnabled?: boolean; inappEnabled?: boolean; theme?: string }) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const userRef = useRef<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSessionExpiredModalOpen, setIsSessionExpiredModalOpen] = useState<boolean>(false);
  const [returnPath, setReturnPath] = useState<string | null>(null);

  // Synchronize ref with user state to prevent stale closures in async callbacks
  const updateUser = useCallback((newUser: UserProfile | null) => {
    userRef.current = newUser;
    setUser(newUser);
  }, []);

  const triggerSessionExpired = useCallback(() => {
    if (userRef.current) {
      if (typeof window !== 'undefined') {
        const path = window.location.pathname + window.location.search;
        setReturnPath(path);
      }
      setIsSessionExpiredModalOpen(true);
      updateUser(null);
    }
  }, [updateUser]);

  const refreshUser = useCallback(async () => {
    try {
      const res = await apiClient.get<{ user: UserProfile }>('/api/v1/me');
      if (res?.user) {
        updateUser(res.user);
      } else {
        updateUser(null);
      }
    } catch (err: any) {
      if (err.status === 401 && userRef.current) {
        triggerSessionExpired();
      } else {
        updateUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [updateUser, triggerSessionExpired]);

  // Wire global unauthorized callback from apiClient
  useEffect(() => {
    apiClient.setOnUnauthorized(() => {
      triggerSessionExpired();
    });

    refreshUser();

    return () => {
      apiClient.setOnUnauthorized(null);
    };
  }, [triggerSessionExpired, refreshUser]);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiClient.post<{ user: UserProfile; csrfToken?: string; token?: string }>(
        '/api/v1/auth/login',
        { email, password }
      );

      if (res?.user) {
        if (res.csrfToken) {
          apiClient.setCsrfToken(res.csrfToken);
        }
        if (res.token) {
          apiClient.setSessionToken(res.token);
        }

        // Authoritatively verify session via /api/v1/me before claiming success
        try {
          const meRes = await apiClient.get<{ user: UserProfile }>('/api/v1/me');
          if (!meRes?.user) {
            throw new Error('Failed to verify session profile from /api/v1/me');
          }
          updateUser(meRes.user);
          return { success: true };
        } catch (verifyErr: any) {
          updateUser(null);
          reportError(verifyErr, { context: 'login:verify_me' });
          return {
            success: false,
            error: verifyErr.error?.message || verifyErr.message || 'Session verification failed.',
          };
        }
      }
      return { success: false, error: 'Login failed' };
    } catch (err: any) {
      return {
        success: false,
        error: err.error?.message || 'Invalid email or password.',
      };
    }
  };

  const register = async (data: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ success: boolean; verificationToken?: string; error?: string }> => {
    try {
      const res = await apiClient.post<{ user: UserProfile; verificationToken?: string; message: string }>(
        '/api/v1/auth/register',
        data
      );

      return {
        success: true,
        verificationToken: res?.verificationToken,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.error?.message || 'Registration failed',
      };
    }
  };

  const logout = async () => {
    try {
      await apiClient.post('/api/v1/auth/logout', {});
    } catch (err) {
      reportError(err, { context: 'logout' });
    } finally {
      updateUser(null);
      apiClient.setCsrfToken('');
      apiClient.setSessionToken('');
    }
  };

  const updateProfile = async (data: string | { displayName?: string; department?: string | null; year?: number | null }) => {
    try {
      const payload = typeof data === 'string' ? { displayName: data } : data;
      const res = await apiClient.patch<{ user: UserProfile }>('/api/v1/me', payload);
      if (res?.user) {
        updateUser(res.user);
        return { success: true };
      }
      return { success: false, error: 'Update failed' };
    } catch (err: any) {
      return { success: false, error: err.error?.message || 'Failed to update profile' };
    }
  };

  const updatePreferences = async (prefs: { emailEnabled?: boolean; inappEnabled?: boolean; theme?: string }) => {
    try {
      const res = await apiClient.patch<{ preferences: any }>('/api/v1/me/preferences', prefs);
      if (res?.preferences && userRef.current) {
        updateUser({ ...userRef.current, preferences: res.preferences });
        return { success: true };
      }
      return { success: false, error: 'Update failed' };
    } catch (err: any) {
      return { success: false, error: err.error?.message || 'Failed to update preferences' };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isSessionExpiredModalOpen,
        returnPath,
        setReturnPath,
        setIsSessionExpiredModalOpen,
        login,
        register,
        logout,
        refreshUser,
        updateProfile,
        updatePreferences,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
