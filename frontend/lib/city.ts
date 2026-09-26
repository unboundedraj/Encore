/**
 * The selected city, shared between server and client.
 *
 * Stored in a cookie rather than a query string or localStorage. A query
 * string would have to be threaded through every link on the site, and
 * localStorage is invisible to a server component -- which would mean the
 * first render always showed the wrong city and then corrected itself. A
 * cookie is the one place both halves can read.
 */

export const CITY_COOKIE = "encore_city";

/**
 * Used when nobody has chosen yet. Picking a default rather than blocking on a
 * chooser means a first-time visitor sees a populated page immediately; the
 * header makes the current city obvious and one click away from changing.
 */
export const DEFAULT_CITY = "Mumbai";

/**
 * Cities offered in the picker even when the API is unreachable, so the
 * selector is never empty. The API's list (cities that genuinely have shows)
 * takes precedence -- this is only the fallback ordering.
 */
export const POPULAR_CITIES = [
  "Mumbai",
  "Delhi NCR",
  "Bengaluru",
  "Hyderabad",
  "Chennai",
  "Kolkata",
  "Pune",
] as const;

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Writes the cookie from the browser. Server components read it via next/headers. */
export function persistCity(city: string): void {
  document.cookie = `${CITY_COOKIE}=${encodeURIComponent(city)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
