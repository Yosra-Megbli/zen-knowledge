import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // @huggingface/transformers ships its own ONNX runtime WASM/native
  // binaries. Left to Next.js's default serverless bundler, those
  // binaries are not correctly included in the deployed function —
  // every request needing an embedding (retrieval, ingestion) crashed
  // immediately in production with an empty 500, while working fine
  // locally (Next.js dev doesn't bundle the same way). Marking the
  // package external tells Next.js to leave it as a real
  // node_modules import resolved at runtime instead of tracing/
  // inlining it.
  serverExternalPackages: ["@huggingface/transformers"],
};

export default nextConfig;
