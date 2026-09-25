"use client";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getFirebaseAuth, googleProvider } from "@/lib/firebase";

interface AuthContextValue {
  user: User | null;
  /**
   * True until Firebase has restored any persisted session.
   *
   * This matters more than it looks. Firebase reads the existing session out of
   * IndexedDB asynchronously, so on first paint `user` is null even for someone
   * who is signed in. Anything that treats "user === null" as "logged out"
   * without waiting on this will bounce a signed-in person to /login on every
   * refresh. Consumers must check `loading` first.
   */
  loading: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getFirebaseAuth();
    // Fires immediately with the restored session (or null), then again on
    // every sign-in and sign-out, including in other tabs.
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      setUser(next);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      // These intentionally do not catch: callers need the Firebase error to
      // map it to a message. State updates arrive via onAuthStateChanged, so
      // there is nothing to set here on success.
      signUp: async (email, password) => {
        await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
      },
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
      },
      signInWithGoogle: async () => {
        await signInWithPopup(getFirebaseAuth(), googleProvider);
      },
      signOut: async () => {
        await firebaseSignOut(getFirebaseAuth());
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}
