/**
 * Read-only show/seat queries backing the "pick a showtime, see the seat map"
 * flow. No booking or locking logic lives here yet -- that needs Redis holds,
 * which is the next step. This is purely an accurate view of current state.
 */

import type {
  AssignedShowDetail,
  GeneralAdmissionShowDetail,
  SeatStatus,
  SeatWithStatus,
  ShowDetail,
  ShowListItem,
} from "shared";
import { supabase } from "../config/supabase";
import { SHOWTIME_HORIZON_DAYS } from "../config/showtimes";
import { getSeatHolders, readGeneralHolds } from "./lockService";

const CONTENT_ID = /^[0-9a-f]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidContentId(id: string): boolean {
  return CONTENT_ID.test(id);
}

export function isValidShowId(id: string): boolean {
  return UUID.test(id);
}

/** Thrown when the seat map is requested for a show that has none. */
export class ShowNotAssignedError extends Error {
  constructor() {
    super("This show is general admission and has no seat map.");
    this.name = "ShowNotAssignedError";
  }
}

/**
 * Upcoming shows for one piece of content, soonest first, within the listing
 * horizon. Bounding it matters beyond tidiness: shows are scheduled months
 * ahead, and PostgREST caps a response at 1000 rows, so an unbounded read of a
 * popular title would silently lose its later days.
 *
 * `city` filters to venues in that city. It is applied in application code
 * rather than as a PostgREST filter on the embedded venue, because filtering
 * on an embedded resource there turns the embed into an inner join whose
 * semantics differ from the plain read this otherwise is -- and the row count
 * per title is small enough that the difference is not worth the subtlety.
 */
export async function listShowsForContent(
  contentId: string,
  city: string | null = null
): Promise<ShowListItem[]> {
  const { data, error } = await supabase
    .from("encore_shows")
    .select(
      "id, content_id, content_type, seating_mode, start_time, price, venue_id, screen_id, encore_venues(name, city), encore_screens(name)"
    )
    .eq("content_id", contentId)
    .gte("start_time", new Date().toISOString())
    .lt("start_time", new Date(Date.now() + SHOWTIME_HORIZON_DAYS * 86_400_000).toISOString())
    .order("start_time", { ascending: true });

  if (error) throw new Error(`Failed to list shows: ${error.message}`);

  // supabase-js types a to-one embed as an array in its generic client; at
  // runtime a *-to-one foreign key (shows -> venues, shows -> screens) always
  // returns a single object or null, never a list. This narrows the shape back
  // to what the server actually sends rather than what the untyped client
  // infers.
  type Row = {
    id: string;
    content_id: string;
    content_type: ShowListItem["content_type"];
    seating_mode: ShowListItem["seating_mode"];
    start_time: string;
    price: number;
    venue_id: string;
    screen_id: string | null;
    encore_venues: { name: string; city: string } | null;
    encore_screens: { name: string } | null;
  };

  const wantedCity = city?.trim().toLowerCase() ?? null;

  return ((data ?? []) as unknown as Row[])
    .filter((row) => !wantedCity || row.encore_venues?.city?.toLowerCase() === wantedCity)
    .map((row) => ({
      id: row.id,
      content_id: row.content_id,
      content_type: row.content_type,
      seating_mode: row.seating_mode,
      start_time: row.start_time,
      price: row.price,
      venue_id: row.venue_id,
      venue_name: row.encore_venues?.name ?? "",
      venue_city: row.encore_venues?.city ?? "",
      screen_id: row.screen_id,
      screen_name: row.encore_screens?.name ?? null,
    }));
}

/**
 * Full detail for one show. Returns null for "no such show" so the controller
 * can turn that into a 404 -- this function throwing is reserved for actual
 * failures.
 */
export async function getShowDetail(
  showId: string,
  viewerId: string | null = null
): Promise<ShowDetail | null> {
  const { data: show, error } = await supabase
    .from("encore_shows")
    .select(
      "id, content_id, content_type, seating_mode, start_time, price, total_capacity, encore_venues(*), encore_screens(*)"
    )
    .eq("id", showId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load show: ${error.message}`);
  if (!show) return null;

  const venue = show.encore_venues as unknown as ShowDetail["venue"] | null;
  if (!venue) {
    // venue_id is NOT NULL with a RESTRICT foreign key, so this indicates a
    // data integrity problem, not a normal "not found" -- worth a loud error
    // rather than silently treating the show as missing.
    throw new Error(`Show ${showId} has no resolvable venue`);
  }

  if (show.seating_mode === "assigned") {
    const screen = show.encore_screens as unknown as AssignedShowDetail["screen"] | null;
    if (!screen) throw new Error(`Assigned show ${showId} has no resolvable screen`);
    const detail: AssignedShowDetail = {
      id: show.id,
      content_id: show.content_id,
      content_type: show.content_type,
      start_time: show.start_time,
      price: show.price,
      venue,
      seating_mode: "assigned",
      screen,
    };
    return detail;
  }

  // General admission: availability = total_capacity - SUM(quantity) over
  // confirmed bookings for this show. head:true+count would be wrong here --
  // this is a sum, not a row count, so the query has to actually read the
  // quantity column.
  const { data: bookings, error: bookingsError } = await supabase
    .from("encore_bookings")
    .select("quantity")
    .eq("show_id", showId)
    .eq("status", "confirmed");

  if (bookingsError) {
    throw new Error(`Failed to compute availability: ${bookingsError.message}`);
  }

  const totalCapacity = show.total_capacity ?? 0;
  const bookedQuantity = (bookings ?? []).reduce((sum, b) => sum + (b.quantity ?? 0), 0);

  // Redis holds are additional, temporary consumption on top of confirmed
  // bookings. If Redis is unreachable we fall back to counting only confirmed
  // bookings: that over-reports availability, but this is a display path, and
  // a hold request would still be refused by the atomic script. Failing the
  // whole page because the cache is down would be the worse trade.
  let heldByOthers = 0;
  let heldByYou = 0;
  try {
    const holds = await readGeneralHolds(showId, viewerId);
    heldByOthers = holds.heldByOthers;
    heldByYou = holds.heldByYou;
  } catch (err) {
    console.error(`[shows] hold lookup failed for ${showId}, reporting confirmed only:`, err);
  }

  // Clamped at 0 defensively. Holds and confirmed bookings can briefly
  // double-count the same tickets -- during checkout the booking exists in
  // Postgres while the hold still exists in Redis -- which under-reports
  // availability for a few seconds. That direction is safe; the opposite
  // would oversell.
  const availableCapacity = Math.max(0, totalCapacity - bookedQuantity - heldByOthers);

  const detail: GeneralAdmissionShowDetail = {
    id: show.id,
    content_id: show.content_id,
    content_type: show.content_type,
    start_time: show.start_time,
    price: show.price,
    venue,
    seating_mode: "general",
    total_capacity: totalCapacity,
    booked_quantity: bookedQuantity,
    held_by_others: heldByOthers,
    held_by_you: heldByYou,
    available_capacity: availableCapacity,
  };
  return detail;
}

/**
 * Capacity a general-admission hold may draw from: everything not already
 * sold. Live holds are subtracted inside the Lua script rather than here,
 * because only the script can read and act on them atomically.
 */
export async function getGeneralCapacityForHolds(showId: string): Promise<number | null> {
  const { data: show, error } = await supabase
    .from("encore_shows")
    .select("seating_mode, total_capacity")
    .eq("id", showId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load show: ${error.message}`);
  if (!show || show.seating_mode !== "general") return null;

  const { data: bookings, error: bookingsError } = await supabase
    .from("encore_bookings")
    .select("quantity")
    .eq("show_id", showId)
    .eq("status", "confirmed");

  if (bookingsError) throw new Error(`Failed to compute availability: ${bookingsError.message}`);

  const booked = (bookings ?? []).reduce((sum, b) => sum + (b.quantity ?? 0), 0);
  return Math.max(0, (show.total_capacity ?? 0) - booked);
}

/**
 * The seat layout for an assigned-seating show, each seat marked with its
 * current status.
 *
 * Throws ShowNotAssignedError for a general-admission show -- the controller
 * maps that to 400, since "the seat map for a show with no seat map" is a
 * request error, not a missing resource.
 */
export async function getSeatMapForShow(
  showId: string,
  viewerId: string | null = null
): Promise<SeatWithStatus[] | null> {
  const { data: show, error: showError } = await supabase
    .from("encore_shows")
    .select("seating_mode, screen_id")
    .eq("id", showId)
    .maybeSingle();

  if (showError) throw new Error(`Failed to load show: ${showError.message}`);
  if (!show) return null;
  if (show.seating_mode !== "assigned" || !show.screen_id) {
    throw new ShowNotAssignedError();
  }

  const [{ data: seats, error: seatsError }, { data: booked, error: bookedError }] =
    await Promise.all([
      supabase
        .from("encore_seats")
        .select("*")
        .eq("screen_id", show.screen_id)
        .order("row_label", { ascending: true })
        .order("seat_number", { ascending: true }),
      // encore_booking_seats.show_id and .status are denormalized copies kept
      // exactly in sync with their parent booking by a composite foreign key
      // with ON UPDATE CASCADE (see backend/docs/schema.md) -- so filtering
      // this table directly is equivalent to joining through encore_bookings,
      // without the join.
      supabase
        .from("encore_booking_seats")
        .select("seat_id")
        .eq("show_id", showId)
        .eq("status", "confirmed"),
    ]);

  if (seatsError) throw new Error(`Failed to load seats: ${seatsError.message}`);
  if (bookedError) throw new Error(`Failed to load bookings: ${bookedError.message}`);

  const bookedSeatIds = new Set((booked ?? []).map((row) => row.seat_id as string));
  const allSeats = seats ?? [];

  // Degrade rather than fail if Redis is unreachable: the seat map still
  // shows Postgres truth (booked vs not), just without hold information. A
  // browsing page should not break because the cache is down -- and a hold
  // attempt would still be refused, since that path fails closed.
  let holders = new Map<string, string>();
  try {
    holders = await getSeatHolders(
      showId,
      allSeats.map((s) => s.id as string)
    );
  } catch (err) {
    console.error(`[shows] hold lookup failed for ${showId}, showing bookings only:`, err);
  }

  return allSeats.map((seat) => {
    const holder = holders.get(seat.id as string);
    // Postgres wins over Redis. A confirmed booking whose hold has not been
    // released yet is sold, not "being checked out", and showing it as merely
    // held would invite someone to wait for a seat that is never coming back.
    let status: SeatStatus;
    if (bookedSeatIds.has(seat.id as string)) status = "booked";
    else if (!holder) status = "available";
    else if (viewerId && holder === viewerId) status = "held_by_you";
    else status = "held_by_other";

    return { ...seat, status };
  });
}

/** Seat ids that genuinely belong to this show's screen, for validating a hold request. */
export async function getValidSeatIds(showId: string): Promise<Set<string> | null> {
  const { data: show, error } = await supabase
    .from("encore_shows")
    .select("seating_mode, screen_id")
    .eq("id", showId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load show: ${error.message}`);
  if (!show) return null;
  if (show.seating_mode !== "assigned" || !show.screen_id) throw new ShowNotAssignedError();

  const { data: seats, error: seatsError } = await supabase
    .from("encore_seats")
    .select("id")
    .eq("screen_id", show.screen_id);

  if (seatsError) throw new Error(`Failed to load seats: ${seatsError.message}`);
  return new Set((seats ?? []).map((s) => s.id as string));
}

/** Row/number for the given seat ids, so a conflict can be named in the UI. */
export async function describeSeats(seatIds: string[]): Promise<Map<string, { row_label: string; seat_number: number }>> {
  const described = new Map<string, { row_label: string; seat_number: number }>();
  if (seatIds.length === 0) return described;

  const { data, error } = await supabase
    .from("encore_seats")
    .select("id, row_label, seat_number")
    .in("id", seatIds);

  if (error) throw new Error(`Failed to describe seats: ${error.message}`);
  for (const seat of data ?? []) {
    described.set(seat.id as string, {
      row_label: seat.row_label as string,
      seat_number: seat.seat_number as number,
    });
  }
  return described;
}
