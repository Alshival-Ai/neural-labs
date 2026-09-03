# Passkeys

Neural Labs supports passkey login for accounts that have already authenticated
with Microsoft. A passkey is an additional sign-in method for the same approved
account; it cannot create an account, bypass approval, reactivate a disabled
account, or change a role.

## Create a passkey

1. Sign in with Microsoft, or link Microsoft under **Settings →
   Personalization → Sign-in methods**.
2. In the Passkeys row, name the device or credential and select **Create
   passkey**.
3. Complete the browser or operating-system prompt using the device unlock,
   fingerprint, face, PIN, security key, or cross-device flow it offers.

After verification succeeds, Personalization immediately adds the passkey to
the list, shows its localized creation date and time, and reconciles the list
with the server. Other open Personalization windows in the same desktop update
from the same account-change signal. A manual browser refresh is not required.

On later visits, select **Use a passkey** on the Neural Labs login page. The
passkey is discoverable, so an email address is not required first.

Passkeys require a WebAuthn-capable browser and the deployment's configured
HTTPS public origin. The relying-party ID is the public hostname. Moving the
deployment to another hostname requires signing in with Microsoft and creating
new passkeys for that hostname.

## Security and stored data

The authenticator retains the private key. Neural Labs stores only the public
credential, signature counter, transport and backup hints, a user-provided
label, and timestamps in PostgreSQL. Registration and authentication require
user verification. One-use ceremony challenges expire after five minutes.

Users can remove registered passkeys from Personalization. Removal prevents
future Neural Labs login with that credential, but the browser or platform may
still show its local copy until the user removes it from their credential
manager.
