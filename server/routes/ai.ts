import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import type Anthropic from "@anthropic-ai/sdk";
import { all, get, run, nowIso } from "../db.ts";
import { runAgent, aiAvailable } from "../ai/agent.ts";
import { answerOffline } from "../ai/offline.ts";
import { config } from "../config.ts";
import { ingestPdf, searchDocuments, invalidateDocIndex } from "../lib/documents.ts";

export const aiRouter = Router();

aiRouter.get("/ai/status", (_req, res) => {
  res.json({ available: aiAvailable(), provider: config.ai.provider, model: config.ai.model, effort: config.ai.effort, hasKey: config.ai.hasKey });
});

aiRouter.get("/ai/conversations", (req, res) => res.json(all("SELECT id, title, created_at, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100", req.userId)));

aiRouter.get("/ai/conversations/:id", (req, res) => {
  const c = get("SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?", Number(req.params.id), req.userId);
  if (!c) return res.status(404).json({ error: "Not found" });
  res.json({ ...c, messages: all<{ id: number; role: string; display: string; tools: string | null; created_at: string }>("SELECT id, role, display, tools, created_at FROM ai_messages WHERE conversation_id = ? AND display IS NOT NULL ORDER BY id", c.id).map((m) => ({ ...m, tools: m.tools ? JSON.parse(m.tools) : [] })) });
});

aiRouter.delete("/ai/conversations/:id", (req, res) => { run("DELETE FROM ai_conversations WHERE id = ? AND user_id = ?", Number(req.params.id), req.userId); res.json({ ok: true }); });

aiRouter.post("/ai/chat", async (req, res) => {
  const { message, conversationId } = z.object({ message: z.string().trim().min(1).max(8000), conversationId: z.number().int().optional() }).parse(req.body);
  const userId = req.userId!;
  let convId = conversationId;
  if (convId && !get("SELECT 1 FROM ai_conversations WHERE id = ? AND user_id = ?", convId, userId)) return res.status(404).json({ error: "Conversation not found" });
  if (!convId) convId = Number(run("INSERT INTO ai_conversations (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", userId, message.slice(0, 80), nowIso(), nowIso()).lastInsertRowid);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("conversation", { id: convId });

  // Stored API history (exact content blocks, append-only) for this conversation.
  const stored = all<{ role: string; content: string }>("SELECT role, content FROM ai_messages WHERE conversation_id = ? AND content IS NOT NULL ORDER BY id", convId);
  const history: Anthropic.MessageParam[] = stored.map((m) => ({ role: m.role as "user" | "assistant", content: JSON.parse(m.content) }));
  const userMsg: Anthropic.MessageParam = { role: "user", content: message };

  try {
    if (!aiAvailable()) {
      send("status", "Building a data report (AI narrative is off)");
      const text = await answerOffline(message, userId);
      run("INSERT INTO ai_messages (conversation_id, role, content, display, created_at) VALUES (?, 'user', NULL, ?, ?)", convId, message, nowIso());
      run("INSERT INTO ai_messages (conversation_id, role, content, display, tools, created_at) VALUES (?, 'assistant', NULL, ?, ?, ?)", convId, text, JSON.stringify(["rules engine"]), nowIso());
      send("text", text);
    } else {
      const before = history.length;
      const result = await runAgent([...history, userMsg], userId, (e) => send(e.type, e.data));
      const added = result.messages.slice(before); // user msg + assistant/tool turns
      added.forEach((m, i) => {
        const isFirstUser = i === 0;
        const isFinal = i === added.length - 1 && m.role === "assistant";
        run("INSERT INTO ai_messages (conversation_id, role, content, display, tools, created_at) VALUES (?, ?, ?, ?, ?, ?)", convId, m.role, JSON.stringify(m.content),
          isFirstUser ? message : isFinal ? result.finalText : null, isFinal ? JSON.stringify([...new Set(result.toolsUsed)]) : null, nowIso());
      });
      send("text", result.finalText);
      send("tools", [...new Set(result.toolsUsed)]);
    }
    run("UPDATE ai_conversations SET updated_at = ? WHERE id = ?", nowIso(), convId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ai]", msg);
    send("error", /401|authentication|api key/i.test(msg) ? "The AI provider rejected the API key. Check it in Settings." : `AI request failed: ${msg.slice(0, 300)}`);
  }
  send("done", {});
  res.end();
});

// ---------- documents ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 }, fileFilter: (_req, f, cb) => cb(null, f.mimetype === "application/pdf" || /\.pdf$/i.test(f.originalname)) });

aiRouter.post("/documents", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Upload a PDF file." });
  const meta = z.object({ title: z.string().trim().min(1).max(200), symbol: z.string().trim().toUpperCase().max(12).optional().or(z.literal("")), kind: z.string().max(60).optional(), period: z.string().max(60).optional() }).parse(req.body);
  const buf = new Uint8Array(req.file.buffer);
  if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) return res.status(400).json({ error: "That file is not a valid PDF." });
  const r = await ingestPdf(req.userId!, buf, { title: meta.title, symbol: meta.symbol || null, kind: meta.kind, period: meta.period, filename: req.file.originalname });
  res.json({ ...r, note: r.scanned ? "Most pages have no extractable text (scanned images). Search and AI answers will be limited for this document." : undefined });
});

aiRouter.get("/documents", (req, res) => res.json(all("SELECT id, symbol, title, kind, period, filename, pages, uploaded_at FROM documents WHERE user_id = ? ORDER BY uploaded_at DESC", req.userId)));
aiRouter.get("/documents/search", (req, res) => res.json(searchDocuments(req.userId!, String(req.query.q || ""), (req.query.symbol as string) || undefined, 10)));
aiRouter.get("/documents/:id/pages/:page", (req, res) => {
  const d = get("SELECT id, title FROM documents WHERE id = ? AND user_id = ?", Number(req.params.id), req.userId);
  if (!d) return res.status(404).json({ error: "Not found" });
  res.json({ ...d, page: Number(req.params.page), text: get<{ text: string }>("SELECT text FROM doc_pages WHERE doc_id = ? AND page = ?", Number(req.params.id), Number(req.params.page))?.text ?? "" });
});
aiRouter.delete("/documents/:id", (req, res) => { run("DELETE FROM documents WHERE id = ? AND user_id = ?", Number(req.params.id), req.userId); invalidateDocIndex(); res.json({ ok: true }); });
