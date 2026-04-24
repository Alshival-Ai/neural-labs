import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginScreen } from "@/components/auth/login-screen";
import { getViewerFromCookieHeader } from "@/lib/server/auth";
import { getBackgroundPresetClassName } from "@/lib/shared/providers";

function cookieHeaderFromStore(store: Awaited<ReturnType<typeof cookies>>) {
  return store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export default async function LoginPage() {
  const cookieStore = await cookies();
  const viewer = getViewerFromCookieHeader(cookieHeaderFromStore(cookieStore));
  if (viewer) {
    redirect("/desktop");
  }

  return (
    <LoginScreen
      backgroundStyle={getBackgroundPresetClassName(
        process.env.NEURAL_LABS_BACKGROUND_ID
      )}
    />
  );
}
