import { redirect } from "next/navigation";

/**
 * There is no separate landing page: browsing what is on in your city *is* the
 * front door of a ticketing site. Redirecting rather than duplicating the
 * listing keeps one implementation of it.
 */
export default function Home() {
  redirect("/browse");
}
