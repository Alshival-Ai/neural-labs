import type {
  IdentityRecord,
  ProviderAvailability,
  UserRecord,
} from "./types.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(title: string, body: string, options: { actor?: UserRecord } = {}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>${escapeHtml(title)} · Neural Labs</title>
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" href="/assets/brand/neural-labs-favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/control-assets/control.css?v=1">
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="/"><img src="/assets/brand/neural-labs-mark.webp" alt=""><span>Neural Labs</span></a>
        <nav>
          <a href="https://github.com/Alshival-Ai/neural-labs" target="_blank" rel="noreferrer">GitHub ↗</a>
          ${options.actor ? `<a href="/account">${escapeHtml(options.actor.displayName)}</a>` : ""}
        </nav>
      </header>
      ${body}
    </div>
  </body>
</html>`;
}

function notice(message?: string, type: "error" | "success" = "error"): string {
  return message
    ? `<div class="notice notice-${type}" role="status">${escapeHtml(message)}</div>`
    : "";
}

export function setupView(input: {
  publicOrigin?: string | undefined;
  environmentMicrosoft: boolean;
  tenantId?: string | undefined;
  clientId?: string | undefined;
  authorityHost: string;
  localAuthEnabled: boolean;
  microsoftAuthEnabled: boolean;
  microsoftMcpEnabled: boolean;
  error?: string | undefined;
}): string {
  return layout(
    "Set up your instance",
    `<main class="page auth-grid">
      <section>
        <p class="eyebrow">First-run onboarding</p>
        <h1>Make this deployment yours.</h1>
        <p>Configure the public address and the sign-in methods your team can use. Complete this page over a loopback connection before exposing the deployment through Nginx.</p>
        <p><a href="https://github.com/Alshival-Ai/neural-labs/blob/main/wiki/entra-app-setup.md" target="_blank" rel="noreferrer">Microsoft Entra setup guide ↗</a></p>
      </section>
      <section class="card">
        <form class="stack" method="post" action="/setup" enctype="multipart/form-data">
          ${notice(input.error)}
          <div class="field"><label for="public_origin">Public origin</label><input id="public_origin" name="public_origin" type="url" required placeholder="https://neural-labs.example.com" value="${escapeHtml(input.publicOrigin ?? "")}"><span class="hint">HTTPS origin only; do not include a path.</span></div>
          <label class="check"><input name="local_enabled" type="checkbox" ${input.localAuthEnabled ? "checked" : ""}><span>Enable local email and password authentication</span></label>
          <label class="check"><input name="microsoft_enabled" type="checkbox" ${input.microsoftAuthEnabled ? "checked" : ""}><span>Enable Sign in with Microsoft</span></label>
          <label class="check"><input name="mcp_enabled" type="checkbox" ${input.microsoftMcpEnabled ? "checked" : ""}><span>Enable Microsoft-authenticated MCP after setup</span></label>
          ${input.environmentMicrosoft ? `<div class="notice notice-success">Complete Microsoft credentials were detected in the root .env file. Leave credential fields empty to use that configuration.</div>` : ""}
          <details ${input.environmentMicrosoft || input.microsoftAuthEnabled || input.microsoftMcpEnabled ? "open" : ""}>
            <summary>Microsoft Entra configuration</summary>
            <div class="stack space-top">
              <div class="field"><label for="tenant_id">Tenant ID</label><input id="tenant_id" name="tenant_id" type="text" autocomplete="off" value="${escapeHtml(input.tenantId ?? "")}"></div>
              <div class="field"><label for="client_id">Application (client) ID</label><input id="client_id" name="client_id" type="text" autocomplete="off" value="${escapeHtml(input.clientId ?? "")}"></div>
              <div class="field"><label for="authority_host">Authority host</label><input id="authority_host" name="authority_host" type="url" value="${escapeHtml(input.authorityHost)}"></div>
              <div class="field"><label for="client_secret">Client secret</label><input id="client_secret" name="client_secret" type="password" autocomplete="new-password"><span class="hint">Use either a client secret or a PEM upload, never both.</span></div>
              <div class="field"><label for="certificate">Certificate credential PEM</label><input id="certificate" name="certificate" type="file" accept=".pem,application/x-pem-file"></div>
              <div class="field"><label for="certificate_passphrase">PEM passphrase, if encrypted</label><input id="certificate_passphrase" name="certificate_passphrase" type="password" autocomplete="new-password"></div>
            </div>
          </details>
          <button class="button button-primary" type="submit">Save configuration</button>
        </form>
      </section>
    </main>`,
  );
}

export function loginView(input: {
  providers: ProviderAvailability;
  error?: string | undefined;
  success?: string | undefined;
}): string {
  const local = input.providers.local.enabled
    ? `<form class="stack" method="post" action="/api/auth/local/login">
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="button button-primary" type="submit">Log in</button>
        <p class="hint">Need an account? <a href="/signup">Request access</a>.</p>
      </form>`
    : "";
  const microsoft = input.providers.microsoft.enabled
    ? `${local ? '<div class="divider">or</div>' : ""}<a class="button microsoft-button" href="/auth/microsoft" aria-label="Sign in with Microsoft"><img src="/assets/icons/ms-symbollockup_signin_light_short.svg" alt="Sign in with Microsoft"></a>`
    : "";
  return layout(
    "Log in",
    `<main class="page auth-grid">
      <section><p class="eyebrow">Private AI desktop</p><h1>Return to your workspace.</h1><p>Authenticate with a provider enabled by your Neural Labs administrator.</p></section>
      <section class="card stack">
        <div><h2>Log in</h2><p>Continue to your Neural Labs deployment.</p></div>
        ${notice(input.error)}${notice(input.success, "success")}
        ${local}${microsoft || (!local ? '<div class="notice notice-error">No authentication provider is currently available.</div>' : "")}
      </section>
    </main>`,
  );
}

export function signupView(input: { error?: string | undefined }): string {
  return layout(
    "Request access",
    `<main class="page auth-grid">
      <section><p class="eyebrow">Local account</p><h1>Request access.</h1><p>The first account becomes the instance administrator. Later accounts remain pending until an administrator approves them.</p></section>
      <section class="card"><form class="stack" method="post" action="/api/auth/local/signup">
        ${notice(input.error)}
        <div class="field"><label for="display_name">Display name</label><input id="display_name" name="display_name" type="text" maxlength="120" required></div>
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><span class="hint">Use at least 12 characters.</span></div>
        <button class="button button-primary" type="submit">Create account</button>
        <p class="hint"><a href="/login">Return to login</a></p>
      </form></section>
    </main>`,
  );
}

export function pendingView(user: UserRecord, csrf: string): string {
  return layout(
    "Approval pending",
    `<main class="page auth-grid">
      <section><p class="eyebrow">Account received</p><h1>Approval pending.</h1><p>Your identity is registered, but an administrator must approve it before workspace access is available.</p></section>
      <section class="card stack"><h2>${escapeHtml(user.displayName)}</h2><p>${escapeHtml(user.email)}</p><span class="pill pill-pending">Pending</span>
        <form method="post" action="/api/auth/logout"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button button-secondary" type="submit">Log out</button></form>
      </section>
    </main>`,
    { actor: user },
  );
}

export function accountView(input: {
  user: UserRecord;
  identities: IdentityRecord[];
  csrf: string;
  microsoftAvailable: boolean;
  error?: string | undefined;
  success?: string | undefined;
}): string {
  const providerNames = new Set(input.identities.map((identity) => identity.provider));
  return layout(
    "Account",
    `<main class="page"><div class="dashboard-header"><div><p class="eyebrow">Account</p><h1>${escapeHtml(input.user.displayName)}</h1><p>${escapeHtml(input.user.email)}</p></div></div>
      <div class="dashboard-grid">
        <section class="card span-7 stack"><h2>Linked identities</h2>${notice(input.error)}${notice(input.success, "success")}
          ${[...providerNames].map((provider) => `<div class="notice"><strong>${escapeHtml(provider)}</strong> identity linked</div>`).join("")}
          ${input.microsoftAvailable && !providerNames.has("microsoft") ? `<a class="button button-secondary" href="/auth/microsoft?intent=link">Link Microsoft identity</a>` : ""}
          ${!providerNames.has("local") ? `<form class="stack" method="post" action="/api/account/identities/local"><input type="hidden" name="_csrf" value="${escapeHtml(input.csrf)}"><div class="field"><label for="local_password">Add a local password</label><input id="local_password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></div><button class="button button-secondary" type="submit">Link local login</button></form>` : ""}
        </section>
        <section class="card span-5 stack"><h2>Workspace</h2><p>Open the shared Neural Labs desktop to work with Neura, files, and administrator settings.</p><a class="button button-primary" href="/workspace">Open workspace</a>
          <form method="post" action="/api/auth/logout"><input type="hidden" name="_csrf" value="${escapeHtml(input.csrf)}"><button class="button button-secondary" type="submit">Log out</button></form>
        </section>
      </div>
    </main>`,
    { actor: input.user },
  );
}

export function errorView(status: number, title: string, message: string): string {
  return layout(
    title,
    `<main class="page auth-grid"><section><p class="eyebrow">${escapeHtml(status)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="button button-secondary" href="/">Return home</a></section></main>`,
  );
}
