"use client";

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
 * can do -- reading Postgres -- rather than just echoing the token back.
 */

interface MeResponse {
  user: { uid: string; email: string | null; name: string | null; emailVerified: boolean };
  record: User | null;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-black/5 py-2.5 last:border-b-0 dark:border-white/10 sm:flex-row sm:gap-4">
      <span className="w-48 shrink-0 text-sm text-black/50 dark:text-white/50">{label}</span>
      <span className="font-mono text-sm break-all">{value}</span>
    </div>
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

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-sm underline underline-offset-4 hover:opacity-70"
        >
          Sign out
        </button>
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
          Firebase client session
        </h2>
        <div className="mt-2">
          <Row label="uid" value={user?.uid} />
          <Row label="email" value={user?.email ?? "—"} />
          <Row label="display name" value={user?.displayName ?? "—"} />
          <Row label="providers" value={user?.providerData.map((p) => p.providerId).join(", ") || "—"} />
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
            GET /api/me &mdash; verified by the backend
          </h2>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setRefreshIndex((i) => i + 1);
            }}
            disabled={loading}
            className="text-sm underline underline-offset-4 hover:opacity-70 disabled:opacity-40"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        {data ? (
          <div className="mt-2">
            <Row label="token verified for uid" value={data.user.uid} />
            <Row label="email in token" value={data.user.email ?? "—"} />
            <Row label="email verified" value={String(data.user.emailVerified)} />
            <Row
              label="encore_users row"
              value={data.record ? `id=${data.record.id}` : "not provisioned"}
            />
            <Row label="row email" value={data.record?.email ?? "—"} />
            <Row label="row name" value={data.record?.name ?? "—"} />
            <Row label="row created_at" value={data.record?.created_at ?? "—"} />
          </div>
        ) : null}
      </section>
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
