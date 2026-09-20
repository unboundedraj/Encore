export interface Seat {
  id: string;
  showId: string;
  row: string;
  number: number;
  category: "regular" | "premium" | "vip";
  price: number;
  status: "available" | "locked" | "booked";
}
