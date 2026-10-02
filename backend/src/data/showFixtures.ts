/**
 * Everything that describes the ticketing fixtures -- venues, screens, seat
 * layouts, what each screen plays, and the generator that turns that into
 * dated showtimes -- with no database access. Shared by the seed script (which
 * writes venues, screens and seats once) and by the server's rolling top-up
 * (which keeps showtimes ahead of today without ever touching sold ones), so
 * both produce exactly the same shows.
 *
 * Show ids are derived from the *calendar date* of the showtime, not from "N
 * days after whenever the seed ran". That is what lets a top-up re-derive an
 * id it already inserted on an earlier day and skip it, rather than creating
 * a second copy of the same screening.
 */

import { createHash } from "node:crypto";
import { filmsByLanguage } from "../scripts/data/catalog";

// ---------------------------------------------------------------------------
// Ids that must not move
//
// These four are referenced by tests and by links that may already exist, so
// they are pinned to specific showtimes below rather than left to the derived
// id scheme. SHOW_ONE in particular must stay an assigned-seating show on
// SCREEN_ONE: checkoutWebhook.ts looks up seats by that screen id, and
// checkoutLive.ts expects SHOW_GA to be general admission.
// ---------------------------------------------------------------------------
export const VENUE_PVR_PHOENIX = "11111111-1111-1111-1111-111111111111";
export const VENUE_JIO_GARDEN = "33333333-3333-3333-3333-333333333333";
export const SCREEN_ONE = "22222222-2222-2222-2222-222222222222";
export const SHOW_ONE = "a4620294-915a-4671-be81-03e313c9df81";
export const SHOW_TWO = "6cd65801-eaf8-4320-82ad-4b704085637d";
export const SHOW_THREE = "0786da7f-9e35-4175-bfc5-a6ee8659a62d";
export const SHOW_GA = "aed18429-63c1-4165-9d1f-17ae3b2688c8";

export const v = (n: string) => `a1000000-0000-4000-8000-0000000000${n}`;
export const s = (n: string) => `b2000000-0000-4000-8000-0000000000${n}`;

// Event ids, mirroring seedContent.ts. Films are not listed here: their ids are
// derived from the TMDB snapshot (data/catalog.ts) and picked by language below.
export const C = {
  indianOcean: "65f1a2b3c4d5e6f702000001",
  tughlaq: "65f1a2b3c4d5e6f702000002",
  zakir: "65f1a2b3c4d5e6f702000003",
  mumbaiOpen: "65f1a2b3c4d5e6f702000004",
  bassi: "65f1a2b3c4d5e6f702000005",
  kenny: "65f1a2b3c4d5e6f702000006",
  divine: "65f1a2b3c4d5e6f702000007",
  prateek: "65f1a2b3c4d5e6f702000008",
  rahulSub: "65f1a2b3c4d5e6f702000009",
  carnatic: "65f1a2b3c4d5e6f70200000a",
  courtMartial: "65f1a2b3c4d5e6f70200000b",
  openMic: "65f1a2b3c4d5e6f70200000c",
  samayRaina: "65f1a2b3c4d5e6f70200000d",
  gauravKapoor: "65f1a2b3c4d5e6f70200000e",
  abhishekUpmanyu: "65f1a2b3c4d5e6f70200000f",
  virDas: "65f1a2b3c4d5e6f702000010",
  aakashGupta: "65f1a2b3c4d5e6f702000011",
  tanmayBhat: "65f1a2b3c4d5e6f702000012",
  anuvJain: "65f1a2b3c4d5e6f702000013",
  arijit: "65f1a2b3c4d5e6f702000014",
  diljit: "65f1a2b3c4d5e6f702000015",
  shreya: "65f1a2b3c4d5e6f702000016",
  nucleya: "65f1a2b3c4d5e6f702000017",
} as const;

export const VENUES = [
  // Mumbai
  { id: VENUE_PVR_PHOENIX, name: "PVR ICON: Phoenix Palladium", address: "462 Senapati Bapat Marg, Lower Parel", city: "Mumbai" },
  { id: v("01"), name: "INOX: R-City, Ghatkopar", address: "LBS Marg, Ghatkopar West", city: "Mumbai" },
  { id: v("02"), name: "The Habitat, Khar", address: "Above Gold's Gym, Linking Road, Khar West", city: "Mumbai" },
  { id: VENUE_JIO_GARDEN, name: "Jio World Garden, BKC", address: "Bandra Kurla Complex, Bandra East", city: "Mumbai" },
  { id: v("03"), name: "NCPA Tata Theatre", address: "NCPA Marg, Nariman Point", city: "Mumbai" },
  // Delhi NCR
  { id: v("04"), name: "PVR Director's Cut: Ambience Vasant Kunj", address: "Ambience Mall, Vasant Kunj", city: "Delhi NCR" },
  { id: v("05"), name: "Canvas Laugh Club, Noida", address: "DLF Mall of India, Sector 18, Noida", city: "Delhi NCR" },
  { id: v("06"), name: "Kamani Auditorium", address: "1 Copernicus Marg, Mandi House", city: "Delhi NCR" },
  // Bengaluru
  { id: v("07"), name: "PVR IMAX: Forum Mall, Koramangala", address: "21 Hosur Road, Koramangala", city: "Bengaluru" },
  { id: v("08"), name: "INOX: Garuda Mall, Magrath Road", address: "Magrath Road, Ashok Nagar", city: "Bengaluru" },
  { id: v("09"), name: "That Comedy Club, Indiranagar", address: "100 Feet Road, Indiranagar", city: "Bengaluru" },
  // Hyderabad
  { id: v("0a"), name: "AMB Cinemas, Gachibowli", address: "Sattva Knowledge City, Gachibowli", city: "Hyderabad" },
  { id: v("0b"), name: "Shilpakala Vedika", address: "Hitech City Main Road, Madhapur", city: "Hyderabad" },
  // Chennai
  { id: v("0c"), name: "PVR Sathyam, Royapettah", address: "8 Thiru Vi Ka Road, Royapettah", city: "Chennai" },
  { id: v("0d"), name: "The Music Academy", address: "168 TTK Road, Royapettah", city: "Chennai" },
  // Pune
  { id: v("0e"), name: "PVR: Pavillion Mall, SB Road", address: "Senapati Bapat Road, Shivajinagar", city: "Pune" },
  { id: v("11"), name: "INOX: Phoenix Marketcity, Viman Nagar", address: "Nagar Road, Viman Nagar", city: "Pune" },
  { id: v("12"), name: "Canvas Laugh Club, Pune", address: "North Main Road, Koregaon Park", city: "Pune" },
  // Kolkata
  { id: v("0f"), name: "INOX: Quest Mall, Ballygunge", address: "33 Syed Amir Ali Avenue, Ballygunge", city: "Kolkata" },
  { id: v("10"), name: "Kala Mandir", address: "48 Shakespeare Sarani, Kolkata", city: "Kolkata" },
  // Added venues in existing cities
  { id: v("13"), name: "PVR: Phoenix Marketcity, Kurla", address: "LBS Marg, Kurla West", city: "Mumbai" },
  { id: v("14"), name: "PVR: E-Square, University Road", address: "University Road, Ganeshkhind", city: "Pune" },
  // Ahmedabad
  { id: v("15"), name: "PVR: Acropolis Mall, Thaltej", address: "Acropolis Mall, Thaltej", city: "Ahmedabad" },
  { id: v("16"), name: "INOX: Himalaya Mall, Drive-In Road", address: "Drive-In Road, Memnagar", city: "Ahmedabad" },
  { id: v("17"), name: "Gujarat University Convention Centre", address: "Navrangpura", city: "Ahmedabad" },
  // Jaipur
  { id: v("18"), name: "Raj Mandir Cinema", address: "Bhagwan Das Road, Panch Batti", city: "Jaipur" },
  { id: v("19"), name: "PVR: World Trade Park, Malviya Nagar", address: "JLN Marg, Malviya Nagar", city: "Jaipur" },
  { id: v("1a"), name: "Jawahar Kala Kendra", address: "JLN Marg, Jhalana Doongri", city: "Jaipur" },
  // Chandigarh
  { id: v("1b"), name: "PVR: Elante Mall", address: "Industrial Area Phase 1", city: "Chandigarh" },
  { id: v("1c"), name: "Neelam Cinema", address: "Sector 17", city: "Chandigarh" },
  { id: v("1d"), name: "Tagore Theatre", address: "Sector 18", city: "Chandigarh" },
  // Lucknow
  { id: v("1e"), name: "PVR: Phoenix Palassio", address: "Amar Shaheed Path, Sushant Golf City", city: "Lucknow" },
  { id: v("1f"), name: "PVR: Lulu Mall", address: "Sushant Golf City, Shaheed Path", city: "Lucknow" },
  { id: v("20"), name: "Sangeet Natak Akademi Auditorium", address: "Gomti Nagar", city: "Lucknow" },
  // Kochi
  { id: v("21"), name: "PVR: Lulu Mall, Edappally", address: "NH 66 Bypass, Edappally", city: "Kochi" },
  { id: v("22"), name: "Cinepolis: Centre Square Mall", address: "MG Road, Ernakulam", city: "Kochi" },
  { id: v("23"), name: "Kerala Fine Arts Hall", address: "Fine Arts Avenue, Ernakulam", city: "Kochi" },
  // Indore
  { id: v("24"), name: "INOX: Treasure Island Mall", address: "MG Road", city: "Indore" },
  { id: v("25"), name: "PVR: Phoenix Citadel", address: "Nipania, Bypass Road", city: "Indore" },
  { id: v("26"), name: "Abhay Prashal Auditorium", address: "Race Course Road", city: "Indore" },
];

/**
 * Seat layouts, sized like real multiplex audis rather than a demo grid.
 *
 * `premiumRows` counts from row A, which renders at the *back* of the hall --
 * the seat map puts the screen at the bottom, the way an Indian multiplex
 * booking flow does, so row A is the furthest from it and therefore the
 * expensive block. seat_type only has two values, so the map shows two zones;
 * a third (a separate recliner tier) would need an enum migration and is
 * deliberately out of scope, since pricing here is per show, not per seat.
 */
export const LAYOUTS = {
  imax: { rows: 14, seatsPerRow: 20, premiumRows: 3 },
  large: { rows: 12, seatsPerRow: 18, premiumRows: 2 },
  standard: { rows: 10, seatsPerRow: 16, premiumRows: 2 },
  boutique: { rows: 8, seatsPerRow: 12, premiumRows: 2 },
} as const;

export type LayoutName = keyof typeof LAYOUTS;

export const SCREENS: { id: string; venueId: string; name: string; layout: LayoutName }[] = [
  { id: SCREEN_ONE, venueId: VENUE_PVR_PHOENIX, name: "Audi 1 - IMAX", layout: "imax" },
  { id: s("01"), venueId: VENUE_PVR_PHOENIX, name: "Audi 2", layout: "large" },
  { id: s("02"), venueId: v("01"), name: "Screen 3", layout: "large" },
  { id: s("03"), venueId: v("01"), name: "Screen 4 - Insignia", layout: "boutique" },
  { id: s("04"), venueId: v("04"), name: "Director's Cut Audi 1", layout: "boutique" },
  { id: s("05"), venueId: v("07"), name: "IMAX Audi", layout: "imax" },
  { id: s("06"), venueId: v("07"), name: "Audi 4", layout: "standard" },
  { id: s("07"), venueId: v("08"), name: "Screen 1", layout: "standard" },
  { id: s("08"), venueId: v("0a"), name: "Audi 2 - Dolby Atmos", layout: "large" },
  { id: s("09"), venueId: v("0c"), name: "Screen 1 - Sathyam", layout: "standard" },
  { id: s("0a"), venueId: v("0e"), name: "Audi 3", layout: "standard" },
  { id: s("0b"), venueId: v("0f"), name: "Screen 2", layout: "standard" },
  { id: s("0c"), venueId: v("11"), name: "Screen 2", layout: "large" },
  { id: s("0d"), venueId: v("13"), name: "Screen 1", layout: "large" },
  { id: s("0e"), venueId: v("14"), name: "Audi 2", layout: "standard" },
  { id: s("0f"), venueId: v("15"), name: "Audi 1 - Gold", layout: "large" },
  { id: s("10"), venueId: v("15"), name: "Audi 3", layout: "standard" },
  { id: s("11"), venueId: v("16"), name: "Screen 2", layout: "standard" },
  { id: s("12"), venueId: v("18"), name: "Main Screen", layout: "large" },
  { id: s("13"), venueId: v("19"), name: "Audi 1", layout: "standard" },
  { id: s("14"), venueId: v("1b"), name: "Audi 1 - Dolby Atmos", layout: "large" },
  { id: s("15"), venueId: v("1b"), name: "Audi 4", layout: "standard" },
  { id: s("16"), venueId: v("1c"), name: "Screen 1", layout: "standard" },
  { id: s("17"), venueId: v("1e"), name: "Audi 2", layout: "large" },
  { id: s("18"), venueId: v("1f"), name: "Audi 1", layout: "standard" },
  { id: s("19"), venueId: v("21"), name: "Audi 1 - Dolby Atmos", layout: "large" },
  { id: s("1a"), venueId: v("21"), name: "Audi 3", layout: "standard" },
  { id: s("1b"), venueId: v("22"), name: "Screen 2", layout: "standard" },
  { id: s("1c"), venueId: v("24"), name: "Screen 1", layout: "large" },
  { id: s("1d"), venueId: v("25"), name: "Audi 2", layout: "standard" },
];

export const ROW_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * Seat ids are derived rather than listed. They are never addressed
 * individually in a URL, so a readable pattern beats two thousand literals:
 * the last block encodes screen index, row index and seat number, so
 * ...000000010203 is screen 1, row B, seat 3.
 */
export function seatId(screenIndex: number, rowIndex: number, seatNumber: number): string {
  const encoded =
    String(screenIndex + 1).padStart(2, "0") +
    String(rowIndex + 1).padStart(2, "0") +
    String(seatNumber).padStart(2, "0");
  return `5ea70000-0000-0000-0000-${encoded.padStart(12, "0")}`;
}

const IST_OFFSET_MS = 5.5 * 3600_000;

/**
 * A wall-clock IST showtime, `dayOffset` days from today, as a real instant.
 *
 * Date.UTC treats its arguments as UTC, so building the desired IST wall time
 * there and subtracting the offset yields the instant that clock reading
 * corresponds to. India has no DST, so a fixed offset is correct year round.
 */
export function istShowTime(dayOffset: number, hour: number, minute: number): Date {
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  const asUtc = Date.UTC(
    nowIst.getUTCFullYear(),
    nowIst.getUTCMonth(),
    nowIst.getUTCDate() + dayOffset,
    hour,
    minute
  );
  return new Date(asUtc - IST_OFFSET_MS);
}

/** Whole days since the epoch of the IST calendar date `dayOffset` days from today. */
function istDayNumber(dayOffset: number): number {
  return Math.floor((Date.now() + IST_OFFSET_MS) / 86_400_000) + dayOffset;
}

/** "2026-10-07" for that IST date -- the stable part of a show's identity. */
function istDateKey(dayOffset: number): string {
  return new Date(istDayNumber(dayOffset) * 86_400_000).toISOString().slice(0, 10);
}

/** Fixed reference day, so a live event's weekly pattern never shifts between runs. */
const WEEK_ANCHOR_DAY = Math.floor(Date.UTC(2026, 0, 5) / 86_400_000);

/**
 * Show ids are derived from what the show *is* -- screen or venue, title,
 * calendar date and clock time -- not from its position in a generated list or
 * from how many days after a seed run it falls. Today's early slots are
 * skipped once they are too close to start, and the window moves forward every
 * day, so anything positional or relative would renumber shows between runs.
 */
function derivedShowId(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export interface ShowRow {
  id: string;
  contentId: string;
  contentType: "movie" | "event";
  venueId: string;
  screenId: string | null;
  seatingMode: "assigned" | "general";
  startTime: Date;
  price: number;
  totalCapacity: number | null;
}

/** Slots a multiplex actually runs, and the surcharge the later ones carry. */
const SLOTS = [
  { hour: 10, minute: 15, surcharge: 0 },
  { hour: 13, minute: 30, surcharge: 3000 },
  { hour: 16, minute: 45, surcharge: 5000 },
  { hour: 20, minute: 0, surcharge: 8000 },
];

/**
 * How far ahead showtimes are kept. The server tops this up daily, so "a
 * couple of months out" is always true rather than true only until the seed
 * ages. Seat and show rows are cheap; an empty listing is not.
 */
export const WINDOW_DAYS = 60;
/** Don't list a show that starts sooner than this -- nobody can get there. */
const MIN_LEAD_MINUTES = 90;

const FILMS_BY_LANGUAGE = filmsByLanguage();

/**
 * Picks films for a screen from the real catalog by language, so a Kochi
 * screen runs Malayalam and Tamil releases and a Chandigarh one runs Punjabi
 * and Hindi. `offset` staggers which film of a language each screen starts on,
 * so neighbouring screens in a city are not all running the same title.
 */
function films(langs: string[], offset = 0): string[] {
  const taken = new Map<string, number>();
  const out: string[] = [];
  for (const lang of langs) {
    const pool = FILMS_BY_LANGUAGE[lang];
    if (!pool?.length) continue;
    const n = taken.get(lang) ?? 0;
    taken.set(lang, n + 1);
    const id = pool[(offset + n) % pool.length];
    if (!out.includes(id)) out.push(id);
  }
  if (out.length === 0) throw new Error(`no films found for languages ${langs.join(",")}`);
  return out;
}

/** What each screen is playing, and its base ticket price in paise. */
export const PROGRAMME: { screenId: string; basePrice: number; films: string[] }[] = [
  // Mumbai
  { screenId: SCREEN_ONE, basePrice: 45000, films: films(["hi", "te", "hi"], 0) },
  { screenId: s("01"), basePrice: 32000, films: films(["hi", "mr", "ta"], 1) },
  { screenId: s("02"), basePrice: 28000, films: films(["hi", "mr", "hi"], 3) },
  { screenId: s("03"), basePrice: 60000, films: films(["hi", "hi"], 2) },
  { screenId: s("0d"), basePrice: 27000, films: films(["hi", "te", "ta"], 7) },
  // Delhi NCR
  { screenId: s("04"), basePrice: 75000, films: films(["hi", "hi", "pa"], 4) },
  // Bengaluru
  { screenId: s("05"), basePrice: 42000, films: films(["kn", "hi", "ta"], 0) },
  { screenId: s("06"), basePrice: 25000, films: films(["kn", "te", "hi"], 1) },
  { screenId: s("07"), basePrice: 22000, films: films(["kn", "hi", "ml"], 2) },
  // Hyderabad
  { screenId: s("08"), basePrice: 30000, films: films(["te", "hi", "te"], 0) },
  // Chennai
  { screenId: s("09"), basePrice: 24000, films: films(["ta", "ml", "ta"], 0) },
  // Pune
  { screenId: s("0a"), basePrice: 26000, films: films(["hi", "mr", "te"], 5) },
  { screenId: s("0c"), basePrice: 27000, films: films(["hi", "mr", "te"], 6) },
  { screenId: s("0e"), basePrice: 24000, films: films(["hi", "mr", "kn"], 2) },
  // Kolkata
  { screenId: s("0b"), basePrice: 23000, films: films(["bn", "hi", "bn"], 0) },
  // Ahmedabad
  { screenId: s("0f"), basePrice: 30000, films: films(["gu", "hi", "te"], 0) },
  { screenId: s("10"), basePrice: 22000, films: films(["hi", "gu", "hi"], 4) },
  { screenId: s("11"), basePrice: 21000, films: films(["gu", "hi", "pa"], 1) },
  // Jaipur
  { screenId: s("12"), basePrice: 26000, films: films(["hi", "hi", "te"], 5) },
  { screenId: s("13"), basePrice: 23000, films: films(["hi", "pa", "te"], 3) },
  // Chandigarh
  { screenId: s("14"), basePrice: 32000, films: films(["pa", "hi", "te"], 0) },
  { screenId: s("15"), basePrice: 24000, films: films(["pa", "hi", "hi"], 6) },
  { screenId: s("16"), basePrice: 20000, films: films(["pa", "hi"], 2) },
  // Lucknow
  { screenId: s("17"), basePrice: 25000, films: films(["hi", "te", "hi"], 7) },
  { screenId: s("18"), basePrice: 22000, films: films(["hi", "pa", "hi"], 8) },
  // Kochi
  { screenId: s("19"), basePrice: 26000, films: films(["ml", "ml", "ta"], 0) },
  { screenId: s("1a"), basePrice: 22000, films: films(["ml", "hi", "ml"], 2) },
  { screenId: s("1b"), basePrice: 20000, films: films(["ml", "ta", "hi"], 1) },
  // Indore
  { screenId: s("1c"), basePrice: 24000, films: films(["hi", "mr", "te"], 3) },
  { screenId: s("1d"), basePrice: 22000, films: films(["hi", "mr", "hi"], 6) },
];

/** Live events: general admission, one or two nights each. */
export const LIVE: { contentId: string; venueId: string; price: number; capacity: number; nights: { day: number; hour: number; minute: number }[] }[] = [
  { contentId: C.indianOcean, venueId: VENUE_JIO_GARDEN, price: 99900, capacity: 2500, nights: [{ day: 3, hour: 19, minute: 30 }, { day: 4, hour: 19, minute: 30 }] },
  { contentId: C.zakir, venueId: v("02"), price: 79900, capacity: 220, nights: [{ day: 1, hour: 20, minute: 0 }, { day: 2, hour: 20, minute: 0 }] },
  { contentId: C.openMic, venueId: v("02"), price: 29900, capacity: 180, nights: [{ day: 1, hour: 17, minute: 30 }, { day: 4, hour: 17, minute: 30 }] },
  { contentId: C.kenny, venueId: v("09"), price: 84900, capacity: 260, nights: [{ day: 2, hour: 20, minute: 30 }, { day: 3, hour: 20, minute: 30 }] },
  { contentId: C.bassi, venueId: v("05"), price: 74900, capacity: 400, nights: [{ day: 2, hour: 19, minute: 0 }, { day: 3, hour: 19, minute: 0 }] },
  { contentId: C.rahulSub, venueId: v("05"), price: 69900, capacity: 400, nights: [{ day: 4, hour: 19, minute: 0 }] },
  { contentId: C.divine, venueId: VENUE_JIO_GARDEN, price: 149900, capacity: 3000, nights: [{ day: 5, hour: 20, minute: 0 }] },
  { contentId: C.prateek, venueId: v("0b"), price: 119900, capacity: 1800, nights: [{ day: 2, hour: 19, minute: 30 }] },
  { contentId: C.carnatic, venueId: v("0d"), price: 59900, capacity: 1200, nights: [{ day: 1, hour: 18, minute: 30 }, { day: 3, hour: 18, minute: 30 }] },
  { contentId: C.tughlaq, venueId: v("03"), price: 89900, capacity: 1000, nights: [{ day: 2, hour: 19, minute: 0 }, { day: 4, hour: 19, minute: 0 }] },
  { contentId: C.courtMartial, venueId: v("06"), price: 64900, capacity: 620, nights: [{ day: 1, hour: 19, minute: 30 }, { day: 3, hour: 19, minute: 30 }] },
  { contentId: C.tughlaq, venueId: v("10"), price: 54900, capacity: 900, nights: [{ day: 5, hour: 18, minute: 30 }] },
  { contentId: C.mumbaiOpen, venueId: v("0b"), price: 129900, capacity: 4000, nights: [{ day: 4, hour: 16, minute: 0 }] },
  { contentId: C.samayRaina, venueId: v("12"), price: 89900, capacity: 350, nights: [{ day: 2, hour: 20, minute: 0 }, { day: 4, hour: 20, minute: 0 }] },
  { contentId: C.gauravKapoor, venueId: v("09"), price: 79900, capacity: 260, nights: [{ day: 1, hour: 19, minute: 30 }] },
  { contentId: C.abhishekUpmanyu, venueId: v("02"), price: 79900, capacity: 220, nights: [{ day: 3, hour: 20, minute: 0 }, { day: 5, hour: 20, minute: 0 }] },
  // Mumbai
  { contentId: C.tanmayBhat, venueId: v("02"), price: 69900, capacity: 220, nights: [{ day: 2, hour: 20, minute: 0 }] },
  { contentId: C.nucleya, venueId: VENUE_JIO_GARDEN, price: 129900, capacity: 3000, nights: [{ day: 3, hour: 21, minute: 0 }] },
  { contentId: C.shreya, venueId: v("03"), price: 129900, capacity: 1000, nights: [{ day: 3, hour: 19, minute: 0 }] },
  // Delhi NCR
  { contentId: C.aakashGupta, venueId: v("05"), price: 69900, capacity: 400, nights: [{ day: 5, hour: 19, minute: 0 }] },
  { contentId: C.anuvJain, venueId: v("06"), price: 99900, capacity: 620, nights: [{ day: 2, hour: 19, minute: 0 }] },
  // Bengaluru, Hyderabad, Chennai, Pune, Kolkata
  { contentId: C.virDas, venueId: v("09"), price: 89900, capacity: 260, nights: [{ day: 4, hour: 20, minute: 30 }] },
  { contentId: C.diljit, venueId: v("0b"), price: 169900, capacity: 1800, nights: [{ day: 4, hour: 19, minute: 30 }] },
  { contentId: C.shreya, venueId: v("0d"), price: 119900, capacity: 1200, nights: [{ day: 2, hour: 18, minute: 30 }] },
  { contentId: C.tanmayBhat, venueId: v("12"), price: 74900, capacity: 350, nights: [{ day: 3, hour: 20, minute: 0 }] },
  { contentId: C.arijit, venueId: v("10"), price: 199900, capacity: 900, nights: [{ day: 3, hour: 19, minute: 0 }] },
  // Ahmedabad
  { contentId: C.arijit, venueId: v("17"), price: 249900, capacity: 2500, nights: [{ day: 2, hour: 20, minute: 0 }] },
  { contentId: C.zakir, venueId: v("17"), price: 79900, capacity: 1200, nights: [{ day: 3, hour: 19, minute: 30 }] },
  // Jaipur
  { contentId: C.anuvJain, venueId: v("1a"), price: 119900, capacity: 800, nights: [{ day: 2, hour: 19, minute: 30 }] },
  { contentId: C.bassi, venueId: v("1a"), price: 74900, capacity: 600, nights: [{ day: 4, hour: 19, minute: 0 }] },
  // Chandigarh
  { contentId: C.diljit, venueId: v("1d"), price: 199900, capacity: 1500, nights: [{ day: 3, hour: 20, minute: 0 }] },
  { contentId: C.aakashGupta, venueId: v("1d"), price: 64900, capacity: 700, nights: [{ day: 1, hour: 19, minute: 30 }] },
  // Lucknow
  { contentId: C.shreya, venueId: v("20"), price: 149900, capacity: 1100, nights: [{ day: 4, hour: 19, minute: 30 }] },
  { contentId: C.rahulSub, venueId: v("20"), price: 59900, capacity: 600, nights: [{ day: 2, hour: 19, minute: 0 }] },
  // Kochi
  { contentId: C.kenny, venueId: v("23"), price: 74900, capacity: 800, nights: [{ day: 3, hour: 20, minute: 0 }] },
  { contentId: C.carnatic, venueId: v("23"), price: 49900, capacity: 700, nights: [{ day: 1, hour: 18, minute: 30 }] },
  // Indore
  { contentId: C.samayRaina, venueId: v("26"), price: 84900, capacity: 900, nights: [{ day: 3, hour: 20, minute: 0 }] },
  { contentId: C.virDas, venueId: v("26"), price: 89900, capacity: 900, nights: [{ day: 5, hour: 19, minute: 30 }] },
];

/**
 * Builds every unpinned show in the window [today, today + windowDays).
 *
 * Film rotation and live-night recurrence both key off the absolute IST day
 * number, never an offset from today, so the same calendar date yields the
 * same programme whether it is generated now or on a top-up weeks later.
 *
 * Live events repeat weekly: a night's `day` is read as a position in a fixed
 * seven-day cycle (see WEEK_ANCHOR_DAY), so an event listed for "day 3" runs
 * every seventh day for as long as the window reaches.
 */
export function buildShows(windowDays: number = WINDOW_DAYS): ShowRow[] {
  const screenById = new Map(SCREENS.map((sc) => [sc.id, sc]));
  const cutoff = Date.now() + MIN_LEAD_MINUTES * 60_000;
  const shows: ShowRow[] = [];

  for (let offset = 0; offset < windowDays; offset++) {
    const dayNumber = istDayNumber(offset);
    const dateKey = istDateKey(offset);

    for (const entry of PROGRAMME) {
      const screen = screenById.get(entry.screenId);
      if (!screen) throw new Error(`programme references unknown screen ${entry.screenId}`);

      SLOTS.forEach((slot, slotIndex) => {
        const startTime = istShowTime(offset, slot.hour, slot.minute);
        if (startTime.getTime() < cutoff) return;

        // Alternate films so a screen reads like it is running two titles
        // rather than the same one on loop.
        const contentId = entry.films[(dayNumber + slotIndex) % entry.films.length];
        shows.push({
          id: derivedShowId(`${entry.screenId}|${contentId}|${dateKey}|${slot.hour}:${slot.minute}`),
          contentId,
          contentType: "movie",
          venueId: screen.venueId,
          screenId: screen.id,
          seatingMode: "assigned",
          startTime,
          price: entry.basePrice + slot.surcharge,
          totalCapacity: null,
        });
      });
    }

    const weekday = (((dayNumber - WEEK_ANCHOR_DAY) % 7) + 7) % 7;
    for (const event of LIVE) {
      for (const night of event.nights) {
        if (night.day % 7 !== weekday) continue;
        const startTime = istShowTime(offset, night.hour, night.minute);
        if (startTime.getTime() < cutoff) continue;
        shows.push({
          id: derivedShowId(`${event.venueId}|${event.contentId}|${dateKey}|${night.hour}:${night.minute}`),
          contentId: event.contentId,
          contentType: "event",
          venueId: event.venueId,
          screenId: null,
          seatingMode: "general",
          startTime,
          price: event.price,
          totalCapacity: event.capacity,
        });
      }
    }
  }

  return shows;
}

/**
 * Reassigns the four ids that tests and saved links depend on onto specific
 * slots. Seed-only: a top-up must never pin, or it would keep re-pointing a
 * fixed id at whatever show happens to be earliest that day.
 */
export function pinKnownShows(shows: ShowRow[]): void {
  pin(shows, SHOW_ONE, (row) => row.screenId === SCREEN_ONE && row.seatingMode === "assigned");
  pin(shows, SHOW_TWO, (row) => row.screenId === SCREEN_ONE && row.id !== SHOW_ONE);
  pin(shows, SHOW_THREE, (row) => row.screenId === s("01"));
  pin(shows, SHOW_GA, (row) => row.seatingMode === "general" && row.contentId === C.indianOcean);
}

/** Reassigns a pinned id onto the earliest show matching `match`. */
export function pin(shows: ShowRow[], id: string, match: (row: ShowRow) => boolean): void {
  const candidate = shows
    .filter((row) => row.startTime.getTime() > Date.now() + 6 * 3600_000 && match(row))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];
  if (!candidate) throw new Error(`no show available to pin id ${id}`);
  candidate.id = id;
}

