/**
 * MongoDB `content` collection: the catalog of everything sellable -- movies
 * and live events -- in one polymorphic collection.
 *
 * WHY MONGOOSE RATHER THAN A PLAIN INTERFACE + ZOD
 *
 * The two realistic options were the native driver with a Zod schema validating
 * at the API boundary, or Mongoose. Mongoose wins here for three reasons:
 *
 * 1. Discriminators are exactly this problem. Movies and events share most
 *    fields and diverge on a few, and we want them in one collection so a
 *    single "browse what's on" query returns both. Mongoose discriminators
 *    give one collection, a shared base schema, and per-type required fields
 *    enforced by the driver -- `durationMinutes` is required on a movie and
 *    rejected on an event, with no conditional validation written by hand.
 *
 * 2. Mongo has no DDL, so whatever is not enforced in the app is not enforced.
 *    Zod only validates where someone remembers to call it; a seed script or
 *    an admin backfill that writes through the driver bypasses it silently.
 *    Mongoose validation is attached to the model, so every write that goes
 *    through the model is checked, including bulk paths.
 *
 * 3. Postgres is where correctness is enforced for this product (see
 *    backend/docs/schema.md). The catalog is descriptive content, not money or
 *    inventory -- a wrong runtime here means a bad poster, not a double sale.
 *    That makes Mongoose's shape-level validation the right amount of rigor,
 *    and its ergonomics worth more than Zod's composability.
 *
 * The tradeoff we are accepting: Zod would be reusable on the frontend and for
 * request-body parsing, and Mongoose is not. So inbound HTTP payloads still get
 * validated at the route layer when we build the admin API -- Mongoose is the
 * last line of defense at the persistence boundary, not the only one.
 *
 * The `shared` package stays the cross-cutting contract. The document types
 * below are derived from it rather than redeclared, and the `satisfies Declares<...>`
 * guards make that derivation load-bearing: adding a field to `Movie` or
 * `Event` in `shared` fails this file's build until the schema declares it.
 */

import { Schema, model, type Model } from "mongoose";
import type { ContentType, Event, EventCategory, Movie } from "shared";

/**
 * The shared types describe the JSON shape the API returns: `_id` and the
 * timestamps are strings. In Mongo the same document has a real ObjectId
 * (supplied by Mongoose) and Date timestamps.
 */
type WireOnly = "_id" | "createdAt" | "updatedAt";
type Timestamps = { createdAt: Date; updatedAt: Date };

export type MovieDoc = Omit<Movie, WireOnly> & Timestamps;
export type EventDoc = Omit<Event, WireOnly> & Timestamps;
export type ContentDoc = MovieDoc | EventDoc;

/**
 * Which fields belong to the base schema and which to a discriminator is
 * computed from the shared types, not listed by hand -- a field on both is
 * shared, a field on one is that type's own.
 */
type SharedFieldKeys = Exclude<keyof Movie & keyof Event, WireOnly>;
type MovieOnlyKeys = Exclude<keyof Movie, keyof Event>;
type EventOnlyKeys = Exclude<keyof Event, keyof Movie>;

/** Fields every content document has, whatever its type. */
type ContentBaseDoc = Omit<Pick<Movie, SharedFieldKeys>, "type"> & {
  type: ContentType;
} & Timestamps;

/**
 * Forces a schema definition to declare every key of K. This is the drift
 * guard: Mongoose's own `Schema<T>` generic accepts a definition that omits
 * paths of T, so without this a new field in `shared` would compile fine here
 * and then silently never persist.
 */
type Declares<K extends PropertyKey> = Record<K, unknown>;

const EVENT_CATEGORIES: EventCategory[] = [
  "concert",
  "play",
  "standup",
  "sports",
  "conference",
  "other",
];

// `type` is excluded: it is written by the discriminator, and declaring it as
// an ordinary path would shadow the discriminator key.
const baseFields = {
  title: { type: String, required: true, trim: true, maxlength: 300 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  posterUrl: { type: String, required: true, trim: true },
  // Optional, and explicitly nullable rather than absent, so the shape the
  // API returns matches the shared type whether or not a trailer exists.
  trailerUrl: { type: String, trim: true, default: null },
  genres: {
    type: [String],
    default: [],
    // Mongo would happily accept a 400-entry genre array from a bad import.
    validate: {
      validator: (v: string[]) => v.length <= 20,
      message: "A content item cannot have more than 20 genres.",
    },
  },
} satisfies Declares<Exclude<SharedFieldKeys, "type">>;

const contentSchema = new Schema<ContentBaseDoc>(baseFields, {
  discriminatorKey: "type",
  timestamps: true,
  collection: "content",
});

// Catalog search. Weighted so a title match outranks a description match.
//
// language_override is redirected to a field that does not exist on purpose.
// MongoDB reads the *document's* `language` field to pick a stemmer, and a
// movie's `language` is an ISO 639-1 code for the film's spoken language --
// entirely unrelated. Left at its default, inserting a film in Malayalam fails
// outright with `language override unsupported: ml`, because Mongo has no
// Malayalam stemmer. Pointing the override at an unused field makes every
// document use default_language and leaves our field as pure domain data.
contentSchema.index(
  { title: "text", description: "text" },
  {
    weights: { title: 10, description: 1 },
    name: "content_search_idx",
    default_language: "english",
    language_override: "_searchLanguage",
  }
);
// "All movies" / "all events" listing pages, newest first.
contentSchema.index({ type: 1, createdAt: -1 });

const movieFields = {
  durationMinutes: { type: Number, required: true, min: 1, max: 1000 },
  cast: { type: [String], default: [] },
  // ISO 639-1 code rather than a display name, so the frontend controls how it
  // is rendered and filtering does not depend on spelling.
  language: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    // `as const` keeps this a [RegExp, string] tuple. Without it the literal
    // widens to (string | RegExp)[] and Mongoose rejects it.
    match: [/^[a-z]{2}$/, "language must be a two-letter ISO 639-1 code"] as const,
  },
} satisfies Declares<MovieOnlyKeys>;

const eventFields = {
  performer: { type: String, required: true, trim: true, maxlength: 300 },
  category: { type: String, required: true, enum: EVENT_CATEGORIES },
} satisfies Declares<EventOnlyKeys>;

const movieSchema = new Schema<MovieDoc>(movieFields);
const eventSchema = new Schema<EventDoc>(eventFields);

/**
 * Base model. Querying this returns both movies and events, already hydrated
 * into the right discriminator class.
 */
export const ContentModel: Model<ContentBaseDoc> = model<ContentBaseDoc>(
  "Content",
  contentSchema
);

/** Writes `type: "movie"` automatically and enforces the movie-only fields. */
export const MovieModel = ContentModel.discriminator<MovieDoc>("movie", movieSchema);

/** Writes `type: "event"` automatically and enforces the event-only fields. */
export const EventModel = ContentModel.discriminator<EventDoc>("event", eventSchema);
