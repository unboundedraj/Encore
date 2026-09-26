/**
 * Read-only booking lookups for the frontend -- "what did I just buy". No
 * write paths here; those live in bookingService.ts and go through the raw
 * Postgres pool because they need real transactions. A single-row read with
 * nested embeds is exactly what PostgREST is for.
 */

import type { BookingDetail, BookingStatus, ContentType, SeatingMode } from "shared";
import { supabase } from "../config/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidBookingId(id: string): boolean {
  return UUID.test(id);
}

export type BookingLookup =
  | { kind: "found"; booking: BookingDetail }
  | { kind: "not_found" }
  /** Exists, but does not belong to the caller. Kept distinct from not_found
   *  so the controller can choose whether to say so or stay silent. */
  | { kind: "forbidden" };

/** Shape PostgREST actually returns for the embedded query below. */
interface Row {
  id: string;
  show_id: string;
  user_id: string;
  status: BookingStatus;
  seating_mode: SeatingMode;
  quantity: number | null;
  total_amount: number;
  created_at: string;
  encore_shows: {
    content_id: string;
    content_type: ContentType;
    start_time: string;
    encore_venues: { name: string; city: string } | null;
    encore_screens: { name: string } | null;
  } | null;
  encore_booking_seats: {
    seat_id: string;
    encore_seats: { row_label: string; seat_number: number } | null;
  }[];
}

export async function getBookingForUser(
  bookingId: string,
  userId: string
): Promise<BookingLookup> {
  const { data, error } = await supabase
    .from("encore_bookings")
    .select(
      `id, show_id, user_id, status, seating_mode, quantity, total_amount, created_at,
       encore_shows ( content_id, content_type, start_time,
         encore_venues ( name, city ),
         encore_screens ( name )
       ),
       encore_booking_seats ( seat_id, encore_seats ( row_label, seat_number ) )`
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load booking: ${error.message}`);
  if (!data) return { kind: "not_found" };

  const row = data as unknown as Row;
  if (row.user_id !== userId) return { kind: "forbidden" };
  if (!row.encore_shows) {
    // venue_id/screen_id are RESTRICT foreign keys, so this is a data
    // integrity problem, not a legitimate "not found" -- surface it loudly.
    throw new Error(`Booking ${bookingId} has no resolvable show`);
  }

  const seats =
    row.seating_mode === "assigned"
      ? row.encore_booking_seats
          .filter((s) => s.encore_seats)
          .map((s) => ({
            id: s.seat_id,
            row_label: s.encore_seats!.row_label,
            seat_number: s.encore_seats!.seat_number,
          }))
          .sort((a, b) => a.row_label.localeCompare(b.row_label) || a.seat_number - b.seat_number)
      : null;

  const booking: BookingDetail = {
    id: row.id,
    show_id: row.show_id,
    content_id: row.encore_shows.content_id,
    content_type: row.encore_shows.content_type,
    status: row.status,
    seating_mode: row.seating_mode,
    seats,
    quantity: row.seating_mode === "general" ? row.quantity : null,
    total_amount: row.total_amount,
    venue_name: row.encore_shows.encore_venues?.name ?? "",
    city: row.encore_shows.encore_venues?.city ?? "",
    screen_name: row.encore_shows.encore_screens?.name ?? null,
    start_time: row.encore_shows.start_time,
    created_at: row.created_at,
  };

  return { kind: "found", booking };
}
