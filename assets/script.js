(() => {
  const els = {
    app: document.getElementById('nonogram'),
    board: document.getElementById('board'),
    rowClues: document.getElementById('rowClues'),
    colClues: document.getElementById('colClues'),
    sizeSelect: document.getElementById('sizeSelect'),
    newBtn: document.getElementById('newBtn'),
    checkBtn: document.getElementById('checkBtn'),
    modeFill: document.getElementById('modeFill'),
    modeMark: document.getElementById('modeMark'),
    mistakesToggle: document.getElementById('mistakesToggle'),
    toast: document.getElementById('toast'),
    winModal: document.getElementById('winModal'),
    modalNew: document.getElementById('modalNew'),
    modalClose: document.getElementById('modalClose'),
    busy: document.getElementById('busy'),
  };

  const State = {
    size: parseInt(els.sizeSelect?.value || '10', 10),
    solution: [],
    player: [],
    rowClues: [],
    colClues: [],
    mode: 'fill', // 'fill' or 'mark'
    dragging: false,
    dragValue: 0, // 0 empty, 1 filled, 2 marked
    showMistakes: false,
    won: false,
  };

  function cellSizeFor(size) {
    if (size <= 5) return 54;
    if (size <= 10) return 40;
    if (size <= 15) return 32;
    return 28;
  }

  function setCssVars() {
    const cell = cellSizeFor(State.size);
    els.app.style.setProperty('--size', State.size);
    els.app.style.setProperty('--cell', `${cell}px`);
  }

  function randBool(p) {
    return Math.random() < p;
  }

  function fillProbability(size) {
    const base = 0.5 - (size - 5) * 0.015; // gentler drop-off for larger boards
    const adjusted = base + 0.08; // nudge density higher overall
    return Math.min(0.62, Math.max(0.35, adjusted));
  }

  function randomSolution(size) {
    const p = fillProbability(size);
    const total = size * size;
    const minFill = Math.floor(total * Math.max(0.32, p - 0.12));
    const maxFill = Math.ceil(total * Math.min(0.78, p + 0.12));
    let grid, filled;
    do {
      grid = Array.from({ length: size }, () =>
        Array.from({ length: size }, () => randBool(p))
      );
      filled = grid.flat().filter(Boolean).length;
    } while (filled < minFill || filled > maxFill);
    return grid;
  }

  function emptyPlayer(size) {
    return Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  }

  function lineCluesFromBools(arr) {
    const res = [];
    let run = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i]) run++;
      else if (run > 0) {
        res.push(run);
        run = 0;
      }
    }
    if (run > 0) res.push(run);
    return res.length ? res : [0];
  }

  function computeClues(solution) {
    const size = solution.length;
    const rows = solution.map(lineCluesFromBools);
    const cols = Array.from({ length: size }, (_, c) =>
      lineCluesFromBools(solution.map(row => row[c]))
    );
    return { rows, cols };
  }

  // ----------------------------
  // Logic solver (line possibilities)
  // ----------------------------

  function normalizeClues(clues) {
    if (clues.length === 1 && clues[0] === 0) return [];
    return clues.slice();
  }

  function sum(arr) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s;
  }

  function genLinePossibilities(len, clues, current) {
    clues = normalizeClues(clues);
    const res = [];
    const n = clues.length;

    function fitsSet(arr, start, end, val) {
      for (let i = start; i < end; i++) {
        const cur = current[i];
        if (cur !== -1 && cur !== val) return false;
        arr[i] = val;
      }
      return true;
    }

    function place(idx, pos, arr) {
      if (idx >= n) {
        // fill rest zeros
        const endOK = fitsSet(arr, pos, len, 0);
        if (endOK) res.push(arr.slice());
        return;
      }
      const k = clues[idx];
      // compute minimal remaining length required for remaining clues
      const remBlocks = clues.slice(idx + 1);
      const minRem = (remBlocks.length > 0 ? sum(remBlocks) + remBlocks.length : 0); // spaces between remaining blocks
      const maxStart = len - (k + minRem);

      for (let s = pos; s <= maxStart; s++) {
        const nextArr = arr.slice();
        // zeros up to start
        if (!fitsSet(nextArr, pos, s, 0)) continue;
        // ones block
        if (!fitsSet(nextArr, s, s + k, 1)) continue;

        let nextPos = s + k;
        if (idx < n - 1) {
          // separator zero
          if (nextPos >= len) continue;
          if (!fitsSet(nextArr, nextPos, nextPos + 1, 0)) continue;
          nextPos += 1;
        }
        place(idx + 1, nextPos, nextArr);
      }
    }

    // Special case: no clues -> all zeros
    if (n === 0) {
      const arr = new Array(len).fill(0);
      for (let i = 0; i < len; i++) {
        if (current[i] !== -1 && current[i] !== 0) return [];
      }
      res.push(arr);
      return res;
    }

    place(0, 0, new Array(len).fill(-1));
    return res;
  }

  function deduceFromPossibilities(poss) {
    if (poss.length === 0) return null; // contradiction
    const len = poss[0].length;
    const ded = new Array(len).fill(-1);
    for (let i = 0; i < len; i++) {
      let all1 = true, all0 = true;
      for (let p = 0; p < poss.length; p++) {
        if (poss[p][i] === 1) all0 = false;
        else all1 = false;
        if (!all1 && !all0) break;
      }
      if (all1) ded[i] = 1;
      else if (all0) ded[i] = 0;
    }
    return ded;
  }

  function logicSolve(rowClues, colClues, size) {
    const grid = Array.from({ length: size }, () => new Array(size).fill(-1));
    let changed = true;

    function applyLineToGrid(isRow, index, ded) {
      let any = false;
      if (isRow) {
        const row = grid[index];
        for (let i = 0; i < size; i++) {
          if (ded[i] !== -1 && row[i] === -1) {
            row[i] = ded[i];
            any = true;
          }
        }
      } else {
        for (let i = 0; i < size; i++) {
          if (ded[i] !== -1 && grid[i][index] === -1) {
            grid[i][index] = ded[i];
            any = true;
          }
        }
      }
      return any;
    }

    while (changed) {
      changed = false;

      // Rows
      for (let r = 0; r < size; r++) {
        const line = grid[r];
        const poss = genLinePossibilities(size, rowClues[r], line);
        if (poss.length === 0) return { contradiction: true, solved: false, grid };
        const ded = deduceFromPossibilities(poss);
        if (ded == null) return { contradiction: true, solved: false, grid };
        if (applyLineToGrid(true, r, ded)) changed = true;
      }

      // Cols
      for (let c = 0; c < size; c++) {
        const line = new Array(size);
        for (let r = 0; r < size; r++) line[r] = grid[r][c];
        const poss = genLinePossibilities(size, colClues[c], line);
        if (poss.length === 0) return { contradiction: true, solved: false, grid };
        const ded = deduceFromPossibilities(poss);
        if (ded == null) return { contradiction: true, solved: false, grid };
        if (applyLineToGrid(false, c, ded)) changed = true;
      }
    }

    // Check solved
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === -1) {
          return { contradiction: false, solved: false, grid };
        }
      }
    }
    return { contradiction: false, solved: true, grid };
  }

  async function generateSolvablePuzzle(size) {
    const deadline = Date.now() + (size <= 10 ? 2500 : size <= 15 ? 4500 : 7000);
    let attempts = 0;
    while (Date.now() < deadline && attempts < 800) {
      attempts++;
      const candidate = randomSolution(size);
      const clues = computeClues(candidate);
      const solved = logicSolve(clues.rows, clues.cols, size);
      if (solved.solved && !solved.contradiction) {
        // Use the solved grid (ensures internal consistency)
        return {
          solution: solved.grid.map(row => row.map(v => v === 1)),
          rows: clues.rows,
          cols: clues.cols,
          attempts
        };
      }
      // Yield to UI occasionally
      if (attempts % 20 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return null;
  }

  function setBusy(on) {
    if (!els.busy) return;
    els.busy.classList.toggle('is-on', !!on);
    els.busy.setAttribute('aria-hidden', on ? 'false' : 'true');
  }

  async function generateSolvablePuzzleForever(size) {
    let pre = null;
    while (!pre) {
      pre = await generateSolvablePuzzle(size);
      if (!pre) {
        // yield to UI and try again
        await new Promise(r => setTimeout(r, 0));
      }
    }
    return pre;
  }

  async function newSolvableGame(size) {
    setBusy(true);
    const pre = await generateSolvablePuzzleForever(size);
    setBusy(false);
    newGame(size, pre);
  }

  function makeEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) {
      if (Array.isArray(cls)) el.classList.add(...cls);
      else el.classList.add(cls);
    }
    if (text != null) el.textContent = text;
    return el;
  }

  function renderClues() {
    els.rowClues.innerHTML = '';
    els.colClues.innerHTML = '';

    // Row clues
    State.rowClues.forEach((nums, r) => {
      const row = makeEl('div', 'row-clue');
      nums.forEach(n => row.appendChild(makeEl('span', 'clue-number', n)));
      row.dataset.row = String(r);
      els.rowClues.appendChild(row);
    });

    // Column clues
    State.colClues.forEach((nums, c) => {
      const col = makeEl('div', 'col-clue');
      nums.forEach(n => col.appendChild(makeEl('span', 'clue-number', n)));
      col.dataset.col = String(c);
      els.colClues.appendChild(col);
    });
  }

  function cellKey(r, c) {
    return `${r}:${c}`;
  }

  function buildBoard() {
    els.board.innerHTML = '';
    els.board.style.setProperty('--size', State.size);
    els.board.style.setProperty('--cell', getComputedStyle(els.app).getPropertyValue('--cell'));

    for (let r = 0; r < State.size; r++) {
      for (let c = 0; c < State.size; c++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cell';
        btn.setAttribute('role', 'gridcell');
        btn.setAttribute('aria-label', `r${r + 1} c${c + 1}`);
        btn.dataset.row = String(r);
        btn.dataset.col = String(c);

        const x = makeEl('span', 'x');
        btn.appendChild(x);

        applyCellClass(btn, State.player[r][c], false);
        els.board.appendChild(btn);
      }
    }
  }

  function applyCellClass(el, val, animate = true) {
    el.classList.toggle('cell--filled', val === 1);
    el.classList.toggle('cell--marked', val === 2);
    if (animate && val === 1) {
      el.style.transform = 'scale(0.98)';
      requestAnimationFrame(() => {
        el.style.transform = '';
      });
    }
  }

  function setCell(r, c, val, animate = true) {
    if (r < 0 || c < 0 || r >= State.size || c >= State.size) return;
    const prev = State.player[r][c];
    if (prev === val) return;

    State.player[r][c] = val;
    const idx = r * State.size + c;
    const el = els.board.children[idx];
    applyCellClass(el, val, animate);
  }

  function equalArrays(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function groupsFromPlayerLine(vals) {
    const res = [];
    let run = 0;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] === 1) run++;
      else if (run > 0) {
        res.push(run);
        run = 0;
      }
    }
    if (run > 0) res.push(run);
    return res.length ? res : [0];
  }

  function updateClueStatus() {
    // Rows
    for (let r = 0; r < State.size; r++) {
      const playerLine = State.player[r];
      const g = groupsFromPlayerLine(playerLine);
      const ok = equalArrays(g, State.rowClues[r]);
      const rowEl = els.rowClues.children[r];
      rowEl.classList.toggle('clue--ok', ok);
    }
    // Columns
    for (let c = 0; c < State.size; c++) {
      const playerLine = Array.from({ length: State.size }, (_, r) => State.player[r][c]);
      const g = groupsFromPlayerLine(playerLine);
      const ok = equalArrays(g, State.colClues[c]);
      const colEl = els.colClues.children[c];
      colEl.classList.toggle('clue--ok', ok);
    }
  }

  function showMistakesIfNeeded() {
    if (!State.showMistakes) {
      els.board.querySelectorAll('.cell--mistake').forEach(el => el.classList.remove('cell--mistake'));
      return;
    }
    for (let r = 0; r < State.size; r++) {
      for (let c = 0; c < State.size; c++) {
        const idx = r * State.size + c;
        const el = els.board.children[idx];
        const player = State.player[r][c];
        const shouldFill = State.solution[r][c];
        const mistake = (player === 1 && !shouldFill) || (player === 2 && shouldFill);
        el.classList.toggle('cell--mistake', Boolean(mistake));
      }
    }
  }

  function isSolved() {
    for (let r = 0; r < State.size; r++) {
      for (let c = 0; c < State.size; c++) {
        const shouldFill = State.solution[r][c];
        const playerFilled = State.player[r][c] === 1;
        if (playerFilled !== shouldFill) return false;
      }
    }
    return true;
  }

  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(() => {
      els.toast.classList.remove('show');
    }, 1600);
  }

  function openWinModal() {
    if (State.won) return;
    State.won = true;
    if (!els.winModal) return;
    els.winModal.classList.add('is-open');
    els.winModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      els.modalNew?.focus();
    }, 0);
  }

  function closeWinModal() {
    if (!els.winModal) return;
    els.winModal.classList.remove('is-open');
    els.winModal.setAttribute('aria-hidden', 'true');
    State.won = false;
  }

  function newGame(size, preset = null) {
    State.size = size;
    setCssVars();

    State.won = false;
    if (els.winModal) {
      els.winModal.classList.remove('is-open');
      els.winModal.setAttribute('aria-hidden', 'true');
    }

    if (preset && preset.solution && preset.rows && preset.cols) {
      State.solution = preset.solution;
      State.rowClues = preset.rows;
      State.colClues = preset.cols;
      State.player = emptyPlayer(size);
    } else {
      State.solution = randomSolution(size);
      State.player = emptyPlayer(size);
      const clues = computeClues(State.solution);
      State.rowClues = clues.rows;
      State.colClues = clues.cols;
    }

    // Adjust corner size based on clue depth
    const maxColDepth = Math.max(...State.colClues.map(c => c.length));
    const maxRowDepth = Math.max(...State.rowClues.map(r => r.length));
    const corner = document.querySelector('.corner');
    if (corner) {
      const px = Math.max(60, Math.floor(cellSizeFor(size) * Math.max(maxColDepth, 2) * 0.9));
      corner.style.minHeight = `${px}px`;
      corner.style.minWidth = `${Math.max(72, Math.floor(cellSizeFor(size) * Math.max(maxRowDepth, 2) * 1.2))}px`;
    }

    renderClues();
    buildBoard();
    updateClueStatus();
    showMistakesIfNeeded();
  }

  // Interaction
  function desiredActionFromEvent(e) {
    if (e.button === 2 || e.buttons === 2) return 'mark';
    if (State.mode === 'mark' || e.shiftKey) return 'mark';
    return 'fill';
  }

  function onPointerDown(e) {
    const target = e.target.closest('.cell');
    if (!target) return;
    e.preventDefault();

    const r = +target.dataset.row;
    const c = +target.dataset.col;
    const current = State.player[r][c];
    const kind = desiredActionFromEvent(e);
    let desired = kind === 'fill' ? 1 : 2;
    // Toggle behaviour on the first cell
    const paintTo = current === desired ? 0 : desired;

    State.dragging = true;
    State.dragValue = paintTo;
    setCell(r, c, paintTo, true);
    updateClueStatus();
    showMistakesIfNeeded();
  }

  function onPointerEnter(e) {
    if (!State.dragging) return;
    const target = e.target.closest('.cell');
    if (!target) return;
    const r = +target.dataset.row;
    const c = +target.dataset.col;
    setCell(r, c, State.dragValue, false);
  }

  function onPointerUp() {
    if (!State.dragging) return;
    State.dragging = false;
    updateClueStatus();
    showMistakesIfNeeded();
    if (isSolved()) {
      openWinModal();
    }
  }

  function preventContext(e) {
    if (e.target.closest('.board')) e.preventDefault();
  }

  // Mode toggle
  function setMode(mode) {
    State.mode = mode;
    els.modeFill.classList.toggle('is-active', mode === 'fill');
    els.modeFill.setAttribute('aria-pressed', String(mode === 'fill'));
    els.modeMark.classList.toggle('is-active', mode === 'mark');
    els.modeMark.setAttribute('aria-pressed', String(mode === 'mark'));
  }

  // Wire up
  function bindEvents() {
    els.board.addEventListener('pointerdown', onPointerDown);
    els.board.addEventListener('pointerover', onPointerEnter);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('contextmenu', preventContext);

    els.newBtn.addEventListener('click', async () => {
      setBusy(true);
      const pre = await generateSolvablePuzzleForever(State.size);
      setBusy(false);
      newGame(State.size, pre);
      toast('New solvable puzzle');
    });

    els.checkBtn.addEventListener('click', () => {
      if (isSolved()) openWinModal();
      else toast('Not solved yet');
    });

    els.sizeSelect.addEventListener('change', async (e) => {
      const size = parseInt(e.target.value, 10);
      setBusy(true);
      const pre = await generateSolvablePuzzleForever(size);
      setBusy(false);
      newGame(size, pre);
      toast('New solvable puzzle');
    });

    els.modeFill.addEventListener('click', () => setMode('fill'));
    els.modeMark.addEventListener('click', () => setMode('mark'));

    els.mistakesToggle.addEventListener('change', (e) => {
      State.showMistakes = e.target.checked;
      showMistakesIfNeeded();
    });

    // Modal actions
    els.modalNew?.addEventListener('click', async () => {
      closeWinModal();
      setBusy(true);
      const pre = await generateSolvablePuzzleForever(State.size);
      setBusy(false);
      newGame(State.size, pre);
      toast('New solvable puzzle');
    });
    els.modalClose?.addEventListener('click', () => {
      closeWinModal();
    });
    els.winModal?.addEventListener('click', (e) => {
      if (e.target === els.winModal) closeWinModal();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.winModal?.classList.contains('is-open')) {
        closeWinModal();
      }
    });
  }

  function init() {
    bindEvents();
    setMode('fill');
    State.showMistakes = false;
    setCssVars();
    newSolvableGame(State.size);
  }

  document.addEventListener('DOMContentLoaded', init);
})();