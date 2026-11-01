// Nesting engine: MaxRects (best short side fit), multi-sheet. No kerf.
(function (root) {
  const EPS = 1e-9;

  class Bin {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.free = [{ x: 0, y: 0, w, h }];
      this.placed = [];
    }
    score(pw, ph) {
      let best = null;
      for (const f of this.free) {
        if (pw <= f.w + EPS && ph <= f.h + EPS) {
          const s1 = Math.min(f.w - pw, f.h - ph);
          const s2 = Math.max(f.w - pw, f.h - ph);
          if (!best || s1 < best.s1 || (s1 === best.s1 && s2 < best.s2)) best = { s1, s2, x: f.x, y: f.y };
        }
      }
      return best;
    }
    place(x, y, w, h, rotated) {
      this.placed.push({ x, y, w, h, rotated });
      const next = [];
      for (const f of this.free) {
        if (x >= f.x + f.w - EPS || x + w <= f.x + EPS || y >= f.y + f.h - EPS || y + h <= f.y + EPS) {
          next.push(f); continue;
        }
        if (x > f.x + EPS) next.push({ x: f.x, y: f.y, w: x - f.x, h: f.h });
        if (x + w < f.x + f.w - EPS) next.push({ x: x + w, y: f.y, w: f.x + f.w - x - w, h: f.h });
        if (y > f.y + EPS) next.push({ x: f.x, y: f.y, w: f.w, h: y - f.y });
        if (y + h < f.y + f.h - EPS) next.push({ x: f.x, y: y + h, w: f.w, h: f.y + f.h - y - h });
      }
      // drop rectangles contained in another (keep one of exact duplicates)
      const inside = (a, b) => a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;
      this.free = next.filter((a, i) => !next.some((b, j) => i !== j && inside(a, b) && (!inside(b, a) || j < i)));
    }
    tryPlace(piece, allowRotate) {
      const a = this.score(piece.w, piece.h);
      const b = allowRotate && piece.w !== piece.h ? this.score(piece.h, piece.w) : null;
      let pick = null, rot = false;
      if (a && (!b || a.s1 < b.s1 || (a.s1 === b.s1 && a.s2 <= b.s2))) pick = a;
      else if (b) { pick = b; rot = true; }
      if (!pick) return false;
      this.place(pick.x, pick.y, rot ? piece.h : piece.w, rot ? piece.w : piece.h, rot);
      return true;
    }
  }

  function run(stockW, stockH, pieces, allowRotate, sortFn) {
    const list = pieces.slice().sort(sortFn);
    const bins = [];
    for (const p of list) {
      let ok = false;
      for (const b of bins) if (b.tryPlace(p, allowRotate)) { ok = true; break; }
      if (!ok) {
        const b = new Bin(stockW, stockH);
        if (!b.tryPlace(p, allowRotate)) throw new Error('Piece ' + p.w + ' x ' + p.h + ' does not fit on the stock tile.');
        bins.push(b);
      }
    }
    return bins;
  }

  // pieces: [{w,h}] already expanded by quantity. Returns [{w,h,placed:[{x,y,w,h,rotated}]}]
  function nest(stockW, stockH, pieces, allowRotate) {
    const sorts = [
      (a, b) => b.w * b.h - a.w * a.h,
      (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
      (a, b) => b.h - a.h || b.w - a.w,
      (a, b) => b.w - a.w || b.h - a.h,
      (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h) || b.w * b.h - a.w * a.h,
    ];
    let best = null, bestLast = 0;
    for (const s of sorts) {
      const bins = run(stockW, stockH, pieces, allowRotate, s);
      // fewer sheets first; then emptier last sheet (bigger reusable offcut)
      const last = bins[bins.length - 1].placed.reduce((t, p) => t + p.w * p.h, 0);
      if (!best || bins.length < best.length || (bins.length === best.length && last < bestLast)) { best = bins; bestLast = last; }
    }
    return best.map(b => ({ w: b.w, h: b.h, placed: b.placed }));
  }

  // Unique cut segments for one sheet: shared edges cut once, stock border skipped.
  function cutPaths(sheet) {
    const eps = 1e-6;
    const H = new Map(), V = new Map();
    const add = (map, key, a, b) => {
      const k = Math.round(key * 1e4) / 1e4;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push([a, b]);
    };
    for (const p of sheet.placed) {
      add(H, p.y, p.x, p.x + p.w); add(H, p.y + p.h, p.x, p.x + p.w);
      add(V, p.x, p.y, p.y + p.h); add(V, p.x + p.w, p.y, p.y + p.h);
    }
    const merge = iv => {
      iv.sort((a, b) => a[0] - b[0]);
      const out = [];
      for (const s of iv) {
        const l = out[out.length - 1];
        if (l && s[0] <= l[1] + eps) l[1] = Math.max(l[1], s[1]); else out.push([s[0], s[1]]);
      }
      return out;
    };
    const segs = [];
    for (const [y, iv] of H) {
      if (y < eps || Math.abs(y - sheet.h) < eps) continue;
      for (const [a, b] of merge(iv)) segs.push({ x1: a, y1: y, x2: b, y2: y });
    }
    for (const [x, iv] of V) {
      if (x < eps || Math.abs(x - sheet.w) < eps) continue;
      for (const [a, b] of merge(iv)) segs.push({ x1: x, y1: a, x2: x, y2: b });
    }
    // nearest-neighbour ordering, entering each segment from its closer end
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
  function gcode(sheets) {
    const L = ['; NESTR', '; Units: mm, absolute positioning', 'G21', 'G90', 'M21'];
    sheets.forEach((s, i) => {
      L.push('', '; ---- Sheet ' + (i + 1) + ' of ' + sheets.length + ' (' + fmt(s.w) + ' x ' + fmt(s.h) + '), X0 Y0 = bottom-left ----');
      let cx = null, cy = null, down = false;
      for (const g of cutPaths(s)) {
        if (cx !== g.x1 || cy !== g.y1) {
          if (down) { L.push('M21'); down = false; }
          L.push('G0 X' + fmt(g.x1) + ' Y' + fmt(g.y1));
        }
        if (!down) { L.push('M20'); down = true; }
        L.push('G1 X' + fmt(g.x2) + ' Y' + fmt(g.y2));
        cx = g.x2; cy = g.y2;
      }
      if (down) L.push('M21');
      L.push('G0 X0 Y0');
    });
    L.push('', '; END');
    return L.join('\r\n') + '\r\n';
  }

  root.Nestr = { nest, cutPaths, gcode };
})(typeof window !== 'undefined' ? window : globalThis);
