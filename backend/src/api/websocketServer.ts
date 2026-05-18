import { WebSocketServer, WebSocket } from "ws";
import { env } from "../config/env.js";
import { systemState } from "../state/systemState.js";
import type { WsMessage } from "../types/index.js";

let wss: WebSocketServer | null = null;
let broadcastTimer: ReturnType<typeof setInterval> | null = null;

function send(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg: WsMessage): void {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

export function startWebSocketServer(): void {
  wss = new WebSocketServer({ port: env.WS_PORT });

  wss.on("connection", (ws) => {
    send(ws, {
      v: 1,
      type: "market.state",
      ts: new Date().toISOString(),
      payload: systemState.getSnapshot(),
    });
  });

  broadcastTimer = setInterval(() => {
    const snap = systemState.getSnapshot();
    broadcast({
      v: 1,
      type: "market.state",
      ts: new Date().toISOString(),
      payload: snap,
    });
  }, 1000);

  console.log(`[ws] listening on :${env.WS_PORT}`);
}

export function stopWebSocketServer(): void {
  if (broadcastTimer) clearInterval(broadcastTimer);
  wss?.close();
  wss = null;
}
