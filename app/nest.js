// Nesting engine: guillotine packing, multi-sheet. No kerf.
// Every cut runs fully across the (sub)rectangle it divides, i.e. from one edge of the
// sheet / an earlier cut to the opposite one, so tiles can be snapped by hand along it.
(function (root) {
  const EPS = 1e-6;

  class Bin {
    constructor(w, h, splitMode, allowance) {
      this.w = w; this.h = h;
      this.allowance = allowance || 0;
      this.splitMode = splitMode; // 'H' | 'V' | 'auto'
      this.free = [{ x: 0, y: 0, w, h }];
      this.placed = [];
      this.cuts = []; // {x1,y1,x2,y2}
    }
    // A leftover strip along the sheet's right/top border must be exactly 0 or >= allowance
    // (thin slivers of ceramic are hard to remove).
    edgeOk(f, pw, ph) {
      const a = this.allowance;
      if (!(a > 0)) return true;
      const rw = f.w - pw, rh = f.h - ph;
      if (Math.abs(f.x + f.w - this.w) < EPS && rw > EPS && rw < a - EPS) return false;
      if (Math.abs(f.y + f.h - this.h) < EPS && rh > EPS && rh < a - EPS) return false;
      return true;
    }
    best(pw, ph) {
      let best = null;
      this.free.forEach((f, i) => {
        if (pw <= f.w + EPS && ph <= f.h + EPS && this.edgeOk(f, pw, ph)) {
          const s1 = Math.min(f.w - pw, f.h - ph);
          const s2 = Math.max(f.w - pw, f.h - ph);
          if (!best || s1 < best.s1 - EPS || (Math.abs(s1 - best.s1) <= EPS && s2 < best.s2)) best = { s1, s2, i };
        }
      });
      return best;
    }
    place(i, pw, ph, rotated, note) {
      const f = this.free.splice(i, 1)[0];
      this.placed.push({ x: f.x, y: f.y, w: pw, h: ph, rotated, note: note || '' });
      const rw = f.w - pw, rh = f.h - ph;
      const hasR = rw > EPS, hasT = rh > EPS;
      const mode = this.splitMode === 'auto' ? (rw < rh ? 'H' : 'V') : this.splitMode;
      const cut = (x1, y1, x2, y2) => this.cuts.push({ x1, y1, x2, y2 });
      if (mode === 'H') {
        // full-width horizontal cut first, then a vertical cut inside the lower strip
        if (hasT) { cut(f.x, f.y + ph, f.x + f.w, f.y + ph); this.free.push({ x: f.x, y: f.y + ph, w: f.w, h: rh }); }
        if (hasR) { cut(f.x + pw, f.y, f.x + pw, f.y + ph); this.free.push({ x: f.x + pw, y: f.y, w: rw, h: ph }); }
      } else {
        // full-height vertical cut first, then a horizontal cut inside the left strip
        if (hasR) { cut(f.x + pw, f.y, f.x + pw, f.y + f.h); this.free.push({ x: f.x + pw, y: f.y, w: rw, h: f.h }); }
        if (hasT) { cut(f.x, f.y + ph, f.x + pw, f.y + ph); this.free.push({ x: f.x, y: f.y + ph, w: pw, h: rh }); }
      }
    }
    tryPlace(piece, allowRotate) {
      const a = this.best(piece.w, piece.h);
      const b = allowRotate && piece.w !== piece.h ? this.best(piece.h, piece.w) : null;
      if (a && (!b || a.s1 < b.s1 - EPS || (Math.abs(a.s1 - b.s1) <= EPS && a.s2 <= b.s2))) this.place(a.i, piece.w, piece.h, !!piece.rot, piece.note);
        else if (b) this.place(b.i, piece.h, piece.w, !piece.rot, piece.note);
      else return false;
      return true;
    }
  }

  function run(stockW, stockH, pieces, allowRotate, sortFn, splitMode, allowance) {
    const list = pieces.slice().sort(sortFn);
    const bins = [];
    for (const p of list) {
      let ok = false;
      for (const b of bins) if (b.tryPlace(p, allowRotate)) { ok = true; break; }
      if (!ok) {
        const b = new Bin(stockW, stockH, splitMode, allowance);
        if (!b.tryPlace(p, allowRotate)) throw new Error('Piece ' + p.w + ' x ' + p.h + ' does not fit on the stock tile' + (allowance > 0 ? ' with the allowance of ' + allowance + ' mm.' : '.'));
        bins.push(b);
      }
    }
    return bins;
  }

  // Row (shelf) packing: fills each sheet from the bottom up in full-width rows, so the
  // leftover is one big rectangle on top instead of scattered strips. Returns null if the
  // layout is impossible or breaks the border allowance.
  function shelfRun(W, H, pieces, allowRotate, orient, allowance) {
    var list = [], i, j, k;
    for (i = 0; i < pieces.length; i++) {
      var p = pieces[i], w = p.w, h = p.h, rot = false, t;
      if (allowRotate && orient !== 'asis' && ((orient === 'tall' && w > h) || (orient === 'wide' && h > w))) { t = w; w = h; h = t; rot = true; }
      if (!(w <= W + EPS && h <= H + EPS)) {
        if (allowRotate && h <= W + EPS && w <= H + EPS) { t = w; w = h; h = t; rot = !rot; } else return null;
      }
      list.push({ w: w, h: h, rotated: rot, note: p.note });
    }
    list.sort(function (a, b) { return b.h - a.h || b.w - a.w; });
    var bins = [];
    for (i = 0; i < list.length; i++) {
      var it = list[i], done = false;
      for (j = 0; j < bins.length && !done; j++) {
        var sh = bins[j].shelves;
        for (k = 0; k < sh.length; k++) {
          if (it.h <= sh[k].h + EPS && sh[k].x + it.w <= W + EPS) { sh[k].items.push(it); sh[k].x += it.w; done = true; break; }
        }
        if (!done && bins[j].y + it.h <= H + EPS) {
          sh.push({ y: bins[j].y, h: it.h, x: it.w, items: [it] });
          bins[j].y += it.h; done = true;
        }
      }
      if (!done) bins.push({ y: it.h, shelves: [{ y: 0, h: it.h, x: it.w, items: [it] }] });
    }
    var out = [], a = allowance || 0;
    for (i = 0; i < bins.length; i++) {
      var placed = [], cuts = [], free = [], ok = true;
      for (j = 0; j < bins[i].shelves.length; j++) {
        var s = bins[i].shelves[j], top = s.y + s.h, atTop = H - top < EPS, x = 0;
        if (!atTop) cuts.push({ x1: 0, y1: top, x2: W, y2: top });
        for (k = 0; k < s.items.length; k++) {
          var q = s.items[k], xe = x + q.w;
          placed.push({ x: x, y: s.y, w: q.w, h: q.h, rotated: q.rotated, note: q.note || '' });
          if (W - xe > EPS) cuts.push({ x1: xe, y1: s.y, x2: xe, y2: top });
          if (s.h - q.h > EPS) {
            cuts.push({ x1: x, y1: s.y + q.h, x2: xe, y2: s.y + q.h });
            free.push({ x: x, y: s.y + q.h, w: q.w, h: s.h - q.h });
            if (atTop && s.h - q.h < a - EPS) ok = false;
          }
          x = xe;
        }
        if (W - s.x > EPS) {
          free.push({ x: s.x, y: s.y, w: W - s.x, h: s.h });
          if (W - s.x < a - EPS) ok = false;
        }
      }
      if (H - bins[i].y > EPS) {
        free.push({ x: 0, y: bins[i].y, w: W, h: H - bins[i].y });
        if (H - bins[i].y < a - EPS) ok = false;
      }
      if (!ok) return null;
      out.push({ w: W, h: H, placed: placed, cuts: cuts, free: free });
    }
    return out;
  }

  // Same layout with X and Y swapped (columns from the left instead of rows from the bottom)
  function transposeBins(bins, W, H) {
    function r(o) { return { x: o.y, y: o.x, w: o.h, h: o.w, rotated: o.rotated, note: o.note }; }
    return bins.map(function (b) {
      return {
        w: W, h: H,
        placed: b.placed.map(r),
        free: b.free.map(r),
        cuts: b.cuts.map(function (c) { return { x1: c.y1, y1: c.x1, x2: c.y2, y2: c.x2 }; })
      };
    });
  }

  // Higher = fewer, bigger leftovers. bin.free holds the rectangles the cuts really leave,
  // so a layout whose cuts chop the waste into several pieces scores badly.
  // Each extra leftover rectangle costs 40% of the sheet's score.
  function leftoverScore(bins) {
    var s = 0;
    for (var i = 0; i < bins.length; i++) {
      var sq = 0, cnt = 0, sheetArea = bins[i].w * bins[i].h;
      for (var j = 0; j < bins[i].free.length; j++) {
        var f = bins[i].free[j], ar = f.w * f.h;
        sq += ar * ar;
        if (ar >= sheetArea * 0.005) cnt++;
      }
      s += sq / Math.pow(1.4, Math.max(cnt - 1, 0));
    }
    return s;
  }

  // small deterministic random generator so the same input always gives the same result
  function makeRng(seed) {
    var x = seed >>> 0;
    return function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  }

  // pieces: [{w,h}] already expanded by quantity.
  // Returns [{w,h,placed:[{x,y,w,h,rotated}],cuts:[{x1,y1,x2,y2}]}]
  // Tries many strategies and keeps the one with the fewest sheets, then the best leftovers.
  // With rotation allowed, the no-rotation layouts are tried too, so allowing rotation
  // can never give a worse result than forbidding it.
  function nestCore(stockW, stockH, pieces, allowRotate, allowance) {
    allowance = allowance || 0;
    var sorts = [
      function (a, b) { return b.w * b.h - a.w * a.h; },
      function (a, b) { return Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h; },
      function (a, b) { return b.h - a.h || b.w - a.w; },
      function (a, b) { return b.w - a.w || b.h - a.h; },
      function (a, b) { return Math.min(b.w, b.h) - Math.min(a.w, a.h) || b.w * b.h - a.w * a.h; }
    ];
    var modes = ['auto', 'H', 'V'];
    var best = null, bestScore = 0, firstErr = null;
    function consider(bins) {
      if (!bins || !bins.length) return;
      var sc = leftoverScore(bins);
      if (!best || bins.length < best.length || (bins.length === best.length && sc > bestScore + EPS)) { best = bins; bestScore = sc; }
    }
    var rots = allowRotate ? [true, false] : [false];
    for (var r = 0; r < rots.length; r++) {
      var rot = rots[r], s, m, o;
      for (s = 0; s < sorts.length; s++) for (m = 0; m < modes.length; m++) {
        try { consider(run(stockW, stockH, pieces, rot, sorts[s], modes[m], allowance)); }
        catch (e) { if (!firstErr) firstErr = e; }
      }
      var orients = rot ? ['tall', 'wide'] : ['asis'];
      var swapped = pieces.map(function (p) { return { w: p.h, h: p.w, note: p.note }; });
      for (o = 0; o < orients.length; o++) {
        consider(shelfRun(stockW, stockH, pieces, rot, orients[o], allowance));
        var t = shelfRun(stockH, stockW, swapped, rot, orients[o], allowance);
        if (t) consider(transposeBins(t, stockW, stockH));
      }
    }
    // Randomised search: random rotations and orderings, same scoring. Deterministic seed.
    var n = pieces.length, iters = n <= 150 ? Math.min(300, Math.floor(30000 / Math.max(n, 1))) : 0;
    if (best && iters > 0) {
      var rnd = makeRng(12345 + n), keyFns = [
        function (p) { return p.w * p.h; },
        function (p) { return Math.max(p.w, p.h); },
        function (p) { return p.h; },
        function (p) { return p.w; }
      ];
      for (var it = 0; it < iters; it++) {
        var kf = keyFns[Math.floor(rnd() * keyFns.length)], list = [];
        for (var pi = 0; pi < n; pi++) {
          var pc = pieces[pi], flip = allowRotate && rnd() < 0.5 && pc.w !== pc.h;
          var np = flip ? { w: pc.h, h: pc.w, note: pc.note, rot: true } : { w: pc.w, h: pc.h, note: pc.note, rot: false };
          np.key = -kf(np) * (1 + (rnd() - 0.5) * 0.6);
          list.push(np);
        }
        try { consider(run(stockW, stockH, list, false, function (a, b) { return a.key - b.key; }, modes[Math.floor(rnd() * 3)], allowance)); }
        catch (e2) { /* this random orientation does not fit; skip */ }
      }
    }
    if (!best) throw firstErr || new Error('Pieces do not fit on the stock tile.');
    return { bins: best, score: bestScore };
  }

  function nest(stockW, stockH, pieces, allowRotate, allowance) {
    var res = nestCore(stockW, stockH, pieces, allowRotate, allowance);
    if (allowRotate) {
      // rotation must never be worse than "respect direction": compare with that result
      var alt = null;
      try { alt = nestCore(stockW, stockH, pieces, false, allowance); } catch (e) { alt = null; }
      if (alt && (alt.bins.length < res.bins.length || (alt.bins.length === res.bins.length && alt.score > res.score + EPS))) res = alt;
    }
    var best = res.bins.slice(), out = [];
    // re-pack each sheet's own pieces alone: the sheet split found above may hide a better single-sheet layout
    if (best.length > 1) {
      for (var bi = 0; bi < best.length; bi++) {
        var own = best[bi].placed.map(function (p) { return p.rotated ? { w: p.h, h: p.w, note: p.note } : { w: p.w, h: p.h, note: p.note }; });
        if (own.length < 2) continue;
        try {
          var rp = nestCore(stockW, stockH, own, allowRotate, allowance);
          if (rp.bins.length === 1 && rp.score > leftoverScore([best[bi]]) + EPS) best[bi] = rp.bins[0];
        } catch (e3) { /* keep the original sheet */ }
      }
    }
    for (var i = 0; i < best.length; i++) out.push({ w: best[i].w, h: best[i].h, placed: best[i].placed, cuts: best[i].cuts, free: best[i].free });
    return out;
  }

  // Cuts ordered by nearest neighbour. Normally each cut is entered from its closer end;
  // with sameDir every cut runs right to left / top to bottom.
  function cutPaths(sheet, sameDir, gap) {
    // merge collinear cuts that touch or overlap into one continuous line
    const groups = new Map();
    for (const c of sheet.cuts) {
      const horiz = Math.abs(c.y1 - c.y2) < EPS;
      const key = (horiz ? 'H' : 'V') + Math.round((horiz ? c.y1 : c.x1) * 1e4);
      const a = horiz ? Math.min(c.x1, c.x2) : Math.min(c.y1, c.y2);
      const b = horiz ? Math.max(c.x1, c.x2) : Math.max(c.y1, c.y2);
      if (!groups.has(key)) groups.set(key, { horiz, pos: horiz ? c.y1 : c.x1, iv: [] });
      groups.get(key).iv.push([a, b]);
    }
    const merged = [];
    for (const g of groups.values()) {
      g.iv.sort((p, q) => p[0] - q[0]);
      const m = [];
      for (const s of g.iv) {
        const l = m[m.length - 1];
        if (l && s[0] <= l[1] + EPS) l[1] = Math.max(l[1], s[1]); else m.push([s[0], s[1]]);
      }
      for (const [a, b] of m) merged.push(g.horiz ? { x1: a, y1: g.pos, x2: b, y2: g.pos } : { x1: g.pos, y1: a, x2: g.pos, y2: b });
    }
    // every merged cut ends at the sheet border or at a perpendicular cut: stop `gap` short of it
    // at both ends so a small uncut bridge remains. Cuts too short for that are skipped.
    if (gap > 0) {
      const trimmed = [];
      for (const s of merged) {
        const horiz = Math.abs(s.y1 - s.y2) < EPS;
        const len = horiz ? s.x2 - s.x1 : s.y2 - s.y1;
        if (len <= 2 * gap + EPS) continue;
        trimmed.push(horiz ? { x1: s.x1 + gap, y1: s.y1, x2: s.x2 - gap, y2: s.y2 } : { x1: s.x1, y1: s.y1 + gap, x2: s.x2, y2: s.y2 - gap });
      }
      merged.length = 0;
      merged.push(...trimmed);
    }
    // merged segments run left to right / bottom to top; same-direction mode reverses them
    const segs = sameDir ? merged.map(s => ({ x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 })) : merged;
    const out = [];
    let cx = 0, cy = 0;
    while (segs.length) {
      let bi = 0, bd = Infinity, flip = false;
      segs.forEach((s, i) => {
        const d1 = Math.hypot(s.x1 - cx, s.y1 - cy), d2 = Math.hypot(s.x2 - cx, s.y2 - cy);
        if (d1 < bd) { bd = d1; bi = i; flip = false; }
        if (!sameDir && d2 < bd) { bd = d2; bi = i; flip = true; }
      });
      const s = segs.splice(bi, 1)[0];
      const seg = flip ? { x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 } : s;
      out.push(seg); cx = seg.x2; cy = seg.y2;
    }
    return out;
  }

  const fmt = n => String(Math.round(n * 1000) / 1000);
  // angle in [0,360), snapped so 90/180/270 never come out as 89.9999
  const norm = d => { let a = ((d % 360) + 360) % 360; a = Math.round(a * 1e6) / 1e6; return a >= 360 ? 0 : a; };

  // X/Y only. M21 = cutting head up, M20 = cutting head down.
  // G-code for a single sheet (index is 0-based).
  function gcode(sheet, index, total, sameDir, feed, gap) {
    const L = ['(NESTR)', '(Sheet ' + (index + 1) + ' of ' + total + ' - ' + fmt(sheet.w) + ' x ' + fmt(sheet.h) + ' mm)',
      '(Units mm, absolute positioning, X0 Y0 = bottom-left)'];
    if (sameDir) L.push('(Same direction cuts: right to left, top to bottom)');
    if (gap > 0) L.push('(Gap: cuts stop ' + fmt(gap) + ' mm short of the sheet border and of crossing cuts)');
    L.push('(A axis = direction of the next cut: +X = 0, +Y = 90, -X = 180, -Y = 270)');
    L.push('G21', 'G90', 'M21');
    // head orientation for a cut: angle of its direction vector
    const angle = g => norm(Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180 / Math.PI);
    for (const g of cutPaths(sheet, sameDir, gap)) {
      // G0 always carries A so the head is oriented before it goes down
      L.push('G0 X' + fmt(g.x1) + ' Y' + fmt(g.y1) + ' A' + fmt(angle(g)));
      // exactly one G1 between M20 and M21
      L.push('M20', 'G1 X' + fmt(g.x2) + ' Y' + fmt(g.y2) + ' F' + fmt(feed), 'M21');
    }
    L.push('G0 X0 Y0 A0', 'M30');
    return L.join('\r\n') + '\r\n';
  }

  root.Nestr = { nest, cutPaths, gcode };
})(typeof window !== 'undefined' ? window : globalThis);
