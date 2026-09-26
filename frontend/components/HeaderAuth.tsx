"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

/**
 * The sign-in / account corner of the header.
 *
 * Renders a neutral placeholder while Firebase restores a persisted session,
 * rather than showing "Sign in" and then flipping to the account chip a moment
 * later -- see the note on `loading` in AuthProvider.
 */
export function HeaderAuth() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="h-8 w-20 animate-pulse rounded bg-white/10" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-dark"
      >
        Sign in
      </Link>
    );
  }

  const label = user.displayName?.trim() || user.email?.split("@")[0] || "Account";
  const initial = label.charAt(0).toUpperCase();

  return (
    <Link
      href="/profile"
      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-white/90 transition-colors hover:bg-white/10"
      title={user.email ?? undefined}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
        {initial}
      </span>
      <span className="hidden max-w-[7rem] truncate sm:inline">{label}</span>
    </Link>
  );
}
