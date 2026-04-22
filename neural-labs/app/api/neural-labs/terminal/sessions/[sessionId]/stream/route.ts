import { getTerminalManager } from "@/lib/server/terminal-manager";

export const runtime = "nodejs";

const encoder = new TextEncoder();

function encodeEvent(payload: unknown) {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;
  const manager = getTerminalManager();
  const session = manager.get(sessionId);
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of session.backlog) {
        controller.enqueue(encodeEvent(chunk));
      }

      const unsubscribe = manager.subscribe(sessionId, (chunk) => {
        controller.enqueue(encodeEvent(chunk));
        if (chunk.type === "exit") {
          unsubscribe();
          controller.close();
        }
      });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      session.process.once("exit", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
