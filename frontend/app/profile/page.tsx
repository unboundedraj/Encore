"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import type { User } from "shared";

/**
 * End-to-end check of the whole auth chain:
 *
 *   sign in here -> Firebase issues an ID token -> apiFetch attaches it as a
 *   Bearer header -> the backend's requireAuth verifies it with the Admin SDK
 *   -> ensureUserRecord upserts the encore_users row -> that row comes back.
 *
 * If this page renders a record, every link in that chain works against real
 * services. The `record` field is the proof the backend did something only it
 * can do -- reading Postgres -- rather than just echoing the token back. That
 * proof is still shown below (the "Account status" card): reskinned to look
 * like part of the product, but nothing about what it verifies has changed.
 */

interface MeResponse {
  user: { uid: string; email: string | null; name: string | null; emailVerified: boolean };
  record: User | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  password: "Email & password",
  "google.com": "Google",
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline py-3 last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="truncate text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        ok ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-ok" : "bg-warn"}`} />
      {label}
    </span>
  );
}

function ProfileContent() {
  const { user, signOut } = useAuth();
  const [data, setData] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped by the Refresh button to re-run the effect below. This, rather
  // than calling a shared fetch function from both the button and the
  // effect, is what lets the fetch live directly inside the effect: nothing
  // outside it needs to invoke the same logic.
  const [refreshIndex, setRefreshIndex] = useState(0);

  // No statement here runs synchronously except setting up the promise chain
  // and the cleanup flag -- every setState call lives inside a .then/.catch/
  // .finally callback, which only ever runs after this effect has already
  // finished executing. `loading` therefore never needs setting to true here:
  // it already starts true (mount) or was set true by the Refresh button's
  // own click handler (refetch) before this effect even re-runs.
  useEffect(() => {
    let cancelled = false;
    apiFetch<MeResponse>("/api/me")
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Request failed");
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshIndex]);

  const displayName = user?.displayName?.trim() || user?.email?.split("@")[0] || "Your account";
  const initial = displayName.charAt(0).toUpperCase();
  const providers = user?.providerData.map((p) => PROVIDER_LABELS[p.providerId] ?? p.providerId) ?? [];
  const memberSince = user?.metadata.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

  return (
    <main className="flex-1 bg-background">
      {/* Compact dark band, matching the show/title pages, so this reads as
          part of the same product rather than a bolted-on settings screen. */}
      <div className="bg-ink-2 text-white">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-4 px-4 py-8 sm:px-6">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent text-2xl font-bold text-white ring-4 ring-white/10">
            {initial}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{displayName}</h1>
            <p className="truncate text-sm text-white/60">{user?.email ?? "—"}</p>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Account card */}
          <section className="rounded-lg bg-surface p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Account
              </h2>
              <StatusPill
                ok={Boolean(user?.emailVerified)}
                label={user?.emailVerified ? "Email verified" : "Email unverified"}
              />
            </div>

            <div className="mt-3">
              <InfoRow label="Name" value={user?.displayName ?? "Not set"} />
              <InfoRow label="Email" value={user?.email ?? "—"} />
              <InfoRow label="Signed in with" value={providers.join(", ") || "—"} />
              <InfoRow label="Member since" value={memberSince} />
            </div>

            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-5 w-full rounded-md border border-hairline px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              Sign out
            </button>
          </section>

          {/* Bookings placeholder: there is no "list my bookings" endpoint
              yet -- only GET /api/bookings/:bookingId, reached from the
              checkout success page -- so this points people at browse
              rather than faking a history the backend cannot back up. */}
          <section className="flex flex-col justify-between rounded-lg bg-surface p-6 shadow-sm">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                My bookings
              </h2>
              <p className="mt-3 text-sm text-foreground/80">
                Confirmed bookings show up on the page you land on right after checkout. A
                dedicated booking history is not built yet.
              </p>
            </div>
            <Link
              href="/browse"
              className="mt-5 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
            >
              Browse movies &amp; events
            </Link>
          </section>
        </div>

        {/* Backend verification -- unchanged in substance from before, just
            reskinned. This is what proves the token this page holds is real
            to the backend, not merely something the browser believes. */}
        <section className="mt-6 rounded-lg bg-surface p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Account status
              </h2>
              <p className="mt-1 text-xs text-muted">
                Verified server-side via GET /api/me on every load.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setRefreshIndex((i) => i + 1);
              }}
              disabled={loading}
              className="shrink-0 rounded-md border border-hairline px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {loading ? "Checking…" : "Refresh"}
            </button>
          </div>

          {error ? (
            <p role="alert" className="mt-4 rounded-md bg-accent/10 px-3 py-2 text-sm text-accent-dark">
              {error}
            </p>
          ) : null}

          {data ? (
            <div className="mt-4 grid gap-x-8 sm:grid-cols-2">
              <div>
                <InfoRow label="Token verified for" value={data.user.uid} />
                <InfoRow label="Email in token" value={data.user.email ?? "—"} />
              </div>
              <div>
                <InfoRow
                  label="Database record"
                  value={
                    <StatusPill
                      ok={Boolean(data.record)}
                      label={data.record ? "Provisioned" : "Not provisioned"}
                    />
                  }
                />
                <InfoRow label="Record created" value={data.record?.created_at ?? "—"} />
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  );
}
