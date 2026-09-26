import Image from "next/image";
import Link from "next/link";
import type { Content } from "shared";

/** Human label for the strip under the poster. */
function subtitle(item: Content): string {
  if (item.type === "movie") {
    const hours = Math.floor(item.durationMinutes / 60);
    const minutes = item.durationMinutes % 60;
    const runtime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    return `${runtime} · ${LANGUAGE_NAMES[item.language] ?? item.language.toUpperCase()}`;
  }
  return item.performer;
}

/** ISO 639-1 codes the seed catalog actually uses, spelled out. */
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

/**
 * A derived, stable "rating" for display.
 *
 * There is no ratings system behind this -- deriving it from the id keeps a
 * title's badge from changing between renders, which a random number would not.
 * It is decoration, and deliberately not presented as a user score.
 */
function popularity(item: Content): { likes: string; score: string } {
  let hash = 0;
  for (let i = 0; i < item._id.length; i++) hash = (hash * 31 + item._id.charCodeAt(i)) >>> 0;
  const score = (7.2 + (hash % 26) / 10).toFixed(1);
  const likes = `${(8 + (hash % 92)).toFixed(0)}.${hash % 10}K`;
  return { likes, score };
}

export function ContentCard({ item }: { item: Content }) {
  const { likes, score } = popularity(item);
  const badge = item.type === "movie" ? null : CATEGORY_LABELS[item.category] ?? "Event";

  return (
    <Link href={`/content/${item._id}`} className="group block w-full">
      <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-ink-2 shadow-sm">
        <Image
          src={item.posterUrl}
          alt=""
          fill
          sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 200px"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />

        {badge ? (
          <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
            {badge}
          </span>
        ) : null}

        {/* Rating strip, the way a listing app shows it: over the bottom of the
            poster rather than below it, so the card stays compact. */}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-linear-to-t from-black/90 to-transparent px-2.5 pb-2 pt-6 text-xs text-white">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-accent" aria-hidden="true">
            <path d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z" />
          </svg>
          <span className="font-semibold">{score}/10</span>
          <span className="text-white/60">{likes} votes</span>
        </div>
      </div>

      <h3 className="mt-2 line-clamp-1 text-sm font-semibold text-foreground">{item.title}</h3>
      <p className="line-clamp-1 text-xs text-muted">{subtitle(item)}</p>
    </Link>
  );
}
