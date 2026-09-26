/**
 * Show/seat reads for server components. Same reasoning as content-api.ts:
 * these endpoints are public, so no Firebase token is involved and the fetch
 * can run during rendering.
 */

import type { SeatWithStatus, ShowDetail, ShowListItem } from "shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Showtimes change on a schedule someone sets, not per request, so a short
 * cache is safe and cuts backend load from repeated content-page views.
 */
const SHOWS_LIST_CACHE = { next: { revalidate: 60, tags: ["shows"] } } satisfies RequestInit;

/**
 * Deliberately uncached. Availability changes the moment someone books, and a
 * page whose entire purpose is "how many seats are left" showing a minute-old
 * answer is a worse trade than the extra backend hit. Once real traffic makes
 * that cost matter, this is the number to revisit.
 */
const LIVE = { cache: "no-store" } satisfies RequestInit;

/** `city` restricts to venues in that city; omit it for every city. */
export async function fetchShowsForContent(
  contentId: string,
  city?: string
): Promise<ShowListItem[]> {
  const qs = city ? `?city=${encodeURIComponent(city)}` : "";
  const res = await fetch(
    `${API_URL}/api/content/${encodeURIComponent(contentId)}/shows${qs}`,
    SHOWS_LIST_CACHE
  );
  if (!res.ok) throw new Error(`Failed to load showtimes (${res.status})`);
  const body = (await res.json()) as { items: ShowListItem[] };
  return body.items;
}

export async function fetchShowDetail(showId: string): Promise<ShowDetail | null> {
  const res = await fetch(`${API_URL}/api/shows/${encodeURIComponent(showId)}`, LIVE);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load show (${res.status})`);
  return (await res.json()) as ShowDetail;
}

export async function fetchSeatMap(showId: string): Promise<SeatWithStatus[]> {
  const res = await fetch(`${API_URL}/api/shows/${encodeURIComponent(showId)}/seats`, LIVE);
  if (!res.ok) throw new Error(`Failed to load seat map (${res.status})`);
  const body = (await res.json()) as { items: SeatWithStatus[] };
  return body.items;
}
