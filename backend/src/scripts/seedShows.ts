/**
 * Seeds the Postgres ticketing fixtures: venues across thirteen Indian cities,
 * multiplex-sized screens, their seat layouts, and two months of showtimes. The
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
import { Client } from "pg";
import {
  LAYOUTS,
  ROW_LABELS,
  SCREENS,
  SHOW_GA,
  SHOW_ONE,
  VENUES,
  buildShows,
  pinKnownShows,
  seatId,
} from "../data/showFixtures";

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
  pinKnownShows(shows);

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
