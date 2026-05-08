import { cookies } from "next/headers";

import { getViewerFromCookieHeader } from "@/lib/server/auth";
import { getBackgroundPresetClassName } from "@/lib/shared/providers";

function cookieHeaderFromStore(store: Awaited<ReturnType<typeof cookies>>) {
  return store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export default async function Page() {
  const cookieStore = await cookies();
  const viewer = getViewerFromCookieHeader(cookieHeaderFromStore(cookieStore));
  const primaryHref = viewer ? "/desktop" : "/login";
  const primaryLabel = viewer ? "Open desktop" : "Sign in";

  return (
    <main
      className="nl-landing-shell"
      style={{
        backgroundImage: getBackgroundPresetClassName(
          process.env.NEURAL_LABS_BACKGROUND_ID
        ),
      }}
    >
      <section className="nl-landing-hero">
        <div className="nl-landing-hero__copy">
          <img
            className="nl-landing-hero__mark"
            src="/brand/alshival-brain-wide.png"
            alt="Neural Labs"
          />
          <p className="nl-landing-kicker">Browser OS</p>
          <h1>Neural Labs</h1>
          <p className="nl-landing-hero__lead">
            A private AI desktop for files, terminals, conversations, and
            workspace control.
          </p>
          <div className="nl-landing-actions">
            <a className="nl-landing-button nl-landing-button--primary" href={primaryHref}>
              {primaryLabel}
            </a>
            {!viewer ? (
              <span className="nl-landing-access-note">Invite-only access</span>
            ) : null}
          </div>
        </div>

        <div className="nl-landing-preview" aria-hidden="true">
          <div className="nl-landing-preview__bar">
            <span />
            <span />
            <span />
          </div>
          <div className="nl-landing-preview__body">
            <div className="nl-landing-preview__sidebar">
              <span />
              <span />
              <span />
            </div>
            <div className="nl-landing-preview__workspace">
              <div className="nl-landing-preview__window nl-landing-preview__window--wide" />
              <div className="nl-landing-preview__window" />
              <div className="nl-landing-preview__terminal" />
            </div>
          </div>
        </div>
      </section>

      <section className="nl-landing-capabilities" aria-label="Capabilities">
        <article>
          <span>01</span>
          <h2>Desktop workspace</h2>
          <p>Open the tools you need without leaving the browser.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Files and terminal</h2>
          <p>Manage project files and run shell sessions side by side.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Neura chat</h2>
          <p>Keep AI conversations close to the work they support.</p>
        </article>
      </section>
    </main>
  );
}
