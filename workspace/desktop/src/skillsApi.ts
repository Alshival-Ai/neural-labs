export type CustomSkillScope = "personal" | "team";

export type CustomSkill = {
  id: string;
  key: string;
  name: string;
  description: string;
  scope: CustomSkillScope;
  ownerUserId: string;
  ownerDisplayName: string;
  ownedByCurrentUser: boolean;
  editable: boolean;
  instructions: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomSkillDraft = {
  name: string;
  description: string;
  instructions: string;
  scope: CustomSkillScope;
};

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    let message = `Skill operation failed with HTTP ${response.status}`;
    try {
      const body = await response.json() as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function listCustomSkills(signal?: AbortSignal): Promise<CustomSkill[]> {
  return (await requestJson<{ skills: CustomSkill[] }>("/workspace/api/skills", { signal })).skills;
}

export async function createCustomSkill(draft: CustomSkillDraft): Promise<CustomSkill> {
  return (await requestJson<{ skill: CustomSkill }>("/workspace/api/skills", {
    method: "POST",
    body: JSON.stringify(draft),
  })).skill;
}

export async function updateCustomSkill(key: string, draft: CustomSkillDraft): Promise<CustomSkill> {
  return (await requestJson<{ skill: CustomSkill }>(`/workspace/api/skills/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify(draft),
  })).skill;
}

export async function setCustomSkillScope(key: string, scope: CustomSkillScope): Promise<CustomSkill> {
  return (await requestJson<{ skill: CustomSkill }>(`/workspace/api/skills/${encodeURIComponent(key)}/scope`, {
    method: "PUT",
    body: JSON.stringify({ scope }),
  })).skill;
}
