import Link from "next/link";
import type { ContentType } from "shared";
import { ContentCard } from "@/components/ContentCard";
import { fetchContentList } from "@/lib/content-api";

export const metadata = {
  title: "Browse · Encore",
  description: "Movies and live events on Encore.",
};

const TABS: { label: string; type?: ContentType }[] = [
  { label: "All" },
  { label: "Movies", type: "movie" },
  { label: "Events", type: "event" },
];

const PAGE_SIZE = 12;

function isContentType(value: unknown): value is ContentType {
  return value === "movie" || value === "event";
}

/**
 * Server-rendered. The filter tabs are plain links that change the query
 * string, so switching tabs re-runs this component on the server rather than
 * fetching from the browser -- no client JavaScript is involved in listing.
 *
 * Reading searchParams makes the route dynamic, so it renders per request. The
 * upstream fetch is still cached for five minutes (see lib/content-api.ts), so
 * "rendered per request" does not mean "queries Mongo per request".
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const params = await searchParams;
  const type = isContentType(params.type) ? params.type : undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const { items, pagination } = await fetchContentList({ type, page, limit: PAGE_SIZE });

  const hrefFor = (nextType?: ContentType, nextPage = 1) => {
    const qs = new URLSearchParams();
    if (nextType) qs.set("type", nextType);
    if (nextPage > 1) qs.set("page", String(nextPage));
    const s = qs.toString();
    return s ? `/browse?${s}` : "/browse";
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Browse</h1>
      <p className="mt-1 text-sm text-black/55 dark:text-white/55">
        {pagination.total} {pagination.total === 1 ? "title" : "titles"} available
      </p>

      <nav className="mt-6 flex gap-1 border-b border-black/10 dark:border-white/15">
        {TABS.map((tab) => {
          const active = tab.type === type;
          return (
            <Link
              key={tab.label}
              href={hrefFor(tab.type)}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-foreground"
                  : "border-transparent text-black/55 hover:text-foreground dark:text-white/55"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <p className="py-20 text-center text-sm text-black/50 dark:text-white/50">
          Nothing here yet.
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <ContentCard key={item._id} item={item} />
          ))}
        </div>
      )}

      {pagination.totalPages > 1 ? (
        <div className="mt-10 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={hrefFor(type, page - 1)} className="underline underline-offset-4">
              &larr; Previous
            </Link>
          ) : (
            <span className="text-black/30 dark:text-white/30">&larr; Previous</span>
          )}
          <span className="text-black/55 dark:text-white/55">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          {pagination.hasMore ? (
            <Link href={hrefFor(type, page + 1)} className="underline underline-offset-4">
              Next &rarr;
            </Link>
          ) : (
            <span className="text-black/30 dark:text-white/30">Next &rarr;</span>
          )}
        </div>
      ) : null}
    </main>
  );
}
