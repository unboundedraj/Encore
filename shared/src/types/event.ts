export interface Event {
  id: string;
  title: string;
  description: string;
  category: "concert" | "sports" | "theatre" | "comedy" | "other";
  imageUrl: string;
  organizer: string;
}
