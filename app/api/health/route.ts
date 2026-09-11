import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "zen-knowledge",
    timestamp: new Date().toISOString(),
  });
}
