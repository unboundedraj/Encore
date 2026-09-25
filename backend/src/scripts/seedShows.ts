/**
 * Seeds the Postgres ticketing fixtures: venues, screens, the seat layout, and
 * upcoming shows. The Mongo catalog is seeded separately by seedContent.ts --
 * these shows reference that catalog by content_id, so run the content seed
 * first or the showtimes will point at titles that do not exist.
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
import { Client } from "pg";

const VENUE_CINEMA = "11111111-1111-1111-1111-111111111111";
const VENUE_AMPHITHEATRE = "33333333-3333-3333-3333-333333333333";
const SCREEN_ONE = "22222222-2222-2222-2222-222222222222";

const VENUES = [
  {
    id: VENUE_CINEMA,
    name: "PVR IMAX Forum",
    address: "21 Hosur Road, Koramangala",
    city: "Bangalore",
  },
  {
    id: VENUE_AMPHITHEATRE,
    name: "The Grand Amphitheatre",
    address: "8 MG Road",
    city: "Bangalore",
  },
];

const SCREENS = [
  { id: SCREEN_ONE, venueId: VENUE_CINEMA, name: "Screen 1", capacity: 40 },
];

/** Row A is the premium row; B-E are standard. 5 rows x 8 seats = 40. */
const SEAT_ROWS = [
  { label: "A", seatType: "premium" },
  { label: "B", seatType: "standard" },
  { label: "C", seatType: "standard" },
  { label: "D", seatType: "standard" },
  { label: "E", seatType: "standard" },
];
const SEATS_PER_ROW = 8;

/**
 * Seat ids are generated rather than listed. They are never addressed
 * individually in a URL, so a readable derived pattern beats forty opaque
 * literals: the last block encodes row index and seat number, so
 * ...000000000103 is row A seat 3.
 */
function seatId(rowIndex: number, seatNumber: number): string {
  const encoded = `${String(rowIndex + 1).padStart(2, "0")}${String(seatNumber).padStart(2, "0")}`;
  return `5ea70000-0000-0000-0000-${encoded.padStart(12, "0")}`;
}

/**
 * Start times are offsets from now, not fixed timestamps.
 *
 * A seed with hardcoded dates rots: once those dates pass, every "upcoming
 * shows" query returns nothing and the browse flow looks broken for reasons
 * that have nothing to do with the code. The offsets below reproduce the
 * spread the fixtures already had.
 *
 * Show ids are pinned to their existing values because /shows/<id> is a
 * user-visible URL, and re-seeding should not invalidate a link someone saved.
 */
const SHOWS = [
  {
    id: "a4620294-915a-4671-be81-03e313c9df81",
    contentId: "65f1a2b3c4d5e6f701000001", // The Silent Orbit
    contentType: "movie",
    venueId: VENUE_CINEMA,
    screenId: SCREEN_ONE,
    seatingMode: "assigned",
    hoursFromNow: 42,
    price: 35000,
    totalCapacity: null,
  },
  {
    id: "6cd65801-eaf8-4320-82ad-4b704085637d",
    contentId: "65f1a2b3c4d5e6f701000001", // The Silent Orbit, second showing
    contentType: "movie",
    venueId: VENUE_CINEMA,
    screenId: SCREEN_ONE,
    seatingMode: "assigned",
    hoursFromNow: 68,
    price: 40000,
    totalCapacity: null,
  },
  {
    id: "0786da7f-9e35-4175-bfc5-a6ee8659a62d",
    contentId: "65f1a2b3c4d5e6f701000003", // Hollow Pines
    contentType: "movie",
    venueId: VENUE_CINEMA,
    screenId: SCREEN_ONE,
    seatingMode: "assigned",
    hoursFromNow: 91,
    price: 35000,
    totalCapacity: null,
  },
  {
    id: "aed18429-63c1-4165-9d1f-17ae3b2688c8",
    contentId: "65f1a2b3c4d5e6f702000001", // Aurora Collective
    contentType: "event",
    venueId: VENUE_AMPHITHEATRE,
    screenId: null,
    seatingMode: "general",
    hoursFromNow: 137,
    price: 99900,
    totalCapacity: 500,
  },
];

const SHOW_IDS = SHOWS.map((s) => s.id);
const SEAT_IDS = SEAT_ROWS.flatMap((_, rowIndex) =>
  Array.from({ length: SEATS_PER_ROW }, (_, i) => seatId(rowIndex, i + 1))
);

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(
      "SUPABASE_DB_URL is not set. It is the direct Postgres connection string,\n" +
        "not SUPABASE_URL -- see backend/.env.example."
    );
    process.exit(2);
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query("begin");

    // Refuse to proceed if any of this has been sold. The foreign keys are
    // ON DELETE RESTRICT, so the deletes below would fail anyway -- but they
    // would fail with a raw constraint violation halfway through. Checking
    // first turns that into an explanation.
    const sold = await client.query(
      `select
         (select count(*) from encore_bookings where show_id = any($1)) as bookings,
         (select count(*) from encore_booking_seats where seat_id = any($2)) as seats`,
      [SHOW_IDS, SEAT_IDS]
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
    // reference screens. Scoped to the ids this script owns, so anything added
    // by hand survives.
    const removedShows = await client.query(`delete from encore_shows where id = any($1)`, [SHOW_IDS]);
    const removedSeats = await client.query(`delete from encore_seats where id = any($1)`, [SEAT_IDS]);
    const removedScreens = await client.query(`delete from encore_screens where id = any($1)`, [
      SCREENS.map((s) => s.id),
    ]);
    const removedVenues = await client.query(`delete from encore_venues where id = any($1)`, [
      VENUES.map((v) => v.id),
    ]);
    console.log(
      `removed previously seeded rows -- shows: ${removedShows.rowCount}, seats: ${removedSeats.rowCount}, ` +
        `screens: ${removedScreens.rowCount}, venues: ${removedVenues.rowCount}`
    );

    for (const venue of VENUES) {
      await client.query(
        `insert into encore_venues (id, name, address, city) values ($1, $2, $3, $4)`,
        [venue.id, venue.name, venue.address, venue.city]
      );
    }
    console.log(`inserted ${VENUES.length} venues`);

    for (const screen of SCREENS) {
      await client.query(
        `insert into encore_screens (id, venue_id, name, capacity) values ($1, $2, $3, $4)`,
        [screen.id, screen.venueId, screen.name, screen.capacity]
      );
    }
    console.log(`inserted ${SCREENS.length} screen`);

    let seatCount = 0;
    for (const [rowIndex, row] of SEAT_ROWS.entries()) {
      for (let seatNumber = 1; seatNumber <= SEATS_PER_ROW; seatNumber++) {
        await client.query(
          `insert into encore_seats (id, screen_id, row_label, seat_number, seat_type)
           values ($1, $2, $3, $4, $5)`,
          [seatId(rowIndex, seatNumber), SCREEN_ONE, row.label, seatNumber, row.seatType]
        );
        seatCount++;
      }
    }
    console.log(`inserted ${seatCount} seats (${SEAT_ROWS.length} rows x ${SEATS_PER_ROW})`);

    for (const show of SHOWS) {
      const startTime = new Date(Date.now() + show.hoursFromNow * 3600_000).toISOString();
      await client.query(
        `insert into encore_shows
           (id, content_id, content_type, venue_id, screen_id, seating_mode, start_time, price, total_capacity)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          show.id,
          show.contentId,
          show.contentType,
          show.venueId,
          show.screenId,
          show.seatingMode,
          startTime,
          show.price,
          show.totalCapacity,
        ]
      );
    }
    console.log(`inserted ${SHOWS.length} shows`);

    await client.query("commit");

    const summary = await client.query(`
      select
        (select count(*) from encore_venues)  as venues,
        (select count(*) from encore_screens) as screens,
        (select count(*) from encore_seats)   as seats,
        (select count(*) from encore_shows)   as shows`);
    const { venues, screens, seats, shows } = summary.rows[0];
    console.log(
      `\ncatalog now holds ${venues} venues, ${screens} screen(s), ${seats} seats, ${shows} shows`
    );
    console.log(`sample show URL: /shows/${SHOWS[0].id}`);
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
