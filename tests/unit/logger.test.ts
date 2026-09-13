import test from "node:test";
import assert from "node:assert/strict";
import { captureError, logger } from "../../lib/monitoring/logger.ts";

test("logger sanitizes sensitive keys and tokens", () => {
  // Capture console output
  const originalError = console.error;
  let loggedPayload: unknown[] = [];
  console.error = (...args: unknown[]) => {
    loggedPayload = args;
  };

  try {
    const errorWithSecrets = new Error("Sample test failure");
    captureError(errorWithSecrets, {
      userId: "user-123",
      password: "SuperSecretPassword123",
      apiKey: "gsk_sensitive_groq_key_999",
      nested: {
        token: "ey123456789",
        safeField: "safe value",
      },
    });

    assert.ok(loggedPayload.length > 0);
    const loggedStr = JSON.stringify(loggedPayload);
    assert.ok(!loggedStr.includes("SuperSecretPassword123"), "Password must be redacted");
    assert.ok(!loggedStr.includes("gsk_sensitive_groq_key_999"), "API key must be redacted");
    assert.ok(!loggedStr.includes("ey123456789"), "JWT token must be redacted");
    assert.ok(loggedStr.includes("[REDACTED]"), "Must contain REDACTED marker");
    assert.ok(loggedStr.includes("safe value"), "Safe fields must be preserved");
  } finally {
    console.error = originalError;
  }
});

test("logger methods info/warn/error do not throw on malformed inputs", () => {
  assert.doesNotThrow(() => {
    logger.info("Informational message", { foo: "bar" });
    logger.warn("Warning message", { count: 42 });
    logger.error(new Error("Controlled test error"));
    logger.error("Non-error string thrown");
    logger.error(null);
  });
});
