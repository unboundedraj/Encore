/**
 * Server-only half of the city selection. Split from lib/city.ts because this
 * imports next/headers, which cannot be pulled into a client component -- and
 * the client half (persistCity, the city list) is needed by the picker.
 */

import { cookies } from "next/headers";
import { CITY_COOKIE, DEFAULT_CITY } from "./city";

/** The visitor's chosen city, or the default when they have not chosen one. */
export async function getSelectedCity(): Promise<string> {
  const store = await cookies();
  const value = store.get(CITY_COOKIE)?.value?.trim();
  return value ? decodeURIComponent(value) : DEFAULT_CITY;
}
