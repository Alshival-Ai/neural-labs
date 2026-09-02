# Manual Microsoft Entra app setup

Microsoft integration is optional. Neural Labs does not call Microsoft Graph to
create or mutate an app registration; an Entra administrator performs these
steps manually and then places the resulting values in the ignored root `.env`.

Use one single-tenant app registration for the Neural Labs web login and MCP
API. Replace `https://neural-labs.example.com` with the instance's final HTTPS
origin. Decide that origin before configuring Codex because the MCP URL affects
its generated callback.

## 1. Create the registration

In **Microsoft Entra admin center → App registrations**, create a registration
for accounts in this organizational directory only. Record:

- Directory (tenant) ID;
- Application (client) ID.

Do not put either value in a public example file even though they are not
passwords; deployment-specific identifiers still belong in instance state.

## 2. Add the web redirect

Under **Authentication → Web**, add exactly:

```text
https://neural-labs.example.com/auth/microsoft/callback
```

Do not enable implicit ID-token or access-token grants. Neural Labs uses the
authorization-code flow, PKCE, state, and nonce.

## 3. Create the confidential-client credential

Choose one method:

### Certificate (preferred)

Create a certificate and keep its private key on the Neural Labs host. Upload
only the public certificate under **Certificates & secrets → Certificates**.
The Neural Labs credential must be a PEM bundle containing that certificate and
the matching private key. Protect the bundle with mode `0600`, encode it into
the root `.env`, then remove the staging copy when it is no longer needed.

If the source is a PFX file, create a temporary PEM bundle with OpenSSL:

```bash
openssl pkcs12 -in neural-labs.pfx -clcerts -nodes -out neural-labs-credential.pem
chmod 0600 neural-labs-credential.pem
openssl base64 -A -in neural-labs-credential.pem
```

Place the single-line output in `AZURE_CLIENT_CERTIFICATE_BASE64`. That value
and the original PEM contain private-key material and must be handled as
secrets.

### Client secret

Create a client secret under **Certificates & secrets → Client secrets** and
copy its value immediately into `AZURE_CLIENT_SECRET` in the root `.env`; do not
store it in Git or a shell profile. Record its expiry in the operator's secret-management
system so it can be rotated before expiration.

## 4. Expose the MCP API

Under **Expose an API**:

1. Set the Application ID URI to `api://<application-client-id>`.
2. Add a delegated scope named `mcp.access`.
3. Enable the scope for admins and users, or require administrator consent if
   that matches the tenant's policy.

The resulting full scope is:

```text
api://<application-client-id>/mcp.access
```

Neural Labs validates the tenant, issuer, audience, Microsoft signature,
expiration, client, and this delegated `scp` value. If the tenant issues v1
access tokens for the custom API, set the app manifest's requested access-token
version to 2.

## 5. Add the Codex public-client callback

Once `https://neural-labs.example.com/mcp` is reachable, register the server in
Codex using the final URL and the same app client ID:

```bash
codex mcp add neural-labs \
  --url https://neural-labs.example.com/mcp \
  --oauth-client-id <application-client-id>
```

Codex prints an OAuth callback URL derived from the server registration. Add
that exact URL under **Authentication → Mobile and desktop applications** and
enable public-client flows. Preserve the entire callback path. For an HTTP
`127.0.0.1` URI, Entra may require editing the application manifest rather than
using the portal text box.

Then authenticate and verify the connection:

```bash
codex mcp login neural-labs
codex mcp list
```

Use the MCP `whoami` tool to confirm the expected tenant and identity.

The callback behavior and client-registration requirements are documented in
[OpenAI's official MCP OAuth guide](https://learn.chatgpt.com/docs/extend/mcp?surface=app#app-__codexlocalizedvalueprops__codextranslations-u0069-oauth-client-registration-and-callbacks).

## 6. Complete Neural Labs configuration

Set the final public origin, intended administrator email, tenant ID, client ID,
authority host (`https://login.microsoftonline.com` for the public cloud), and
one credential in the root `.env`. Enable the desired Microsoft provider
switches and run `bin/neural-labs up`. Microsoft buttons appear automatically
when an effective credential exists and Microsoft web login is enabled.

After the first administrator signs in, rotate credentials and provider switches
from the administrator-only Settings app inside `/workspace`. Saved
configuration overrides environment fallback values.
