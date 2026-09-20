import type { ContentType } from "./enums";

/**
 * Catalog documents from the MongoDB `content` collection.
 *
 * Note the casing change: everything sourced from Postgres uses snake_case to
 * match the column names supabase-js returns verbatim, while these use
 * camelCase to match the Mongoose schema. The boundary is the database, so the
 * casing tells you which one a value came from.
 */

export type EventCategory =
  | "concert"
  | "play"
  | "standup"
  | "sports"
  | "conference"
  | "other";

interface ContentBase {
  /** MongoDB ObjectId as a 24-char hex string; `encore_shows.content_id` points here. */
  _id: string;
  type: ContentType;
  title: string;
  description: string;
  posterUrl: string;
  trailerUrl: string | null;
  /** Free-form labels: "Action", "Rock", "Drama". Distinct from an event's structured `category`. */
  genres: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Movie extends ContentBase {
  type: "movie";
  durationMinutes: number;
  cast: string[];
  /** Primary spoken language, e.g. "en", "hi". */
  language: string;
}

export interface Event extends ContentBase {
  type: "event";
  /** Headline artist, performer, team or speaker. */
  performer: string;
  category: EventCategory;
}

/**
 * A single `content` document. Discriminated on `type`, mirroring the Mongoose
 * discriminator key, so narrowing gives you the type-specific fields.
 */
export type Content = Movie | Event;
