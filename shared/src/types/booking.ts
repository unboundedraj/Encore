import type { BookingStatus } from "./enums";

interface BookingBase {
  id: string;
  /** Firebase UID, matching `encore_users.id`. */
  user_id: string;
  show_id: string;
  status: BookingStatus;
  /** Minor units (cents/paise). */
  total_amount: number;
  created_at: string;
}

/** Seats are the line items in `encore_booking_seats`; there is no quantity column. */
export interface AssignedBooking extends BookingBase {
  seating_mode: "assigned";
  quantity: null;
}

/** GA sale is just a headcount; no `encore_booking_seats` rows exist. */
export interface GeneralAdmissionBooking extends BookingBase {
  seating_mode: "general";
  quantity: number;
}

/**
 * Row in the Postgres `encore_bookings` table.
 *
 * `seating_mode` is denormalized from the parent show. It is not maintained by
 * application code -- a composite foreign key to
 * `encore_shows (id, seating_mode)` makes Postgres guarantee the two agree.
 */
export type Booking = AssignedBooking | GeneralAdmissionBooking;

/**
 * Row in the Postgres `encore_booking_seats` table -- one seat on one
 * assigned-seating booking. Never written for general-admission bookings.
 *
 * `show_id`, `screen_id` and `status` are denormalized copies of the parent
 * booking's and show's values. They exist so the partial unique index that
 * prevents double-booking is expressible on this table alone, and they are held
 * correct by composite foreign keys with ON UPDATE CASCADE -- not by the
 * application. Treat them as read-only: writing them out of sync is rejected.
 */
export interface BookingSeat {
  id: string;
  booking_id: string;
  show_id: string;
  screen_id: string;
  seat_id: string;
  status: BookingStatus;
  created_at: string;
}
