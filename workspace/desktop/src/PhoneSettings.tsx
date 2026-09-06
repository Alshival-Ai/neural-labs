import { Phone, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { settingsMutationHeaders, settingsRequest } from "./settingsApi";
import "./phone-settings.css";

export type PhoneStatus = {
  available: boolean;
  notificationsEnabled: boolean;
  phoneNumber: string | null;
  verifiedAt: string | null;
  pending: {
    phoneNumber: string;
    challengeId: string;
    expiresAt: string;
    attemptsRemaining: number;
    deliveryAccepted: boolean;
  } | null;
  resendAt: string | null;
};

export function PhoneSettings({ csrfToken }: { csrfToken: string }) {
  const id = useId();
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const requestId = useRef(0);
  const inFlight = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    const current = ++requestId.current;
    setError("");
    try {
      const next = await settingsRequest<PhoneStatus>("/api/account/phone");
      if (current === requestId.current) setStatus(next);
    } catch (cause) {
      if (current === requestId.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load phone settings.",
        );
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (status?.pending) codeInput.current?.focus();
  }, [status?.pending?.challengeId]);
  const pending = status?.pending;
  const resendSeconds = Math.max(
    0,
    Math.ceil(
      ((status?.resendAt ? Date.parse(status.resendAt) : 0) - now) / 1000,
    ),
  );
  const expired = Boolean(pending && Date.parse(pending.expiresAt) <= now);
  const locked = Boolean(pending && pending.attemptsRemaining === 0);

  async function mutate(
    action: "request" | "verify" | "cancel" | "remove",
    body?: object,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = ++requestId.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await settingsRequest<PhoneStatus>(
        action === "remove"
          ? "/api/account/phone"
          : `/api/account/phone/${action}`,
        {
          method: action === "remove" ? "DELETE" : "POST",
          headers: settingsMutationHeaders(csrfToken),
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      if (current !== requestId.current) return;
      setStatus(next);
      setNow(Date.now());
      setCode("");
      setConfirmRemove(false);
      setNotice(
        {
          request:
            "Verification SMS requested. Enter the code when it arrives.",
          verify: "Phone number verified.",
          cancel: "Verification canceled.",
          remove: "Phone number removed.",
        }[action],
      );
      if (action !== "request") {
        setEditing(false);
        setConsent(false);
        setNumber("");
      }
    } catch (cause) {
      if (current !== requestId.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update phone settings.",
      );
      // Refresh remaining attempts/cooldown after failures without hiding the error.
      try {
        const next = await settingsRequest<PhoneStatus>("/api/account/phone");
        if (current === requestId.current) {
          setStatus(next);
          setNow(Date.now());
        }
      } catch {
        /* Keep the last known state and actionable error. */
      }
    } finally {
      inFlight.current = false;
      if (current === requestId.current) setBusy(false);
    }
  }

  async function setNotifications(enabled: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await settingsRequest<PhoneStatus>("/api/account/phone/notifications", {
        method: "PUT",
        headers: settingsMutationHeaders(csrfToken),
        body: JSON.stringify({ enabled }),
      });
      setStatus(next);
      setNotice(enabled ? "Neura may now send you requested SMS/MMS updates." : "Agent SMS/MMS updates disabled.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update SMS notifications.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  return (
    <section
      className="settings-card user-settings-card phone-settings"
      aria-label="Phone number"
      aria-busy={busy}
    >
      <div className="user-settings-card__heading">
        <div>
          <span>Contact</span>
          <h3>Phone number</h3>
          <p>
            A private contact number on your profile. This does not enable phone
            sign-in or account recovery.
          </p>
        </div>
        <Phone aria-hidden="true" />
      </div>
      {error && (
        <p className="phone-settings__error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!status ? (
        error ? (
          <button type="button" onClick={() => void refresh()}>
            Retry phone settings
          </button>
        ) : (
          <p role="status">Loading phone settings…</p>
        )
      ) : (
        <>
          {!status.available && (
            <p role="status">
              SMS verification is not configured. Contact your administrator to
              enable it.
            </p>
          )}
          {status.phoneNumber && (
            <>
              <div className="phone-settings__verified">
                <strong>{status.phoneNumber}</strong>
                <span><ShieldCheck aria-hidden="true" />Verified</span>
              </div>
              {!pending && !editing && !confirmRemove && <label className="phone-settings__notification-toggle">
                <span><strong>Agent SMS/MMS updates</strong><small>Allow Neura to send this number updates you explicitly request, including automation completion messages. Off by default.</small></span>
                <input type="checkbox" checked={status.notificationsEnabled} disabled={busy || !status.available} onChange={(event) => void setNotifications(event.target.checked)} />
              </label>}
            </>
          )}
          {pending ? (
            <div className="phone-settings__pending">
              <p>
                Verify <strong>{pending.phoneNumber}</strong>.{" "}
                {status.phoneNumber &&
                  "Your current verified number stays in place until this number is verified."}
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    !expired &&
                    !locked &&
                    pending.deliveryAccepted &&
                    /^\d{6}$/.test(code)
                  )
                    void mutate("verify", {
                      challengeId: pending.challengeId,
                      code,
                    });
                }}
              >
                <label htmlFor={`${id}-code`}>
                  Six-digit verification code
                </label>
                <input
                  ref={codeInput}
                  id={`${id}-code`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  disabled={
                    busy || expired || locked || !pending.deliveryAccepted
                  }
                  aria-describedby={`${id}-code-help`}
                />
                <p id={`${id}-code-help`}>
                  {expired
                    ? "This code has expired. Request a new code."
                    : locked
                      ? "No attempts remaining. Request a new code."
                      : !pending.deliveryAccepted
                        ? "This request has not been accepted for delivery. Cancel and try again."
                        : `The code expires in 10 minutes. ${pending.attemptsRemaining} attempts remaining.`}
                </p>
                <div className="phone-settings__actions">
                  <button
                    disabled={
                      busy ||
                      expired ||
                      locked ||
                      !pending.deliveryAccepted ||
                      code.length !== 6
                    }
                  >
                    Verify number
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || resendSeconds > 0 || !status.available}
                    onClick={() =>
                      void mutate("request", {
                        phoneNumber: pending.phoneNumber,
                        consent: true,
                      })
                    }
                  >
                    {resendSeconds > 0
                      ? `Resend in ${resendSeconds}s`
                      : "Resend code"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void mutate("cancel", {
                        challengeId: pending.challengeId,
                      })
                    }
                  >
                    Cancel verification
                  </button>
                </div>
              </form>
            </div>
          ) : !status.phoneNumber || editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (consent && status.available && !resendSeconds)
                  void mutate("request", { phoneNumber: number, consent });
              }}
            >
              <label htmlFor={`${id}-number`}>
                {status.phoneNumber ? "New phone number" : "Phone number"}
              </label>
              <input
                id={`${id}-number`}
                type="tel"
                autoComplete="tel"
                placeholder="+1 202 555 0123"
                maxLength={64}
                required
                value={number}
                disabled={busy || !status.available}
                onChange={(event) => setNumber(event.target.value)}
                aria-describedby={`${id}-number-help`}
              />
              <p id={`${id}-number-help`}>
                Include your country code, starting with +.{" "}
                {status.phoneNumber &&
                  "Your current number stays verified until the replacement is confirmed."}
              </p>
              <label className="phone-settings__consent">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy || !status.available}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  Send me an SMS to verify this number. Message and data rates
                  may apply. This does not subscribe me to marketing messages.
                </span>
              </label>
              <div className="phone-settings__actions">
                <button
                  disabled={
                    busy ||
                    !status.available ||
                    !number.trim() ||
                    !consent ||
                    resendSeconds > 0
                  }
                >
                  {busy
                    ? "Sending…"
                    : resendSeconds > 0
                      ? `Send in ${resendSeconds}s`
                      : "Send verification code"}
                </button>
                {editing && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditing(false);
                      setConsent(false);
                      setError("");
                    }}
                  >
                    Cancel change
                  </button>
                )}
              </div>
            </form>
          ) : confirmRemove ? (
            <div>
              <p>Remove {status.phoneNumber} from your profile?</p>
              <div className="phone-settings__actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void mutate("remove")}
                >
                  Confirm removal
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirmRemove(false)}
                >
                  Keep number
                </button>
              </div>
            </div>
          ) : (
            <div className="phone-settings__actions">
              <button
                type="button"
                disabled={!status.available}
                onClick={() => {
                  setEditing(true);
                  setNumber("");
                  setNotice("");
                }}
              >
                Change number
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setConfirmRemove(true);
                  setNotice("");
                }}
              >
                Remove number
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
