// Nesting engine: guillotine packing, multi-sheet. No kerf.
// Every cut runs fully across the (sub)rectangle it divides, i.e. from one edge of the
// sheet / an earlier cut to the opposite one, so tiles can be snapped by hand along it.
(function (root) {
  const EPS = 1e-6;

  class Bin {
    constructor(w, h, splitMode) {
      this.w = w; this.h = h;
      this.splitMode = splitMode; // 'H' | 'V' | 'auto'
      this.free = [{ x: 0, y: 0, w, h }];
      this.placed = [];
      this.cuts = []; // {x1,y1,x2,y2}
    }
    best(pw, ph) {
      let best = null;
      this.free.forEach((f, i) => {
        if (pw <= f.w + EPS && ph <= f.h + EPS) {
          const s1 = Math.min(f.w - pw, f.h - ph);
          const s2 = Math.max(f.w - pw, f.h - ph);
          if (!best || s1 < best.s1 - EPS || (Math.abs(s1 - best.s1) <= EPS && s2 < best.s2)) best = { s1, s2, i };
        }
      });
      return best;
    }
    place(i, pw, ph, rotated) {
      const f = this.free.splice(i, 1)[0];
      this.placed.push({ x: f.x, y: f.y, w: pw, h: ph, rotated });
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
      if (a && (!b || a.s1 < b.s1 - EPS || (Math.abs(a.s1 - b.s1) <= EPS && a.s2 <= b.s2))) this.place(a.i, piece.w, piece.h, false);
      else if (b) this.place(b.i, piece.h, piece.w, true);
      else return false;
      return true;
    }
  }

  function run(stockW, stockH, pieces, allowRotate, sortFn, splitMode) {
    const list = pieces.slice().sort(sortFn);
    const bins = [];
    for (const p of list) {
      let ok = false;
      for (const b of bins) if (b.tryPlace(p, allowRotate)) { ok = true; break; }
      if (!ok) {
        const b = new Bin(stockW, stockH, splitMode);
        if (!b.tryPlace(p, allowRotate)) throw new Error('Piece ' + p.w + ' x ' + p.h + ' does not fit on the stock tile.');
        bins.push(b);
      }
    }
    return bins;
  }

  // pieces: [{w,h}] already expanded by quantity.
  // Returns [{w,h,placed:[{x,y,w,h,rotated}],cuts:[{x1,y1,x2,y2}]}]
  function nest(stockW, stockH, pieces, allowRotate) {
    const sorts = [
      (a, b) => b.w * b.h - a.w * a.h,
      (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
      (a, b) => b.h - a.h || b.w - a.w,
      (a, b) => b.w - a.w || b.h - a.h,
      (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h) || b.w * b.h - a.w * a.h,
    ];
    let best = null, bestLast = 0;
    for (const s of sorts) for (const m of ['auto', 'H', 'V']) {
      const bins = run(stockW, stockH, pieces, allowRotate, s, m);
      // fewer sheets first; then emptier last sheet (bigger reusable offcut)
      const last = bins[bins.length - 1].placed.reduce((t, p) => t + p.w * p.h, 0);
      if (!best || bins.length < best.length || (bins.length === best.length && last < bestLast)) { best = bins; bestLast = last; }
    }
    return best.map(b => ({ w: b.w, h: b.h, placed: b.placed, cuts: b.cuts }));
  }

  // Cuts ordered by nearest neighbour, entering each cut from its closer end.
  function cutPaths(sheet) {
    const segs = sheet.cuts.map(c => ({ ...c }));
    const out = [];
    let cx = 0, cy = 0;
    while (segs.length) {
      let bi = 0, bd = Infinity, flip = false;
      segs.forEach((s, i) => {
        const d1 = Math.hypot(s.x1 - cx, s.y1 - cy), d2 = Math.hypot(s.x2 - cx, s.y2 - cy);
        if (d1 < bd) { bd = d1; bi = i; flip = false; }
        if (d2 < bd) { bd = d2; bi = i; flip = true; }
      });
      const s = segs.splice(bi, 1)[0];
      const seg = flip ? { x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 } : s;
      out.push(seg); cx = seg.x2; cy = seg.y2;
    }
    return out;
  }

  const fmt = n => String(Math.round(n * 1000) / 1000);

  // X/Y only. M21 = cutting head up, M20 = cutting head down.
  // G-code for a single sheet (index is 0-based).
  function gcode(sheet, index, total) {
    const L = ['; NESTR', '; Sheet ' + (index + 1) + ' of ' + total + ' (' + fmt(sheet.w) + ' x ' + fmt(sheet.h) + ' mm)',
      '; Units: mm, absolute positioning, X0 Y0 = bottom-left', 'G21', 'G90', 'M21'];
    let cx = null, cy = null, down = false;
    for (const g of cutPaths(sheet)) {
      if (cx === null || Math.abs(cx - g.x1) > EPS || Math.abs(cy - g.y1) > EPS) {
        if (down) { L.push('M21'); down = false; }
        L.push('G0 X' + fmt(g.x1) + ' Y' + fmt(g.y1));
      }
      if (!down) { L.push('M20'); down = true; }
      L.push('G1 X' + fmt(g.x2) + ' Y' + fmt(g.y2));
      cx = g.x2; cy = g.y2;
    }
    if (down) L.push('M21');
    L.push('G0 X0 Y0', '; END');
    return L.join('\r\n') + '\r\n';
  }

  root.Nestr = { nest, cutPaths, gcode };
})(typeof window !== 'undefined' ? window : globalThis);
