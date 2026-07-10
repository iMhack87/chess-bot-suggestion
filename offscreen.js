// Document offscreen : héberge Stockfish dans un Web Worker et parle UCI.
// Essaie d'abord le build WASM (rapide) via un wrapper diagnostic ; si le
// moteur n'a pas répondu « readyok » sous 8 s, bascule sur le build asm.js
// pur (aucun WASM, insensible aux blocages CSP des workers d'extension).
// Une seule analyse à la fois ; la dernière position reçue gagne.

const BOOT_TIMEOUT_MS = 8000;

let worker = null;
let engineKind = null; // 'wasm' | 'asm'
let engineReady = false;
let busy = false;
let current = null; // { fen, depth } en cours d'analyse
let pending = null; // dernière demande en attente
let lastInfo = null; // dernières infos (depth/score/pv) pour la position courante
let bootTimer = null;

function sendToContent(payload) {
  chrome.runtime.sendMessage(Object.assign({ target: "content" }, payload));
}

function startWorker(kind) {
  if (worker) {
    try {
      worker.terminate();
    } catch (e) {}
    worker = null;
  }
  engineKind = kind;
  engineReady = false;
  busy = false;
  current = null;
  lastInfo = null;

  const url = kind === "wasm" ? "vendor/sf-worker.js" : "vendor/stockfish.asm.js";
  worker = new Worker(url);
  worker.onmessage = (e) => {
    // Certains builds concatènent plusieurs lignes par message : découper.
    String(e.data)
      .split("\n")
      .forEach((raw) => {
        const line = raw.trim();
        if (line) handleLine(line);
      });
  };
  worker.onerror = (e) => {
    sendToContent({
      type: "engine-error",
      message: "worker " + kind + " : " + String(e.message || e),
    });
  };
  sendToContent({ type: "engine-status", message: "moteur " + kind + " : démarrage" });
  worker.postMessage("uci");

  clearTimeout(bootTimer);
  bootTimer = setTimeout(() => {
    if (!engineReady) {
      if (kind === "wasm") {
        sendToContent({
          type: "engine-status",
          message: "WASM muet après 8 s → bascule sur asm.js",
        });
        startWorker("asm");
      } else {
        sendToContent({
          type: "engine-error",
          message: "aucun moteur ne démarre (wasm et asm muets)",
        });
      }
    }
  }, BOOT_TIMEOUT_MS);
}

function ensureWorker() {
  if (!worker) startWorker("wasm");
}

function handleLine(line) {
  if (line.startsWith("WRAPPER-INFO:") || line.startsWith("WRAPPER-ERROR:")) {
    // Diagnostic du wrapper : informatif, le timer gère la bascule.
    sendToContent({ type: "engine-status", message: line });
    return;
  }
  onEngineLine(line);
}

function matchInt(line, re) {
  const m = line.match(re);
  return m ? parseInt(m[1], 10) : null;
}

function onEngineLine(line) {
  if (line === "uciok") {
    worker.postMessage("setoption name Threads value 1");
    worker.postMessage("setoption name Hash value 32");
    worker.postMessage("isready");
    return;
  }
  if (line === "readyok") {
    engineReady = true;
    clearTimeout(bootTimer);
    sendToContent({ type: "engine-status", message: "moteur " + engineKind + " prêt" });
    maybeStart();
    return;
  }
  if (line.startsWith("info ") && current) {
    const pvMatch = line.match(/\bpv (.+)$/);
    const depth = matchInt(line, /\bdepth (\d+)/);
    if (pvMatch && depth != null) {
      const pv = pvMatch[1].split(" ");
      lastInfo = {
        move: pv[0],
        depth,
        cp: matchInt(line, /\bscore cp (-?\d+)/),
        mate: matchInt(line, /\bscore mate (-?\d+)/),
        pv: pv.slice(0, 5),
      };
      sendToContent(
        Object.assign({ type: "analysis", done: false, fen: current.fen }, lastInfo)
      );
    }
    return;
  }
  if (line.startsWith("bestmove") && current) {
    const move = line.split(/\s+/)[1];
    sendToContent({
      type: "analysis",
      done: true,
      fen: current.fen,
      move,
      depth: lastInfo ? lastInfo.depth : null,
      cp: lastInfo ? lastInfo.cp : null,
      mate: lastInfo ? lastInfo.mate : null,
      pv: lastInfo ? lastInfo.pv : [move],
    });
    busy = false;
    current = null;
    lastInfo = null;
    maybeStart();
  }
}

function maybeStart() {
  if (!engineReady || busy || !pending || !worker) return;
  current = pending;
  pending = null;
  lastInfo = null;
  busy = true;
  worker.postMessage("position fen " + current.fen);
  worker.postMessage("go depth " + current.depth);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen") return;
  sendResponse({ ok: true, from: "offscreen" }); // ack pour le diagnostic
  if (msg.type === "analyze" && typeof msg.fen === "string") {
    ensureWorker();
    pending = { fen: msg.fen, depth: Number(msg.depth) || 15 };
    if (busy) {
      worker.postMessage("stop"); // le bestmove qui suit relancera maybeStart()
    } else {
      maybeStart();
    }
  }
});
