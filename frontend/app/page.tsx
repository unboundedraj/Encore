import Image from "next/image";
import Link from "next/link";
import { CityLink } from "@/components/CityLink";
import { ContentCard } from "@/components/ContentCard";
import { getSelectedCity } from "@/lib/city-server";
import { fetchCities, fetchContentList } from "@/lib/content-api";
import type { CitySummary, ContentType, Movie, Event } from "shared";

export const metadata = {
  title: "Encore — Movies, comedy & live events across India",
  description:
    "Book movie tickets, standup comedy, concerts and theatre across Mumbai, Delhi NCR, Bengaluru, Hyderabad, Chennai, Kolkata, Pune and more Indian cities.",
};

const CATEGORIES: { label: string; href: string; blurb: string }[] = [
  { label: "Movies", href: "/browse?type=movie", blurb: "New releases in nine languages" },
  { label: "Comedy", href: "/browse?type=event&category=standup", blurb: "Standup from India's best" },
  { label: "Concerts", href: "/browse?type=event&category=concert", blurb: "Live music, indie to arena" },
  { label: "Theatre", href: "/browse?type=event&category=play", blurb: "Plays, staged live" },
  { label: "Sports", href: "/browse?type=event&category=sports", blurb: "Courtside and pitch-side" },
];

const STEPS: { title: string; body: string }[] = [
  {
    title: "Pick a city & a show",
    body: "Browse what's playing near you — movies, comedy, concerts and more.",
  },
  {
    title: "Choose your seats",
    body: "Real seat maps for cinemas, live availability for general admission.",
  },
  {
    title: "Pay securely",
    body: "Checkout is handled by Stripe. Your seats are held while you pay.",
  },
];

/**
 * The front door of the site. Explicitly a real page, not a redirect to
 * /browse: a landing page's job is to make the case for clicking in, and a
 * listing page's job is to list -- collapsing them means the first thing a
 * new visitor sees is a filter bar with no context for what they are
 * filtering. Every section here ends in a link into /browse, in one city or
 * one category at a time, rather than duplicating what that page already
 * does well.
 */
export default async function LandingPage() {
  const city = await getSelectedCity();
  const [cities, trending] = await Promise.all([
    fetchCities(),
    fetchContentList({ city, limit: 10 }),
  ]);

  const totalShows = cities.reduce((sum, c) => sum + c.show_count, 0);
  const totalVenues = cities.reduce((sum, c) => sum + c.venue_count, 0);
  // Decorative only: a handful of posters tiled behind the hero copy, the way
  // a listing app's marketing page shows a wall of what's on rather than a
  // flat color. Falls back to nothing gracefully if the catalog is briefly
  // empty -- the hero still reads fine as a solid dark band.
  const backdropPosters = trending.items.slice(0, 6).map((item: Movie | Event) => item.posterUrl);

  return (
    <main className="flex-1">
      {/* HERO */}
      <section className="relative overflow-hidden bg-ink-3 text-white">
        {backdropPosters.length > 0 ? (
          <div className="absolute inset-0 grid grid-cols-3 sm:grid-cols-6" aria-hidden="true">
            {backdropPosters.map((src: string, i: number) => (
              <div key={src + i} className="relative">
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="17vw"
                  priority={i < 2}
                  className="object-cover opacity-30"
                />
              </div>
            ))}
          </div>
        ) : null}
        {/* Heavy gradient over the collage so hero text stays fully legible
            regardless of what happens to be trending. */}
        <div
          className="absolute inset-0 bg-linear-to-b from-ink-3/50 via-ink-3/90 to-ink-3"
          aria-hidden="true"
        />

        <div className="relative mx-auto w-full max-w-5xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">
            India&rsquo;s shows, one ticket away
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-6xl">
            Movies, comedy &amp; live events across India
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/70">
            Book tickets for the latest films, standup specials and concerts in {city} and{" "}
            {Math.max(cities.length - 1, 0)} other cities — pick your seats, pay securely, done in a couple of minutes.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/browse"
              className="rounded-md bg-accent px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-accent/30 transition-colors hover:bg-accent-dark"
            >
              Browse what&rsquo;s on in {city}
            </Link>
            <Link
              href="/browse?type=event&category=standup"
              className="rounded-md border border-white/25 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              See comedy shows
            </Link>
          </div>

          <dl className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-6 border-t border-white/10 pt-8">
            <div>
              <dd className="text-2xl font-bold sm:text-3xl">{cities.length}</dd>
              <dt className="mt-1 text-xs uppercase tracking-wider text-white/50">Cities</dt>
            </div>
            <div>
              <dd className="text-2xl font-bold sm:text-3xl">{totalVenues}+</dd>
              <dt className="mt-1 text-xs uppercase tracking-wider text-white/50">Venues</dt>
            </div>
            <div>
              <dd className="text-2xl font-bold sm:text-3xl">{totalShows}+</dd>
              <dt className="mt-1 text-xs uppercase tracking-wider text-white/50">
                Showtimes live
              </dt>
            </div>
          </dl>
        </div>
      </section>

      {/* TRENDING */}
      {trending.items.length > 0 ? (
        <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h2 className="text-2xl font-bold tracking-tight">Trending in {city}</h2>
            <Link href="/browse" className="shrink-0 text-sm font-medium text-accent hover:underline">
              See all &rsaquo;
            </Link>
          </div>
          <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 no-scrollbar sm:-mx-6 sm:px-6">
            {trending.items.map((item: Movie | Event) => (
              <div key={item._id} className="w-36 shrink-0 sm:w-44">
                <ContentCard item={item} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* CATEGORIES */}
      <section className="bg-surface py-14">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight">Browse by category</h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.label}
                href={cat.href}
                className="group rounded-lg border border-hairline bg-background p-5 transition-colors hover:border-accent"
              >
                <p className="text-base font-semibold transition-colors group-hover:text-accent">
                  {cat.label}
                </p>
                <p className="mt-1 text-xs text-muted">{cat.blurb}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CITIES */}
      {cities.length > 0 ? (
        <section className="py-14">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight">Choose your city</h2>
            <p className="mt-1 text-sm text-muted">Tap a city to see what&rsquo;s playing there.</p>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {cities.map((c: CitySummary) => (
                <CityLink
                  key={c.city}
                  city={c.city}
                  className="rounded-lg bg-surface p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <p className="font-semibold">{c.city}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {c.show_count} showtime{c.show_count === 1 ? "" : "s"}
                  </p>
                </CityLink>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* HOW IT WORKS */}
      <section className="bg-ink-2 py-16 text-white">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight">How Encore works</h2>
          <div className="mt-10 grid gap-10 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title} className="text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent text-sm font-bold">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-accent py-14 text-center text-white">
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Ready for your next night out?
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/85">
            Browse what&rsquo;s playing in {city} and grab your seats before they&rsquo;re gone.
          </p>
          <Link
            href="/browse"
            className="mt-6 inline-block rounded-md bg-white px-8 py-3.5 text-sm font-semibold text-accent-dark transition-opacity hover:opacity-90"
          >
            Start browsing
          </Link>
        </div>
      </section>
    </main>
  );
}
