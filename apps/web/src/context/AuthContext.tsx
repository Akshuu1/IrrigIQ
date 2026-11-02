import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setAccessToken, type User } from '../api/client.js';
import type { LoginInput, RegisterInput, UpdateProfileInput } from '@irrigiq/shared';
import { setAppLanguage, type SupportedLanguage } from '../locales/i18n.js';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (input: UpdateProfileInput) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Initial session restoration
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        const refreshRes = await api.refresh();
        if (refreshRes?.accessToken) {
          setAccessToken(refreshRes.accessToken);
          const meRes = await api.getMe();
          if (mounted && meRes?.user) {
            setUser(meRes.user);
            if (meRes.user.language) {
              setAppLanguage(meRes.user.language as SupportedLanguage);
            }
          }
        }
      } catch {
        if (mounted) {
          setUser(null);
          setAccessToken(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void initAuth();

    const handleAuthExpired = () => {
      setUser(null);
      setAccessToken(null);
    };

    window.addEventListener('auth:expired', handleAuthExpired);
    return () => {
      mounted = false;
      window.removeEventListener('auth:expired', handleAuthExpired);
    };
  }, []);

  const login = async (input: LoginInput) => {
    const res = await api.login(input);
    setAccessToken(res.accessToken);
    setUser(res.user);
    if (res.user.language) {
      setAppLanguage(res.user.language as SupportedLanguage);
    }
  };

  const register = async (input: RegisterInput) => {
    const res = await api.register(input);
    setAccessToken(res.accessToken);
    setUser(res.user);
    if (res.user.language) {
      setAppLanguage(res.user.language as SupportedLanguage);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  };

  const updateUser = async (input: UpdateProfileInput) => {
    const res = await api.updateMe(input);
    setUser(res.user);
    if (input.language) {
      setAppLanguage(input.language as SupportedLanguage);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
