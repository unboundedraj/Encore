/**
 * Client-side calls for holding, releasing and checking out a show, plus
 * reading back a booking after payment.
 *
 * Built on apiFetch (lib/api.ts), which attaches the signed-in user's
 * Firebase token -- every one of these routes requires it. Distinct from
 * lib/show-api.ts, which is the anonymous, server-side read path used during
 * SSR.
 */

import type {
  BookingDetail,
  CheckoutSession,
  GeneralHoldSuccess,
  SeatHoldSuccess,
  SeatWithStatus,
} from "shared";
import { apiFetch } from "./api";

export function holdSeats(showId: string, seatIds: string[]): Promise<SeatHoldSuccess> {
  return apiFetch<SeatHoldSuccess>(`/api/shows/${showId}/hold`, {
    method: "POST",
    body: JSON.stringify({ seatIds }),
  });
}

export function holdQuantity(showId: string, quantity: number): Promise<GeneralHoldSuccess> {
  return apiFetch<GeneralHoldSuccess>(`/api/shows/${showId}/hold`, {
    method: "POST",
    body: JSON.stringify({ quantity }),
  });
}

export function releaseSeats(showId: string, seatIds: string[]): Promise<{ released: number }> {
  return apiFetch<{ released: number }>(`/api/shows/${showId}/release`, {
    method: "POST",
    body: JSON.stringify({ seatIds }),
  });
}

export function releaseQuantity(showId: string): Promise<{ released: number }> {
  return apiFetch<{ released: number }>(`/api/shows/${showId}/release`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function checkoutSeats(showId: string, seatIds: string[]): Promise<CheckoutSession> {
  return apiFetch<CheckoutSession>(`/api/shows/${showId}/checkout`, {
    method: "POST",
    body: JSON.stringify({ seatIds }),
  });
}

export function checkoutQuantity(showId: string, quantity: number): Promise<CheckoutSession> {
  return apiFetch<CheckoutSession>(`/api/shows/${showId}/checkout`, {
    method: "POST",
    body: JSON.stringify({ quantity }),
  });
}

export function fetchBooking(bookingId: string): Promise<BookingDetail> {
  return apiFetch<BookingDetail>(`/api/bookings/${bookingId}`);
}

/**
 * The seat map, as this signed-in user, so their own holds resolve to
 * held_by_you. The server-rendered page fetches this anonymously (no request
 * carries a Firebase token during SSR), so it can never attribute a hold to
 * anybody -- a user who reloads mid-selection would otherwise see their own
 * held seats rendered as taken by a stranger. Callers use this once on mount,
 * to correct that, not as a general polling mechanism.
 */
export function fetchSeatMapAsViewer(showId: string): Promise<{ items: SeatWithStatus[] }> {
  return apiFetch<{ items: SeatWithStatus[] }>(`/api/shows/${showId}/seats`);
}
