/**
 * How far ahead the public listings look. Showtimes are scheduled further out
 * than this (see WINDOW_DAYS in data/showFixtures.ts) so the horizon is always
 * full even if the server sleeps for a while; what a person browsing sees is a
 * fortnight, the way a real booking app shows it.
 */
export const SHOWTIME_HORIZON_DAYS = 14;
