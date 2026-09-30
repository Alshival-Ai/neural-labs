import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
export type DeploymentAdapter = (input: Record<string, unknown>) => Promise<unknown>;
export function registerDeploymentTools(server: McpServer, deployments?: DeploymentAdapter) {
  if (!deployments) return;
  server.registerTool('deployments', {
    description: 'Publish and manage persistent workspace websites and HTTP apps. Read hosting first. Deploy only when the user requests publication. Public apps need configured wildcard DNS/TLS and enabled web access; otherwise hosting uses host loopback. Build/start commands execute in an isolated project snapshot without provider credentials. Updates retain the URL and switch only after readiness. Logs may contain app-generated private data. Never publish the whole workspace.',
    inputSchema: z.object({
      action: z.enum(['hosting','list','status','logs','deploy','start','restart','stop','remove']),
      name: z.string().max(63).optional(), project: z.string().max(1024).optional(),
      kind: z.enum(['static','server']).optional(), output: z.string().max(1024).optional(),
      build: z.string().max(4096).optional(), start: z.string().max(4096).optional(),
    }).strict(),
  }, async input => ({ content: [{ type: 'text', text: JSON.stringify(await deployments(input)) }] }));
}
