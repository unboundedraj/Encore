import express, { Router } from "express";
import { handleStripeWebhook } from "../controllers/webhook.controller";

/**
 * Mounted at /api/webhooks, and mounted BEFORE the global express.json() in
 * index.ts.
 *
 * Stripe signs the exact bytes it sent. Once express.json() has parsed and
 * discarded the raw body, re-serialising it does not reliably reproduce those
 * bytes -- key order and whitespace are not guaranteed to survive -- so every
 * signature check would fail. express.raw here keeps req.body as a Buffer.
 *
 * The raw parser is scoped to this router rather than applied globally,
 * because every other route wants parsed JSON.
 */
const router = Router();

router.post("/stripe", express.raw({ type: "application/json" }), handleStripeWebhook);

export default router;
