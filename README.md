# FRIDAY — Realtime AI Voice Assistant

A browser-based voice assistant that feels realtime: you speak, and FRIDAY starts
talking back mid-response — it doesn't wait for the full AI reply before speaking
the first sentence.

## How it's realtime

- **STT**: Browser's native Web Speech API (`webkitSpeechRecognition`) — no upload latency.
- **AI**: Gemini API response is **streamed** from the server. The backend flushes each
  completed sentence to the browser over WebSocket the moment it's ready, instead of
  waiting for the whole reply.
- **TTS**: The browser speaks each sentence as it arrives, queued back-to-back, so the
  user hears FRIDAY start responding within ~1 second instead of waiting for a full
  paragraph to generate.
- **Barge-in**: If you start talking while FRIDAY is speaking, it immediately stops and
  listens to you.

## Setup

```bash
cd friday
npm install
cp .env.example .env
# edit .env and add your GEMINI_API_KEY (get one free at aistudio.google.com/app/apikey)
npm start
```

Open `http://localhost:3000` in **Chrome** (Web Speech API support is best there).

## Project structure

```
friday/
├── server.js          # Express + WebSocket server, streams Claude responses
├── package.json
├── .env.example
└── public/
    ├── index.html      # UI shell
    ├── style.css       # Dark HUD aesthetic, animated status states
    └── app.js           # STT, WebSocket client, TTS queue, orb visualizer
```

## Customizing FRIDAY's personality

Edit `SYSTEM_PROMPT` in `server.js` — it currently keeps replies short and
conversational since they're spoken aloud, not read.

## Notes

- Requires a Chromium-based browser for speech recognition (Safari/Firefox support is
  partial or absent).
- Mic permission is requested each time you tap the mic button.
- History is kept in-memory per WebSocket connection (resets on page reload).
