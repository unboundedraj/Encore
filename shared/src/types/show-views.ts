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
  /** Lets the showtimes list group by venue and label the city without a second lookup. */
  venue_city: string;
  screen_id: string | null;
  screen_name: string | null;
}

/**
 * One row of GET /api/cities.
 *
 * Only cities with at least one upcoming show are listed -- offering a city
 * that resolves to an empty catalog is worse than not offering it, since the
 * user cannot tell "nothing on here" from "we got that wrong".
 */
export interface CitySummary {
  city: string;
  /** Upcoming shows across every venue in this city. */
  show_count: number;
  venue_count: number;
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
 * available_capacity is the authoritative number to display, computed
 * server-side as total_capacity - confirmed - held_by_others. Do not
 * recompute it from the parts: reproducing that arithmetic in the UI is
 * exactly what this field exists to prevent, and the parts are only exposed
 * so a screen can explain *why* a number is low.
 *
 * held_by_you is excluded from that subtraction -- tickets you are already
 * holding are still yours to buy, so showing them as unavailable to yourself
 * would be wrong.
 */
export interface GeneralAdmissionShowDetail extends ShowDetailBase {
  seating_mode: "general";
  total_capacity: number;
  booked_quantity: number;
  /** Temporarily held by other users; frees up on its own if they don't buy. */
  held_by_others: number;
  /** This user's own live hold, if any. Zero for anonymous callers. */
  held_by_you: number;
  available_capacity: number;
}

/** Discriminate on seating_mode to know whether to fetch a seat map or show a quantity picker. */
export type ShowDetail = AssignedShowDetail | GeneralAdmissionShowDetail;

/**
 * Seat availability, derived rather than stored -- see the note on Seat.
 *
 * `booked` is permanent and comes from Postgres. The two `held_*` states are
 * temporary Redis holds that expire on their own, and are kept distinct from
 * `booked` so the UI can say "someone is checking out" rather than "gone",
 * and can show a returning user which seats are already theirs.
 */
export type SeatStatus = "available" | "held_by_you" | "held_by_other" | "booked";

/** One row of GET /api/shows/:showId/seats. */
export interface SeatWithStatus extends Seat {
  status: SeatStatus;
}

/** Successful POST /api/shows/:showId/hold. */
export interface SeatHoldSuccess {
  seating_mode: "assigned";
  seat_ids: string[];
  expires_at: string;
  ttl_seconds: number;
}

export interface GeneralHoldSuccess {
  seating_mode: "general";
  quantity: number;
  expires_at: string;
  ttl_seconds: number;
}

export type HoldSuccess = SeatHoldSuccess | GeneralHoldSuccess;

/** Identifies a contested seat well enough to name it in the UI. */
export interface SeatConflict {
  seat_id: string;
  row_label: string;
  seat_number: number;
}

/** 409 body when another user already holds one of the requested seats. */
export interface SeatHoldConflict {
  error: string;
  seating_mode: "assigned";
  conflicts: SeatConflict[];
}

/** 409 body when the requested quantity no longer fits. */
export interface GeneralHoldConflict {
  error: string;
  seating_mode: "general";
  requested: number;
  available: number;
}
