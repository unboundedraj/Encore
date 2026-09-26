import Link from "next/link";
import type { Content, ContentType, EventCategory } from "shared";
import { ContentCard } from "@/components/ContentCard";
import { getSelectedCity } from "@/lib/city-server";
import { fetchContentList } from "@/lib/content-api";

export const metadata = {
  title: "Browse · Encore",
  description: "Movies, comedy and live events near you.",
};

const TABS: { label: string; type?: ContentType; category?: EventCategory }[] = [
  { label: "All" },
  { label: "Movies", type: "movie" },
  { label: "Comedy", type: "event", category: "standup" },
  { label: "Concerts", type: "event", category: "concert" },
  { label: "Theatre", type: "event", category: "play" },
  { label: "Sports", type: "event", category: "sports" },
];

const PAGE_SIZE = 24;

function isContentType(value: unknown): value is ContentType {
  return value === "movie" || value === "event";
}

const EVENT_CATEGORIES = ["concert", "play", "standup", "sports", "conference", "other"];
function isCategory(value: unknown): value is EventCategory {
  return typeof value === "string" && EVENT_CATEGORIES.includes(value);
}

/** Titles grouped into the rails a listing page actually shows. */
function section(items: Content[], predicate: (item: Content) => boolean): Content[] {
  return items.filter(predicate);
}

/**
 * A titled row of posters.
 *
 * `rail` scrolls horizontally, which is what a listing app does and what keeps
 * a seven-item section from wrapping a single orphaned card onto its own line.
 * `grid` wraps, and is used when a tab has been chosen and the whole point is
 * to see everything at once.
 */
function Rail({
  title,
  items,
  href,
  layout = "rail",
}: {
  title: string;
  items: Content[];
  href?: string;
  layout?: "rail" | "grid";
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {href ? (
          <Link href={href} className="shrink-0 text-sm font-medium text-accent hover:underline">
            See all &rsaquo;
          </Link>
        ) : null}
      </div>

      {layout === "grid" ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((item) => (
            <ContentCard key={item._id} item={item} />
          ))}
        </div>
      ) : (
        <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 no-scrollbar sm:-mx-6 sm:px-6">
          {items.map((item) => (
            <div key={item._id} className="w-36 shrink-0 sm:w-44">
              <ContentCard item={item} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Server-rendered. The filter tabs are plain links that change the query
 * string, so switching tabs re-runs this component on the server rather than
 * fetching from the browser -- no client JavaScript is involved in listing.
 *
 * The city comes from a cookie, not the query string, so it survives
 * navigation without every link having to carry it. Reading either makes the
 * route dynamic; the upstream fetch is still cached for five minutes, so
 * "rendered per request" does not mean "queries the catalog per request".
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; category?: string; page?: string }>;
}) {
  const params = await searchParams;
  const type = isContentType(params.type) ? params.type : undefined;
  const category = isCategory(params.category) ? params.category : undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const city = await getSelectedCity();

  const { items, pagination } = await fetchContentList({
    type,
    category,
    city,
    page,
    limit: PAGE_SIZE,
  });

  const hrefFor = (tab: (typeof TABS)[number], nextPage = 1) => {
    const qs = new URLSearchParams();
    if (tab.type) qs.set("type", tab.type);
    if (tab.category) qs.set("category", tab.category);
    if (nextPage > 1) qs.set("page", String(nextPage));
    const s = qs.toString();
    return s ? `/browse?${s}` : "/browse";
  };

  const activeTab =
    TABS.find((tab) => tab.type === type && tab.category === category) ?? TABS[0];
  const unfiltered = !type && !category && page === 1;

  return (
    <main className="flex-1">
      {/* Hero band. Dark, full-bleed, and sized so it frames the listing
          rather than competing with the posters below it. */}
      <div className="bg-ink-2 text-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Now showing in {city}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Book movies, comedy &amp; live events
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/70">
            {pagination.total} {pagination.total === 1 ? "title" : "titles"} with showtimes in{" "}
            {city}. Change your city from the header to see what&rsquo;s on elsewhere.
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
        <nav className="flex gap-1 overflow-x-auto border-b border-hairline py-1 no-scrollbar">
          {TABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <Link
                key={tab.label}
                href={hrefFor(tab)}
                aria-current={active ? "page" : undefined}
                className={`-mb-px shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "border-accent text-accent"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {items.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-lg font-semibold">Nothing on in {city} right now</p>
            <p className="mt-2 text-sm text-muted">
              Try another city from the header, or a different category.
            </p>
          </div>
        ) : unfiltered ? (
          <>
            <Rail
              title="Recommended movies"
              items={section(items, (item) => item.type === "movie")}
              href="/browse?type=movie"
            />
            <Rail
              title="Comedy shows"
              items={section(
                items,
                (item) => item.type === "event" && item.category === "standup"
              )}
              href="/browse?type=event&category=standup"
            />
            <Rail
              title="Live music"
              items={section(
                items,
                (item) => item.type === "event" && item.category === "concert"
              )}
              href="/browse?type=event&category=concert"
            />
            <Rail
              title="Theatre & more"
              items={section(
                items,
                (item) =>
                  item.type === "event" &&
                  item.category !== "standup" &&
                  item.category !== "concert"
              )}
            />
          </>
        ) : (
          <Rail title={`${activeTab.label} in ${city}`} items={items} layout="grid" />
        )}

        {pagination.totalPages > 1 ? (
          <div className="mt-12 flex items-center justify-between text-sm">
            {page > 1 ? (
              <Link href={hrefFor(activeTab, page - 1)} className="font-medium text-accent hover:underline">
                &larr; Previous
              </Link>
            ) : (
              <span className="text-muted/50">&larr; Previous</span>
            )}
            <span className="text-muted">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            {pagination.hasMore ? (
              <Link href={hrefFor(activeTab, page + 1)} className="font-medium text-accent hover:underline">
                Next &rarr;
              </Link>
            ) : (
              <span className="text-muted/50">Next &rarr;</span>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
