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
  // pdf-parse (used for PDF text extraction during ingestion) depends
  // on @napi-rs/canvas, a native addon with the same per-platform
  // shared-library problem as onnxruntime-node below — its Linux x64
  // binary was never traced into the deployed function, crashing
  // every request to /api/n8n/ingest and /api/documents/upload at
  // import time (lib/ingestion/extract/pdf.ts imports pdf-parse
  // unconditionally, even for a .txt upload — extract/index.ts
  // doesn't lazy-load per file type).
  serverExternalPackages: ["@huggingface/transformers", "pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  // Root cause confirmed from the actual Vercel function log:
  // "libonnxruntime.so.1: cannot open shared object file". Loading
  // @huggingface/transformers unconditionally does
  // `import * as ONNX_NODE from 'onnxruntime-node'` at module top
  // level (its onnx.js backend file), regardless of which inference
  // device is later requested — so this import alone crashes if the
  // native addon's shared-library dependency is missing, before any
  // device selection ever runs. That .so file lives alongside the
  // .node binary but is loaded by the OS's dynamic linker (dlopen),
  // not by a JS require()/import Next.js's static file tracer can
  // see — so it silently never got copied into the deployed function.
  // outputFileTracingIncludes force-includes it for exactly the
  // routes that actually import the embeddings module (RAG retrieval/
  // answer, ingestion), rather than bloating every API route.
  outputFileTracingIncludes: {
    "/api/rag/retrieve": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**"],
    "/api/rag/answer": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**"],
    "/api/documents/upload": [
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
      "./node_modules/pdfjs-dist/**",
    ],
    "/api/n8n/ingest": [
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
      "./node_modules/pdfjs-dist/**",
    ],
    "/api/documents/[versionId]/retry": [
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
      "./node_modules/pdfjs-dist/**",
    ],
    "app/api/documents/[versionId]/retry/route": [
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
      "./node_modules/pdfjs-dist/**",
    ],
  },
};

export default nextConfig;
