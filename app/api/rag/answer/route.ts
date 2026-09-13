import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { answerQuestion } from "../../../../lib/rag/answerQuestion.ts";
import { ensureConversation, persistTurn } from "../../../../lib/conversation/persist.ts";
import { LlmError } from "../../../../lib/llm/types.ts";
import { captureError } from "../../../../lib/monitoring/logger.ts";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const question = typeof body.question === "string" ? body.question : "";
  if (!question.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // conversationId may be null (first turn) — ensureConversation creates one.
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;

  try {
    const result = await answerQuestion(ctx, question);

    // Persist regardless of refusal — we still want the conversation history.
    let persistedConversationId: string | null = null;
    let messageId: string | null = null;
    try {
      persistedConversationId = await ensureConversation(ctx, conversationId, question);
      if (!result.refusal) {
        messageId = await persistTurn(ctx, persistedConversationId, question, result);
      }
    } catch (persistErr) {
      // Persistence failure must never break the user-facing response.
      console.error("POST /api/rag/answer: persistence error", persistErr);
    }

    return NextResponse.json({
      ...result,
      conversationId: persistedConversationId,
      messageId,
    });
  } catch (err) {
    if (err instanceof LlmError) {
      if (err.code === "RATE_LIMIT") {
        return NextResponse.json(
          { error: "The AI service is temporarily busy. Please try again in a moment." },
          { status: 429 }
        );
      }
      if (err.code === "TIMEOUT") {
        return NextResponse.json(
          { error: "The AI service did not respond in time. Please try again." },
          { status: 504 }
        );
      }
      if (err.code === "CONFIGURATION_ERROR") {
        captureError(err, { route: "POST /api/rag/answer", userId: ctx.userId, companyId: ctx.companyId, errorType: "LLM_CONFIGURATION_ERROR" });
        return NextResponse.json({ error: "AI service is not configured." }, { status: 503 });
      }
      return NextResponse.json(
        { error: "The AI service returned an unexpected error. Please try again." },
        { status: 502 }
      );
    }
    captureError(err, { route: "POST /api/rag/answer", userId: ctx.userId, companyId: ctx.companyId });
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
