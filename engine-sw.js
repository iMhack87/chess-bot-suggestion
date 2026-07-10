// Service worker : héberge Stockfish (build asm.js, pur JavaScript) et parle
// UCI directement — pas de Web Worker (interdit en SW MV3) ni de document
// offscreen (Chrome gèle ses timers, ses workers et sa file de tâches de
// façon imprévisible ; voir CLAUDE.md). importScripts doit être appelé dans
// l'évaluation initiale du SW, d'où le chargement en tête ; le cache de code
// V8 rend les réveils suivants rapides.
//
// Le build emscripten se croit dans un worker (importScripts existe) : il
// installe `onmessage` comme entrée UCI et émet via `postMessage`. On
// fournit notre postMessage AVANT l'import, puis on détache son onmessage
// pour l'appeler directement en fonction.
//
// Une seule analyse à la fois ; la dernière position reçue gagne.

let engineReady = false;
let busy = false;
let current = null; // { fen, depth } en cours d'analyse
let pending = null; // dernière demande en attente
let lastInfo = null; // dernières infos (depth/score/pv) pour la position courante

// Onglet ayant émis la dernière demande d'analyse (une partie à la fois).
let lastTabId = null;

// Journal d'événements embarqué (renvoyé dans l'ack, pour le diagnostic).
const journal = [];
function jlog(s) {
  journal.push((Date.now() % 1000000) + " " + s);
  if (journal.length > 25) journal.shift();
}

function reportToTab(payload) {
  if (lastTabId == null) return;
  chrome.tabs.sendMessage(lastTabId, Object.assign({ target: "content" }, payload)).catch(() => {
    // L'onglet a pu être fermé entre-temps.
  });
}

// Sortie moteur : postMessage est appelé par le print d'emscripten, de façon
// SYNCHRONE pendant le ccall en cours. Traiter la ligne immédiatement
// réentrerait dans le moteur (uciok → setoption pendant que « uci » s'exécute
// encore) : on met en file et on vide en microtâche, après le retour du ccall.
const lineQueue = [];
let flushScheduled = false;
function flushLines() {
  flushScheduled = false;
  while (lineQueue.length) onEngineLine(lineQueue.shift());
}
self.postMessage = function (msg) {
  if (typeof msg !== "string") return;
  msg.split("\n").forEach((raw) => {
    const line = raw.trim();
    if (line) lineQueue.push(line);
  });
  if (!flushScheduled) {
    flushScheduled = true;
    Promise.resolve().then(flushLines);
  }
};

let importError = null;
try {
  importScripts("vendor/stockfish.asm.js");
} catch (e) {
  importError = String(e && e.message ? e.message : e);
}

// Le prélude du build a installé son handler sur `onmessage` : on le capture
// comme simple fonction d'entrée et on neutralise le handler global.
const engineSend = self.onmessage;
self.onmessage = null;

function toEngine(cmd) {
  if (typeof engineSend === "function") engineSend({ data: cmd });
}

function matchInt(line, re) {
  const m = line.match(re);
  return m ? parseInt(m[1], 10) : null;
}

function onEngineLine(line) {
  if (line === "uciok") {
    // ATTENTION : ne JAMAIS envoyer « setoption name Threads … » à ce build
    // (boucle infinie dans sa gestion de threads — il est mono-thread de
    // toute façon). Le hash par défaut convient.
    toEngine("isready");
    return;
  }
  if (line === "readyok") {
    jlog("readyok");
    engineReady = true;
    reportToTab({ type: "engine-status", message: "moteur prêt" });
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
      reportToTab(
        Object.assign({ type: "analysis", done: false, fen: current.fen }, lastInfo)
      );
    }
    return;
  }
  if (line.startsWith("bestmove") && current) {
    jlog("bestmove " + line.split(/\s+/)[1]);
    const move = line.split(/\s+/)[1];
    reportToTab({
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

let uciStarted = false;

function maybeStart() {
  if (!engineReady || busy || !pending) return;
  current = pending;
  pending = null;
  lastInfo = null;
  busy = true;
  jlog("recherche depth " + current.depth);
  toEngine("position fen " + current.fen);
  toEngine("go depth " + current.depth + " movetime " + (current.depth >= 18 ? 4000 : current.depth >= 15 ? 2500 : 1200));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "background") return;

  if (msg.type === "analyze" && typeof msg.fen === "string") {
    if (sender.tab) lastTabId = sender.tab.id;
    jlog("analyze reçu");
    // Accusé de réception = télémétrie du SW (affichée côté content).
    sendResponse({
      ok: true,
      engine: typeof engineSend,
      ready: engineReady,
      busy,
      queued: lineQueue.length,
      importError,
      calledRun: typeof Module !== "undefined" ? !!Module.calledRun : null,
      journal: journal.slice(),
    });
    pending = { fen: msg.fen, depth: Number(msg.depth) || 15 };
    if (!uciStarted) {
      uciStarted = true;
      jlog("uci envoyé");
      toEngine("uci"); // → uciok → isready → readyok → maybeStart
    } else {
      maybeStart();
    }
  }
});
