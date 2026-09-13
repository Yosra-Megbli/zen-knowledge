export interface LogContext {
  userId?: string | null;
  companyId?: string | null;
  route?: string;
  action?: string;
  documentId?: string;
  versionId?: string;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "groq_api_key",
  "authorization",
]);

function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    // Mask potential bearer tokens or high-entropy secrets if detected
    if (obj.startsWith("gsk_") || obj.startsWith("ey")) return "[REDACTED]";
    return obj;
  }
  if (Array.isArray(obj)) return obj.map((item) => sanitize(item, depth + 1));
  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        sanitized[k] = "[REDACTED]";
      } else {
        sanitized[k] = sanitize(v, depth + 1);
      }
    }
    return sanitized;
  }
  return obj;
}

/**
 * Dispatches an error alert to an external monitoring or webhook service
 * (e.g. Sentry/Datadog/Slack/LogRocket ingest) if configured via ERROR_WEBHOOK_URL.
 * Non-blocking, fails gracefully without throwing.
 */
async function sendToExternalMonitoring(payload: Record<string, unknown>): Promise<void> {
  const webhookUrl = process.env.ERROR_WEBHOOK_URL || process.env.SENTRY_DSN;
  if (!webhookUrl) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  } catch {
    // External logging network failures must never disrupt application flow
  }
}

export function captureError(err: unknown, context: LogContext = {}): void {
  const isErr = err instanceof Error;
  const errorPayload = {
    timestamp: new Date().toISOString(),
    level: "error",
    name: isErr ? err.name : "UnknownError",
    message: isErr ? err.message : String(err),
    stack: isErr && process.env.NODE_ENV !== "production" ? err.stack : undefined,
    code: (err as { code?: string })?.code,
    context: sanitize(context),
  };

  // Structured console log
  if (process.env.NODE_ENV === "production") {
    console.error(JSON.stringify(errorPayload));
  } else {
    console.error(`[ERROR] ${errorPayload.timestamp} - ${errorPayload.name}: ${errorPayload.message}`, errorPayload.context);
  }

  // Asynchronous external alert dispatch
  void sendToExternalMonitoring(errorPayload);
}

export const logger = {
  info(message: string, context?: LogContext): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level: "info",
      message,
      context: sanitize(context),
    };
    console.log(process.env.NODE_ENV === "production" ? JSON.stringify(payload) : `[INFO] ${message}`, context ?? "");
  },

  warn(message: string, context?: LogContext): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level: "warn",
      message,
      context: sanitize(context),
    };
    console.warn(process.env.NODE_ENV === "production" ? JSON.stringify(payload) : `[WARN] ${message}`, context ?? "");
  },

  error(err: unknown, context?: LogContext): void {
    captureError(err, context);
  },
};
