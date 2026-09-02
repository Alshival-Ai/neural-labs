import type { SessionRow } from "./types";

type SessionTarget = {
  key: string;
  agentId: "main";
  expectedSessionId?: string;
};

export type SessionDeletionPlan = {
  archive?: SessionTarget & { archived: true };
  remove: SessionTarget & { deleteTranscript: true; archivedOnly: true };
};

export function buildSessionDeletionPlan(session: SessionRow): SessionDeletionPlan {
  const target: SessionTarget = {
    key: session.key,
    agentId: "main",
    ...(session.sessionId ? { expectedSessionId: session.sessionId } : {}),
  };

  return {
    ...(!session.archived ? { archive: { ...target, archived: true as const } } : {}),
    remove: {
      ...target,
      deleteTranscript: true,
      archivedOnly: true,
    },
  };
}
