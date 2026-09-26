import Link from "next/link";
import { CitySelector } from "@/components/CitySelector";
import { HeaderAuth } from "@/components/HeaderAuth";
import { getSelectedCity } from "@/lib/city-server";
import { fetchCities } from "@/lib/content-api";

/**
 * Server component: it reads the city cookie and the city list during render,
 * so the correct city is in the first byte of HTML rather than appearing after
 * hydration. Only the two genuinely interactive pieces -- the picker and the
 * auth chip -- are client components.
 */
export async function SiteHeader() {
  const [city, cities] = await Promise.all([getSelectedCity(), fetchCities()]);

  return (
    <header className="sticky top-0 z-40 bg-ink-3 text-white shadow-sm">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="text-xl font-bold tracking-tight">
            en<span className="text-accent">core</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 text-sm md:flex">
          <Link href="/browse" className="rounded px-3 py-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white">
            Browse
          </Link>
          <Link href="/browse?type=movie" className="rounded px-3 py-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white">
            Movies
          </Link>
          <Link href="/browse?type=event" className="rounded px-3 py-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white">
            Events
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <CitySelector current={city} cities={cities} />
          <HeaderAuth />
        </div>
      </div>
    </header>
  );
}
