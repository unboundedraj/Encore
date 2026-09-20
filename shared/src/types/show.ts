import type { ContentType } from "./enums";

interface ShowBase {
  id: string;
  /**
   * MongoDB ObjectId of the `content` document, as a 24-char hex string.
   * There is no foreign key -- the catalog lives in Mongo, not Postgres.
   */
  content_id: string;
  content_type: ContentType;
  venue_id: string;
  /** Minor units (cents/paise), matching the gateways. */
  price: number;
  start_time: string;
  created_at: string;
}

/** Movie-style show with a seat map. Inventory is the `encore_seats` table. */
export interface AssignedShow extends ShowBase {
  seating_mode: "assigned";
  screen_id: string;
  total_capacity: null;
}

/** Standing/GA event. Inventory is a headcount, not a seat map. */
export interface GeneralAdmissionShow extends ShowBase {
  seating_mode: "general";
  screen_id: null;
  total_capacity: number;
}

/**
 * Row in the Postgres `encore_shows` table.
 *
 * Modelled as a discriminated union so the compiler enforces the same rule as
 * the `encore_shows_seating_mode_check` constraint: narrowing on `seating_mode` gives
 * a non-null `screen_id` or a non-null `total_capacity`, never both.
 */
export type Show = AssignedShow | GeneralAdmissionShow;
