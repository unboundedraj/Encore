/**
 * Read-only show/seat queries backing the "pick a showtime, see the seat map"
 * flow. No booking or locking logic lives here yet -- that needs Redis holds,
 * which is the next step. This is purely an accurate view of current state.
 */

import type {
  AssignedShowDetail,
  GeneralAdmissionShowDetail,
  SeatWithStatus,
  ShowDetail,
  ShowListItem,
} from "shared";
import { supabase } from "../config/supabase";

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

/** Upcoming shows for one piece of content, newest first by start time. */
export async function listShowsForContent(contentId: string): Promise<ShowListItem[]> {
  const { data, error } = await supabase
    .from("encore_shows")
    .select(
      "id, content_id, content_type, seating_mode, start_time, price, venue_id, screen_id, encore_venues(name), encore_screens(name)"
    )
    .eq("content_id", contentId)
    .gte("start_time", new Date().toISOString())
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
    encore_venues: { name: string } | null;
    encore_screens: { name: string } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    content_id: row.content_id,
    content_type: row.content_type,
    seating_mode: row.seating_mode,
    start_time: row.start_time,
    price: row.price,
    venue_id: row.venue_id,
    venue_name: row.encore_venues?.name ?? "",
    screen_id: row.screen_id,
    screen_name: row.encore_screens?.name ?? null,
  }));
}

/**
 * Full detail for one show. Returns null for "no such show" so the controller
 * can turn that into a 404 -- this function throwing is reserved for actual
 * failures.
 */
export async function getShowDetail(showId: string): Promise<ShowDetail | null> {
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
  // Clamped at 0 defensively; encore_bookings_quantity_check and the absence
  // of any decrement-without-a-row path mean this should never go negative,
  // but a UI showing "-3 seats left" would be a worse failure than a clamp.
  const availableCapacity = Math.max(0, totalCapacity - bookedQuantity);

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
    available_capacity: availableCapacity,
  };
  return detail;
}

/**
 * The seat layout for an assigned-seating show, each seat marked with its
 * current status.
 *
 * Throws ShowNotAssignedError for a general-admission show -- the controller
 * maps that to 400, since "the seat map for a show with no seat map" is a
 * request error, not a missing resource.
 */
export async function getSeatMapForShow(showId: string): Promise<SeatWithStatus[] | null> {
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

  return (seats ?? []).map((seat) => ({
    ...seat,
    status: bookedSeatIds.has(seat.id) ? "booked" : "available",
  }));
}
