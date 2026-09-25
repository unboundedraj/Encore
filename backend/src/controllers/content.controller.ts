/**
 * Public catalog reads.
 *
 * These endpoints are deliberately unauthenticated: browsing what is on is the
 * top of the funnel and happens before anyone signs in. Do not mount requireAuth
 * on this router. Writes will live behind an admin guard when that exists.
 */

import type { Request, Response } from "express";
import type { ContentType, EventCategory, Paginated } from "shared";
import { ContentModel } from "../models/Content";

const CONTENT_TYPES: ContentType[] = ["movie", "event"];
const EVENT_CATEGORIES: EventCategory[] = [
  "concert",
  "play",
  "standup",
  "sports",
  "conference",
  "other",
];

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * A 24-character hex string.
 *
 * Not mongoose's isValid(), which also accepts any 12-byte string -- so a
 * 12-character slug like "dark-knight1" passes it and then silently queries for
 * a nonsense id. This is the same shape the Postgres side enforces on
 * encore_shows.content_id, so the two databases agree on what an id looks like.
 */
const OBJECT_ID = /^[0-9a-f]{24}$/;

/** Clamps rather than rejects: a limit of 1000 is a request to be capped. */
function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function isMongoUnavailable(err: unknown): boolean {
  const name = (err as { name?: string }).name ?? "";
  return (
    name === "MongoNotConnectedError" ||
    name === "MongooseServerSelectionError" ||
    name === "MongoNetworkError"
  );
}

/**
 * GET /api/content
 * ?type=movie|event  ?category=<event category>  ?page=1  ?limit=20
 */
export async function listContent(req: Request, res: Response) {
  const { type, category } = req.query;

  // Reject unknown filter values rather than returning an empty list. A typo'd
  // ?type=movies otherwise looks like "there are no movies".
  if (type !== undefined && !CONTENT_TYPES.includes(type as ContentType)) {
    return res.status(400).json({
      error: `Unknown type '${String(type)}'. Expected one of: ${CONTENT_TYPES.join(", ")}.`,
    });
  }
  if (category !== undefined && !EVENT_CATEGORIES.includes(category as EventCategory)) {
    return res.status(400).json({
      error: `Unknown category '${String(category)}'. Expected one of: ${EVENT_CATEGORIES.join(", ")}.`,
    });
  }

  const page = parsePositiveInt(req.query.page, 1, Number.MAX_SAFE_INTEGER);
  const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);

  const filter: Record<string, unknown> = {};
  if (type) filter.type = type;
  // category exists only on the event discriminator; combining it with
  // type=movie is legal and simply matches nothing.
  if (category) filter.category = category;

  try {
    const [items, total] = await Promise.all([
      ContentModel.find(filter)
        .select("-__v")
        // Matches the { type: 1, createdAt: -1 } index when type is filtered.
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ContentModel.countDocuments(filter),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const body: Paginated<unknown> = {
      items,
      pagination: { page, limit, total, totalPages, hasMore: page < totalPages },
    };
    return res.json(body);
  } catch (err) {
    if (isMongoUnavailable(err)) {
      console.error("[content] catalog unavailable:", err);
      return res.status(503).json({ error: "Catalog temporarily unavailable" });
    }
    console.error("[content] list failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/** GET /api/content/:id */
export async function getContentById(req: Request, res: Response) {
  const { id } = req.params;

  // Validate before querying. Handing a malformed id to Mongoose throws a
  // CastError, which without this becomes a 500 for what is really "no such
  // thing" -- a client error, not a server one.
  if (!OBJECT_ID.test(id)) {
    return res.status(404).json({ error: "Content not found" });
  }

  try {
    const item = await ContentModel.findById(id).select("-__v").lean();
    if (!item) return res.status(404).json({ error: "Content not found" });
    return res.json(item);
  } catch (err) {
    if (isMongoUnavailable(err)) {
      console.error("[content] catalog unavailable:", err);
      return res.status(503).json({ error: "Catalog temporarily unavailable" });
    }
    console.error("[content] lookup failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
