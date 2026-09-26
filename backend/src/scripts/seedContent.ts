/**
 * Seeds the MongoDB catalog with a realistic Indian listing: films across five
 * languages, standup, live music, theatre and sport.
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
 * Posters are picsum.photos placeholders seeded by slug, so each title gets a
 * stable, distinct image without anyone sourcing real artwork. Titles and
 * performers are recognisably Indian so the catalog reads like a real listing
 * rather than lorem ipsum; nothing here corresponds to an actual scheduled
 * event.
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
    title: "Kaalchakra",
    description:
      "A Mumbai homicide detective investigating a series of staged suicides realises every victim shared a train compartment on the night of the 2006 floods.",
    posterUrl: poster("kaalchakra"),
    trailerUrl: TRAILER,
    genres: ["Thriller", "Crime", "Mystery"],
    durationMinutes: 148,
    cast: ["Rajkummar Rao", "Konkona Sen Sharma", "Jaideep Ahlawat"],
    language: "hi",
  },
  {
    _id: "65f1a2b3c4d5e6f701000002",
    type: "movie",
    title: "Monsoon Letters",
    description:
      "Two estranged sisters reopen their grandmother's bookshop in Fort Kochi and find sixty years of unsent correspondence stacked behind the Malayalam poetry shelf.",
    posterUrl: poster("monsoon-letters"),
    trailerUrl: null,
    genres: ["Drama", "Family"],
    durationMinutes: 118,
    cast: ["Parvathy Thiruvothu", "Nimisha Sajayan", "Fahadh Faasil"],
    language: "ml",
  },
  {
    _id: "65f1a2b3c4d5e6f701000003",
    type: "movie",
    title: "Vetri Nagaram",
    description:
      "A Madurai auto driver wins a district kabaddi trial and discovers the selection was fixed against the one player who could beat him.",
    posterUrl: poster("vetri-nagaram"),
    trailerUrl: TRAILER,
    genres: ["Sports", "Drama", "Action"],
    durationMinutes: 156,
    cast: ["Dhanush", "Aishwarya Rajesh", "Soori"],
    language: "ta",
  },
  {
    _id: "65f1a2b3c4d5e6f701000004",
    type: "movie",
    title: "Chai, Biscuit, Revolution",
    description:
      "Four friends running a failing tea stall outside a Lucknow coaching centre accidentally become the face of a student movement.",
    posterUrl: poster("chai-biscuit"),
    trailerUrl: TRAILER,
    genres: ["Comedy", "Drama"],
    durationMinutes: 132,
    cast: ["Vijay Varma", "Sanya Malhotra", "Pankaj Tripathi"],
    language: "hi",
  },
  {
    _id: "65f1a2b3c4d5e6f701000005",
    type: "movie",
    title: "Samudram",
    description:
      "A Visakhapatnam trawler captain takes a contract he cannot refuse and finds his crew a hundred nautical miles from anyone who can help.",
    posterUrl: poster("samudram"),
    trailerUrl: TRAILER,
    genres: ["Action", "Thriller"],
    durationMinutes: 164,
    cast: ["Rana Daggubati", "Sai Pallavi", "Jagapathi Babu"],
    language: "te",
  },
  {
    _id: "65f1a2b3c4d5e6f701000006",
    type: "movie",
    title: "Night Shift at Marine Drive",
    description:
      "An ambulance driver working the graveyard shift keeps picking up the same passenger from the same stretch of sea wall.",
    posterUrl: poster("marine-drive"),
    trailerUrl: TRAILER,
    genres: ["Horror", "Mystery"],
    durationMinutes: 109,
    cast: ["Radhika Apte", "Adarsh Gourav"],
    language: "hi",
  },
  {
    _id: "65f1a2b3c4d5e6f701000007",
    type: "movie",
    title: "Bengaluru Traffic",
    description:
      "Six strangers stuck on the Outer Ring Road for nine hours discover they are all on their way to the same funeral.",
    posterUrl: poster("bengaluru-traffic"),
    trailerUrl: TRAILER,
    genres: ["Comedy", "Drama"],
    durationMinutes: 127,
    cast: ["Rakshit Shetty", "Rashmika Mandanna", "Achyuth Kumar"],
    language: "kn",
  },
  {
    _id: "65f1a2b3c4d5e6f701000008",
    type: "movie",
    title: "The Last Ledger",
    description:
      "A forensic accountant auditing a cooperative bank in Nashik finds a second set of books written in her late father's hand.",
    posterUrl: poster("last-ledger"),
    trailerUrl: null,
    genres: ["Drama", "Thriller"],
    durationMinutes: 141,
    cast: ["Tabu", "Manoj Bajpayee", "Shefali Shah"],
    language: "hi",
  },
  {
    _id: "65f1a2b3c4d5e6f701000009",
    type: "movie",
    title: "Pushpavalli Returns",
    description:
      "A wedding planner with a perfect record takes on the one ceremony she swore she would never touch: her own.",
    posterUrl: poster("pushpavalli-returns"),
    trailerUrl: TRAILER,
    genres: ["Romance", "Comedy"],
    durationMinutes: 124,
    cast: ["Sanya Malhotra", "Abhishek Banerjee", "Sheeba Chaddha"],
    language: "hi",
  },
  {
    _id: "65f1a2b3c4d5e6f70100000a",
    type: "movie",
    title: "Silk Route",
    description:
      "A Kolkata textile heir traces a shipment of counterfeit sarees back through four countries and one family secret.",
    posterUrl: poster("silk-route"),
    trailerUrl: TRAILER,
    genres: ["Drama", "Mystery"],
    durationMinutes: 152,
    cast: ["Jisshu Sengupta", "Swastika Mukherjee", "Ritwick Chakraborty"],
    language: "bn",
  },
  {
    _id: "65f1a2b3c4d5e6f70100000b",
    type: "movie",
    title: "Antariksh",
    description:
      "India's first crewed lunar mission loses contact forty seconds before descent, and a retired engineer in Thiruvananthapuram is the only one who knows why.",
    posterUrl: poster("antariksh"),
    trailerUrl: TRAILER,
    genres: ["Sci-Fi", "Drama"],
    durationMinutes: 159,
    cast: ["R. Madhavan", "Vidya Balan", "Mohanlal"],
    language: "hi",
  },
  {
    _id: "65f1a2b3c4d5e6f70100000c",
    type: "movie",
    title: "Dhaba Diaries",
    description:
      "A Michelin-trained chef inherits her grandfather's highway dhaba on NH-44 and cannot bring herself to change a single recipe.",
    posterUrl: poster("dhaba-diaries"),
    trailerUrl: null,
    genres: ["Drama", "Family"],
    durationMinutes: 113,
    cast: ["Bhumi Pednekar", "Kumud Mishra"],
    language: "hi",
  },
];

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
];

async function main() {
  await connectMongo();

  const movieIds = MOVIES.map((m) => m._id);
  const eventIds = EVENTS.map((e) => e._id);

  // Replace rather than upsert: a changed discriminator (movie -> event) on a
  // reused id cannot be applied by an update, and deleting first also clears
  // fields removed from a seed entry rather than leaving them behind.
  const removed = await ContentModel.deleteMany({ _id: { $in: [...movieIds, ...eventIds] } });
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
