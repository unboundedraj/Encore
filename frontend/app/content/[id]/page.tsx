import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Content } from "shared";
import { ShowtimesList } from "@/components/ShowtimesList";
import { getSelectedCity } from "@/lib/city-server";
import { fetchContentById } from "@/lib/content-api";
import { fetchShowsForContent } from "@/lib/show-api";
import { formatCurrency } from "@/lib/utils";

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

const LANGUAGE_NAMES: Record<string, string> = {
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  ml: "Malayalam",
  kn: "Kannada",
  bn: "Bengali",
  mr: "Marathi",
  en: "English",
};

const CATEGORY_LABELS: Record<string, string> = {
  concert: "Concert",
  play: "Theatre",
  standup: "Comedy",
  sports: "Sports",
  conference: "Conference",
  other: "Event",
};

function runtime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Matches ContentCard so a title's badge does not change between pages. */
function popularity(item: Content): { likes: string; score: string } {
  let hash = 0;
  for (let i = 0; i < item._id.length; i++) hash = (hash * 31 + item._id.charCodeAt(i)) >>> 0;
  return {
    score: (7.2 + (hash % 26) / 10).toFixed(1),
    likes: `${(8 + (hash % 92)).toFixed(0)}.${hash % 10}K`,
  };
}

/** Type-specific rows. The discriminant is what makes this exhaustive. */
function Details({ item }: { item: Content }) {
  const rows =
    item.type === "movie"
      ? [
          ["Runtime", runtime(item.durationMinutes)],
          ["Language", LANGUAGE_NAMES[item.language] ?? item.language.toUpperCase()],
          ["Cast", item.cast.length > 0 ? item.cast.join(", ") : "—"],
        ]
      : [
          ["Performer", item.performer],
          ["Category", CATEGORY_LABELS[item.category] ?? item.category],
        ];

  return (
    <dl className="divide-y divide-hairline">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-6">
          <dt className="w-32 shrink-0 text-sm text-muted">{label}</dt>
          <dd className="text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function ContentDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<{ date?: string }>;
}) {
  const { id } = await params;
  const { date } = await searchParams;
  const item = await fetchContentById(id);

  // A missing or malformed id renders the real 404 page and returns a 404
  // status, rather than a 200 with an error message on it.
  if (!item) notFound();

  const city = await getSelectedCity();

  // Independent fetch, not embedded in the content document: shows live in
  // Postgres and content lives in Mongo, joined only by this id at read time.
  // Both the city's shows and the full set are needed -- the second is what
  // lets an empty city list say "it is on in Pune" instead of just "nothing".
  const [shows, allShows] = await Promise.all([
    fetchShowsForContent(item._id, city),
    fetchShowsForContent(item._id),
  ]);

  const { score, likes } = popularity(item);
  const kind = item.type === "movie" ? "Movie" : CATEGORY_LABELS[item.category] ?? "Event";
  const cheapest = shows.length > 0 ? Math.min(...shows.map((s) => s.price)) : null;
  const otherCities = [...new Set(allShows.map((s) => s.venue_city))].filter((c) => c !== city);

  return (
    <main className="flex-1">
      {/* Dark hero band with the poster overlapping into the content below --
          the layout a ticketing app uses for a title page. */}
      <div className="relative overflow-hidden bg-ink-2 text-white">
        {/* The poster again, blurred, as a backdrop. Decorative only. */}
        <Image
          src={item.posterUrl}
          alt=""
          fill
          sizes="100vw"
          aria-hidden="true"
          className="scale-110 object-cover opacity-20 blur-2xl"
        />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:flex-row sm:gap-10 sm:px-6 sm:py-12">
          <div className="relative aspect-2/3 w-40 shrink-0 self-center overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10 sm:w-56 sm:self-start">
            <Image
              src={item.posterUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 160px, 224px"
              className="object-cover"
              priority
            />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">{item.title}</h1>

            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 backdrop-blur-sm">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-accent" aria-hidden="true">
                <path d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z" />
              </svg>
              <span className="text-sm font-semibold">{score}/10</span>
              <span className="text-sm text-white/60">{likes} votes</span>
            </div>

            <p className="mt-4 text-sm text-white/80">
              {[
                kind,
                item.type === "movie" ? runtime(item.durationMinutes) : null,
                item.type === "movie"
                  ? LANGUAGE_NAMES[item.language] ?? item.language.toUpperCase()
                  : item.performer,
                item.genres.slice(0, 3).join(", ") || null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {shows.length > 0 ? (
                <a
                  href="#showtimes"
                  className="rounded-md bg-accent px-8 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-accent-dark"
                >
                  Book tickets
                  {cheapest !== null ? (
                    <span className="ml-2 font-normal text-white/80">
                      from {formatCurrency(cheapest)}
                    </span>
                  ) : null}
                </a>
              ) : (
                <span className="rounded-md bg-white/10 px-6 py-3 text-sm font-medium text-white/70">
                  Not currently showing in {city}
                </span>
              )}
              {item.trailerUrl ? (
                <a
                  href={item.trailerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-white/30 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
                >
                  Watch trailer
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <Link
          href={item.type === "movie" ? "/browse?type=movie" : "/browse?type=event"}
          className="text-sm font-medium text-accent hover:underline"
        >
          &larr; Back to browse
        </Link>

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <section id="showtimes" className="scroll-mt-20">
              <h2 className="text-xl font-bold tracking-tight">Showtimes in {city}</h2>
              <div className="mt-4">
                <ShowtimesList
                  shows={shows}
                  city={city}
                  otherCities={otherCities}
                  selectedDate={date}
                  dateHref={(key) => `/content/${item._id}?date=${key}#showtimes`}
                />
              </div>
            </section>
          </div>

          <aside className="min-w-0">
            <div className="rounded-lg bg-surface p-5 shadow-sm">
              <h2 className="text-lg font-bold tracking-tight">About</h2>
              <p className="mt-3 text-sm leading-relaxed text-foreground/80">{item.description}</p>

              {item.genres.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {item.genres.map((genre) => (
                    <span
                      key={genre}
                      className="rounded-full border border-hairline px-2.5 py-0.5 text-xs text-muted"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-4">
                <Details item={item} />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
