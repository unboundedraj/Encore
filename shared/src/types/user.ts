/** Row in the Postgres `encore_users` table. `id` is the Firebase UID. */
export interface User {
  id: string;
  email: string;
  /** Null until the user sets a display name; Firebase does not require one. */
  name: string | null;
  created_at: string;
}
