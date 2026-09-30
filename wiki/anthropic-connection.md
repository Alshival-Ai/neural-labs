# Connect Anthropic

In **Settings → Model Provider**, choose **Connect Anthropic**. Anthropic opens
in another tab. Complete sign-in there, then paste the returned **sign-in code**
into the Anthropic card and press **Connect**. If the tab did not open, use
**Open Anthropic**. Terminal is not required.

The card loads models and sends one tiny request using your account to verify
that Claude can reply. This uses a small amount of provider usage. It has no
tools, skills, MCP servers, external delivery, or workspace files. On success,
your existing available model is retained or the default available model is
selected. Choose **Open Alshival** to return to chat.

Administrators use the same flow for shared, Team, and background connections
under **Advanced connections**. Connecting verifies that account; it does not
change another workload's selected connection. Other members cannot submit
codes or cancel an administrator's sign-in.

## Reconnect and retry

If Anthropic revokes or expires access, chat and Settings show **Reconnect
Anthropic**. Existing credential files alone do not clear that warning. Complete
sign-in again; your conversations are retained. **Retry message** restores the
failed text to the composer for review and sending. It never automatically
replays a turn or its commands.

Usage limits, unavailable models, and temporary provider problems offer a
connection-check retry instead of requesting another sign-in. Verification runs
once after login; page refresh and status polling do not consume repeated test
requests. A sign-in attempt expires after ten minutes. Cancel or start again to
replace it. Reloading Settings resumes a still-active attempt owned by you.

The native CLI stores credentials only in the selected connection's isolated
account home. Sign-in codes are never placed in chat, browser storage, audit
records, or Terminal history. See [the architecture decision](adr/0042-guided-anthropic-sign-in.md).
