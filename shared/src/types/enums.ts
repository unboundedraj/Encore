// Mirrors of the Postgres enum types. Kept in one file so a schema change has
// a single place to land on the TypeScript side.
//
// The Postgres type names carry an `encore_` prefix because this Supabase
// project is shared with other applications; the TypeScript names do not, as
// they are already namespaced by this package.

/** Postgres: encore_content_type. Also the Mongo `content` discriminator. */
export type ContentType = "movie" | "event";

/** Postgres: encore_seating_mode. */
export type SeatingMode = "assigned" | "general";

/** Postgres: encore_seat_type. */
export type SeatType = "standard" | "premium";

/** Postgres: encore_booking_status. */
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired";

/** Postgres: encore_payment_gateway. */
export type PaymentGateway = "stripe" | "razorpay";

/** Postgres: encore_payment_status. */
export type PaymentStatus = "pending" | "succeeded" | "failed";
