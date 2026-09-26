"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { isSilentAuthError, toAuthErrorMessage } from "@/lib/auth-errors";

type Mode = "signin" | "signup";

const COPY = {
  signin: {
    heading: "Sign in",
    submit: "Sign in",
    pending: "Signing in…",
    switchPrompt: "Don't have an account?",
    switchLabel: "Create one",
    switchHref: "/signup",
  },
  signup: {
    heading: "Create an account",
    submit: "Create account",
    pending: "Creating account…",
    switchPrompt: "Already have an account?",
    switchLabel: "Sign in",
    switchHref: "/login",
  },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, signUp, signInWithGoogle } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"form" | "google" | null>(null);

  // Where to land after success. Only relative paths are honoured: an absolute
  // URL here would let a crafted link bounce someone to another site carrying
  // the impression that Encore sent them there.
  const rawNext = searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/profile";

  async function run(action: () => Promise<void>, which: "form" | "google") {
    setError(null);
    setPending(which);
    try {
      await action();
      router.replace(next);
    } catch (err) {
      // Closing the Google popup is a decision, not a failure.
      if (!isSilentAuthError(err)) setError(toAuthErrorMessage(err));
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <div className="w-full max-w-sm rounded-lg bg-surface p-7 shadow-sm">
      <h1 className="text-2xl font-bold tracking-tight">{copy.heading}</h1>

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () => (mode === "signin" ? signIn(email, password) : signUp(email, password)),
            "form"
          );
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            className="rounded-md border border-hairline bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            className="rounded-md border border-hairline bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-accent disabled:opacity-50"
          />
        </label>

        {error ? (
          // role=alert so screen readers announce it when it appears.
          <p role="alert" className="rounded-md bg-accent/10 px-3 py-2 text-sm text-accent-dark">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
        >
          {pending === "form" ? copy.pending : copy.submit}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-hairline" />
        or
        <span className="h-px flex-1 bg-hairline" />
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => signInWithGoogle(), "google")}
        className="w-full rounded-md border border-hairline px-4 py-2.5 text-sm font-medium transition-colors hover:bg-background disabled:opacity-50"
      >
        {pending === "google" ? "Opening Google…" : "Continue with Google"}
      </button>

      <p className="mt-6 text-sm text-muted">
        {copy.switchPrompt}{" "}
        <Link href={copy.switchHref} className="font-semibold text-accent hover:underline">
          {copy.switchLabel}
        </Link>
      </p>
    </div>
  );
}
