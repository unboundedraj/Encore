/**
 * Provisioning the local `encore_users` row for a Firebase identity.
 *
 * Firebase is the source of truth for who someone is. Postgres needs a row for
 * them anyway, because encore_bookings.user_id is a foreign key to
 * encore_users.id -- a booking cannot be written for a user who does not exist
 * locally.
 */

import type { User } from "shared";
import { supabase } from "../config/supabase";

export class MissingEmailError extends Error {
  constructor() {
    super("Firebase identity has no email address");
    this.name = "MissingEmailError";
  }
}

export class EmailConflictError extends Error {
  constructor() {
    super("Email already belongs to a different account");
    this.name = "EmailConflictError";
  }
}

export interface IdentityForProvisioning {
  uid: string;
  email: string | null;
  name: string | null;
}

/**
 * Creates the user's row, or refreshes it if it already exists.
 *
 * The upsert overwrites email and name from the token on purpose: Firebase owns
 * identity, so if someone changes their email there we want Postgres to follow.
 * Worth revisiting if Encore ever grows a profile editor -- at that point a
 * locally-edited display name would be clobbered on the next request, and name
 * would need to move out of this write.
 */
export async function upsertUserFromIdentity(
  identity: IdentityForProvisioning
): Promise<User> {
  if (!identity.email) {
    // encore_users.email is NOT NULL with a CHECK that it contains '@'. Firebase
    // identities are not guaranteed to have one (phone-number sign-in, for
    // example), so this is a real case rather than a defensive branch. Fail
    // loudly instead of inventing a placeholder that would defeat the CHECK.
    throw new MissingEmailError();
  }

  const { data, error } = await supabase
    .from("encore_users")
    .upsert(
      { id: identity.uid, email: identity.email, name: identity.name },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    // 23505 on the email index means a *different* uid already holds this
    // address. Distinguishable from a generic failure, and not retryable.
    if (error.code === "23505") throw new EmailConflictError();
    throw new Error(`Failed to provision user: ${error.message}`);
  }

  return data as User;
}

export async function findUserById(uid: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("encore_users")
    .select()
    .eq("id", uid)
    .maybeSingle();

  if (error) throw new Error(`Failed to load user: ${error.message}`);
  return (data as User) ?? null;
}
