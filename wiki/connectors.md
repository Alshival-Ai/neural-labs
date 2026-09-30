# Email and SMS connectors

**Settings → Connectors** gives the workspace agent one existing Gmail or
Outlook mailbox and one existing Twilio number. Administrators configure the
connections. Each member verifies their address/phone and chooses whether to
receive conversations and proactive updates. Only active, verified, opted-in
workspace members can participate. Outside recipients are not supported.

## Connect the workspace agent

1. Connect a workspace account in **Settings → Model Provider**.
2. In **Connectors → Workspace agent**, choose that connection, load models,
   choose a model, and select **Use for messaging**.
3. Configure email and/or SMS below. Incoming messages use this workspace
   connection even when everyone is signed out. Personal accounts are not used
   as a fallback. Replies run through native Codex or Claude Code with workspace
   command access and no individual command approvals.

## Gmail

The installation operator first creates a Google OAuth web application:

1. Enable the Gmail API in Google Cloud and configure the OAuth consent screen.
2. Register the **exact redirect URL displayed in the Gmail card**, typically
   `https://YOUR-INSTANCE/api/connectors/oauth/gmail/callback`.
3. Configure Gmail read-only and send scopes. Configure permitted test users
   while testing, or complete Google's required publication/verification process
   for the intended audience. Development consent and token expiry limitations
   are controlled by Google.
4. Save the client ID and client secret under **OAuth application setup**.
5. Select **Connect**, sign in to the mailbox account in the new tab, and grant
   access. Return to Connectors to see the connected address.

Provider reference: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## Outlook

Register an application in Microsoft Entra with a Web redirect matching the
Outlook card, typically
`https://YOUR-INSTANCE/api/connectors/oauth/outlook/callback`. Support the account
types that will sign in, and add delegated **User.Read**, **Mail.Read**,
**Mail.Send**, and **offline_access**. Save the application client ID and secret
in the card, then connect and consent as the mailbox owner. Organization policy
may require tenant administrator consent. This connection is separate from
Microsoft sign-in and any existing application-only notification credentials.
Delegated Exchange shared mailboxes are not supported in this version.

Provider reference: [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

Only one mailbox is active. Connecting another provider requires confirmation
and replaces the active mailbox; history remains. Initial connection establishes
a baseline without replying to old mail. Subsequent inbox changes are polled
approximately once a minute. Reconnection establishes a new baseline. Replies
are addressed directly to the verified member; Outlook replies may form a new
provider-side thread. Neural Labs retains its own conversation thread.

## Twilio SMS

1. Use an existing Twilio account and an SMS-capable number. Enter Account SID
   and Auth Token, select **Load my numbers**, and choose the sender number.
   You can also enter the number directly in international format.
2. Save the connection. It starts paused.
3. Select **Configure webhooks** to set that number's incoming SMS URL and POST
   method. This changes the incoming handler for that number; use a number
   dedicated to this workspace. Alternatively, enter the displayed incoming
   webhook manually in Twilio Console.
4. Select **Enable SMS**. Neural Labs verifies the number's incoming webhook
   before enabling it. Outbound requests include the displayed delivery callback
   automatically; no separate phone-number voice callback is needed.

The public HTTPS callback must reach `/webhooks/twilio/sms` and
`/webhooks/twilio/sms/status`. The control plane verifies Twilio's signature
against the exact configured external URL. Reverse proxies must preserve
`X-Twilio-Signature` and form fields. Set `SMS_WEBHOOK_ORIGIN` when that external
origin differs from the instance origin. Local-only installations need a stable
public HTTPS ingress to receive SMS; localhost alone cannot receive Twilio
callbacks. Hosted workspace callbacks use the workspace DNS/TLS and do not
require enabling public access for deployed websites.

Messages are text-only; MMS, attachments, voice, number purchasing, and account
creation are outside this release. Proactive SMS is limited to 1600 characters.
Long automatic replies are shortened with an explicit notice. Twilio/carrier
billing, sender registration, and account restrictions still apply.

## Member setup and privacy

- Select **Verify my email**, enter the emailed code, then enable email
  conversations and updates.
- Verify your phone in **Settings → Security**, enable **Agent SMS updates** in
  Personalization, then enable SMS conversations in Connectors.
- Text STOP to opt out of SMS. START removes the provider opt-out; the member's
  own channel preference must still be enabled. Unknown senders are ignored.
- **Alshival → Email & SMS** shows only the current member's messages and delivery
  status. A shared mailbox/number does not grant members access to one another's
  private history in Neural Labs. People with direct access to the provider
  mailbox/account can still see provider-side communications.
- Agents work in the shared workspace. Files deliberately written there are
  shared workspace content; private conversation storage is separate.

Enabling a channel permits automatic replies and proactive messages, including
from automations. The `workspace_messages` agent tool accepts a workspace member
ID or handle, a channel, text, and a stable request UUID. It never accepts an
arbitrary destination address or phone number. Reuse the UUID when checking or
retrying the same request. Read-only agent sessions cannot send messages.

## Check and recover

**Send a connection test** sends one real message to a verified opted-in member.
No message is sent merely by opening Settings or saving credentials. Reply to
the test and check your private history for the agent response.

- **Held:** no delivery occurred, or execution needs attention. Reconnect the
  provider/model or restore member opt-in. Incoming messages that never started
  may be resumed from the history view.
- **Accepted/sent:** the provider accepted the request; it is not proof the member
  read it. SMS delivery callbacks can advance the status to delivered or failed.
- **Unknown:** a request may have reached the provider/runtime before an
  interruption. Do not blindly resend. An operator must inspect the provider
  record or native turn before deciding how to recover it.
- **Reconnect required/cursor expired:** reconnect the mailbox. Old mail is not
  replayed automatically. Provider outages use delayed polling.

Provider secrets are encrypted in the control plane and are never supplied to
agent tools. Disconnecting stops new processing and retains history. Pausing or
changing connector settings revokes active connector grants and holds stale
queued deliveries. Production acceptance requires actual provider consent and
an owner-triggered test; fixture tests do not establish live provider readiness.
