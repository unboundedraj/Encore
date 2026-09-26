/**
 * Catalog reads for server components.
 *
 * Deliberately separate from lib/api.ts: that one pulls in the Firebase client
 * SDK to attach a user's ID token, which cannot run on the server. These
 * endpoints are public, so no credential is involved and the fetch can happen
 * during rendering.
 */

import type { CitySummary, Content, ContentType, EventCategory, Paginated } from "shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Cache the upstream response for five minutes.
 *
 * Next 15+ defaults fetch to no-store, so caching has to be asked for
 * explicitly. A catalog changes when someone adds a title -- not per request --
 * so serving a page built from data up to five minutes old is the right trade,
 * and it keeps a burst of traffic from turning into a burst of backend queries.
 * Tagged so a future admin write can revalidateTag('content') and refresh
 * immediately rather than waiting the window out.
 */
const CACHE = { next: { revalidate: 300, tags: ["content"] } } satisfies RequestInit;

export interface ContentQuery {
  type?: ContentType;
  category?: EventCategory;
  /** Restricts to titles with at least one upcoming show in this city. */
  city?: string;
  page?: number;
  limit?: number;
}

export async function fetchContentList(query: ContentQuery = {}): Promise<Paginated<Content>> {
  const params = new URLSearchParams();
  if (query.type) params.set("type", query.type);
  if (query.category) params.set("category", query.category);
  if (query.city) params.set("city", query.city);
  if (query.page) params.set("page", String(query.page));
  if (query.limit) params.set("limit", String(query.limit));

  const qs = params.toString();
  const res = await fetch(`${API_URL}/api/content${qs ? `?${qs}` : ""}`, CACHE);

  if (!res.ok) {
    // Surfaced as the route's error boundary rather than rendered as an empty
    // catalog, which would look like "we have nothing" instead of "we broke".
    throw new Error(`Catalog request failed (${res.status})`);
  }
  return (await res.json()) as Paginated<Content>;
}

/**
 * Cities that currently have something on.
 *
 * Falls back to an empty list rather than throwing: the picker has a static
 * list of its own to fall back on, and a city lookup failing is no reason to
 * take down a page that otherwise renders fine.
 */
export async function fetchCities(): Promise<CitySummary[]> {
  try {
    const res = await fetch(`${API_URL}/api/cities`, CACHE);
    if (!res.ok) return [];
    const body = (await res.json()) as { items: CitySummary[] };
    return body.items ?? [];
  } catch {
    return [];
  }
}

/** Returns null for a missing item so the page can call notFound(). */
export async function fetchContentById(id: string): Promise<Content | null> {
  const res = await fetch(`${API_URL}/api/content/${encodeURIComponent(id)}`, CACHE);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
  return (await res.json()) as Content;
}
