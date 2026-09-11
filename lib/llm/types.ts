export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  maxTokens?: number;
  /** 0 = deterministic. */
  temperature?: number;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmResponse {
  content: string;
  model: string;
  usage: LlmUsage | null;
  /** Latency in milliseconds, measured client-side. */
  latencyMs: number;
}

export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
  readonly model: string;
}

export type LlmErrorCode =
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "API_ERROR"
  | "MALFORMED_RESPONSE"
  | "CONFIGURATION_ERROR";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
  }
}
