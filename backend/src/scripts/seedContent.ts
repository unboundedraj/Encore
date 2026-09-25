/**
 * Seeds the MongoDB catalog with realistic movies and events.
 *
 * Ids are fixed rather than generated, which makes the script idempotent (a
 * re-run replaces exactly what it wrote before, never duplicating) and keeps
 * /content/<id> URLs stable across re-seeds so links in notes and tests do not
 * rot.
 *
 * Documents are created through the discriminator models rather than inserted
 * raw, so every one of them passes the same validation a real write would --
 * which makes this a check on the schema as well as a fixture loader.
 *
 * Posters are picsum.photos placeholders seeded by slug, so each title gets a
 * stable, distinct image without anyone sourcing real artwork.
 *
 * Run with: npm run seed:content -w backend
 */

import "dotenv/config";
import { connectMongo, disconnectMongo } from "../config/mongodb";
import { ContentModel, EventModel, MovieModel, type EventDoc, type MovieDoc } from "../models/Content";

const poster = (slug: string) => `https://picsum.photos/seed/${slug}/400/600`;
const TRAILER = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/**
 * MovieDoc/EventDoc deliberately omit `_id` -- it belongs to the wire shape and
 * is normally assigned by Mongo. Seeds pin it so re-runs replace rather than
 * duplicate, so the seed type adds it back. Timestamps are dropped because
 * Mongoose sets them.
 */
type Seed<T> = Omit<T, "createdAt" | "updatedAt"> & { _id: string };

const MOVIES: Seed<MovieDoc>[] = [
  {
    _id: "65f1a2b3c4d5e6f701000001",
    type: "movie",
    title: "The Silent Orbit",
    description:
      "A salvage crew wakes from cryosleep to find their ship three years off course and one crew member unaccounted for.",
    posterUrl: poster("silent-orbit"),
    trailerUrl: TRAILER,
    genres: ["Sci-Fi", "Thriller"],
    durationMinutes: 137,
    cast: ["Priya Raghunathan", "Tomas Beck", "Ana Oyelaran"],
    language: "en",
  },
  {
    _id: "65f1a2b3c4d5e6f701000002",
    type: "movie",
    title: "Monsoon Letters",
    description:
      "Two estranged sisters reopen their grandmother's bookshop in Kochi and find sixty years of unsent correspondence.",
    posterUrl: poster("monsoon-letters"),
    trailerUrl: null,
    genres: ["Drama", "Family"],
    durationMinutes: 118,
    cast: ["Meera Nandakumar", "Lakshmi Iyer", "Rahul Menon"],
    language: "ml",
  },
  {
    _id: "65f1a2b3c4d5e6f701000003",
    type: "movie",
    title: "Hollow Pines",
    description:
      "A wildfire lookout in her first season starts receiving radio calls from a tower that burned down a decade ago.",
    posterUrl: poster("hollow-pines"),
    trailerUrl: TRAILER,
    genres: ["Horror", "Mystery"],
    durationMinutes: 101,
    cast: ["Dana Whitfield", "Marcus Adeyemi"],
    language: "en",
  },
  {
    _id: "65f1a2b3c4d5e6f701000004",
    type: "movie",
    title: "Paper Tigers",
    description:
      "Four retired stuntmen are hired for one last job and discover the film they signed onto does not exist.",
    posterUrl: poster("paper-tigers"),
    trailerUrl: null,
    genres: ["Action", "Comedy"],
    durationMinutes: 124,
    cast: ["Vikram Sethi", "Joon-ho Park", "Elena Brandt", "Samuel Achebe"],
    language: "hi",
  },
  {
    _id: "65f1a2b3c4d5e6f701000005",
    type: "movie",
    title: "The Cartographer's Daughter",
    description:
      "In 1890s Lisbon, a mapmaker's apprentice realises her father has been deliberately drawing one island wrong.",
    posterUrl: poster("cartographers-daughter"),
    trailerUrl: TRAILER,
    genres: ["Historical", "Adventure"],
    durationMinutes: 146,
    cast: ["Ines Carvalho", "Pedro Almeida", "Sofia Ruiz"],
    language: "pt",
  },
  {
    _id: "65f1a2b3c4d5e6f701000006",
    type: "movie",
    title: "Nightshift at the Aquarium",
    description:
      "A lonely security guard befriends an octopus that has started leaving him messages in the gravel.",
    posterUrl: poster("nightshift-aquarium"),
    trailerUrl: null,
    genres: ["Comedy", "Drama"],
    durationMinutes: 96,
    cast: ["Gabriel Okonkwo", "Yuki Tanaka"],
    language: "en",
  },
];

const EVENTS: Seed<EventDoc>[] = [
  {
    _id: "65f1a2b3c4d5e6f702000001",
    type: "event",
    title: "Aurora Collective: Wavelengths Tour",
    description:
      "The Icelandic post-rock quartet bring their six-piece string arrangement to India for the first time.",
    posterUrl: poster("aurora-collective"),
    trailerUrl: TRAILER,
    genres: ["Post-Rock", "Live"],
    performer: "Aurora Collective",
    category: "concert",
  },
  {
    _id: "65f1a2b3c4d5e6f702000002",
    type: "event",
    title: "A Doll's House, Part 2",
    description:
      "Lucas Hnath's sharp sequel to Ibsen, staged in the round with a rotating cast of four.",
    posterUrl: poster("dolls-house-two"),
    trailerUrl: null,
    genres: ["Theatre", "Drama"],
    performer: "Prithvi Repertory",
    category: "play",
  },
  {
    _id: "65f1a2b3c4d5e6f702000003",
    type: "event",
    title: "Kabir Rao: Load Bearing",
    description:
      "Ninety minutes of new material about middle management, elderly parents and the cost of being the reliable one.",
    posterUrl: poster("kabir-rao-load-bearing"),
    trailerUrl: TRAILER,
    genres: ["Stand-up", "Comedy"],
    performer: "Kabir Rao",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f702000004",
    type: "event",
    title: "Mumbai Open: Finals Weekend",
    description:
      "Men's and women's singles finals, with the doubles decider opening Sunday's play.",
    posterUrl: poster("mumbai-open-finals"),
    trailerUrl: null,
    genres: ["Tennis", "Sport"],
    performer: "Mumbai Open",
    category: "sports",
  },
];

async function main() {
  await connectMongo();

  const seededIds = [...MOVIES, ...EVENTS].map((d) => d._id);

  try {
    // Mongoose creates missing indexes on connect but never alters one that
    // already exists under the same name. syncIndexes() is not enough here
    // either: it compares index *keys*, and a text index's keys are the
    // internal _fts/_ftsx pair regardless of options, so a changed
    // language_override looks identical to it and the stale index survives.
    // Check the option directly and drop it when it drifts.
    const existing = await ContentModel.collection.indexes();
    const search = existing.find((i) => i.name === "content_search_idx");
    if (search && search.language_override !== "_searchLanguage") {
      await ContentModel.collection.dropIndex("content_search_idx");
      console.log(
        `dropped stale text index (language_override was '${search.language_override}')`
      );
    }
    const dropped = await ContentModel.syncIndexes();
    console.log(`synced indexes${dropped.length ? ` (dropped: ${dropped.join(", ")})` : ""}`);

    // Scoped to the ids this script owns, so anything added by hand survives.
    const removed = await ContentModel.deleteMany({ _id: { $in: seededIds } });
    console.log(`removed ${removed.deletedCount} previously seeded document(s)`);

    for (const movie of MOVIES) await MovieModel.create(movie);
    console.log(`inserted ${MOVIES.length} movies`);

    for (const event of EVENTS) await EventModel.create(event);
    console.log(`inserted ${EVENTS.length} events`);

    const total = await ContentModel.estimatedDocumentCount();
    const movieCount = await ContentModel.countDocuments({ type: "movie" });
    const eventCount = await ContentModel.countDocuments({ type: "event" });
    console.log(
      `\ncatalog now holds ${total} document(s): ${movieCount} movies, ${eventCount} events`
    );
    console.log(`sample detail URL: /content/${MOVIES[0]._id}`);
  } finally {
    await disconnectMongo();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`seed failed: ${err.message}`);
    process.exit(1);
  });
