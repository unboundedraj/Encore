export function SiteFooter() {
  return (
    <footer className="mt-16 bg-ink text-white/60">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <p className="text-lg font-bold tracking-tight text-white">
          en<span className="text-accent">core</span>
        </p>
        <p className="mt-2 max-w-xl text-sm leading-relaxed">
          A demo ticketing platform for movies and live events. Venues, titles and showtimes
          here are fixtures for development — nothing listed is a real scheduled event, and
          payments run against Stripe test mode.
        </p>
        <p className="mt-6 border-t border-white/10 pt-6 text-xs">
          Built with Next.js, Express, Postgres, MongoDB, Redis and Stripe.
        </p>
      </div>
    </footer>
  );
}
