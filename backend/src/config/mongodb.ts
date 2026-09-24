/**
 * MongoDB connection for the catalog.
 *
 * Mongo holds descriptive content (movies, events); Postgres holds money and
 * inventory. See backend/docs/schema.md for why the split falls where it does.
 *
 * The connection URI embeds the cluster password, so it is read from the
 * environment and never logged. The success log reports the host and database
 * name only.
 */

import mongoose from "mongoose";
import { env } from "./env";

/** Fail fast rather than hang: how long to look for a reachable server. */
const SERVER_SELECTION_TIMEOUT_MS = 8000;

/**
 * Set explicitly rather than relying on the URI's path. The connection string
 * Atlas hands out ends at `/?params`, with no database name -- and the driver
 * silently falls back to a database called `test` when the path is empty. The
 * application, not the connection string, decides where the catalog lives.
 */
const DATABASE_NAME = "encore";

let started: Promise<typeof mongoose> | null = null;
/** Distinguishes a deliberate shutdown from a dropped connection. */
let closing = false;

/** Redacts credentials so a URI can appear in an error message safely. */
export function redactUri(uri: string): string {
  return uri.replace(/\/\/[^@/]*@/, "//<credentials>@");
}

export function isMongoConnected(): boolean {
  // 1 === connected. Deliberately not used as a health signal on its own --
  // see the probe in controllers/health.controller.ts.
  return mongoose.connection.readyState === 1;
}

/**
 * Connects once and returns the same promise on subsequent calls, so importing
 * this module from several places cannot open competing connections.
 */
export function connectMongo(): Promise<typeof mongoose> {
  if (started) return started;

  const uri = env.mongodbUri;
  if (!uri) {
    // Same rule as the Supabase client: absent configuration is a
    // misconfiguration, not a degraded state, and should surface at boot.
    throw new Error(
      "Missing required environment variable MONGODB_URI. " +
        "Copy backend/.env.example to backend/.env and fill it in."
    );
  }

  mongoose.connection.on("error", (err: Error) => {
    console.error(`[mongodb] connection error: ${err.message}`);
  });
  mongoose.connection.on("disconnected", () => {
    // Silent when we asked for it -- warning on an intentional close trains
    // people to ignore the message that matters.
    if (!closing) console.warn("[mongodb] disconnected; the driver will keep retrying");
  });
  mongoose.connection.on("reconnected", () => {
    console.log("[mongodb] reconnected");
  });

  started = mongoose
    .connect(uri, {
      dbName: DATABASE_NAME,
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      // Without this, a query issued while disconnected is queued instead of
      // failing, so the health probe would hang for the whole buffering window
      // rather than reporting the database as down. The driver still retries
      // internally for serverSelectionTimeoutMS, so this does not make
      // transient blips fatal.
      bufferCommands: false,
      appName: "encore-backend",
    })
    .then((m) => {
      const { host, name } = m.connection;
      console.log(`[mongodb] connected to ${host}/${name}`);
      return m;
    })
    .catch((err: Error) => {
      // Reset so a later call can retry rather than being stuck with a
      // permanently rejected promise.
      started = null;
      throw new Error(
        `[mongodb] could not connect to ${redactUri(uri)}: ${err.message}`
      );
    });

  return started;
}

export async function disconnectMongo(): Promise<void> {
  closing = true;
  started = null;
  try {
    await mongoose.disconnect();
  } finally {
    closing = false;
  }
}
