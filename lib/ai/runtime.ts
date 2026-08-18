import type { AICommand, AIEnvelope, AIResponse } from "../../app/types.ts";
import type { FormaAIBridge } from "./contracts.ts";

type RuntimeChannel = { onmessage: ((event: MessageEvent<AIEnvelope>) => void) | null; postMessage: (response: AIResponse) => void; close: () => void };

export function installFormaAITransports(options: {
  target: Window;
  bridge: FormaAIBridge;
  run: (input: string | AICommand | AICommand[], requestId?: string) => Promise<AIResponse>;
  makeId: () => string;
  createChannel: () => RuntimeChannel | null;
}) {
  const receiveCommand = (event: Event) => {
    const detail = (event as CustomEvent<AICommand | AICommand[] | AIEnvelope | string>).detail;
    if (typeof detail === "string") void options.bridge.command(detail);
    else if (Array.isArray(detail)) void options.bridge.batch(detail);
    else if (typeof detail === "object" && detail !== null && "type" in detail && detail.type === "forma:command") {
      const envelope = detail as AIEnvelope;
      void options.bridge.run(envelope.commands ?? envelope.command ?? "");
    }
    else if (typeof detail === "object" && detail !== null && "action" in detail && detail.action) void options.bridge.execute(detail);
  };
  const receiveMessage = (event: MessageEvent<AIEnvelope>) => {
    if (event.source !== options.target || event.origin !== options.target.location.origin || event.data?.type !== "forma:command") return;
    const requestId = event.data.requestId ?? options.makeId();
    void options.run(event.data.commands ?? event.data.command ?? "", requestId).then((response) => options.target.postMessage(response, options.target.location.origin));
  };
  const channel = options.createChannel();
  if (channel) channel.onmessage = (event: MessageEvent<AIEnvelope>) => {
    if (event.data?.type !== "forma:command") return;
    void options.run(event.data.commands ?? event.data.command ?? "", event.data.requestId ?? options.makeId()).then((response) => channel.postMessage(response));
  };
  options.target.addEventListener("forma:command", receiveCommand);
  options.target.addEventListener("message", receiveMessage as EventListener);
  return () => { options.target.removeEventListener("forma:command", receiveCommand); options.target.removeEventListener("message", receiveMessage as EventListener); channel?.close(); };
}
