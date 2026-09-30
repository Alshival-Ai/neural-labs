# 0042 — Guided Anthropic sign-in

Status: accepted.

Reuse the pinned native Claude CLI's `auth login` process through a private PTY
owned by the runtime. Do not register this PTY with TerminalManager. The runtime
extracts only an allowed HTTPS OAuth authorization URL; it discards its bounded
transient output before accepting a code and never retains echoed input.

Existing account operations gain `account.submit` and `account.verify`. They
carry the current attempt ID; submission additionally carries one bounded code.
Status returns stage, expiry, safe failure category, and the pending URL to the
initiating member only. All mutating account operations require the personal
owner or a shared/Team/background administrator. The original authority is
renewed during login and verification; replacement, expiry and revocation stop
the old process. Sign-in counts as active maintenance work.

Successful login loads the native catalog and performs one tools-disabled CLI
request against an empty workspace. No automatic retry occurs. Only explicit
verification retry performs another request. Persist safe health metadata in
the existing native metadata table, bound to the connection generation. No
control-plane schema migration is needed. Authentication failures persist until
new sign-in and verification succeed. Historical failed turns are projected into
safe reconnect messages rather than replayed or rewritten.

Codes and authorization URLs are not audit data. Provider errors become stable
categories; never render arbitrary provider error output. Keep OpenAI device
login and its existing terminal capability separate from the Anthropic path.

Validate synthetic attempts, member/admin authorization, stale callbacks,
credential generation changes, native protocol compatibility, and actual pinned
CLI URL extraction on the target architecture. A live owner sign-in and reply
remain required product acceptance; never substitute health checks for them.
