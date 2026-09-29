# Adopting an existing instance into a portal

This is an offline operator migration, not an alternative sign-in method.
Standalone login remains the default for independent installations. Never copy
another deployment's identity mapping or configuration.

Before adoption, upgrade through the reviewed runtime maintenance procedure,
verify the standalone database is bound to `standalone`, and prepare the target
portal's instance registration and membership. Preserve the database encryption
key, all workspace volumes, native user UUIDs and agent directories. Complete the
native migration/restore acceptance first.

Prepare a private JSON file (0600) with **every** existing user:

```json
{"users":[{"userId":"11111111-1111-4111-8111-111111111111","subject":"123","expectedEmail":"owner@example.com"}]}
```

Verify each portal subject independently against its existing native UUID. Emails
are assertions against the reviewed mapping, never automatic account linking.
All mapped subjects must currently belong to the target portal workspace.

Close ingress, pause scheduling, wait for active work to finish, stop the control
plane and retain recoverable database/volume copies. Configure the target managed
authority in a private operator process using the same database and master key.
Run the compiled control-plane command with production ingress still closed:

```sh
node dist/adoptManagedIdentityCommand.js /private/identity-map.json
node dist/adoptManagedIdentityCommand.js /private/identity-map.json --confirm
```

The first invocation validates and rolls back. The second binds the authority,
inserts explicit identity mappings, updates the instance's public origin, disables
local/Microsoft sign-in and invalidates old browser sessions in one transaction.
It never rewrites user UUIDs or credentials. A second confirmed
adoption is refused. No HTTP endpoint exposes this operation.

Start the upgraded managed control plane and verify portal handoff, session
reauthorization, revocation, preserved skills/automations, provider ownership,
history authors and background scheduling. Disable or redirect the installation's
old authentication entrypoints. Ordinary startup still refuses an unreviewed
authority change. Never restore old database state after accepting new writes;
follow the operator recovery boundary for the whole deployment.

For an existing SMS integration, set `CONTROL_PLANE_SMS_WEBHOOK_ORIGIN` to the old
HTTPS origin (private managed registration: `sms_webhook_origin`) and retain its
signed `/webhooks/twilio/sms` ingress. This preserves the provider callback and
signature URL while browser login and desktop move to the new origin. Do not
redirect provider webhook POSTs through login or forward them as browser traffic.

The private managed renderer accepts an operator-selected DNS hostname. The
portal must independently authorize the exact origin/workspace binding. When
sharing a portal origin, reserve control API and WebSocket paths explicitly,
preserve the portal's own routes, and filter identity headers and cookies at the
trusted ingress. Customer deployments should keep their separate origins.
