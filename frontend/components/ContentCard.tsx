import Image from "next/image";
import Link from "next/link";
import type { Content } from "shared";

/** One-line summary of whatever distinguishes this item's type. */
function subtitle(item: Content): string {
  if (item.type === "movie") {
    const hours = Math.floor(item.durationMinutes / 60);
    const minutes = item.durationMinutes % 60;
    const runtime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    return `${runtime} · ${item.language.toUpperCase()}`;
  }
  return item.performer;
}

export function ContentCard({ item }: { item: Content }) {
  return (
    <Link
      href={`/content/${item._id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-black/10 transition-colors hover:border-black/30 dark:border-white/15 dark:hover:border-white/40"
    >
      <div className="relative aspect-[2/3] bg-black/5 dark:bg-white/5">
        <Image
          src={item.posterUrl}
          alt=""
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
          {item.type === "movie" ? "Movie" : item.category}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h2 className="text-sm font-medium leading-snug">{item.title}</h2>
        <p className="text-xs text-black/55 dark:text-white/55">{subtitle(item)}</p>
        {item.genres.length > 0 ? (
          <p className="mt-auto pt-2 text-[11px] text-black/40 dark:text-white/40">
            {item.genres.join(" · ")}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
