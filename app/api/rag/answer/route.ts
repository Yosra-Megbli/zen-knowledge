import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { answerQuestion } from "../../../../lib/rag/answerQuestion.ts";
import { LlmError } from "../../../../lib/llm/types.ts";

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

  // Any company_id / role / department_id present in body is never
  // read — ctx comes exclusively from the server-side JWT session.

  try {
    const result = await answerQuestion(ctx, question);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LlmError) {
      // Map provider errors to safe, user-facing messages. Never
      // expose raw provider details or stack traces.
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
        // Config errors are operational — log server-side, return generic 503.
        console.error("POST /api/rag/answer: LLM configuration error", err.message);
        return NextResponse.json({ error: "AI service is not configured." }, { status: 503 });
      }
      return NextResponse.json(
        { error: "The AI service returned an unexpected error. Please try again." },
        { status: 502 }
      );
    }
    console.error("POST /api/rag/answer: unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
