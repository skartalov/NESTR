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
      if (a && (!b || a.s1 < b.s1 - EPS || (Math.abs(a.s1 - b.s1) <= EPS && a.s2 <= b.s2))) this.place(a.i, piece.w, piece.h, false, piece.note);
      else if (b) this.place(b.i, piece.h, piece.w, true, piece.note);
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

  // pieces: [{w,h}] already expanded by quantity.
  // Returns [{w,h,placed:[{x,y,w,h,rotated}],cuts:[{x1,y1,x2,y2}]}]
  function nest(stockW, stockH, pieces, allowRotate, allowance) {
    const sorts = [
      (a, b) => b.w * b.h - a.w * a.h,
      (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
      (a, b) => b.h - a.h || b.w - a.w,
      (a, b) => b.w - a.w || b.h - a.h,
      (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h) || b.w * b.h - a.w * a.h,
    ];
    let best = null, bestLast = 0;
    for (const s of sorts) for (const m of ['auto', 'H', 'V']) {
      const bins = run(stockW, stockH, pieces, allowRotate, s, m, allowance);
      // fewer sheets first; then emptier last sheet (bigger reusable offcut)
      const last = bins[bins.length - 1].placed.reduce((t, p) => t + p.w * p.h, 0);
      if (!best || bins.length < best.length || (bins.length === best.length && last < bestLast)) { best = bins; bestLast = last; }
    }
    return best.map(b => ({ w: b.w, h: b.h, placed: b.placed, cuts: b.cuts }));
  }

  // Cuts ordered by nearest neighbour. Normally each cut is entered from its closer end;
  // with sameDir every cut runs right to left / top to bottom.
  function cutPaths(sheet, sameDir) {
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
  function gcode(sheet, index, total, sameDir, feed) {
    const L = ['(NESTR)', '(Sheet ' + (index + 1) + ' of ' + total + ' - ' + fmt(sheet.w) + ' x ' + fmt(sheet.h) + ' mm)',
      '(Units mm, absolute positioning, X0 Y0 = bottom-left)'];
    if (sameDir) L.push('(Same direction cuts: right to left, top to bottom)');
    L.push('(A axis = direction of the next cut: +X = 0, +Y = 90, -X = 180, -Y = 270)');
    L.push('G21', 'G90', 'M21');
    // head orientation for a cut: angle of its direction vector
    const angle = g => norm(Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180 / Math.PI);
    for (const g of cutPaths(sheet, sameDir)) {
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
