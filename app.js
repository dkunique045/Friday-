// ---------- State ----------
const micBtn = document.getElementById("micBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const hint = document.getElementById("hint");
const transcriptEl = document.getElementById("transcript");
const canvas = document.getElementById("orb");
const ctx = canvas.getContext("2d");

let ws = null;
let recognition = null;
let listening = false;
let speechQueue = [];
let speakingNow = false;
let audioLevel = 0; // 0..1, driven by mic while listening, synthetic while speaking
let targetLevel = 0;
let audioCtx, analyser, micSource, micStream;

// ---------- WebSocket ----------
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "chunk") {
      speechQueue.push(data.text);
      addLine("friday", data.text, /*append=*/true);
      if (!speakingNow) drainQueue();
    } else if (data.type === "done") {
      setStatus("idle");
    } else if (data.type === "error") {
      addLine("friday", data.text || data.message);
      setStatus("idle");
    }
  };

  ws.onclose = () => setTimeout(connectWS, 1500);
}
connectWS();

// ---------- Speech Recognition (STT) ----------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function setupRecognition() {
  if (!SpeechRecognition) {
    hint.textContent = "Speech recognition not supported in this browser — try Chrome.";
    micBtn.disabled = true;
    return;
  }
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t;
      else interim += t;
    }
    if (interim) hint.textContent = interim;
    if (final.trim()) {
      handleUserUtterance(final.trim());
    }
  };

  recognition.onend = () => {
    listening = false;
    micBtn.classList.remove("active");
    stopMicAnalyser();
    if (!speakingNow) setStatus("idle");
  };

  recognition.onerror = (e) => {
    console.error("Recognition error:", e.error);
    listening = false;
    micBtn.classList.remove("active");
    setStatus("idle");
  };
}
setupRecognition();

function handleUserUtterance(text) {
  // barge-in: stop FRIDAY talking if user interrupts
  window.speechSynthesis.cancel();
  speechQueue = [];
  speakingNow = false;

  addLine("user", text);
  hint.textContent = "Tap the mic and speak to FRIDAY";
  setStatus("thinking");

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "user_message", text }));
  }
}

micBtn.addEventListener("click", () => {
  if (!recognition) return;
  if (listening) {
    recognition.stop();
    return;
  }
  window.speechSynthesis.cancel();
  speechQueue = [];
  speakingNow = false;

  try {
    recognition.start();
    listening = true;
    micBtn.classList.add("active");
    setStatus("listening");
    startMicAnalyser();
  } catch (e) {
    console.error(e);
  }
});

// ---------- Text-to-Speech (streamed) ----------
let currentFridayLine = null;

function drainQueue() {
  if (speechQueue.length === 0) {
    speakingNow = false;
    currentFridayLine = null;
    return;
  }
  speakingNow = true;
  setStatus("speaking");
  const text = speechQueue.shift();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.02;
  utter.pitch = 1.0;
  utter.onend = drainQueue;
  utter.onerror = drainQueue;
  window.speechSynthesis.speak(utter);
}

// ---------- Transcript UI ----------
function addLine(who, text, append) {
  if (append && who === "friday" && currentFridayLine) {
    currentFridayLine.querySelector(".body").textContent += " " + text;
  } else {
    const div = document.createElement("div");
    div.className = `line ${who}`;
    div.innerHTML = `<span class="tag">${who === "user" ? "YOU" : "FRIDAY"}</span><span class="body">${escapeHtml(text)}</span>`;
    transcriptEl.appendChild(div);
    if (who === "friday") currentFridayLine = div;
    else currentFridayLine = null;
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---------- Status ----------
function setStatus(state) {
  statusDot.className = "dot";
  if (state === "listening") { statusDot.classList.add("listening"); statusText.textContent = "LISTENING"; targetLevel = 0.15; }
  else if (state === "thinking") { statusDot.classList.add("thinking"); statusText.textContent = "THINKING"; targetLevel = 0.25; }
  else if (state === "speaking") { statusDot.classList.add("speaking"); statusText.textContent = "SPEAKING"; targetLevel = 0.6; }
  else { statusText.textContent = "STANDBY"; targetLevel = 0.05; }
}
setStatus("idle");

// ---------- Mic amplitude analyser (drives orb while listening) ----------
async function startMicAnalyser() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    micSource = audioCtx.createMediaStreamSource(micStream);
    micSource.connect(analyser);
  } catch (e) {
    console.warn("Mic analyser unavailable:", e);
  }
}

function stopMicAnalyser() {
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close();
  analyser = null;
}

function getMicLevel() {
  if (!analyser) return null;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  return Math.min(1, avg / 90);
}

// ---------- Orb visualizer ----------
const BARS = 64;
let phase = 0;

function drawOrb() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;

  const micLevel = getMicLevel();
  if (micLevel !== null && listening) targetLevel = 0.15 + micLevel * 0.85;
  audioLevel += (targetLevel - audioLevel) * 0.15;

  const baseR = 92;
  const color = speakingNow ? "224, 169, 76" : "76, 224, 224";

  // soft glow core
  const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, baseR + 40);
  grad.addColorStop(0, `rgba(${color}, ${0.25 + audioLevel * 0.35})`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR + 40, 0, Math.PI * 2);
  ctx.fill();

  // radial bars (reactive)
  for (let i = 0; i < BARS; i++) {
    const angle = (i / BARS) * Math.PI * 2 + phase;
    const wobble = Math.sin(angle * 3 + phase * 2) * 0.5 + 0.5;
    const len = 14 + audioLevel * 46 * (0.4 + wobble * 0.6);
    const r1 = baseR;
    const r2 = baseR + len;
    const x1 = cx + Math.cos(angle) * r1;
    const y1 = cy + Math.sin(angle) * r1;
    const x2 = cx + Math.cos(angle) * r2;
    const y2 = cy + Math.sin(angle) * r2;
    ctx.strokeStyle = `rgba(${color}, ${0.35 + audioLevel * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // inner ring
  ctx.strokeStyle = `rgba(${color}, 0.8)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
  ctx.stroke();

  phase += 0.006 + audioLevel * 0.01;
  requestAnimationFrame(drawOrb);
}
drawOrb();
