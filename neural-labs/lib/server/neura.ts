import { randomUUID } from "node:crypto";

import type {
  ConversationMessage,
  ConversationRecord,
  ConversationSummary,
  NeuraConfig,
  ProviderRecord,
} from "@/lib/shared/types";
import {
  getConversation,
  listConversations,
  readSettingsSnapshot,
  saveConversation,
} from "@/lib/server/store";

function requireDefaultProvider(providers: ProviderRecord[]): ProviderRecord {
  const provider = providers.find((entry) => entry.isDefault) ?? providers[0];
  if (!provider) {
    throw new Error("Configure a provider in Desktop Settings before using Neura.");
  }
  return provider;
}

export async function readNeuraConfig(): Promise<NeuraConfig> {
  const settings = await readSettingsSnapshot();
  const provider =
    settings.providers.find((entry) => entry.isDefault) ?? settings.providers[0] ?? null;

  return {
    assistantName: "Neura",
    defaultModel: provider?.model ?? "No model configured",
    defaultProviderName: provider?.name ?? null,
  };
}

export async function createConversation(): Promise<ConversationRecord> {
  const config = await readNeuraConfig();
  const now = new Date().toISOString();
  const summary: ConversationSummary = {
    id: randomUUID(),
    title: "New conversation",
    model: config.defaultModel,
    createdAt: now,
    updatedAt: now,
  };

  const conversation: ConversationRecord = {
    summary,
    messages: [],
  };

  return saveConversation(conversation);
}

function buildOpenAiMessages(messages: ConversationMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

async function requestOpenAiCompatible(provider: ProviderRecord, messages: ConversationMessage[]) {
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: buildOpenAiMessages(messages),
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content?.trim() || "";
}

async function requestAnthropic(provider: ProviderRecord, messages: ConversationMessage[]) {
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 1024,
      messages: buildOpenAiMessages(messages),
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return (
    payload.content
      ?.filter((entry) => entry.type === "text" && entry.text)
      .map((entry) => entry.text)
      .join("\n")
      .trim() || ""
  );
}

async function requestAzureOpenAi(provider: ProviderRecord, messages: ConversationMessage[]) {
  if (!provider.deployment) {
    throw new Error("Azure OpenAI providers require a deployment name.");
  }

  const url = new URL(
    `${provider.baseUrl.replace(/\/$/, "")}/openai/deployments/${provider.deployment}/chat/completions`
  );
  url.searchParams.set("api-version", provider.apiVersion || "2024-10-21");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": provider.apiKey,
    },
    body: JSON.stringify({
      messages: buildOpenAiMessages(messages),
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content?.trim() || "";
}

export async function generateAssistantReply(
  provider: ProviderRecord,
  messages: ConversationMessage[]
): Promise<string> {
  if (!provider.apiKey) {
    return "Add an API key in Desktop Settings to enable Neura replies.";
  }

  if (provider.kind === "anthropic") {
    return requestAnthropic(provider, messages);
  }

  if (provider.kind === "azure-openai") {
    return requestAzureOpenAi(provider, messages);
  }

  return requestOpenAiCompatible(provider, messages);
}

export async function appendConversationMessage(
  conversationId: string,
  userText: string
): Promise<ConversationRecord> {
  const existing = await getConversation(conversationId);
  if (!existing) {
    throw new Error("Conversation not found");
  }

  const settings = await readSettingsSnapshot();
  const provider = requireDefaultProvider(settings.providers);
  const now = new Date().toISOString();
  const userMessage: ConversationMessage = {
    id: randomUUID(),
    role: "user",
    content: userText.trim(),
    createdAt: now,
  };

  const draftConversation: ConversationRecord = {
    summary: {
      ...existing.summary,
      title:
        existing.messages.length === 0
          ? userText.trim().slice(0, 48) || "New conversation"
          : existing.summary.title,
      model: provider.model,
      updatedAt: now,
    },
    messages: [...existing.messages, userMessage],
  };

  const assistantText = await generateAssistantReply(provider, draftConversation.messages);
  const assistantMessage: ConversationMessage = {
    id: randomUUID(),
    role: "assistant",
    content: assistantText || "No response returned.",
    createdAt: new Date().toISOString(),
  };

  return saveConversation({
    summary: {
      ...draftConversation.summary,
      updatedAt: assistantMessage.createdAt,
    },
    messages: [...draftConversation.messages, assistantMessage],
  });
}

export async function testProviderConnection(
  provider: ProviderRecord
): Promise<{ ok: true; message: string }> {
  if (!provider.apiKey) {
    throw new Error("API key is required.");
  }

  if (provider.kind === "anthropic") {
    await requestAnthropic(provider, [
      {
        id: randomUUID(),
        role: "user",
        content: "Reply with the word ready.",
        createdAt: new Date().toISOString(),
      },
    ]);
    return { ok: true, message: "Anthropic connection looks healthy." };
  }

  if (provider.kind === "azure-openai") {
    await requestAzureOpenAi(provider, [
      {
        id: randomUUID(),
        role: "user",
        content: "Reply with the word ready.",
        createdAt: new Date().toISOString(),
      },
    ]);
    return { ok: true, message: "Azure OpenAI connection looks healthy." };
  }

  await requestOpenAiCompatible(provider, [
    {
      id: randomUUID(),
      role: "user",
      content: "Reply with the word ready.",
      createdAt: new Date().toISOString(),
    },
  ]);
  return { ok: true, message: "Provider connection looks healthy." };
}

export async function listConversationSummaries(): Promise<ConversationSummary[]> {
  const conversations = await listConversations();
  return conversations.map((conversation) => conversation.summary);
}
