import type { AICommand, AIResponse, AIResult, AIState } from "../../app/types.ts";

export async function runAIController(input: string | AICommand | AICommand[], options: {
  requestId: string;
  parsePrompt: (prompt: string) => AICommand;
  execute: (command: AICommand) => Promise<AIResult>;
  nextFrame: () => Promise<void>;
  getState: () => AIState;
  publish: (response: AIResponse) => void;
}): Promise<AIResponse> {
  let parsed: string | AICommand | AICommand[] = input;
  if (typeof input === "string" && /^[\s]*[\[{]/.test(input)) parsed = JSON.parse(input) as AICommand | AICommand[];
  const commands = typeof parsed === "string" ? [options.parsePrompt(parsed)] : Array.isArray(parsed) ? parsed : [parsed];
  const results: AIResult[] = [];
  for (const command of commands) {
    results.push(await options.execute(command));
    await options.nextFrame();
  }
  const state = options.getState();
  const response: AIResponse = { type: "forma:response", requestId: options.requestId, ok: results.every((result) => result.ok), results, state, artifact: state.artifact };
  options.publish(response);
  return response;
}
