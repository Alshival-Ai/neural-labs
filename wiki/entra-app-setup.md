# Enable Microsoft sign-in

Microsoft integration is optional. Neural Labs does not call Microsoft Graph to
create or mutate an app registration; an Entra administrator performs these
steps manually and then places the resulting values in the ignored root `.env`.

Use a single-tenant app registration for Neural Labs web login. Replace
`https://neural-labs.example.com` with the instance's final HTTPS origin.
Personal deployments can keep local email/password login and skip this guide.

Public MCP is disabled. You do not need to expose an API, add an `mcp.access`
scope, enable public-client flows, or register a Codex callback for web sign-in.
The retained [future public MCP reference](mcp-entra-oauth.md) is separate.

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

## 4. Complete Neural Labs configuration

Set the final public origin, intended administrator email, tenant ID, client ID,
authority host (`https://login.microsoftonline.com` for the public cloud), and
one credential in the root `.env`. Set `NEURAL_LABS_MICROSOFT_AUTH_ENABLED=true`, keep
`NEURAL_LABS_MCP_ENABLED=false`, and run `bin/neural-labs up` for an initial
installation. On an already configured instance, use **Settings → Authentication**
to save the credential and enable Microsoft: saved settings override `.env`. Microsoft buttons appear automatically
when an effective credential exists and Microsoft web login is enabled.

After the first administrator signs in, rotate credentials and provider switches
from the administrator-only Settings app inside `/workspace`. Saved
configuration overrides environment fallback values.

## 5. Verify sign-in before changing local access

Open `/login` in a separate browser session and choose Microsoft. Confirm the
expected tenant and approved Neural Labs identity. The configured initial
administrator email controls first-account claiming for Microsoft too; other
new users remain pending until approved.

Existing local users should link Microsoft from **Settings → Security** while
signed in. Matching email addresses do not automatically merge identities. Keep
local login available until an active administrator has linked and tested
Microsoft. You can then enroll a [passkey](passkeys.md).
