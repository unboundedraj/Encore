/**
 * Live verification against the real MongoDB Atlas cluster.
 *
 * Inserts one movie and one event through the discriminator models, checks
 * they round-trip correctly, checks an invalid document is rejected, then
 * deletes everything it created and confirms nothing is left behind.
 *
 * Unlike the Postgres test this cannot wrap the run in a transaction that is
 * always rolled back. Mongo transactions need a session on every operation and
 * would not exercise the normal write path, so cleanup is explicit instead --
 * and verified, rather than assumed.
 *
 * Every document carries a run-scoped marker in its title so cleanup can only
 * ever match rows this run created.
 *
 * Run with: npm run verify:mongo -w backend
 */

import "dotenv/config";
import { connectMongo, disconnectMongo } from "../config/mongodb";
import { ContentModel, EventModel, MovieModel } from "../models/Content";

const RUN_ID = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const marker = (s: string) => `${s} [${RUN_ID}]`;

let pass = 0;
let fail = 0;
const createdIds: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok   " : "FAIL "} ${label}${detail ? ` -- ${detail}` : ""}`);
  ok ? pass++ : fail++;
}

async function expectInvalid(label: string, doc: { save(): Promise<unknown> }, field: string) {
  try {
    await doc.save();
    check(label, false, "document saved but should have been rejected");
  } catch (err) {
    const e = err as { name?: string; errors?: Record<string, unknown> };
    const isValidation = e.name === "ValidationError";
    const onField = Boolean(e.errors && field in e.errors);
    check(label, isValidation && onField,
      isValidation ? `ValidationError on "${field}"` : `got ${e.name} instead of ValidationError`);
  }
}

async function main() {
  await connectMongo();

  try {
    console.log(`\nrun marker: ${RUN_ID}\n`);

    console.log("=== valid movie ===");
    const movie = await MovieModel.create({
      title: marker("Dune: Part Two"),
      description: "Paul Atreides unites with the Fremen.",
      posterUrl: "https://cdn.encore.test/dune2.jpg",
      genres: ["Sci-Fi", "Adventure"],
      durationMinutes: 166,
      cast: ["Timothee Chalamet", "Zendaya"],
      language: "en",
    });
    createdIds.push(movie._id.toString());
    check("movie saved", Boolean(movie._id));
    check('discriminator wrote type="movie"', movie.type === "movie", `type=${movie.type}`);

    console.log("\n=== valid event ===");
    const event = await EventModel.create({
      title: marker("Coldplay: Music of the Spheres"),
      description: "World tour, Mumbai leg.",
      posterUrl: "https://cdn.encore.test/coldplay.jpg",
      genres: ["Rock"],
      performer: "Coldplay",
      category: "concert",
    });
    createdIds.push(event._id.toString());
    check("event saved", Boolean(event._id));
    check('discriminator wrote type="event"', event.type === "event", `type=${event.type}`);

    console.log("\n=== persisted correctly (re-read from the server, not from memory) ===");
    const reMovie = await MovieModel.findById(movie._id).lean();
    check("movie re-read", Boolean(reMovie));
    check("  durationMinutes persisted", reMovie?.durationMinutes === 166, `${reMovie?.durationMinutes}`);
    check("  cast persisted", reMovie?.cast?.length === 2);
    check("  language lowercased by the schema", reMovie?.language === "en");
    check("  trailerUrl defaulted to null, not absent",
      reMovie !== null && "trailerUrl" in reMovie && reMovie.trailerUrl === null);

    const reEvent = await EventModel.findById(event._id).lean();
    check("event re-read", Boolean(reEvent));
    check("  performer persisted", reEvent?.performer === "Coldplay");
    check("  category persisted", reEvent?.category === "concert");

    console.log("\n=== one collection, two types ===");
    const both = await ContentModel.find({ title: { $regex: RUN_ID, $options: "i" } }).lean();
    check("base model returns both documents", both.length === 2, `found ${both.length}`);
    check("both live in the 'content' collection", ContentModel.collection.name === "content");
    check("movie-only field absent from the event document",
      !(reEvent as Record<string, unknown> | null)?.durationMinutes);

    console.log("\n=== ObjectId is usable as encore_shows.content_id ===");
    // Postgres stores this as text with CHECK (content_id ~ '^[0-9a-f]{24}$'),
    // since no foreign key can cross databases. Confirm real ids satisfy it.
    const hex24 = /^[0-9a-f]{24}$/;
    check("movie _id matches the Postgres CHECK", hex24.test(movie._id.toString()), movie._id.toString());
    check("event _id matches the Postgres CHECK", hex24.test(event._id.toString()), event._id.toString());

    console.log("\n=== invalid documents are rejected ===");
    await expectInvalid(
      "movie missing durationMinutes",
      new MovieModel({
        title: marker("Invalid Movie"),
        description: "no runtime",
        posterUrl: "https://cdn.encore.test/x.jpg",
        language: "en",
      }),
      "durationMinutes"
    );
    await expectInvalid(
      "movie with a display language instead of an ISO code",
      new MovieModel({
        title: marker("Invalid Movie 2"),
        description: "bad language",
        posterUrl: "https://cdn.encore.test/x.jpg",
        durationMinutes: 120,
        language: "English",
      }),
      "language"
    );
    await expectInvalid(
      "event missing performer",
      new EventModel({
        title: marker("Invalid Event"),
        description: "no performer",
        posterUrl: "https://cdn.encore.test/x.jpg",
        category: "concert",
      }),
      "performer"
    );
    await expectInvalid(
      "event with an unlisted category",
      new EventModel({
        title: marker("Invalid Event 2"),
        description: "bad category",
        posterUrl: "https://cdn.encore.test/x.jpg",
        performer: "Someone",
        category: "rave",
      }),
      "category"
    );

    const afterRejects = await ContentModel.countDocuments({ title: { $regex: RUN_ID, $options: "i" } });
    check("rejected documents were not written", afterRejects === 2, `${afterRejects} docs (expected the 2 valid ones)`);
  } finally {
    console.log("\n=== cleanup ===");
    const res = await ContentModel.deleteMany({ title: { $regex: RUN_ID, $options: "i" } });
    console.log(`  deleted ${res.deletedCount} document(s) created by this run`);
    const leftover = await ContentModel.countDocuments({ title: { $regex: RUN_ID, $options: "i" } });
    check("no documents from this run remain", leftover === 0, `${leftover} left`);
    const total = await ContentModel.estimatedDocumentCount();
    console.log(`  documents remaining in 'content' overall: ${total}`);
    await disconnectMongo();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`\nFailed: ${err.message}`);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
