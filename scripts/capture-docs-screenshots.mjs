import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(process.env.TEMP || "C:\\temp", "chrome_doc_screenshots_" + Date.now());
const PORT = 9222;
const BASE_URL = "https://zen-knowledge.vercel.app";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function main() {
  const chrome = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    "--window-size=1280,800",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
  ]);

  try {
    await sleep(2000);
    const versionRes = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    const versionData = await versionRes.json();
    console.log("Connected to browser:", versionData.Browser);

    // Connect to existing target / page
    const listRes = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const listData = await listRes.json();
    const pageTarget = listData.find((t) => t.type === "page") || listData[0];
    const wsUrl = pageTarget.webSocketDebuggerUrl;

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    const cdp = new CdpSession(ws);
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log("Navigating to /login...");
    await cdp.send("Page.navigate", { url: BASE_URL + "/login" });
    await sleep(4000);

    // 1. Screenshot login page
    const loginScreenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync("docs/screenshots/login.png", Buffer.from(loginScreenshot.data, "base64"));
    console.log("Saved docs/screenshots/login.png");

    // 2. Click the quick-login button for Admin ZEN Retail
    console.log("Clicking quick login for Admin ZEN Retail...");
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const adminBtn = btns.find(b => b.textContent.includes('ZEN Retail Tunisia') && b.textContent.includes('Admin'));
        if (adminBtn) { adminBtn.click(); return 'clicked'; }
        return 'not found';
      })()`,
      returnByValue: true,
    });

    await sleep(4000);

    // Check current URL
    const urlEval = await cdp.send("Runtime.evaluate", {
      expression: "window.location.href",
      returnByValue: true,
    });
    console.log("Current URL after login:", urlEval.result.value);

    // If still on login or redirected to /chat, navigate to /chat
    if (!urlEval.result.value.includes("/chat")) {
      await cdp.send("Page.navigate", { url: BASE_URL + "/chat" });
      await sleep(3000);
    }

    // On /chat, check if there's an existing conversation in sidebar or ask a question
    console.log("Submitting question on /chat...");
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        // Try clicking existing conversation if present
        const sidebarConvs = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && (b.textContent.includes('incendie') || b.textContent.includes('onboarding') || b.textContent.includes('politique')));
        if (sidebarConvs.length > 0) {
          sidebarConvs[0].click();
          return 'sidebar clicked';
        }

        const textarea = document.querySelector('textarea');
        if (textarea) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(textarea, "Quelles sont les consignes de sécurité incendie à l'entrepôt ?");
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          const form = textarea.closest('form');
          const submitBtn = form?.querySelector('button[type="submit"]');
          if (submitBtn) {
            submitBtn.click();
            return 'submit clicked';
          }
        }
        return 'not submitted';
      })()`,
      returnByValue: true,
    });

    console.log("Waiting for RAG answer...");
    for (let i = 0; i < 25; i++) {
      await sleep(1500);
      const evalRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          // Look for citation button (e.g. [1] or document title)
          const citeBtn = buttons.find(b => b.textContent && (b.textContent.includes('[1]') || b.textContent.includes('v1') || b.textContent.includes('Procédure')));
          return !!citeBtn;
        })()`,
        returnByValue: true,
      });
      if (evalRes.result?.value) {
        console.log("Found citation button!");
        break;
      }
    }

    await sleep(2000);

    // Unfold citation
    console.log("Unfolding citation preview...");
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const citeBtn = buttons.find(b => b.textContent && (b.textContent.includes('[1]') || b.textContent.includes('v1') || b.textContent.includes('Procédure')));
        if (citeBtn) { citeBtn.click(); return 'citation clicked'; }
        return 'citation button not found';
      })()`,
      returnByValue: true,
    });

    await sleep(2500);

    // 2. Screenshot chat with citation
    const chatScreenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync("docs/screenshots/chat-citation.png", Buffer.from(chatScreenshot.data, "base64"));
    console.log("Saved docs/screenshots/chat-citation.png");

    // 3. Navigate to /admin
    console.log("Navigating to /admin...");
    await cdp.send("Page.navigate", { url: BASE_URL + "/admin" });
    await sleep(3500);

    const adminScreenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync("docs/screenshots/admin.png", Buffer.from(adminScreenshot.data, "base64"));
    console.log("Saved docs/screenshots/admin.png");

    ws.close();
    console.log("All screenshots captured successfully!");
  } catch (err) {
    console.error("Screenshot script failed:", err);
  } finally {
    chrome.kill();
    try {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch {}
  }
}

main();
