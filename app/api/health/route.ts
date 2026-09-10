import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "zen-knowledge",
    phase: "1-local-development-foundation",
    timestamp: new Date().toISOString(),
  });
}
