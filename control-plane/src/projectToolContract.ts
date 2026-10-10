import { z } from "zod";
import contract from "./project-tools.v1.json" with { type: "json" };

export const projectTools = contract.tools;
export const projectToolSchemas = new Map(projectTools.map(tool =>
  [tool.name, z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0])]));
export const projectOutputSchemas = new Map(projectTools.map(tool =>
  [tool.name, z.fromJSONSchema(tool.outputSchema as Parameters<typeof z.fromJSONSchema>[0])]));
export function projectToolError(status: number) {
  const errors: Record<number, [string, string]> = {
    401: ['unauthorized', 'Current authentication is required.'],
    403: ['forbidden', 'Project operation is not permitted.'],
    404: ['not_found', 'Project item is unavailable.'],
    409: ['conflict', 'Project changed; reread before retrying.'],
    422: ['invalid_arguments', 'Check the project arguments and current revision.'],
    423: ['paused', 'Project changes are paused.'],
    503: ['unavailable', 'Project service is temporarily unavailable.'],
  };
  const [code, message] = errors[status] ?? errors[503]!;
  return { error: { code, message, status: errors[status] ? status : 503 } };
}
export function parseProjectTool(name: string, input: unknown): Record<string, unknown> {
  const schema = projectToolSchemas.get(name);
  if (!schema) throw new Error("Unknown project tool");
  return schema.parse(input) as Record<string, unknown>;
}
