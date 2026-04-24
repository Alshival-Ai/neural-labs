import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { InviteAcceptPanel } from "@/components/auth/invite-accept-panel";
import { getInvitePreview, getViewerFromCookieHeader } from "@/lib/server/auth";

function cookieHeaderFromStore(store: Awaited<ReturnType<typeof cookies>>) {
  return store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const cookieStore = await cookies();
  const viewer = getViewerFromCookieHeader(cookieHeaderFromStore(cookieStore));
  if (viewer) {
    redirect("/desktop");
  }

  try {
    const { token } = await params;
    return <InviteAcceptPanel token={token} invite={getInvitePreview(token)} />;
  } catch (error) {
    return (
      <main className="nl-auth-shell">
        <section className="nl-auth-card">
          <div className="nl-auth-card__hero">
            <div>
              <span>Invite</span>
              <h1>Invite unavailable</h1>
              <p>{error instanceof Error ? error.message : "Invite could not be loaded."}</p>
            </div>
          </div>
          <a className="nl-auth-link" href="/login">
            Back to sign in
          </a>
        </section>
      </main>
    );
  }
}
