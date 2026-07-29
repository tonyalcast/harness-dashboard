import type { Server } from "bun";

export type SseClient = {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  filterKey: string;
};

const clients = new Map<string, SseClient>();
const enc = new TextEncoder();

export function addSseClient(
  filterKey: string,
): { stream: ReadableStream; id: string } {
  const id = crypto.randomUUID();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      clients.set(id, { id, controller, filterKey });
      controller.enqueue(enc.encode(`event: hello\ndata: ${JSON.stringify({ id })}\n\n`));
    },
    cancel() {
      clients.delete(id);
    },
  });
  return { stream, id };
}

export function setClientFilter(id: string, filterKey: string) {
  const c = clients.get(id);
  if (c) c.filterKey = filterKey;
}

export function broadcast(event: string, data: unknown) {
  const payload = enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const [, c] of clients) {
    try {
      c.controller.enqueue(payload);
    } catch {
      clients.delete(c.id);
    }
  }
}

export function heartbeat() {
  const payload = enc.encode(`: ping ${Date.now()}\n\n`);
  for (const [, c] of clients) {
    try {
      c.controller.enqueue(payload);
    } catch {
      clients.delete(c.id);
    }
  }
}

export function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export function clientCount() {
  return clients.size;
}

void (null as unknown as Server);
