import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminPanel } from "@/components/auth/admin-panel";
import { getViewerFromCookieHeader, listInvites } from "@/lib/server/auth";

function cookieHeaderFromStore(store: Awaited<ReturnType<typeof cookies>>) {
  return store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export default async function AdminPage() {
  const cookieStore = await cookies();
  const viewer = getViewerFromCookieHeader(cookieHeaderFromStore(cookieStore));
  if (!viewer) {
    redirect("/login");
  }
  if (viewer.role !== "admin") {
    redirect("/desktop");
  }

  return <AdminPanel viewer={viewer} initialInvites={listInvites(viewer)} />;
}
