export interface Booking {
  id: string;
  userId: string;
  showId: string;
  seatIds: string[];
  totalAmount: number;
  status: "pending" | "confirmed" | "cancelled";
  stripePaymentIntentId: string | null;
  createdAt: string;
}
