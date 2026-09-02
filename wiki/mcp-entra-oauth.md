# Microsoft Entra OAuth setup for the MCP server

> Future public mode: this implementation is retained for a later, separately
> reviewed public MCP release. V1 deliberately returns `404` for public MCP
> and OAuth routes. Do not follow this runbook to enable ingress on a V1 host.

This runbook explains how Codex signs in with Microsoft and connects to the Streamable HTTP MCP endpoint in `mcp/`.

## Architecture

Microsoft Entra authenticates users and signs the access tokens. The MCP process is the protected resource server and also exposes a narrow OAuth metadata façade at `/oauth/authorize` and `/oauth/token`.

In the supported Compose deployment, the control plane owns Entra onboarding
and sends MCP only public tenant, client, scope, audience, authority, and URL
values through an internal bearer-authenticated endpoint. Disabling MCP in the
administrator UI causes the MCP listener to return `503`; re-enabling or
rotating public configuration is picked up without copying credentials between
containers.

The façade exists because Entra supports PKCE but its OpenID discovery document does not currently advertise `code_challenge_methods_supported: ["S256"]`; Codex requires that discovery field for MCP OAuth. The façade advertises OAuth 2.1 + PKCE, validates the exact client, loopback callback, resource, and least-privilege scope, and forwards authorization-code or refresh-token operations to the tenant-specific Entra endpoints. It does not issue tokens, retain sessions, accept client secrets, or use the application certificate.

For Entra, resource selection is expressed by the delegated scope rather than an RFC 8707 URL audience. The façade requires Codex's `resource` value to equal `MCP_PUBLIC_URL`, maps it to the fixed `MCP_OAUTH_SCOPE`, and the MCP resource server then verifies Microsoft's signature plus tenant, issuer, client, audience, expiry, and `scp` claim before invoking a tool.

Codex is a public OAuth client using authorization code with PKCE. It cannot safely hold an application secret or certificate. The certificate configured through the root `.env` authenticates the Neural Labs web application's confidential OIDC token exchange; it is never used or received by Codex or MCP.

## Environment variables

Standalone MCP development can use the variables below. The managed Compose
deployment obtains the corresponding public values from the control plane. Do
not copy real values into Git, Compose files, command history, or tickets.

| Variable | Required | Meaning |
|---|---:|---|
| `AZURE_CLIENT_ID` | yes | Entra application (client) ID. Also the default v2 access-token audience. |
| `AZURE_TENANT_ID` | yes | The only Entra tenant accepted by this single-tenant server. |
| `MCP_PUBLIC_URL` | yes | Canonical endpoint, including its path, such as `https://mcp.example.com/mcp`. Production must use HTTPS. |
| `AZURE_AUTHORITY_HOST` | no | Defaults to `https://login.microsoftonline.com`. Use an alternate Microsoft cloud authority only deliberately. |
| `MCP_OAUTH_SCOPE` | no | Full delegated scope requested from Entra. Defaults to `api://$AZURE_CLIENT_ID/mcp.access`. |
| `MCP_REQUIRED_SCOPE` | no | Value expected in the token's `scp` claim. Defaults to `mcp.access`. |
| `MCP_TOKEN_AUDIENCE` | no | Expected `aud` claim. Defaults to `AZURE_CLIENT_ID`, which is correct for Entra v2 access tokens issued to this API. |
| `MCP_HOST` | no | Listener address; defaults to `127.0.0.1`. Use `0.0.0.0` only behind reviewed authenticated ingress or a container boundary. |
| `MCP_PORT` | no | Listener port; defaults to `3000`. |
| `MCP_ALLOWED_HOSTS` | no | Comma-separated Host-header allowlist. Defaults to the public hostname plus local development hosts. |
| `MCP_ALLOWED_ORIGINS` | no | Optional comma-separated browser Origin-host allowlist. Non-browser MCP clients normally send no Origin header. |

Managed mode uses these additional values:

| Variable | Required | Meaning |
|---|---:|---|
| `MCP_CONTROL_PLANE_CONFIG_URL` | yes | Internal control-plane config endpoint. HTTP is acceptable only on the private container network. |
| `MCP_CONFIG_TOKEN_FILE` | yes | File containing the shared high-entropy internal bearer token. |
| `MCP_CONFIG_POLL_INTERVAL_MS` | no | Reload interval from 5 seconds to 5 minutes; defaults to 30 seconds. |

Use the root `.env.example` only as a public field-name reference. Its identifiers and secrets are obvious placeholders.

## Configure the Entra app registration

The app registration must be single-tenant and serve as the Neural Labs web
client, the API resource, and Codex's pre-registered public client. Follow the
complete [manual Entra app setup](entra-app-setup.md).

1. Under **Expose an API**, set the Application ID URI to `api://<AZURE_CLIENT_ID>`.
2. Add an enabled delegated permission named `mcp.access`. Allow the intended tenant users or administrators to consent according to organizational policy.
3. Under **Authentication**, configure a **Mobile and desktop applications** public-client redirect URI. Do not guess it yet; Codex calculates a callback ID from the final MCP URL.
4. Keep implicit grant disabled. The flow uses authorization code plus PKCE (`S256`).
5. Do not add a client secret to Codex. The web credential remains encrypted in
   the control plane and is unrelated to Codex's public-client flow.

If different scope names or an Application ID URI other than `api://<client-id>` are chosen, set `MCP_OAUTH_SCOPE`, `MCP_REQUIRED_SCOPE`, and, when necessary, `MCP_TOKEN_AUDIENCE` to exactly match the registration.

## Install and run locally

```bash
cd mcp
npm ci

export MCP_PUBLIC_URL=http://127.0.0.1:3000/mcp
npm run dev
```

`AZURE_CLIENT_ID` and `AZURE_TENANT_ID` must already be in the environment. Plain HTTP is accepted only for loopback development. Check the public metadata without authenticating:

```bash
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS http://127.0.0.1:3000/.well-known/oauth-protected-resource/mcp
```

## Connect Codex

Use the final MCP URL because Codex derives the callback ID from the complete URL, including path and query string.

```bash
codex mcp add neural-labs \
  --url "$MCP_PUBLIC_URL" \
  --oauth-client-id "$AZURE_CLIENT_ID"
```

Codex prints an `OAuth callback URL`. Register that exact URI in the Entra app's public-client redirect URI list. Entra does not currently advertise the issuer-bound authorization-response behavior required for Codex's shared callback, so expect a server-specific path similar to:

```text
http://127.0.0.1/callback/<callback-id>
```

For an HTTP `127.0.0.1` redirect, the Entra portal may require editing the application manifest rather than the normal redirect-URI text box. Preserve the complete path. Codex inserts the temporary listener port during login.

After registering the callback:

```bash
codex mcp login neural-labs
codex mcp list
```

Complete Microsoft sign-in in the browser. Then use the MCP `whoami` tool to verify the tenant and user identity returned by the validated access token.

## Production checklist

- Put the exact HTTPS endpoint in `MCP_PUBLIC_URL`; changing it changes Codex's callback ID.
- Terminate TLS at reviewed ingress and forward the MCP endpoint, both OAuth façade endpoints, and both `/.well-known/` discovery paths. Expose health only where operations require it.
- Set an explicit Host allowlist and keep the process unprivileged.
- Load environment values from a protected service environment file or secret manager, not the repository.
- Confirm the Entra token is v2 and that its `aud` and `scp` values match this API.
- Test unauthenticated requests return `401` with a `resource_metadata` challenge.
- Test tokens from another tenant, another audience, an expired token, and a token without `mcp.access` are rejected.
- Rotate Microsoft signing keys automatically through the advertised JWKS; never pin one signing certificate in this repository.

## Troubleshooting

- `invalid_client` or redirect mismatch: rerun `codex mcp add` with the final URL and register the exact callback it prints.
- `AADSTS65001` or consent errors: grant the delegated API permission to the user/client according to tenant policy.
- `invalid_scope`: compare `MCP_OAUTH_SCOPE` with the full scope under **Expose an API**.
- MCP `401 invalid_token`: verify issuer, v2 token format, tenant ID, and audience; do not use a Microsoft Graph token for this API.
- MCP `403 insufficient_scope`: confirm the access token's `scp` claim contains `MCP_REQUIRED_SCOPE`, then re-run `codex mcp login neural-labs`.
- Metadata discovery failure: confirm `MCP_PUBLIC_URL` is externally reachable and that `/.well-known/oauth-protected-resource/<mcp-path>` is not blocked by ingress.

## References

- [OpenAI: connect Codex to MCP with OAuth](https://learn.chatgpt.com/docs/extend/mcp?surface=app#app-__codexlocalizedvalueprops__codextranslations-u0069-oauth-client-registration-and-callbacks)
- [OpenAI: authenticate plugin MCP servers](https://developers.openai.com/plugins/build/auth)
- [Microsoft: expose a web API and delegated scope](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-expose-web-apis)
- [Microsoft: validate access tokens](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens)
- [Microsoft: redirect URI limitations](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)
