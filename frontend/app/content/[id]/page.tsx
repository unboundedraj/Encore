import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Content } from "shared";
import { ShowtimesList } from "@/components/ShowtimesList";
import { fetchContentById } from "@/lib/content-api";
import { fetchShowsForContent } from "@/lib/show-api";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const item = await fetchContentById(id);
  if (!item) return { title: "Not found · Encore" };
  return {
    title: `${item.title} · Encore`,
    description: item.description,
  };
}

function runtime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Type-specific rows. The discriminant is what makes this exhaustive. */
function Details({ item }: { item: Content }) {
  const rows =
    item.type === "movie"
      ? [
          ["Runtime", runtime(item.durationMinutes)],
          ["Language", item.language.toUpperCase()],
          ["Cast", item.cast.length > 0 ? item.cast.join(", ") : "—"],
        ]
      : [
          ["Performer", item.performer],
          // Stored lowercase as an enum value; presented capitalised.
          ["Category", item.category.charAt(0).toUpperCase() + item.category.slice(1)],
        ];

  return (
    <dl className="mt-6 divide-y divide-black/5 border-y border-black/5 dark:divide-white/10 dark:border-white/10">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-6">
          <dt className="w-28 shrink-0 text-sm text-black/50 dark:text-white/50">{label}</dt>
          <dd className="text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function ContentDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const item = await fetchContentById(id);

  // A missing or malformed id renders the real 404 page and returns a 404
  // status, rather than a 200 with an error message on it.
  if (!item) notFound();

  // Independent fetch, not embedded in the content document: shows live in
  // Postgres and content lives in Mongo, joined only by this id at read time.
  const shows = await fetchShowsForContent(item._id);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
      <Link
        href={item.type === "movie" ? "/browse?type=movie" : "/browse?type=event"}
        className="text-sm text-black/55 underline underline-offset-4 hover:text-foreground dark:text-white/55"
      >
        &larr; Back to browse
      </Link>

      <div className="mt-6 flex flex-col gap-8 sm:flex-row sm:gap-10">
        <div className="relative aspect-[2/3] w-full shrink-0 overflow-hidden rounded-lg bg-black/5 sm:w-64 dark:bg-white/5">
          <Image
            src={item.posterUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 256px"
            className="object-cover"
            priority
          />
        </div>

        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium uppercase tracking-wider text-black/45 dark:text-white/45">
            {item.type === "movie" ? "Movie" : item.category}
          </span>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{item.title}</h1>

          {item.genres.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.genres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-full border border-black/10 px-2.5 py-0.5 text-xs dark:border-white/15"
                >
                  {genre}
                </span>
              ))}
            </div>
          ) : null}

          <p className="mt-5 text-sm leading-relaxed text-black/75 dark:text-white/75">
            {item.description}
          </p>

          <Details item={item} />

          {item.trailerUrl ? (
            <a
              href={item.trailerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-block rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Watch trailer
            </a>
          ) : null}

          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-black/45 dark:text-white/45">
              Showtimes
            </h2>
            <div className="mt-3">
              <ShowtimesList shows={shows} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
