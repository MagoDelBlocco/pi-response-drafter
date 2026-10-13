/**
 * Drafter model call.
 *
 * Mirrors the pattern used by the `observer` extension: a one-shot completion via
 * pi-ai's compat `complete`, with auth resolved from the running session's model
 * registry. The drafter can run on a configured model (cheaper/faster is fine for
 * a rewriting task) or fall back to the main session model.
 */

import { complete, type UserMessage } from "@earendil-works/pi-ai/compat";
import type { Api, Model, ProviderHeaders } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseDraft, type DraftResult } from "./schema";
import { SYSTEM_CONTRACT } from "./prompt";

export interface DrafterAuth {
  apiKey: string;
  /**
   * Passed through verbatim: a null value is pi-ai's instruction to *drop* a
   * default header, so this must stay `ProviderHeaders`, not `Record<string, string>`.
   */
  headers?: ProviderHeaders;
}

/**
 * Resolve the model to draft with.
 *
 * `configured` is "provider/id" or a bare "id" (first match wins), or "" to use
 * the current session model. Returns undefined if nothing usable is available.
 */
export function resolveDrafterModel(ctx: ExtensionContext, configured: string): Model<Api> | undefined {
  const id = configured.trim();
  if (!id) return ctx.model;

  const all = ctx.modelRegistry.getAll();
  if (id.includes("/")) {
    const [provider, modelId] = id.split("/", 2);
    const found = ctx.modelRegistry.find(provider, modelId);
    if (found) return found;
  }
  return all.find((m) => m.id === id) ?? ctx.model;
}

/**
 * Invoke the drafter and parse its result.
 *
 * Throws on abort (so the caller can distinguish cancellation from failure). Any
 * other failure is thrown for the caller to swallow into a raw-input fallback —
 * the extension must never block the user when it breaks (spec §15.4).
 */
export async function runDrafter(
  model: Model<Api>,
  auth: DrafterAuth,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<DraftResult> {
  const message: UserMessage = {
    role: "user",
    content: [{ type: "text", text: `${SYSTEM_CONTRACT}\n\n${userPrompt}` }],
    timestamp: Date.now(),
  };

  // Drafting wants a fast, direct answer — no chain-of-thought performance.
  // `chat_template_kwargs` is the vLLM/SGLang convention for toggling it on
  // OpenAI-compatible servers; `samplingParams` is merged into the request body
  // as-is by pi-ai's OpenAI-compatible adapters (and ignored by other APIs, so
  // this stays harmless when drafter-model points at Anthropic & co).
  const response = await complete(
    model,
    { messages: [message] },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal,
      samplingParams: { chat_template_kwargs: { enable_thinking: false } },
    },
  );

  if (response.stopReason === "aborted") {
    const err = new Error("Drafter aborted");
    err.name = "AbortError";
    throw err;
  }

  const text = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return parseDraft(text);
}
