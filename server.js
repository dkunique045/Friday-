import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = "gemini-flash-latest";

const SYSTEM_PROMPT = `You are FRIDAY, a sharp, witty, efficient AI voice assistant.
Keep replies short and conversational — you are being spoken aloud, not read.
Avoid lists, markdown, or long paragraphs. 1-3 sentences unless asked for detail.
Address the user naturally, like a helpful assistant with personality (inspired by Tony Stark's FRIDAY).`;

app.use(express.static(path.join(__dirname, "public")));

wss.on("connection", (ws) => {
  console.log("Client connected");
  let history = []; // [{ role: "user"|"model", parts: [{ text }] }]

  ws.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "reset") {
      history = [];
      return;
    }

    if (data.type === "user_message") {
      const userText = data.text?.trim();
      if (!userText) return;

      const trimmedHistory = history.slice(-20);
      const contents = [
        ...trimmedHistory,
        { role: "user", parts: [{ text: userText }] },
      ];

      try {
        const stream = await ai.models.generateContentStream({
          model: MODEL,
          contents,
          config: { systemInstruction: SYSTEM_PROMPT },
        });

        let fullText = "";
        let sentenceBuffer = "";

        for await (const chunk of stream) {
          const chunkText = chunk.text;
          if (!chunkText) continue;
          fullText += chunkText;
          sentenceBuffer += chunkText;

          // Flush on sentence boundaries so the client can start speaking
          // before the full reply has arrived — this is what makes it feel realtime.
          let match;
          while ((match = sentenceBuffer.match(/^(.*?[.!?])\s+(.*)$/s))) {
            ws.send(JSON.stringify({ type: "chunk", text: match[1].trim() }));
            sentenceBuffer = match[2];
          }
        }

        if (sentenceBuffer.trim()) {
          ws.send(JSON.stringify({ type: "chunk", text: sentenceBuffer.trim() }));
        }

        history.push({ role: "user", parts: [{ text: userText }] });
        history.push({ role: "model", parts: [{ text: fullText }] });

        ws.send(JSON.stringify({ type: "done" }));
      } catch (err) {
        console.error("Gemini API error:", err);
        ws.send(JSON.stringify({ type: "error", message: "Could not reach the AI backend." }));
      }
    }
  });

  ws.on("close", () => console.log("Client disconnected"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`FRIDAY server running at http://localhost:${PORT}`);
});
