/**
 * Keeps showtimes ahead of today, so the listing never runs dry.
 *
 * Seeding writes a fixed window of shows once, which means a demo left alone
 * for a couple of weeks quietly empties itself: every title is listed only
 * while it has an upcoming show. This job inserts whatever part of the rolling
 * window is missing, on startup and then periodically, and prunes shows that
 * are long past.
 *
 * WHY THIS IS SAFE TO RUN ANYWHERE, ANY NUMBER OF TIMES
 *
 * It only ever inserts, and only shows that do not exist yet. Show ids are
 * derived from calendar date (see data/showFixtures.ts), so a show created on
 * an earlier run re-derives the same id and is skipped; the insert also says
 * ON CONFLICT DO NOTHING, so two instances racing on the same day cannot
 * create duplicates or error. It never updates or deletes a show that has a
 * booking, so a sold seat is never disturbed.
 *
 * It does not create venues, screens or seats -- those come from the seed.
 * Fixtures whose venue or screen is missing from the database are skipped, so
 * running this against an unseeded database does nothing rather than failing.
 */

import { getPool } from "../config/postgres";
import { SCREENS, VENUES, WINDOW_DAYS, buildShows } from "../data/showFixtures";

const TOP_UP_INTERVAL_MS = 6 * 3600_000;
const CHUNK = 500;
/** Past shows are kept a day, so a just-finished screening still resolves a booking link. */
const PRUNE_AFTER_HOURS = 24;

export interface TopUpResult {
  inserted: number;
  pruned: number;
}

export async function topUpShows(windowDays: number = WINDOW_DAYS): Promise<TopUpResult> {
  const pool = getPool();
  const venueIds = VENUES.map((x) => x.id);
  const screenIds = SCREENS.map((x) => x.id);

  const [venues, screens] = await Promise.all([
    pool.query<{ id: string }>(`select id from encore_venues where id = any($1)`, [venueIds]),
    pool.query<{ id: string }>(`select id from encore_screens where id = any($1)`, [screenIds]),
  ]);
  const haveVenue = new Set(venues.rows.map((r) => r.id));
  const haveScreen = new Set(screens.rows.map((r) => r.id));

  const candidates = buildShows(windowDays).filter(
    (row) => haveVenue.has(row.venueId) && (row.screenId === null || haveScreen.has(row.screenId))
  );

  let inserted = 0;
  if (candidates.length > 0) {
    // A show can already exist under a different id than the one derived for
    // it -- the seed pins a handful of ids that tests and saved links depend
    // on -- so match on what the show is (where, what, when) as well as on id.
    const existing = await pool.query<{
      id: string;
      venue_id: string;
      screen_id: string | null;
      content_id: string;
      start_time: Date;
    }>(
      `select id, venue_id, screen_id, content_id, start_time
         from encore_shows
        where venue_id = any($1) and start_time >= now()`,
      [venueIds]
    );
    const haveId = new Set(existing.rows.map((r) => r.id));
    const haveSlot = new Set(
      existing.rows.map(
        (r) => `${r.venue_id}|${r.screen_id ?? ""}|${r.content_id}|${r.start_time.getTime()}`
      )
    );

    const fresh = candidates.filter(
      (row) =>
        !haveId.has(row.id) &&
        !haveSlot.has(
          `${row.venueId}|${row.screenId ?? ""}|${row.contentId}|${row.startTime.getTime()}`
        )
    );

    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((row, r) => {
        values.push(
          row.id,
          row.contentId,
          row.contentType,
          row.venueId,
          row.screenId,
          row.seatingMode,
          row.startTime.toISOString(),
          row.price,
          row.totalCapacity
        );
        const o = r * 9;
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}, $${o + 9})`;
      });
      const res = await pool.query(
        `insert into encore_shows
           (id, content_id, content_type, venue_id, screen_id, seating_mode, start_time, price, total_capacity)
         values ${tuples.join(", ")}
         on conflict (id) do nothing`,
        values
      );
      inserted += res.rowCount ?? 0;
    }
  }

  // Past shows nobody booked are dead weight. Anything with a booking is left
  // alone no matter how old: the foreign key would refuse the delete anyway,
  // and a customer's record of a past booking must keep resolving.
  const pruned = await pool.query(
    `delete from encore_shows s
      where s.venue_id = any($1)
        and s.start_time < now() - make_interval(hours => $2)
        and not exists (select 1 from encore_bookings b where b.show_id = s.id)`,
    [venueIds, PRUNE_AFTER_HOURS]
  );

  return { inserted, pruned: pruned.rowCount ?? 0 };
}

/**
 * Runs once shortly after boot, then every few hours. The boot run matters
 * most on a host that sleeps when idle (Render's free tier): every wake-up
 * tops the window up before anyone is likely to look at it.
 */
export function startShowTopUp(intervalMs = TOP_UP_INTERVAL_MS): NodeJS.Timeout {
  const run = () => {
    topUpShows()
      .then(({ inserted, pruned }) => {
        if (inserted > 0 || pruned > 0) {
          console.log(`[showtimes] added ${inserted} upcoming show(s), pruned ${pruned} past one(s)`);
        }
      })
      .catch((err) => console.error("[showtimes] top-up failed:", err));
  };

  setTimeout(run, 5_000).unref();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}
