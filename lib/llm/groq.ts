import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types.ts";

// All configuration is read from environment variables at construction
// time — never from client input, never hardcoded.
// GROQ_API_KEY is read here and ONLY here. It is never logged, never
// returned in a response, never passed to any other module.
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS ?? 1024);
const DEFAULT_TEMPERATURE = Number(process.env.LLM_TEMPERATURE ?? 0);
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 30_000);

export class GroqProvider implements LlmProvider {
  readonly model: string;
  private readonly apiKey: string;

  constructor() {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      throw new LlmError(
        "CONFIGURATION_ERROR",
        "GROQ_API_KEY is not set. Configure it in .env.local (server-side only)."
      );
    }
    this.apiKey = key;
    this.model = process.env.GROQ_MODEL ?? DEFAULT_MODEL;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const body = JSON.stringify({
      model: this.model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature ?? DEFAULT_TEMPERATURE,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const start = Date.now();

    let res: Response;
    try {
      res = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // API key is sent only in this Authorization header, never
          // logged or returned to callers.
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        throw new LlmError("TIMEOUT", `Groq request timed out after ${TIMEOUT_MS}ms.`);
      }
      throw new LlmError("API_ERROR", `Groq network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - start;

    if (res.status === 429) {
      throw new LlmError("RATE_LIMIT", "Groq rate limit reached. Retry after a moment.");
    }
    if (!res.ok) {
      // Never include the raw response body in the thrown error — it
      // could contain internal Groq details not meant for end users.
      throw new LlmError("API_ERROR", `Groq API returned HTTP ${res.status}.`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new LlmError("MALFORMED_RESPONSE", "Groq returned a non-JSON response.");
    }

    const choice = (json as { choices?: { message?: { content?: string } }[] })?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new LlmError("MALFORMED_RESPONSE", "Groq response contained no usable content.");
    }

    const rawUsage = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } })?.usage;
    const usage = rawUsage
      ? {
          promptTokens: rawUsage.prompt_tokens ?? 0,
          completionTokens: rawUsage.completion_tokens ?? 0,
          totalTokens: rawUsage.total_tokens ?? 0,
        }
      : null;

    return { content, model: this.model, usage, latencyMs };
  }
}
