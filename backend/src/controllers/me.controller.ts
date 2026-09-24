import type { Request, Response } from "express";
import { findUserById } from "../services/userService";

/**
 * Returns the verified Firebase identity alongside the matching encore_users
 * row, so the whole chain -- client sign-in, token verification, provisioning,
 * Postgres read -- can be checked end to end with one call.
 */
export async function getMe(req: Request, res: Response) {
  if (!req.user) {
    console.error("[me] reached the handler without requireAuth");
    return res.status(500).json({ error: "Internal server error" });
  }

  // ensureUserRecord only attaches the row on the request that provisioned it,
  // so read it back when the write was skipped. See the note on that middleware.
  const record = req.userRecord ?? (await findUserById(req.user.uid));

  return res.json({
    user: req.user,
    record,
  });
}
