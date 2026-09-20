import type { SeatType } from "./enums";

/**
 * Row in the Postgres `encore_seats` table: one physical seat in a screen's
 * layout.
 *
 * Seats are not per-show. A seat's availability for a given show is derived
 * from `encore_booking_seats`, never stored here.
 */
export interface Seat {
  id: string;
  screen_id: string;
  row_label: string;
  seat_number: number;
  seat_type: SeatType;
  created_at: string;
}
