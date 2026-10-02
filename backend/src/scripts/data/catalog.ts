/**
 * The film list both seeders read, loaded from the committed TMDB snapshot
 * (see fetchTmdb.ts). seedContent writes these as catalog documents and
 * seedShows schedules showtimes against the same ids, so they must derive the
 * id the same way -- which is why that derivation lives here, once.
 */

import snapshot from "./tmdbMovies.json";

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

export const TMDB_MOVIES = snapshot as TmdbMovie[];

/** Mongo ids are 24 hex chars: a fixed prefix, then the TMDB id in hex. */
export function tmdbContentId(tmdbId: number): string {
  return `65f1a2b3c4d5e6f703${tmdbId.toString(16).padStart(6, "0")}`;
}

/** Ids of the fictional films earlier seeds wrote; removed on re-seed. */
export const LEGACY_MOVIE_IDS = Array.from(
  { length: 15 },
  (_, i) => `65f1a2b3c4d5e6f7010000${(i + 1).toString(16).padStart(2, "0")}`
);

/** Film ids grouped by language, in snapshot (popularity) order. */
export function filmsByLanguage(): Record<string, string[]> {
  const pools: Record<string, string[]> = {};
  for (const m of TMDB_MOVIES) (pools[m.language] ??= []).push(tmdbContentId(m.tmdbId));
  return pools;
}
