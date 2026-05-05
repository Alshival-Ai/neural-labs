import { notFound, redirect } from "next/navigation";

import { PasswordResetPanel } from "@/components/auth/password-reset-panel";
import {
  getPasswordResetPreview,
  getViewerFromCookieHeader,
} from "@/lib/server/auth";
import { cookies } from "next/headers";

function cookieHeaderFromStore(store: Awaited<ReturnType<typeof cookies>>) {
  return store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export default async function PasswordResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const cookieStore = await cookies();
  const viewer = getViewerFromCookieHeader(cookieHeaderFromStore(cookieStore));
  if (viewer) {
    redirect("/desktop");
  }

  const { token } = await params;
  try {
    return <PasswordResetPanel token={token} reset={getPasswordResetPreview(token)} />;
  } catch {
    notFound();
  }
}
