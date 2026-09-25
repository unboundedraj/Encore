import type { ContentType, SeatingMode } from "./enums";
import type { Seat } from "./seat";
import type { Screen, Venue } from "./venue";

/**
 * One row of GET /api/content/:contentId/shows.
 *
 * Flat rather than a discriminated union on purpose: a showtime list only
 * needs enough to render a card and link onward, and every field here is
 * meaningful regardless of seating_mode. screen_name is null for a
 * general-admission show, which has no screen.
 */
export interface ShowListItem {
  id: string;
  content_id: string;
  content_type: ContentType;
  seating_mode: SeatingMode;
  start_time: string;
  /** Minor units (cents/paise). */
  price: number;
  venue_id: string;
  venue_name: string;
  screen_id: string | null;
  screen_name: string | null;
}

interface ShowDetailBase {
  id: string;
  content_id: string;
  content_type: ContentType;
  start_time: string;
  /** Minor units (cents/paise). */
  price: number;
  venue: Venue;
}

/** GET /api/shows/:showId for an assigned-seating show. Seats come from a separate call. */
export interface AssignedShowDetail extends ShowDetailBase {
  seating_mode: "assigned";
  screen: Screen;
}

/**
 * GET /api/shows/:showId for a general-admission show.
 *
 * available_capacity is computed server-side as
 * total_capacity - SUM(quantity) over confirmed bookings, and is the number
 * the frontend should treat as authoritative -- never derive it again from
 * total_capacity and booked_quantity independently, since that recomputation
 * is exactly what this field exists to avoid duplicating.
 */
export interface GeneralAdmissionShowDetail extends ShowDetailBase {
  seating_mode: "general";
  total_capacity: number;
  booked_quantity: number;
  available_capacity: number;
}

/** Discriminate on seating_mode to know whether to fetch a seat map or show a quantity picker. */
export type ShowDetail = AssignedShowDetail | GeneralAdmissionShowDetail;

/**
 * One row of GET /api/shows/:showId/seats.
 *
 * status is derived, not stored -- see the note on Seat. "locked" is not a
 * possible value yet: that is the Redis hold from the next step. Today a seat
 * is only ever available or booked.
 */
export interface SeatWithStatus extends Seat {
  status: "available" | "booked";
}
