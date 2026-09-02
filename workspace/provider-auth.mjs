import { spawn } from "node:child_process";

const LOGIN_COMMAND = "openclaw models auth login --provider openai --device-code --set-default";
const LOGIN_TIMEOUT_MS = 16 * 60 * 1000;
const MAX_OUTPUT_BUFFER = 64 * 1024;

function stripTerminalControl(value) {
  return String(value ?? "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\x1b[()][A-Z0-9]/gu, "")
    .replace(/\r/gu, "\n")
    .replace(/[^\t\n\x20-\x7e]/gu, "");
}

export function parseOpenAIDeviceCode(value) {
  const clean = stripTerminalControl(value);
  const verificationUrl = clean.match(/URL:\s*(https:\/\/[^\s]+)/iu)?.[1];
  const userCode = clean.match(/Code:\s*([A-Z0-9][A-Z0-9-]{3,31})/u)?.[1];
  const expiresInMinutes = Number(clean.match(/Code expires in\s+(\d+)\s+minutes?/iu)?.[1]);
  if (!verificationUrl || !userCode) return null;
  return {
    verificationUrl,
    userCode,
    expiresInMinutes:
      Number.isInteger(expiresInMinutes) && expiresInMinutes > 0 ? expiresInMinutes : 15,
  };
}

function defaultSpawn() {
  return spawn("script", ["-qefc", LOGIN_COMMAND, "/dev/null"], {
    detached: true,
    env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function safeBoolean(check) {
  try {
    return Boolean(check());
  } catch {
    return false;
  }
}

function publicMessage(value) {
  const clean = stripTerminalControl(value);
  if (/device code.{0,80}(disabled|not enabled|unavailable)/isu.test(clean)) {
    return "Enable device-code login in your ChatGPT security or workspace settings, then try again.";
  }
  if (/expired|expiration/iu.test(clean)) return "The OpenAI device code expired. Request a new code.";
  if (/network|fetch failed|connect|timed? out/iu.test(clean)) {
    return "The workspace could not reach OpenAI. Check outbound network access and try again.";
  }
  return "OpenAI sign-in did not complete. Try again.";
}

export function createProviderAuthController({
  providerAuthenticated,
  modelReady,
  spawnLogin = defaultSpawn,
  now = () => Date.now(),
  loginTimeoutMs = LOGIN_TIMEOUT_MS,
} = {}) {
  if (typeof providerAuthenticated !== "function" || typeof modelReady !== "function") {
    throw new Error("Provider authentication checks are required");
  }

  let child;
  let timeout;
  let output = "";
  let cancelled = false;
  let state = {
    state: safeBoolean(providerAuthenticated) ? "connected" : "disconnected",
    verificationUrl: null,
    userCode: null,
    expiresAt: null,
    message: null,
  };

  function snapshot() {
    const authenticated = safeBoolean(providerAuthenticated);
    const ready = safeBoolean(modelReady);
    if (!child && authenticated && state.state !== "connected") {
      state = {
        state: "connected",
        verificationUrl: null,
        userCode: null,
        expiresAt: null,
        message: null,
      };
    } else if (!child && !authenticated && state.state === "connected") {
      state = {
        state: "disconnected",
        verificationUrl: null,
        userCode: null,
        expiresAt: null,
        message: null,
      };
    }
    return {
      provider: "openai",
      authMethod: "chatgpt",
      ...state,
      authenticated,
      modelReady: ready,
    };
  }

  function clearProcess() {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    child = undefined;
  }

  function stopProcess(signal = "SIGTERM") {
    if (!child?.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // The login process already exited.
      }
    }
  }

  function receive(chunk) {
    output = `${output}${String(chunk)}`.slice(-MAX_OUTPUT_BUFFER);
    const parsed = parseOpenAIDeviceCode(output);
    if (!parsed || state.userCode) return;
    state = {
      state: "awaiting_user",
      verificationUrl: parsed.verificationUrl,
      userCode: parsed.userCode,
      expiresAt: new Date(now() + parsed.expiresInMinutes * 60_000).toISOString(),
      message: null,
    };
  }

  function start() {
    const current = snapshot();
    if (child || current.authenticated) return current;

    cancelled = false;
    output = "";
    state = {
      state: "starting",
      verificationUrl: null,
      userCode: null,
      expiresAt: null,
      message: null,
    };

    try {
      child = spawnLogin();
    } catch (error) {
      state = {
        state: "error",
        verificationUrl: null,
        userCode: null,
        expiresAt: null,
        message: error instanceof Error ? error.message : "OpenAI sign-in could not start.",
      };
      return snapshot();
    }

    child.stdout?.on("data", receive);
    child.stderr?.on("data", receive);
    child.once("error", (error) => {
      clearProcess();
      state = {
        state: "error",
        verificationUrl: null,
        userCode: null,
        expiresAt: null,
        message: error.message || "OpenAI sign-in could not start.",
      };
    });
    child.once("exit", (code, signal) => {
      clearProcess();
      if (cancelled) {
        state = {
          state: "disconnected",
          verificationUrl: null,
          userCode: null,
          expiresAt: null,
          message: null,
        };
        return;
      }
      const authenticated = safeBoolean(providerAuthenticated);
      if (code === 0 && authenticated) {
        state = {
          state: "connected",
          verificationUrl: null,
          userCode: null,
          expiresAt: null,
          message: null,
        };
        return;
      }
      state = {
        state: "error",
        verificationUrl: null,
        userCode: null,
        expiresAt: null,
        message:
          signal === "SIGKILL"
            ? "OpenAI sign-in expired. Request a new code."
            : publicMessage(output),
      };
    });
    timeout = setTimeout(() => {
      if (!child) return;
      stopProcess("SIGKILL");
    }, loginTimeoutMs);
    timeout.unref?.();
    return snapshot();
  }

  function cancel() {
    if (child) {
      cancelled = true;
      state = {
        state: "disconnected",
        verificationUrl: null,
        userCode: null,
        expiresAt: null,
        message: null,
      };
      stopProcess();
    } else {
      state = {
        state: safeBoolean(providerAuthenticated) ? "connected" : "disconnected",
        verificationUrl: null,
        userCode: null,
        expiresAt: null,
        message: null,
      };
    }
    return snapshot();
  }

  return { snapshot, start, cancel };
}
