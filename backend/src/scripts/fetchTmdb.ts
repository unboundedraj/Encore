/**
 * Pulls currently-relevant Indian films from TMDB into a committed JSON
 * snapshot (data/tmdbMovies.json).
 *
 * A snapshot, rather than fetching inside the seeders, so that seedContent and
 * seedShows read the exact same list (both need it: one writes the catalog
 * documents, the other schedules shows against their ids), re-seeding works
 * offline, and ids stay stable until someone deliberately refreshes this file.
 *
 * Needs TMDB_API_KEY (the v3 key) in backend/.env.
 * Run with: npm run seed:tmdb -w backend
 *
 * Film data and poster images are provided by TMDB (themoviedb.org); the
 * footer carries the attribution their terms require. This product uses the
 * TMDB API but is not endorsed or certified by TMDB.
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.themoviedb.org/3";
const IMAGE = "https://image.tmdb.org/t/p/w500";
const KEY = process.env.TMDB_API_KEY;

/** Language -> how many titles to keep. Weighted toward where audiences are. */
const QUOTA: Record<string, number> = {
  hi: 9,
  te: 5,
  ta: 5,
  ml: 4,
  kn: 3,
  bn: 2,
  mr: 2,
  pa: 1,
  gu: 1,
};

interface Discovered {
  id: number;
  poster_path: string | null;
  popularity: number;
}

interface Details {
  id: number;
  title: string;
  overview: string;
  runtime: number | null;
  release_date: string;
  original_language: string;
  poster_path: string | null;
  genres: { name: string }[];
  production_countries?: { iso_3166_1: string }[];
  credits?: { cast: { name: string; order: number }[] };
  videos?: { results: { site: string; type: string; key: string; official: boolean }[] };
}

export interface TmdbMovie {
  tmdbId: number;
  title: string;
  description: string;
  posterUrl: string;
  trailerUrl: string | null;
  genres: string[];
  durationMinutes: number;
  cast: string[];
  language: string;
  releaseDate: string;
}

async function tmdb<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API}${path}`);
  url.searchParams.set("api_key", KEY as string);
  for (const [k, val] of Object.entries(params)) url.searchParams.set(k, val);

  // TMDB drops connections intermittently from some Indian networks (the first
  // request of a burst is the usual casualty), so retry generously.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`TMDB ${path} -> HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt >= 8) {
        const cause = (err as { cause?: { code?: string } }).cause?.code;
        throw new Error(`${(err as Error).message}${cause ? ` (${cause})` : ""} after ${attempt} attempts`);
      }
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function main() {
  if (!KEY) {
    console.error("TMDB_API_KEY is not set in backend/.env");
    process.exit(2);
  }

  const picked: TmdbMovie[] = [];

  for (const [language, quota] of Object.entries(QUOTA)) {
    // Recent and upcoming only, so the listing reads like "now showing"
    // rather than an all-time popularity chart.
    const found = await tmdb<{ results: Discovered[] }>("/discover/movie", {
      with_original_language: language,
      region: "IN",
      sort_by: "popularity.desc",
      include_adult: "false",
      "primary_release_date.gte": isoDay(-240),
      "primary_release_date.lte": isoDay(10),
    });

    let kept = 0;
    for (const candidate of found.results) {
      if (kept >= quota) break;
      if (!candidate.poster_path) continue;

      const d = await tmdb<Details>(`/movie/${candidate.id}`, {
        language: "en-US",
        append_to_response: "credits,videos",
      });

      // A listing needs a real runtime and a real synopsis; TMDB has stubs
      // for unreleased or obscure titles that would render as blank cards.
      // Indian-origin only: Bengali, Punjabi and Tamil also cover Bangladeshi,
      // Pakistani and Sri Lankan productions that share the language code.
      if (!d.production_countries?.some((c) => c.iso_3166_1 === "IN")) continue;
      if (!d.runtime || d.runtime < 60) continue;
      if (!d.overview || d.overview.length < 40) continue;

      const trailer = d.videos?.results.find(
        (video) => video.site === "YouTube" && video.type === "Trailer"
      );

      picked.push({
        tmdbId: d.id,
        title: d.title,
        description: d.overview,
        posterUrl: `${IMAGE}${d.poster_path}`,
        trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
        genres: d.genres.map((g) => g.name).slice(0, 4),
        durationMinutes: d.runtime,
        cast: (d.credits?.cast ?? [])
          .sort((a, b) => a.order - b.order)
          .slice(0, 3)
          .map((c) => c.name),
        language,
        releaseDate: d.release_date,
      });
      kept++;
    }
    console.log(`${language}: kept ${kept}/${quota}`);
  }

  const dir = join(__dirname, "data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "tmdbMovies.json"), JSON.stringify(picked, null, 2) + "\n");
  console.log(`\nwrote ${picked.length} films to scripts/data/tmdbMovies.json`);
}

main().catch((err: Error) => {
  console.error(`fetch failed: ${err.message}`);
  process.exit(1);
});
