import type { BookingStatus, ContentType, SeatingMode } from "./enums";

/** Response body of POST /api/shows/:showId/checkout on success. */
export interface CheckoutSession {
  booking_id: string;
  checkout_url: string;
  /** Minor units (cents/paise). */
  amount: number;
  expires_at: string | null;
  /** True when an in-flight checkout for the same selection was reused rather than duplicated. */
  reused: boolean;
}

export interface BookingSeatSummary {
  id: string;
  row_label: string;
  seat_number: number;
}

/**
 * Response body of GET /api/bookings/:bookingId.
 *
 * A read-only summary assembled from encore_bookings joined out to its show,
 * venue, screen and seats -- not a raw table row. content_id is included so
 * the caller can separately fetch the Mongo catalog document for a title,
 * the same way the content detail page does; this endpoint has no reason to
 * reach into Mongo itself.
 */
export interface BookingDetail {
  id: string;
  show_id: string;
  content_id: string;
  content_type: ContentType;
  status: BookingStatus;
  seating_mode: SeatingMode;
  /** Populated for assigned seating, null for general admission. */
  seats: BookingSeatSummary[] | null;
  /** Populated for general admission, null for assigned seating. */
  quantity: number | null;
  /** Minor units (cents/paise). */
  total_amount: number;
  venue_name: string;
  city: string;
  /** Null for general admission. */
  screen_name: string | null;
  start_time: string;
  created_at: string;
}
