/** Revoke execution without deleting a former member's files or provider history. */
export async function revokeManagedMember({ userId, request, accounts, terminals }) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(userId)) throw new Error("Invalid member");
  for (const session of [...terminals.sessions.values()]) {
    if (session.ownerId === userId) terminals.destroy(session);
  }
  const agentId = "nl-" + userId.replaceAll("-", "");
  // Pause both connections before inspecting running work, including dormant
  // provider credentials that might otherwise become the fallback.
  await accounts.claude.action({ userId }, "pause");
  await accounts.openai.pause(userId);
  await accounts.openai.assignRole(userId, "unlinked");
  async function inventory(method, key, extra) {
    const rows = [];
    for (let offset = 0; offset < 10000; offset += 200) {
      const page = await request(method, { ...extra, offset, limit: 200 });
      if (!Array.isArray(page?.[key]) || typeof page.hasMore !== "boolean") throw new Error("Cannot verify member activity inventory");
      rows.push(...page[key]);
      if (!page.hasMore) return rows;
    }
    throw new Error("Member activity inventory exceeds supported limit");
  }
  const jobs = await inventory("cron.list", "jobs", { includeDisabled: true });
  for (const job of jobs) if (job.agentId === agentId && job.enabled) await request("cron.update", { id: job.id, patch: { enabled: false } });
  const sessions = await inventory("sessions.list", "sessions", { agentId });
  for (const session of sessions) await request("chat.abort", { sessionKey: session.key });
  return { revoked: true };
}
