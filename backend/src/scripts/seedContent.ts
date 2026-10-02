/**
 * Seeds the MongoDB catalog: real Indian films (from the TMDB snapshot, see
 * fetchTmdb.ts) across nine languages, plus standup, live music, theatre and
 * sport. Event artwork is still placeholder; films use TMDB posters.
 *
 * Ids are fixed rather than generated, which makes the script idempotent (a
 * re-run replaces exactly what it wrote before, never duplicating) and keeps
 * /content/<id> URLs stable across re-seeds so links in notes and tests do not
 * rot. The first ten ids are the ones the original placeholder catalog used --
 * they are deliberately reused rather than retired, so any /content/<id> or
 * /shows/<id> link saved before this reseed still resolves.
 *
 * Documents are created through the discriminator models rather than inserted
 * raw, so every one of them passes the same validation a real write would --
 * which makes this a check on the schema as well as a fixture loader.
 *
 * Film titles, cast and posters are real, from TMDB. Event posters are
 * picsum.photos placeholders seeded by slug (there is no open artwork API for
 * comedians and musicians). Performers are real, but every date, venue and
 * price is a fixture: nothing here corresponds to an actual scheduled event.
 *
 * Run with: npm run seed:content -w backend
 */

import "dotenv/config";
import { connectMongo, disconnectMongo } from "../config/mongodb";
import { ContentModel, EventModel, MovieModel, type EventDoc, type MovieDoc } from "../models/Content";
import { LEGACY_MOVIE_IDS, TMDB_MOVIES, tmdbContentId } from "./data/catalog";

const poster = (slug: string) => `https://picsum.photos/seed/${slug}/400/600`;
const TRAILER = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/**
 * MovieDoc/EventDoc deliberately omit `_id` -- it belongs to the wire shape and
 * is normally assigned by Mongo. Seeds pin it so re-runs replace rather than
 * duplicate, so the seed type adds it back. Timestamps are dropped because
 * Mongoose sets them.
 */
type Seed<T> = Omit<T, "createdAt" | "updatedAt"> & { _id: string };

const MOVIES: Seed<MovieDoc>[] = TMDB_MOVIES.map((m) => ({
  _id: tmdbContentId(m.tmdbId),
  type: "movie" as const,
  title: m.title,
  description: m.description,
  posterUrl: m.posterUrl,
  trailerUrl: m.trailerUrl,
  genres: m.genres,
  durationMinutes: m.durationMinutes,
  cast: m.cast,
  language: m.language,
}));

const EVENTS: Seed<EventDoc>[] = [
  {
    _id: "65f1a2b3c4d5e6f702000001",
    type: "event",
    title: "Indian Ocean: Unplugged",
    description:
      "Four decades of Kandisa and Bandeh, stripped back to acoustic arrangements for a single seated evening.",
    posterUrl: poster("indian-ocean-unplugged"),
    trailerUrl: TRAILER,
    genres: ["Fusion", "Rock"],
    performer: "Indian Ocean",
    category: "concert",
  },
  {
    _id: "65f1a2b3c4d5e6f702000002",
    type: "event",
    title: "Tughlaq",
    description:
      "Girish Karnad's study of an idealist king unravelling into tyranny, staged in the round with a cast of fourteen.",
    posterUrl: poster("tughlaq"),
    trailerUrl: null,
    genres: ["Drama", "Classic"],
    performer: "Prithvi Repertory",
    category: "play",
  },
  {
    _id: "65f1a2b3c4d5e6f702000003",
    type: "event",
    title: "Haq Se Single",
    description:
      "An hour on family pressure, Indore winters and the specific dread of a wedding invitation with your name spelled wrong.",
    posterUrl: poster("haq-se-single"),
    trailerUrl: TRAILER,
    genres: ["Standup", "Hindi"],
    performer: "Zakir Khan",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f702000004",
    type: "event",
    title: "Mumbai Open: Finals Weekend",
    description:
      "Singles and doubles finals across two show courts, with the trophy presentation following the last match.",
    posterUrl: poster("mumbai-open"),
    trailerUrl: null,
    genres: ["Tennis"],
    performer: "Maharashtra Tennis Association",
    category: "sports",
  },
  {
    _id: "65f1a2b3c4d5e6f702000005",
    type: "event",
    title: "Bas Kar Bassi",
    description:
      "Stories about schoolteachers, first bikes and the exact moment your mother finds your report card.",
    posterUrl: poster("bas-kar-bassi"),
    trailerUrl: TRAILER,
    genres: ["Standup", "Hindi"],
    performer: "Anubhav Singh Bassi",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f702000006",
    type: "event",
    title: "The Most Interesting Person in the Room",
    description:
      "Observational comedy on middle-class Bangalore, music school dropouts and being aggressively average.",
    posterUrl: poster("most-interesting-person"),
    trailerUrl: TRAILER,
    genres: ["Standup", "English"],
    performer: "Kenny Sebastian",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f702000007",
    type: "event",
    title: "Gully Gang Live",
    description:
      "A full-band hip-hop set running through Mere Gully Mein and the Kohinoor-era material, with guest verses.",
    posterUrl: poster("gully-gang-live"),
    trailerUrl: TRAILER,
    genres: ["Hip-Hop", "Rap"],
    performer: "DIVINE",
    category: "concert",
  },
  {
    _id: "65f1a2b3c4d5e6f702000008",
    type: "event",
    title: "Prateek Kuhad: Silhouettes Tour",
    description:
      "An evening of cold/mess, kasoor and new material, performed with a four-piece and no opening act.",
    posterUrl: poster("prateek-kuhad-silhouettes"),
    trailerUrl: TRAILER,
    genres: ["Indie", "Acoustic"],
    performer: "Prateek Kuhad",
    category: "concert",
  },
  {
    _id: "65f1a2b3c4d5e6f702000009",
    type: "event",
    title: "Keep It Real",
    description:
      "Crowd work and long-form storytelling from the Aisa Waisa Pyaar tour, with a new closing set.",
    posterUrl: poster("keep-it-real"),
    trailerUrl: null,
    genres: ["Standup", "Hindi"],
    performer: "Rahul Subramanian",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f70200000a",
    type: "event",
    title: "Carnatic 2.0",
    description:
      "A classical ensemble reworking Thyagaraja kritis with double bass, drum kit and live electronics.",
    posterUrl: poster("carnatic-2-0"),
    trailerUrl: TRAILER,
    genres: ["Classical", "Fusion"],
    performer: "Sanjay Subrahmanyan Collective",
    category: "concert",
  },
  {
    _id: "65f1a2b3c4d5e6f70200000b",
    type: "event",
    title: "Court Martial",
    description:
      "Swadesh Deepak's courtroom drama on caste inside the Indian army, performed without an interval.",
    posterUrl: poster("court-martial"),
    trailerUrl: null,
    genres: ["Drama", "Political"],
    performer: "Aadyam Theatre",
    category: "play",
  },
  {
    _id: "65f1a2b3c4d5e6f70200000c",
    type: "event",
    title: "Open Mic Night",
    description:
      "Twelve five-minute sets from the city's newest comics, hosted and unfiltered. New line-up every week.",
    posterUrl: poster("open-mic-night"),
    trailerUrl: null,
    genres: ["Standup", "Open Mic"],
    performer: "Habitat Regulars",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f70200000d",
    type: "event",
    title: "Samay Raina: Chessboard Therapy",
    description:
      "An hour on chess trauma, YouTube comment-section warfare, and why losing on stream is funnier than winning.",
    posterUrl: poster("samay-raina-chessboard-therapy"),
    trailerUrl: TRAILER,
    genres: ["Standup", "Hindi"],
    performer: "Samay Raina",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f70200000e",
    type: "event",
    title: "Gaurav Kapoor: Mic Drop",
    description:
      "Commentary boxes, award-show green rooms and thirty years of overhearing things he was never supposed to hear.",
    posterUrl: poster("gaurav-kapoor-mic-drop"),
    trailerUrl: null,
    genres: ["Standup", "English"],
    performer: "Gaurav Kapoor",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f70200000f",
    type: "event",
    title: "Abhishek Upmanyu: Unfiltered",
    description:
      "New material on Delhi landlords, gym bros, and the group chat that refuses to let an argument die.",
    posterUrl: poster("abhishek-upmanyu-unfiltered"),
    trailerUrl: TRAILER,
    genres: ["Standup", "Hindi"],
    performer: "Abhishek Upmanyu",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f702000010",
    type: "event",
    title: "Vir Das: Live in Concert",
    description:
      "An hour of observational standup on travel, fatherhood and being Indian in every room he walks into, from the comedian who took Indian comedy to a global stage.",
    posterUrl: poster("vir-das-live"),
    trailerUrl: null,
    genres: ["Standup", "English"],
    performer: "Vir Das",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f702000011",
    type: "event",
    title: "Aakash Gupta: Open Book",
    description:
      "Crowd-work-heavy standup built around Delhi, family WhatsApp groups and the dangers of reading the comments.",
    posterUrl: poster("aakash-gupta-open-book"),
    trailerUrl: null,
    genres: ["Standup", "Hindi"],
    performer: "Aakash Gupta",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f702000012",
    type: "event",
    title: "Tanmay Bhat: Late Night Set",
    description:
      "A loose, late-evening set on internet fame, podcasts and the economics of being chronically online.",
    posterUrl: poster("tanmay-bhat-late-night"),
    trailerUrl: null,
    genres: ["Standup", "Hindi", "English"],
    performer: "Tanmay Bhat",
    category: "standup",
  },
  {
    _id: "65f1a2b3c4d5e6f702000013",
    type: "event",
    title: "Anuv Jain: Live",
    description:
      "Soft guitar, quiet rooms and a few thousand people singing every word of Gul and Alag Aasmaan back at him.",
    posterUrl: poster("anuv-jain-live"),
    trailerUrl: null,
    genres: ["Indie", "Acoustic", "Hindi"],
    performer: "Anuv Jain",
    category: "concert",
  },
  {
    _id: "65f1a2b3c4d5e6f702000014",
    type: "event",
    title: "Arijit Singh: Live in Concert",
    description:
      "Two hours across a decade of Hindi film music, from Tum Hi Ho to Kesariya, with a full live band.",
    posterUrl: poster("arijit-singh-live"),
    trailerUrl: null,
    genres: ["Bollywood", "Playback"],
    performer: "Arijit Singh",
    category: "concert",
  },
  {
    _id: "65f1a2b3c4d5e6f702000015",
    type: "event",
    title: "Diljit Dosanjh: Live",
    description:
      "Punjabi pop at stadium volume: Lover, Patiala Peg and the entire Dil-Luminati setlist, with a dhol section on stage.",
    posterUrl: poster("diljit-dosanjh-live"),
    trailerUrl: null,
    genres: ["Punjabi", "Pop"],
    performer: "Diljit Dosanjh",
    category: "concert",
  },
  {
    _id: "65f1a2b3c4d5e6f702000016",
    type: "event",
    title: "Shreya Ghoshal: Live",
    description:
      "A voice-led evening across Hindi, Bengali, Tamil and Marathi film songs, backed by a thirty-piece orchestra.",
    posterUrl: poster("shreya-ghoshal-live"),
    trailerUrl: null,
    genres: ["Bollywood", "Playback", "Classical"],
    performer: "Shreya Ghoshal",
    category: "concert",
  },
  {
    _id: "65f1a2b3c4d5e6f702000017",
    type: "event",
    title: "Sunburn Arena: Nucleya",
    description:
      "Bass-heavy Indian electronic, folk samples over trap drops, a full-light-rig Saturday night.",
    posterUrl: poster("sunburn-arena-nucleya"),
    trailerUrl: null,
    genres: ["Electronic", "Desi Bass"],
    performer: "Nucleya",
    category: "concert",
  },
];

async function main() {
  await connectMongo();

  const movieIds = MOVIES.map((m) => m._id);
  const eventIds = EVENTS.map((e) => e._id);

  // Replace rather than upsert: a changed discriminator (movie -> event) on a
  // reused id cannot be applied by an update, and deleting first also clears
  // fields removed from a seed entry rather than leaving them behind.
  const removed = await ContentModel.deleteMany({
    _id: { $in: [...movieIds, ...eventIds, ...LEGACY_MOVIE_IDS] },
  });
  console.log(`removed ${removed.deletedCount} previously seeded document(s)`);

  await MovieModel.insertMany(MOVIES);
  console.log(`inserted ${MOVIES.length} movies`);

  await EventModel.insertMany(EVENTS);
  console.log(`inserted ${EVENTS.length} events`);

  const total = await ContentModel.countDocuments();
  console.log(`\ncatalog now holds ${total} document(s)`);
  console.log(`sample: /content/${MOVIES[0]._id}`);

  await disconnectMongo();
}

main()
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(`seed failed: ${err.message}`);
    process.exit(1);
  });
