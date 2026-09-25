import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Sign in · Encore" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      {/* AuthForm reads ?next= via useSearchParams, which needs a Suspense
          boundary or Next refuses to prerender this page. */}
      <Suspense fallback={null}>
        <AuthForm mode="signin" />
      </Suspense>
    </main>
  );
}
