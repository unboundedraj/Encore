/** Row in the Postgres `encore_venues` table. */
export interface Venue {
  id: string;
  name: string;
  address: string;
  city: string;
  created_at: string;
}

/** Row in the Postgres `encore_screens` table. A screen belongs to exactly one venue. */
export interface Screen {
  id: string;
  venue_id: string;
  name: string;
  capacity: number;
  created_at: string;
}
