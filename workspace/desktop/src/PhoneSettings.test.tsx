import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhoneSettings, type PhoneStatus } from "./PhoneSettings";

const empty: PhoneStatus = {
  available: true,
  notificationsEnabled: false,
  phoneNumber: null,
  verifiedAt: null,
  pending: null,
  resendAt: null,
};
const pending = (): PhoneStatus => ({
  ...empty,
  pending: {
    phoneNumber: "+12025550123",
    challengeId: "11111111-1111-4111-8111-111111111111",
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    attemptsRemaining: 5,
    deliveryAccepted: true,
  },
  resendAt: new Date(Date.now() + 60000).toISOString(),
});
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("profile phone settings", () => {
  it("requests consent, sends a code, supports autofill and shows a verified badge", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(empty))
      .mockResolvedValueOnce(json(pending()))
      .mockResolvedValueOnce(
        json({
          ...empty,
          phoneNumber: "+12025550123",
          verifiedAt: new Date().toISOString(),
        }),
      );
    render(<PhoneSettings csrfToken="csrf-test" />);
    const number = await screen.findByLabelText("Phone number", {
      selector: "input",
    });
    fireEvent.change(number, { target: { value: "+1 202 555 0123" } });
    expect(
      screen.getByRole("button", { name: "Send verification code" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    const code = await screen.findByLabelText("Six-digit verification code");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveFocus();
    expect(screen.getByRole("button", { name: /Resend in/ })).toBeDisabled();
    const options = fetch.mock.calls[1]![1]!;
    expect(new Headers(options.headers).get("X-CSRF-Token")).toBe("csrf-test");
    expect(JSON.parse(String(options.body))).toEqual({
      phoneNumber: "+1 202 555 0123",
      consent: true,
    });
    fireEvent.change(code, { target: { value: "000123" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify number" }));
    expect(await screen.findByText("Verified")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change number" }),
    ).toBeInTheDocument();
  });
  it("preserves a verified number during changes and confirms removal", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        json({
          ...empty,
          phoneNumber: "+12025550120",
          verifiedAt: new Date().toISOString(),
        }),
      )
      .mockResolvedValueOnce(json(empty));
    render(<PhoneSettings csrfToken="csrf" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Change number" }),
    );
    expect(screen.getByText("+12025550120")).toBeInTheDocument();
    expect(screen.getByLabelText("New phone number")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel change" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove number" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep number" }));
    expect(screen.getByText("Verified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove number" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    expect(
      await screen.findByText("Phone number removed."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });
  it("restores pending verification after reopening and reports failed attempts", async () => {
    const initial = pending();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(initial))
      .mockResolvedValueOnce(
        json({ error: { message: "The code is incorrect." } }, 422),
      )
      .mockResolvedValueOnce(
        json({
          ...initial,
          pending: { ...initial.pending, attemptsRemaining: 4 },
        }),
      );
    render(<PhoneSettings csrfToken="csrf" />);
    const code = await screen.findByLabelText("Six-digit verification code");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify number" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The code is incorrect.",
    );
    await waitFor(() =>
      expect(screen.getByText(/4 attempts remaining/)).toBeInTheDocument(),
    );
  });
  it.each(["expired", "locked"])(
    "disables unusable %s codes but allows resend and cancel",
    async (state) => {
      const value = pending();
      value.resendAt = null;
      if (state === "expired")
        value.pending!.expiresAt = new Date(Date.now() - 1).toISOString();
      else value.pending!.attemptsRemaining = 0;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(json(value));
      render(<PhoneSettings csrfToken="csrf" />);
      expect(
        await screen.findByLabelText("Six-digit verification code"),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Verify number" }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "Cancel verification" }),
      ).toBeEnabled();
    },
  );
  it("explains unavailable SMS configuration and recovers from load failures", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(json({ ...empty, available: false }));
    render(<PhoneSettings csrfToken="csrf" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry phone settings" }),
    );
    expect(
      await screen.findByText(/SMS verification is not configured/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send verification code" }),
    ).toBeDisabled();
  });
});
