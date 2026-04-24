import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getViewerFromCookieHeader } from "@/lib/server/auth";

function cookieHeaderFromStore(store: Awaited<ReturnType<typeof cookies>>) {
  return store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export default async function Page() {
  const cookieStore = await cookies();
  const viewer = getViewerFromCookieHeader(cookieHeaderFromStore(cookieStore));
  redirect(viewer ? "/desktop" : "/login");
}
