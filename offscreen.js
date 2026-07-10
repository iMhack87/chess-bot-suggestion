// Document offscreen : héberge Stockfish (WASM) dans un Web Worker et parle UCI.
// Une seule analyse à la fois ; toute nouvelle demande remplace la précédente
// (la dernière position reçue gagne).

let worker = null;
let engineReady = false;
let busy = false;
let current = null; // { fen, depth } en cours d'analyse
let pending = null; // dernière demande en attente
let lastInfo = null; // dernières infos (depth/score/pv) pour la position courante

function sendToContent(payload) {
  chrome.runtime.sendMessage(Object.assign({ target: "content" }, payload));
}

let sawFirstLine = false;

function ensureWorker() {
  if (worker) return;
  worker = new Worker("vendor/stockfish.wasm.js");
  worker.onmessage = (e) => {
    if (!sawFirstLine) {
      sawFirstLine = true;
      sendToContent({ type: "engine-status", message: "moteur : première ligne reçue" });
    }
    onEngineLine(String(e.data));
  };
  worker.onerror = (e) => {
    sendToContent({ type: "engine-error", message: "worker : " + String(e.message || e) });
  };
  sendToContent({ type: "engine-status", message: "worker créé, uci envoyé" });
  worker.postMessage("uci");
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
  if (!engineReady || busy || !pending) return;
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
    try {
      ensureWorker();
    } catch (e) {
      sendToContent({ type: "engine-error", message: "worker: " + String(e && e.message ? e.message : e) });
      return;
    }
    pending = { fen: msg.fen, depth: Number(msg.depth) || 15 };
    if (busy) {
      worker.postMessage("stop"); // le bestmove qui suit relancera maybeStart()
    } else {
      maybeStart();
    }
  }
});
