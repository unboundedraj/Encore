"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";

/**
 * Redirects to /login when nobody is signed in.
 *
 * THIS IS NOT A SECURITY BOUNDARY. It runs in the browser, so anyone can skip
 * it by disabling JavaScript or calling the API directly. It exists so signed-
 * out people get a login form instead of a broken page. The actual protection
 * is the backend verifying the ID token on every request -- which is why the
 * data shown here is fetched, not embedded at build time.
 *
 * The `loading` check is the part that is easy to get wrong: Firebase restores
 * a persisted session asynchronously, so redirecting while it is still null
 * would bounce a signed-in user to /login on every page refresh.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || user) return;
    // Carry the intended destination so login can return them here.
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, pathname, router]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-16 text-sm text-muted">
        Loading&#8230;
      </div>
    );
  }

  // Redirecting: render nothing rather than flashing protected chrome.
  if (!user) return null;

  return <>{children}</>;
}
