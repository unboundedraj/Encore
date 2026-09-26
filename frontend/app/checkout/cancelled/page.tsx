import Link from "next/link";
import { Suspense } from "react";

export const metadata = { title: "Checkout cancelled · Encore" };

async function CancelledContent({
  searchParams,
}: {
  searchParams: Promise<{ show_id?: string }>;
}) {
  const { show_id: showId } = await searchParams;

  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Checkout cancelled</h1>
      <p className="mt-2 text-sm text-muted">
        No payment was taken. If you had seats selected, the hold releases on its own within a few
        minutes -- so someone else may take them if you wait too long to come back.
      </p>
      <Link
        href={showId ? `/shows/${showId}` : "/browse"}
        className="mt-6 inline-block rounded-md bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-accent-dark"
      >
        {showId ? "Back to seat selection" : "Back to browse"}
      </Link>
    </div>
  );
}

/**
 * Purely informational: no booking lookup here. Landing here does not itself
 * mean the pending booking has been cancelled in Postgres -- that only
 * happens later, when Stripe's session genuinely expires and sends
 * checkout.session.expired (see webhook.controller.ts), or when the person
 * starts a different checkout that supersedes this one. Until then the
 * Stripe session is technically still resumable and the Redis hold, if any,
 * is still counting down on its own clock. None of that needs reconciling
 * here; this page only tells the person what happened.
 */
export default function CheckoutCancelledPage({
  searchParams,
}: {
  searchParams: Promise<{ show_id?: string }>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center justify-center px-6 py-16">
      <Suspense fallback={null}>
        <CancelledContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
