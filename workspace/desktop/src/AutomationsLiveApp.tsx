import { useCallback, useEffect, useRef, useState } from "react";

import { AutomationsApp, type AutomationDraft, type AutomationJob, type AutomationRunMode } from "./AutomationsApp";
import { AutomationsGateway, type AutomationsSnapshot } from "./automationsGateway";
import type { ConnectionState } from "./types";

type AutomationsLiveAppProps = {
  gateway: AutomationsGateway;
  notify?: (message: string) => void;
  workspaceName?: string;
};

export function AutomationsLiveApp({ gateway, notify, workspaceName = "Workspace" }: AutomationsLiveAppProps) {
  const [snapshot, setSnapshot] = useState<AutomationsSnapshot>({ schedulerOnline: false, jobs: [] });
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refreshInFlight = useRef<Promise<void> | undefined>(undefined);
  const connected = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const request = gateway.snapshot()
      .then((next) => {
        setSnapshot(next);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : "OpenClaw did not return automation state.";
        setError(message);
        throw reason;
      })
      .finally(() => {
        setLoading(false);
        refreshInFlight.current = undefined;
      });
    refreshInFlight.current = request;
    return request;
  }, [gateway]);

  useEffect(() => {
    let eventTimer: number | undefined;
    const unsubscribeStatus = gateway.onStatus((state, reason) => {
      connected.current = state === "connected";
      setConnection(state);
      if (state === "connected") void refresh().catch(() => undefined);
      if (state === "error" && reason) {
        setLoading(false);
        setError(reason);
      }
    });
    const unsubscribeChanges = gateway.onChanged(() => {
      window.clearTimeout(eventTimer);
      eventTimer = window.setTimeout(() => void refresh().catch(() => undefined), 250);
    });
    const interval = window.setInterval(() => {
      if (connected.current) void refresh().catch(() => undefined);
    }, 30_000);
    gateway.start();
    return () => {
      unsubscribeStatus();
      unsubscribeChanges();
      window.clearTimeout(eventTimer);
      window.clearInterval(interval);
    };
  }, [gateway, refresh]);

  const mutate = useCallback(async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation();
      await refresh();
      notify?.(success);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "OpenClaw rejected the automation change.";
      setError(message);
      notify?.(message);
      throw reason;
    }
  }, [notify, refresh]);

  const onCreate = (draft: AutomationDraft) => mutate(() => gateway.create(draft), `${draft.name.trim()} created.`);
  const onUpdate = (job: AutomationJob, draft: AutomationDraft) => mutate(() => gateway.update(job, draft), `${draft.name.trim()} updated.`);
  const onToggle = (job: AutomationJob, enabled: boolean) => mutate(() => gateway.toggle(job, enabled), `${job.name} ${enabled ? "enabled" : "paused"}.`);
  const onRun = (job: AutomationJob, mode: AutomationRunMode) => mutate(() => gateway.run(job, mode), `${job.name} was submitted to OpenClaw.`);
  const onDelete = (job: AutomationJob) => mutate(() => gateway.remove(job), `${job.name} removed.`);

  return (
    <AutomationsApp
      jobs={snapshot.jobs}
      workspaceName={workspaceName}
      schedulerOnline={connection === "connected" && snapshot.schedulerOnline}
      loading={loading || connection === "connecting"}
      error={error}
      onRefresh={() => refresh()}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onToggle={onToggle}
      onRun={onRun}
      onDelete={onDelete}
    />
  );
}
