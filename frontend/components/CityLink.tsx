"use client";

import { persistCity } from "@/lib/city";

/**
 * A link that goes to /browse in a specific city, used wherever a page shows
 * a city as a clickable card or list item (the landing page's city grid, the
 * footer).
 *
 * Deliberately a plain <a>, not next/link's <Link>. This sets a cookie and
 * then navigates to a *different* route that shares a layout (the header)
 * with the one the click happened on -- and Next's client-side router
 * caches that shared layout's RSC payload across the navigation, so a
 * client-side Link left the header showing the old city even though the
 * cookie, and the browse page it navigated to, were both correct. A full
 * navigation re-renders everything, header included, from the cookie that
 * is now already set. CitySelector's dropdown does not have this problem --
 * it calls router.refresh() on the *same* page, which does refetch the
 * whole tree including the header; there is just no equivalent for "refresh
 * the page I am about to navigate to before I've navigated to it".
 */
export function CityLink({
  city,
  className,
  children,
}: {
  city: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a href="/browse" className={className} onClick={() => persistCity(city)}>
      {children}
    </a>
  );
}
