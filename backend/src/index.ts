import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { connectMongo } from "./config/mongodb";
import { errorHandler } from "./middleware/errorHandler";
import contentRoutes from "./routes/content.routes";
import healthRoutes from "./routes/health.routes";
import meRoutes from "./routes/me.routes";
import showRoutes from "./routes/show.routes";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/health", healthRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/shows", showRoutes);
app.use("/api/me", meRoutes);

app.use(errorHandler);

// Start connecting, but do not gate listening on it. If Mongo is unreachable we
// still want the process up so /api/health is answerable -- an unreachable
// database is exactly when someone needs to read the health endpoint. The
// failure is logged and surfaces there as a degraded dependency.
connectMongo().catch((err: Error) => console.error(err.message));

app.listen(env.port, () => {
  console.log(`Server running on port ${env.port}`);
});
