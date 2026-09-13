# AI accounts and models

Signing in to Neural Labs gives you access to the desktop. Connecting an AI
account lets Neura run requests. These are separate steps, even if you are the
only user and the administrator.

## Connect your personal account

1. Open **Settings → Model Provider**, then the **OpenAI** card.
2. Choose the connection action and wait for a verification URL and one-time code.
3. Open that URL, sign in to the ChatGPT account you intend to use, and enter
   the code. Keep Settings open until it confirms the connection.
4. Check the model status, then send a request in a private Neura conversation.

If the provider asks you to enable device-code login, follow its account
security instructions and retry with a new code. **Refresh connection** checks
account and model availability; it does not install a new runtime or resume a
paused connection. **Pause** suspends your personal agent's access while
retaining the saved account; **Resume** restores access when the credential is
still valid.

## Which account runs a request?

| Work | Account used |
|---|---|
| Private Neura conversation or a personal skill test | Your connected personal ChatGPT account |
| Manually running an AI task automation from the desktop | The person pressing Run's personal account |
| Scheduled automation | The automation's assigned agent; `main` uses the background account |
| Team Chat before dedicated Team Neura activation | The message author's personal account |
| Team Chat after dedicated Team Neura activation | The dedicated Team account, including requests from members without a personal connection |
| Neura realtime voice and voice-memo transcription | The server's `OPENAI_API_KEY`, configured separately for audio |
| `codex` run directly in a terminal | The terminal CLI's separate login cache |

A missing, paused, or unusable account does not silently fall back to another
person's account or the shared audio API key. Scheduled and manual automation
runs can overlap; the [Automations guide](automations.md) explains run behavior.

## Connect background and Team accounts

Administrators open **Settings → Workspace** to configure these separately:

- **Background ChatGPT connection** supplies the main agent used by scheduled
  AI work and background tasks. Connect it if you plan to use those features.
- **Team Neura** has its own connection and model defaults. Connect the dedicated
  account, then explicitly confirm and save the Team defaults to activate it.
  Once activated, Team Chat requires that account; a later disconnect does not
  restore the message-author fallback.
- **Voice** controls supported audio models and voice selection. Supply the
  audio API key through the protected deployment configuration and apply it
  with the normal operator update process.

Connecting a background or Team account does not connect an administrator's
personal account. Use an account authorized for the intended workspace use.

## Choose model defaults

Model Provider offers supported models and reasoning levels for your account.
Use follow-latest to track the supported recommendation for that workload, or
pin a model when you want a fixed choice. Save the selection and check that it
has applied; a pending or failed change is not an active model configuration.

A private conversation can override its agent defaults. Clearing the
conversation's override returns to the agent default. Automations may have
explicit model settings of their own. Changing your personal default does not
rewrite scheduled jobs or Team defaults.

Claude connections and arbitrary new provider connections are not available in
the current UI. A preview card is not a configured provider.

## Credential storage and recovery

OpenClaw keeps ChatGPT credentials in the persistent workspace volumes. The
browser receives connection status and the temporary login code, not OAuth
tokens. All approved developers share the workspace operating-system trust
boundary; see [Sharing and privacy](sharing-and-privacy.md).

The separate terminal CLI can be connected with
`bin/neural-labs workspace codex-login` when needed. It does not configure Neura.
For personal, background, or Team sign-in problems, start with
[Troubleshooting](troubleshooting.md#neura-will-not-answer).
