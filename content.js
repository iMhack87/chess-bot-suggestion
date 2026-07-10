// Content script chess.com : lit la partie en cours, demande l'analyse à
// Stockfish (via background → offscreen) et affiche le meilleur coup
// (flèche sur l'échiquier + panneau).
//
// Usage prévu : parties amicales avec accord explicite des deux joueurs.

(() => {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const SCAN_DEBOUNCE_MS = 350;

  let enabled = true;
  let depth = 15;
  let lastFen = null; // dernière position analysée (les réponses d'une autre position sont ignorées)
  let panel = null;
  let scanTimer = null;

  // ---------------------------------------------------------------------
  // Lecture de la partie
  // ---------------------------------------------------------------------

  function findBoard() {
    return document.querySelector("wc-chess-board, chess-board");
  }

  function isFlipped(board) {
    return board.classList.contains("flipped");
  }

  // Extrait la liste des coups en SAN depuis la liste de coups de chess.com.
  // Retourne null si aucune liste de coups n'est trouvée.
  function sanMovesFromDOM() {
    const selectors = [
      "wc-simple-move-list .node-highlight-content",
      "wc-move-list .node-highlight-content",
      ".play-controller-moveList .node-highlight-content",
      "vertical-move-list .move-text-component",
      "vertical-move-list .node",
    ];
    let nodes = [];
    for (const sel of selectors) {
      nodes = document.querySelectorAll(sel);
      if (nodes.length) break;
    }
    if (!nodes.length) return null;

    const moves = [];
    nodes.forEach((n) => {
      let san = "";
      // Les pièces sont parfois rendues en "figurine" (icône + attribut data-figurine)
      const fig = n.querySelector("[data-figurine]");
      if (fig) san += fig.getAttribute("data-figurine") || "";
      san += n.textContent || "";
      san = san.replace(/0-0-0/g, "O-O-O").replace(/0-0/g, "O-O");
      san = san.replace(/[^a-hNBRQKO1-8x=+#-]/g, "");
      if (san) moves.push(san);
    });
    return moves;
  }

  // Reconstruit la position avec chess.js à partir des SAN.
  // Donne un FEN complet (trait, roques, en passant) — la voie fiable.
  function fenFromMoves(moves) {
    const game = new Chess();
    for (const san of moves) {
      if (!game.move(san, { sloppy: true })) return null;
    }
    return { fen: game.fen(), game };
  }

  // Plan B si la liste de coups est introuvable : scan des pièces sur
  // l'échiquier. Trait et droits de roque approximés.
  function fenFromPieces(board) {
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    let found = 0;
    board.querySelectorAll(".piece").forEach((el) => {
      let color = null,
        type = null,
        file = null,
        rank = null;
      el.classList.forEach((c) => {
        if (/^[wb][pnbrqk]$/.test(c)) {
          color = c[0];
          type = c[1];
        } else if (/^square-[1-8][1-8]$/.test(c)) {
          file = Number(c[7]);
          rank = Number(c[8]);
        }
      });
      if (color && type && file && rank) {
        grid[8 - rank][file - 1] = color === "w" ? type.toUpperCase() : type;
        found++;
      }
    });
    if (found < 2) return null;

    const placement = grid
      .map((row) => {
        let out = "",
          empty = 0;
        for (const sq of row) {
          if (!sq) empty++;
          else {
            if (empty) out += empty;
            empty = 0;
            out += sq;
          }
        }
        if (empty) out += empty;
        return out;
      })
      .join("/");

    // Droits de roque devinés d'après les positions initiales roi/tour.
    let castling = "";
    if (grid[7][4] === "K") {
      if (grid[7][7] === "R") castling += "K";
      if (grid[7][0] === "R") castling += "Q";
    }
    if (grid[0][4] === "k") {
      if (grid[0][7] === "r") castling += "k";
      if (grid[0][0] === "r") castling += "q";
    }
    // Trait inconnu sans liste de coups : on suppose que c'est au joueur
    // du bas de jouer (cas d'usage : demander une suggestion à son tour).
    const turn = isFlipped(board) ? "b" : "w";
    return { fen: `${placement} ${turn} ${castling || "-"} - 0 1`, game: null };
  }

  function readPosition() {
    const board = findBoard();
    if (!board) return null;
    // Si chess.js casse (chargement, SAN inattendu…), on retombe sur le
    // scan des pièces plutôt que de planter tout le content script.
    try {
      const moves = sanMovesFromDOM();
      if (moves) {
        const r = fenFromMoves(moves);
        if (r) return Object.assign(r, { board });
      }
    } catch (e) {
      console.warn("[Coach amical] lecture des coups impossible :", e);
    }
    const fallback = fenFromPieces(board);
    return fallback ? Object.assign(fallback, { board }) : null;
  }

  // ---------------------------------------------------------------------
  // Affichage : flèche sur l'échiquier
  // ---------------------------------------------------------------------

  function ensureArrowLayer(board) {
    let svg = board.querySelector(":scope > svg.sfa-arrows");
    if (!svg) {
      svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("class", "sfa-arrows");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      const defs = document.createElementNS(SVGNS, "defs");
      const marker = document.createElementNS(SVGNS, "marker");
      marker.setAttribute("id", "sfa-arrowhead");
      marker.setAttribute("markerWidth", "3.2");
      marker.setAttribute("markerHeight", "3.2");
      marker.setAttribute("refX", "2.05");
      marker.setAttribute("refY", "1.6");
      marker.setAttribute("orient", "auto");
      const tip = document.createElementNS(SVGNS, "path");
      tip.setAttribute("d", "M0,0 L3.2,1.6 L0,3.2 z");
      tip.setAttribute("class", "sfa-arrowhead");
      marker.appendChild(tip);
      defs.appendChild(marker);
      svg.appendChild(defs);
      board.appendChild(svg);
    }
    return svg;
  }

  // Centre d'une case (en % du plateau), ex. "e4" → {x, y}
  function squareCenter(square, flipped) {
    const fileIdx = square.charCodeAt(0) - 97; // a → 0
    const rankIdx = Number(square[1]) - 1; // 1 → 0
    const x = flipped ? 7 - fileIdx : fileIdx;
    const y = flipped ? rankIdx : 7 - rankIdx;
    return { x: (x + 0.5) * 12.5, y: (y + 0.5) * 12.5 };
  }

  function drawArrow(board, uciMove) {
    const svg = ensureArrowLayer(board);
    clearArrow(board);
    if (!uciMove || uciMove.length < 4 || uciMove === "(none)") return;
    const flipped = isFlipped(board);
    const from = squareCenter(uciMove.slice(0, 2), flipped);
    const to = squareCenter(uciMove.slice(2, 4), flipped);
    const line = document.createElementNS(SVGNS, "line");
    line.setAttribute("x1", from.x);
    line.setAttribute("y1", from.y);
    line.setAttribute("x2", to.x);
    line.setAttribute("y2", to.y);
    line.setAttribute("class", "sfa-arrow");
    line.setAttribute("marker-end", "url(#sfa-arrowhead)");
    svg.appendChild(line);
  }

  function clearArrow(board) {
    const b = board || findBoard();
    if (!b) return;
    const svg = b.querySelector(":scope > svg.sfa-arrows");
    if (svg) svg.querySelectorAll("line").forEach((l) => l.remove());
  }

  // ---------------------------------------------------------------------
  // Affichage : panneau
  // ---------------------------------------------------------------------

  function buildPanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.className = "sfa-panel";
    panel.innerHTML = `
      <div class="sfa-head">
        <span class="sfa-title">♞ Coach amical</span>
        <label class="sfa-switch" title="Activer / désactiver les suggestions">
          <input type="checkbox" class="sfa-toggle">
          <span class="sfa-slider"></span>
        </label>
      </div>
      <div class="sfa-body">
        <div class="sfa-move">—</div>
        <div class="sfa-eval"></div>
        <div class="sfa-depth-row">
          <span>Profondeur</span>
          <select class="sfa-depth">
            <option value="12">12 (rapide)</option>
            <option value="15">15</option>
            <option value="18">18 (fort)</option>
          </select>
        </div>
      </div>
      <div class="sfa-note">Parties amicales uniquement — avec l'accord des deux joueurs.</div>
    `;
    document.body.appendChild(panel);

    const toggle = panel.querySelector(".sfa-toggle");
    toggle.checked = enabled;
    toggle.addEventListener("change", () => {
      enabled = toggle.checked;
      chrome.storage.local.set({ enabled });
      if (!enabled) {
        clearArrow();
        setPanelMove("—", "");
      } else {
        lastFen = null; // force une nouvelle analyse
        scheduleScan();
      }
      panel.classList.toggle("sfa-off", !enabled);
    });
    panel.classList.toggle("sfa-off", !enabled);

    const depthSel = panel.querySelector(".sfa-depth");
    depthSel.value = String(depth);
    depthSel.addEventListener("change", () => {
      depth = Number(depthSel.value);
      chrome.storage.local.set({ depth });
      lastFen = null;
      scheduleScan();
    });
    return panel;
  }

  function setPanelMove(moveText, evalText) {
    if (!panel) return;
    panel.querySelector(".sfa-move").textContent = moveText;
    panel.querySelector(".sfa-eval").textContent = evalText;
  }

  // ---------------------------------------------------------------------
  // Analyse
  // ---------------------------------------------------------------------

  function requestAnalysis(fen) {
    setPanelMove("…", "analyse en cours");
    chrome.runtime.sendMessage({ target: "background", type: "analyze", fen, depth });
  }

  // Convertit un coup UCI (e2e4, e7e8q) en SAN lisible pour la position donnée.
  function uciToSan(fen, uci) {
    try {
      const g = new Chess(fen);
      const mv = g.move(
        { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] },
        { sloppy: true }
      );
      return mv ? mv.san : uci;
    } catch (e) {
      return uci;
    }
  }

  // Évaluation côté Blancs, formatée ("+0.85", "-1.20", "mat en 3"…)
  function formatEval(fen, cp, mate) {
    const whiteToMove = fen.split(" ")[1] === "w";
    if (mate != null) {
      const m = whiteToMove ? mate : -mate;
      const n = Math.abs(mate);
      return m > 0 ? `mat en ${n} (Blancs)` : `mat en ${n} (Noirs)`;
    }
    if (cp == null) return "";
    const v = (whiteToMove ? cp : -cp) / 100;
    return `${v >= 0 ? "+" : ""}${v.toFixed(2)} (Blancs)`;
  }

  function onAnalysis(msg) {
    if (!enabled || msg.fen !== lastFen) return; // résultat obsolète
    const board = findBoard();
    if (!board) return;
    drawArrow(board, msg.move);
    const san = msg.move && msg.move !== "(none)" ? uciToSan(msg.fen, msg.move) : "—";
    const suffix = msg.done ? "" : ` · prof. ${msg.depth || "?"}…`;
    setPanelMove(san, formatEval(msg.fen, msg.cp, msg.mate) + suffix);
  }

  // ---------------------------------------------------------------------
  // Boucle de détection
  // ---------------------------------------------------------------------

  function scan() {
    const pos = readPosition();
    if (!pos) return;
    buildPanel();
    if (pos.fen === lastFen) return;
    lastFen = pos.fen;
    clearArrow(pos.board);
    if (pos.game && pos.game.game_over()) {
      setPanelMove("Partie terminée", "");
      return;
    }
    if (enabled) requestAnalysis(pos.fen);
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  function init() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.target !== "content") return;
      if (msg.type === "analysis") onAnalysis(msg);
      else if (msg.type === "engine-error")
        setPanelMove("Erreur moteur", msg.message || "");
    });

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Filet de sécurité si une mutation nous échappe (SPA chess.com).
    setInterval(scheduleScan, 3000);
    scheduleScan();
  }

  chrome.storage.local.get({ enabled: true, depth: 15 }, (v) => {
    enabled = Boolean(v.enabled);
    depth = Number(v.depth) || 15;
    init();
  });
})();
