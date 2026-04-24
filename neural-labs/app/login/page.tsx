import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginScreen } from "@/components/auth/login-screen";
import {
  canBootstrapAdmin,
  getBootstrapAdminEmail,
  getViewerFromCookieHeader,
} from "@/lib/server/auth";

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
      canBootstrapAdmin={canBootstrapAdmin()}
      bootstrapAdminEmail={getBootstrapAdminEmail()}
    />
  );
}
