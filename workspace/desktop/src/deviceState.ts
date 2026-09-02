const DEVICE_STATE_PREFIX = "neural-labs.device-state.v1";

function segment(value: string): string {
  return encodeURIComponent(value.trim().slice(0, 180));
}

export function deviceStateKey(userId: string, area: string): string {
  return `${DEVICE_STATE_PREFIX}.${segment(userId)}.${segment(area)}`;
}

export function readDeviceState(userId: string | undefined, area: string): unknown {
  if (!userId) return undefined;
  try {
    const stored = localStorage.getItem(deviceStateKey(userId, area));
    return stored ? JSON.parse(stored) : undefined;
  } catch {
    return undefined;
  }
}

export function writeDeviceState(userId: string | undefined, area: string, value: unknown): void {
  if (!userId) return;
  try {
    localStorage.setItem(deviceStateKey(userId, area), JSON.stringify(value));
  } catch {
    // Private browsing policies and full storage quotas must not break the UI.
  }
}

export function removeDeviceState(userId: string | undefined, area: string): void {
  if (!userId) return;
  try { localStorage.removeItem(deviceStateKey(userId, area)); } catch { /* Storage can be unavailable. */ }
}
