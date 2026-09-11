# ADR 0032: Restrict the workspace OpenAI API key to audio

- Status: Accepted
- Date: 2026-09-10
- Supersedes ADR 0023's workspace API credential import decision

The shared workspace OpenAI API key funds realtime voice and recorded voice-memo
transcription only. Neura text conversations, Team Chat and automations use the
ChatGPT account belonging to their assigned agent. A missing or exhausted account
must not fall back to the shared API key.

Startup removes the legacy `openai:neural-labs-workspace-api` profile from main's
native credential store before starting the Gateway, and no longer imports the
audio key. Failure to inspect or retire that profile prevents Gateway startup.
Text subprocess environments continue to omit `OPENAI_API_KEY`; the server-side
voice service retains it. Removing the native profile does not revoke the key at
the provider or change audio settings.

VS Code must also launch with the sanitized text environment: its extension
hosts and integrated terminals otherwise inherit the audio key from the server.
The 2026-09-11 audit found this remaining inheritance path. Applying the startup
fix requires restarting the workspace to replace processes that already hold
the key; editing the environment of future children does not clear live ones.

Personal agents retain their owner-bound OAuth order. Team Chat retains its
dedicated-account or creator-account routing. Automations use their assigned
agent's account; jobs assigned to main use the background account, not automatically
the person who last edited them. This change does not copy developer credentials,
reassign jobs, change schedules or connect a missing Team account.

Existing deployments require an explicit operator application of the updated
startup files and native credential retirement. Account metadata and retirement
are verified without printing credentials or placing tenant state in the repo.
