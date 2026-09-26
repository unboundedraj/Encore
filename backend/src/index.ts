import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { connectMongo } from "./config/mongodb";
import { connectRedis } from "./config/redis";
import { errorHandler } from "./middleware/errorHandler";
import bookingRoutes from "./routes/booking.routes";
import contentRoutes from "./routes/content.routes";
import healthRoutes from "./routes/health.routes";
import meRoutes from "./routes/me.routes";
import showRoutes from "./routes/show.routes";
import webhookRoutes from "./routes/webhook.routes";
import { startBookingSweep } from "./services/bookingSweep";

const app = express();

app.use(cors());

// Mounted before express.json() on purpose. Stripe signs the exact bytes it
// sent, and this router needs them intact as a Buffer -- once the JSON parser
// has consumed the stream, the original bytes cannot be reconstructed
// reliably and every signature check would fail.
app.use("/api/webhooks", webhookRoutes);

app.use(express.json());

app.use("/api/health", healthRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/shows", showRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/me", meRoutes);

app.use(errorHandler);

// Start connecting, but do not gate listening on it. If Mongo is unreachable we
// still want the process up so /api/health is answerable -- an unreachable
// database is exactly when someone needs to read the health endpoint. The
// failure is logged and surfaces there as a degraded dependency.
connectMongo().catch((err: Error) => console.error(err.message));

// Same rationale as Mongo: connect eagerly so the first request does not race
// the handshake, but do not gate listening on it. An unreachable Redis makes
// holds return 503 while browsing keeps working, which is strictly better than
// refusing to start.
connectRedis().catch((err: Error) => console.error(`[redis] ${err.message}`));

const sweep = startBookingSweep();

const server = app.listen(env.port, () => {
  console.log(`Server running on port ${env.port}`);
});

// Stop the interval on shutdown so the process can actually exit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(sweep);
    server.close(() => process.exit(0));
  });
}
