import Link from "next/link";
import { CityLink } from "@/components/CityLink";
import { POPULAR_CITIES } from "@/lib/city";

const EXPLORE_LINKS = [
  { label: "Movies", href: "/browse?type=movie" },
  { label: "Comedy", href: "/browse?type=event&category=standup" },
  { label: "Concerts", href: "/browse?type=event&category=concert" },
  { label: "Theatre", href: "/browse?type=event&category=play" },
  { label: "Sports", href: "/browse?type=event&category=sports" },
];

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">{title}</h3>
      <ul className="mt-3 flex flex-col gap-2.5">{children}</ul>
    </div>
  );
}

const linkClassName = "text-sm text-white/70 transition-colors hover:text-white";

/**
 * Every link here resolves to something real -- there is no Careers, Press or
 * Contact column, because this is a demo project and those would be dead
 * ends dressed up as real pages. What is here (categories, cities, account)
 * are all routes the app already has.
 */
export function SiteFooter() {
  return (
    // No margin-top here on purpose: several pages end in a full-bleed
    // colored section (the landing page's accent CTA band, a dark hero), and
    // an external margin would put a sliver of the page background between
    // that band and the footer instead of letting the two meet. Pages that
    // need breathing room before the footer -- a plain content grid ending
    // flush -- add their own bottom padding instead.
    <footer className="bg-ink text-white/60">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <Link href="/" className="text-lg font-bold tracking-tight text-white">
              en<span className="text-accent">core</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed">
              Movie tickets, standup comedy and live events across seven Indian cities.
            </p>
          </div>

          <FooterColumn title="Explore">
            {EXPLORE_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className={linkClassName}>
                  {link.label}
                </Link>
              </li>
            ))}
          </FooterColumn>

          <FooterColumn title="Cities">
            {POPULAR_CITIES.map((city) => (
              <li key={city}>
                <CityLink city={city} className={linkClassName}>
                  {city}
                </CityLink>
              </li>
            ))}
          </FooterColumn>

          <FooterColumn title="Account">
            <li>
              <Link href="/browse" className={linkClassName}>
                Browse everything
              </Link>
            </li>
            <li>
              <Link href="/profile" className={linkClassName}>
                My account
              </Link>
            </li>
            <li>
              <Link href="/login" className={linkClassName}>
                Sign in
              </Link>
            </li>
            <li>
              <Link href="/signup" className={linkClassName}>
                Create an account
              </Link>
            </li>
          </FooterColumn>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            A demo ticketing platform. Venues, titles and showtimes here are fixtures for
            development — nothing listed is a real scheduled event, and payments run against
            Stripe test mode.
          </p>
          <p className="shrink-0 text-white/40">
            Built with Next.js, Express, Postgres, MongoDB, Redis &amp; Stripe.
          </p>
        </div>
      </div>
    </footer>
  );
}
