/**
 * Seeds the Postgres ticketing fixtures: venues across seven Indian cities,
 * multiplex-sized screens, their seat layouts, and a week of showtimes. The
 * Mongo catalog is seeded separately by seedContent.ts -- these shows reference
 * that catalog by content_id, so run the content seed first or the showtimes
 * will point at titles that do not exist.
 *
 * Uses a direct Postgres connection rather than supabase-js because this
 * touches four tables in foreign-key order and should be all-or-nothing.
 * PostgREST cannot hold a transaction open across requests; pg can, so a
 * failure half-way leaves the database exactly as it was.
 *
 * Requires SUPABASE_DB_URL -- the same credential `npm run db:push` uses.
 *
 * Run with: npm run seed:shows -w backend
 */

import "dotenv/config";
import { createHash } from "node:crypto";
import { Client } from "pg";

// ---------------------------------------------------------------------------
// Ids that must not move
//
// These four are referenced by tests and by links that may already exist, so
// they are pinned to specific showtimes below rather than left to the derived
// id scheme. SHOW_ONE in particular must stay an assigned-seating show on
// SCREEN_ONE: checkoutWebhook.ts looks up seats by that screen id, and
// checkoutLive.ts expects SHOW_GA to be general admission.
// ---------------------------------------------------------------------------
const VENUE_PVR_PHOENIX = "11111111-1111-1111-1111-111111111111";
const VENUE_JIO_GARDEN = "33333333-3333-3333-3333-333333333333";
const SCREEN_ONE = "22222222-2222-2222-2222-222222222222";
const SHOW_ONE = "a4620294-915a-4671-be81-03e313c9df81";
const SHOW_TWO = "6cd65801-eaf8-4320-82ad-4b704085637d";
const SHOW_THREE = "0786da7f-9e35-4175-bfc5-a6ee8659a62d";
const SHOW_GA = "aed18429-63c1-4165-9d1f-17ae3b2688c8";

const v = (n: string) => `a1000000-0000-4000-8000-0000000000${n}`;
const s = (n: string) => `b2000000-0000-4000-8000-0000000000${n}`;

// Catalog ids, mirroring seedContent.ts.
const C = {
  kaalchakra: "65f1a2b3c4d5e6f701000001",
  monsoonLetters: "65f1a2b3c4d5e6f701000002",
  vetriNagaram: "65f1a2b3c4d5e6f701000003",
  chaiBiscuit: "65f1a2b3c4d5e6f701000004",
  samudram: "65f1a2b3c4d5e6f701000005",
  marineDrive: "65f1a2b3c4d5e6f701000006",
  bengaluruTraffic: "65f1a2b3c4d5e6f701000007",
  lastLedger: "65f1a2b3c4d5e6f701000008",
  pushpavalli: "65f1a2b3c4d5e6f701000009",
  silkRoute: "65f1a2b3c4d5e6f70100000a",
  antariksh: "65f1a2b3c4d5e6f70100000b",
  dhabaDiaries: "65f1a2b3c4d5e6f70100000c",
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
} as const;

const VENUES = [
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
  // Kolkata
  { id: v("0f"), name: "INOX: Quest Mall, Ballygunge", address: "33 Syed Amir Ali Avenue, Ballygunge", city: "Kolkata" },
  { id: v("10"), name: "Kala Mandir", address: "48 Shakespeare Sarani, Kolkata", city: "Kolkata" },
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
const LAYOUTS = {
  imax: { rows: 14, seatsPerRow: 20, premiumRows: 3 },
  large: { rows: 12, seatsPerRow: 18, premiumRows: 2 },
  standard: { rows: 10, seatsPerRow: 16, premiumRows: 2 },
  boutique: { rows: 8, seatsPerRow: 12, premiumRows: 2 },
} as const;

type LayoutName = keyof typeof LAYOUTS;

const SCREENS: { id: string; venueId: string; name: string; layout: LayoutName }[] = [
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
];

const ROW_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * Seat ids are derived rather than listed. They are never addressed
 * individually in a URL, so a readable pattern beats two thousand literals:
 * the last block encodes screen index, row index and seat number, so
 * ...000000010203 is screen 1, row B, seat 3.
 */
function seatId(screenIndex: number, rowIndex: number, seatNumber: number): string {
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
function istShowTime(dayOffset: number, hour: number, minute: number): Date {
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

/**
 * Show ids are derived from what the show *is*, not from its position in a
 * generated list. Today's early slots are skipped once they are too close to
 * start, so a positional scheme would renumber every later show depending on
 * the hour the seed happened to run, invalidating saved /shows/<id> links.
 */
function derivedShowId(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

interface ShowRow {
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

const DAYS = 5;
/** Don't list a show that starts sooner than this -- nobody can get there. */
const MIN_LEAD_MINUTES = 90;

/** What each screen is playing, and its base ticket price in paise. */
const PROGRAMME: { screenId: string; basePrice: number; films: string[] }[] = [
  { screenId: SCREEN_ONE, basePrice: 45000, films: [C.kaalchakra, C.antariksh] },
  { screenId: s("01"), basePrice: 32000, films: [C.chaiBiscuit, C.lastLedger] },
  { screenId: s("02"), basePrice: 28000, films: [C.marineDrive, C.pushpavalli] },
  { screenId: s("03"), basePrice: 60000, films: [C.kaalchakra, C.dhabaDiaries] },
  { screenId: s("04"), basePrice: 75000, films: [C.antariksh, C.lastLedger] },
  { screenId: s("05"), basePrice: 42000, films: [C.antariksh, C.bengaluruTraffic] },
  { screenId: s("06"), basePrice: 25000, films: [C.bengaluruTraffic, C.chaiBiscuit] },
  { screenId: s("07"), basePrice: 22000, films: [C.kaalchakra, C.monsoonLetters] },
  { screenId: s("08"), basePrice: 30000, films: [C.samudram, C.antariksh] },
  { screenId: s("09"), basePrice: 24000, films: [C.vetriNagaram, C.samudram] },
  { screenId: s("0a"), basePrice: 26000, films: [C.chaiBiscuit, C.kaalchakra] },
  { screenId: s("0b"), basePrice: 23000, films: [C.silkRoute, C.marineDrive] },
];

/** Live events: general admission, one or two nights each. */
const LIVE: { contentId: string; venueId: string; price: number; capacity: number; nights: { day: number; hour: number; minute: number }[] }[] = [
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
];

/**
 * Builds every show, then pins the four ids that must not move onto specific
 * slots. Pinned slots are all on day >= 1 so they can never be dropped by the
 * lead-time filter, which only ever affects today.
 */
function buildShows(): ShowRow[] {
  const screenById = new Map(SCREENS.map((sc) => [sc.id, sc]));
  const cutoff = Date.now() + MIN_LEAD_MINUTES * 60_000;
  const shows: ShowRow[] = [];

  for (const entry of PROGRAMME) {
    const screen = screenById.get(entry.screenId);
    if (!screen) throw new Error(`programme references unknown screen ${entry.screenId}`);

    for (let day = 0; day < DAYS; day++) {
      SLOTS.forEach((slot, slotIndex) => {
        const startTime = istShowTime(day, slot.hour, slot.minute);
        if (startTime.getTime() < cutoff) return;

        // Alternate films so a screen reads like it is running two titles
        // rather than the same one on loop.
        const contentId = entry.films[(day + slotIndex) % entry.films.length];
        shows.push({
          id: derivedShowId(`${entry.screenId}|${contentId}|${day}|${slot.hour}:${slot.minute}`),
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
  }

  for (const event of LIVE) {
    for (const night of event.nights) {
      const startTime = istShowTime(night.day, night.hour, night.minute);
      if (startTime.getTime() < cutoff) continue;
      shows.push({
        id: derivedShowId(`${event.venueId}|${event.contentId}|${night.day}|${night.hour}:${night.minute}`),
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

  pin(shows, SHOW_ONE, (row) => row.screenId === SCREEN_ONE && row.seatingMode === "assigned");
  pin(shows, SHOW_TWO, (row) => row.screenId === SCREEN_ONE && row.id !== SHOW_ONE);
  pin(shows, SHOW_THREE, (row) => row.screenId === s("01"));
  pin(shows, SHOW_GA, (row) => row.seatingMode === "general" && row.contentId === C.indianOcean);

  return shows;
}

/** Reassigns a pinned id onto the earliest show matching `match`. */
function pin(shows: ShowRow[], id: string, match: (row: ShowRow) => boolean): void {
  const candidate = shows
    .filter((row) => row.startTime.getTime() > Date.now() + 6 * 3600_000 && match(row))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];
  if (!candidate) throw new Error(`no show available to pin id ${id}`);
  candidate.id = id;
}

/**
 * Multi-row INSERT in chunks. One statement per seat would be roughly two
 * thousand round trips to a hosted database; this is two or three.
 */
async function insertRows(
  client: Client,
  table: string,
  columns: string[],
  rows: unknown[][]
): Promise<void> {
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((row, r) => {
      const placeholders = row.map((_, c) => `$${r * columns.length + c + 1}`);
      values.push(...row);
      return `(${placeholders.join(", ")})`;
    });
    await client.query(
      `insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")}`,
      values
    );
  }
}

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(
      "SUPABASE_DB_URL is not set. It is the direct Postgres connection string,\n" +
        "not SUPABASE_URL -- see backend/.env.example."
    );
    process.exit(2);
  }

  const venueIds = VENUES.map((x) => x.id);
  const screenIds = SCREENS.map((x) => x.id);
  const shows = buildShows();

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query("begin");

    // Refuse to proceed if any of this has been sold. The foreign keys are
    // ON DELETE RESTRICT, so the deletes below would fail anyway -- but they
    // would fail with a raw constraint violation halfway through. Checking
    // first turns that into an explanation. Scoped by venue rather than by the
    // show ids this run happens to generate, so a show left behind by an
    // earlier seed is covered too.
    const sold = await client.query(
      `select
         (select count(*) from encore_bookings
           where show_id in (select id from encore_shows where venue_id = any($1))) as bookings,
         (select count(*) from encore_booking_seats
           where seat_id in (select id from encore_seats where screen_id = any($2))) as seats`,
      [venueIds, screenIds]
    );
    const bookingCount = Number(sold.rows[0].bookings);
    const bookedSeatCount = Number(sold.rows[0].seats);
    if (bookingCount > 0 || bookedSeatCount > 0) {
      throw new Error(
        `Refusing to reseed: ${bookingCount} booking(s) and ${bookedSeatCount} booked seat(s) ` +
          `reference these fixtures. Re-seeding would destroy records of sales. ` +
          `Clear those bookings deliberately first if this is a throwaway database.`
      );
    }

    // Delete in dependency order: shows reference screens and venues, seats
    // reference screens. Seats go by screen_id rather than by generated id so
    // rows written under an older id scheme are cleaned up too.
    const removedShows = await client.query(`delete from encore_shows where venue_id = any($1)`, [venueIds]);
    const removedSeats = await client.query(`delete from encore_seats where screen_id = any($1)`, [screenIds]);
    const removedScreens = await client.query(`delete from encore_screens where id = any($1)`, [screenIds]);
    const removedVenues = await client.query(`delete from encore_venues where id = any($1)`, [venueIds]);
    console.log(
      `removed previously seeded rows -- shows: ${removedShows.rowCount}, seats: ${removedSeats.rowCount}, ` +
        `screens: ${removedScreens.rowCount}, venues: ${removedVenues.rowCount}`
    );

    await insertRows(
      client,
      "encore_venues",
      ["id", "name", "address", "city"],
      VENUES.map((x) => [x.id, x.name, x.address, x.city])
    );
    console.log(`inserted ${VENUES.length} venues across ${new Set(VENUES.map((x) => x.city)).size} cities`);

    await insertRows(
      client,
      "encore_screens",
      ["id", "venue_id", "name", "capacity"],
      SCREENS.map((x) => {
        const layout = LAYOUTS[x.layout];
        return [x.id, x.venueId, x.name, layout.rows * layout.seatsPerRow];
      })
    );
    console.log(`inserted ${SCREENS.length} screens`);

    const seatRows: unknown[][] = [];
    for (const [screenIndex, screen] of SCREENS.entries()) {
      const layout = LAYOUTS[screen.layout];
      for (let rowIndex = 0; rowIndex < layout.rows; rowIndex++) {
        const seatType = rowIndex < layout.premiumRows ? "premium" : "standard";
        for (let seatNumber = 1; seatNumber <= layout.seatsPerRow; seatNumber++) {
          seatRows.push([
            seatId(screenIndex, rowIndex, seatNumber),
            screen.id,
            ROW_LABELS[rowIndex],
            seatNumber,
            seatType,
          ]);
        }
      }
    }
    await insertRows(
      client,
      "encore_seats",
      ["id", "screen_id", "row_label", "seat_number", "seat_type"],
      seatRows
    );
    console.log(`inserted ${seatRows.length} seats`);

    await insertRows(
      client,
      "encore_shows",
      [
        "id",
        "content_id",
        "content_type",
        "venue_id",
        "screen_id",
        "seating_mode",
        "start_time",
        "price",
        "total_capacity",
      ],
      shows.map((show) => [
        show.id,
        show.contentId,
        show.contentType,
        show.venueId,
        show.screenId,
        show.seatingMode,
        show.startTime.toISOString(),
        show.price,
        show.totalCapacity,
      ])
    );
    const assigned = shows.filter((x) => x.seatingMode === "assigned").length;
    console.log(`inserted ${shows.length} shows (${assigned} assigned, ${shows.length - assigned} general)`);

    await client.query("commit");

    const summary = await client.query(`
      select
        (select count(*) from encore_venues)  as venues,
        (select count(distinct city) from encore_venues) as cities,
        (select count(*) from encore_screens) as screens,
        (select count(*) from encore_seats)   as seats,
        (select count(*) from encore_shows)   as shows`);
    const row = summary.rows[0];
    console.log(
      `\ncatalog now holds ${row.venues} venues in ${row.cities} cities, ` +
        `${row.screens} screens, ${row.seats} seats, ${row.shows} shows`
    );
    console.log(`pinned assigned show: /shows/${SHOW_ONE}`);
    console.log(`pinned general-admission show: /shows/${SHOW_GA}`);
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(`seed failed: ${err.message}`);
    process.exit(1);
  });
