export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string;
  role: "customer" | "admin";
  createdAt: string;
}
