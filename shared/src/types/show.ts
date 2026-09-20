export interface Show {
  id: string;
  contentType: "movie" | "event";
  contentId: string;
  venueId: string;
  screenOrStage: string;
  startTime: string;
  endTime: string;
  basePrice: number;
}
