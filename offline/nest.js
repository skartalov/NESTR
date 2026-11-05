// Nesting engine (ES5 version for old browsers): guillotine packing, multi-sheet. No kerf.
// Every cut runs fully across the (sub)rectangle it divides, so tiles can be snapped by hand.
(function (root) {
  var EPS = 1e-6;

  function Bin(w, h, splitMode, allowance) {
    this.w = w; this.h = h;
    this.allowance = allowance || 0;
    this.splitMode = splitMode; // 'H' | 'V' | 'auto'
    this.free = [{ x: 0, y: 0, w: w, h: h }];
    this.placed = [];
    this.cuts = [];
  }
  // A leftover strip along the sheet's right/top border must be exactly 0 or >= allowance
  // (thin slivers of ceramic are hard to remove).
  Bin.prototype.edgeOk = function (f, pw, ph) {
    var a = this.allowance;
    if (!(a > 0)) return true;
    var rw = f.w - pw, rh = f.h - ph;
    if (Math.abs(f.x + f.w - this.w) < EPS && rw > EPS && rw < a - EPS) return false;
    if (Math.abs(f.y + f.h - this.h) < EPS && rh > EPS && rh < a - EPS) return false;
    return true;
  };
  Bin.prototype.best = function (pw, ph) {
    var best = null;
    for (var i = 0; i < this.free.length; i++) {
      var f = this.free[i];
      if (pw <= f.w + EPS && ph <= f.h + EPS && this.edgeOk(f, pw, ph)) {
        var s1 = Math.min(f.w - pw, f.h - ph);
        var s2 = Math.max(f.w - pw, f.h - ph);
        if (!best || s1 < best.s1 - EPS || (Math.abs(s1 - best.s1) <= EPS && s2 < best.s2)) best = { s1: s1, s2: s2, i: i };
      }
    }
    return best;
  };
  Bin.prototype.place = function (i, pw, ph, rotated, note) {
    var self = this;
    var f = this.free.splice(i, 1)[0];
    this.placed.push({ x: f.x, y: f.y, w: pw, h: ph, rotated: rotated, note: note || '' });
    var rw = f.w - pw, rh = f.h - ph;
    var hasR = rw > EPS, hasT = rh > EPS;
    var mode = this.splitMode === 'auto' ? (rw < rh ? 'H' : 'V') : this.splitMode;
    function cut(x1, y1, x2, y2) { self.cuts.push({ x1: x1, y1: y1, x2: x2, y2: y2 }); }
    if (mode === 'H') {
      if (hasT) { cut(f.x, f.y + ph, f.x + f.w, f.y + ph); this.free.push({ x: f.x, y: f.y + ph, w: f.w, h: rh }); }
      if (hasR) { cut(f.x + pw, f.y, f.x + pw, f.y + ph); this.free.push({ x: f.x + pw, y: f.y, w: rw, h: ph }); }
    } else {
      if (hasR) { cut(f.x + pw, f.y, f.x + pw, f.y + f.h); this.free.push({ x: f.x + pw, y: f.y, w: rw, h: f.h }); }
      if (hasT) { cut(f.x, f.y + ph, f.x + pw, f.y + ph); this.free.push({ x: f.x, y: f.y + ph, w: pw, h: rh }); }
    }
  };
  Bin.prototype.tryPlace = function (piece, allowRotate) {
    var a = this.best(piece.w, piece.h);
    var b = allowRotate && piece.w !== piece.h ? this.best(piece.h, piece.w) : null;
    if (a && (!b || a.s1 < b.s1 - EPS || (Math.abs(a.s1 - b.s1) <= EPS && a.s2 <= b.s2))) this.place(a.i, piece.w, piece.h, false, piece.note);
    else if (b) this.place(b.i, piece.h, piece.w, true, piece.note);
    else return false;
    return true;
  };

  function run(stockW, stockH, pieces, allowRotate, sortFn, splitMode, allowance) {
    var list = pieces.slice().sort(sortFn);
    var bins = [];
    for (var n = 0; n < list.length; n++) {
      var p = list[n], ok = false;
      for (var j = 0; j < bins.length; j++) if (bins[j].tryPlace(p, allowRotate)) { ok = true; break; }
      if (!ok) {
        var b = new Bin(stockW, stockH, splitMode, allowance);
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

  // Sum of squared leftover areas: higher = leftovers are bigger and less fragmented
  function leftoverScore(bins) {
    var s = 0;
    for (var i = 0; i < bins.length; i++) for (var j = 0; j < bins[i].free.length; j++) {
      var f = bins[i].free[j], ar = f.w * f.h;
      s += ar * ar;
    }
    return s;
  }

  // Tries many strategies and keeps the one with the fewest sheets, then the best leftovers.
  // With rotation allowed, the no-rotation layouts are tried too, so allowing rotation
  // can never give a worse result than forbidding it.
  function nest(stockW, stockH, pieces, allowRotate, allowance) {
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
    if (!best) throw firstErr || new Error('Pieces do not fit on the stock tile.');
    var out = [];
    for (var i = 0; i < best.length; i++) out.push({ w: best[i].w, h: best[i].h, placed: best[i].placed, cuts: best[i].cuts });
    return out;
  }

  // Cuts ordered by nearest neighbour; with sameDir every cut runs right to left / top to bottom.
  function cutPaths(sheet, sameDir, gap) {
    var groups = {}, order = [], i, j;
    for (i = 0; i < sheet.cuts.length; i++) {
      var c = sheet.cuts[i];
      var horiz = Math.abs(c.y1 - c.y2) < EPS;
      var key = (horiz ? 'H' : 'V') + Math.round((horiz ? c.y1 : c.x1) * 1e4);
      var a = horiz ? Math.min(c.x1, c.x2) : Math.min(c.y1, c.y2);
      var b = horiz ? Math.max(c.x1, c.x2) : Math.max(c.y1, c.y2);
      if (!groups[key]) { groups[key] = { horiz: horiz, pos: horiz ? c.y1 : c.x1, iv: [] }; order.push(key); }
      groups[key].iv.push([a, b]);
    }
    var merged = [];
    for (i = 0; i < order.length; i++) {
      var g = groups[order[i]];
      g.iv.sort(function (p, q) { return p[0] - q[0]; });
      var m = [];
      for (j = 0; j < g.iv.length; j++) {
        var s = g.iv[j], l = m[m.length - 1];
        if (l && s[0] <= l[1] + EPS) l[1] = Math.max(l[1], s[1]); else m.push([s[0], s[1]]);
      }
      for (j = 0; j < m.length; j++) merged.push(g.horiz ? { x1: m[j][0], y1: g.pos, x2: m[j][1], y2: g.pos } : { x1: g.pos, y1: m[j][0], x2: g.pos, y2: m[j][1] });
    }
    // every merged cut ends at the sheet border or at a perpendicular cut: stop `gap` short of it
    // at both ends so a small uncut bridge remains. Cuts too short for that are skipped.
    if (gap > 0) {
      var trimmed = [];
      for (i = 0; i < merged.length; i++) {
        var u = merged[i], uh = Math.abs(u.y1 - u.y2) < EPS;
        var len = uh ? u.x2 - u.x1 : u.y2 - u.y1;
        if (len <= 2 * gap + EPS) continue;
        trimmed.push(uh ? { x1: u.x1 + gap, y1: u.y1, x2: u.x2 - gap, y2: u.y2 } : { x1: u.x1, y1: u.y1 + gap, x2: u.x2, y2: u.y2 - gap });
      }
      merged = trimmed;
    }
    var segs = [];
    for (i = 0; i < merged.length; i++) {
      var t = merged[i];
      segs.push(sameDir ? { x1: t.x2, y1: t.y2, x2: t.x1, y2: t.y1 } : t);
    }
    var out = [], cx = 0, cy = 0;
    while (segs.length) {
      var bi = 0, bd = Infinity, flip = false;
      for (i = 0; i < segs.length; i++) {
        var q = segs[i];
        var d1 = Math.sqrt(Math.pow(q.x1 - cx, 2) + Math.pow(q.y1 - cy, 2));
        var d2 = Math.sqrt(Math.pow(q.x2 - cx, 2) + Math.pow(q.y2 - cy, 2));
        if (d1 < bd) { bd = d1; bi = i; flip = false; }
        if (!sameDir && d2 < bd) { bd = d2; bi = i; flip = true; }
      }
      var sg = segs.splice(bi, 1)[0];
      var seg = flip ? { x1: sg.x2, y1: sg.y2, x2: sg.x1, y2: sg.y1 } : sg;
      out.push(seg); cx = seg.x2; cy = seg.y2;
    }
    return out;
  }

  function fmt(n) { return String(Math.round(n * 1000) / 1000); }
  function norm(d) { var a = ((d % 360) + 360) % 360; a = Math.round(a * 1e6) / 1e6; return a >= 360 ? 0 : a; }

  // X/Y/A. M21 = cutting head up, M20 = cutting head down. One sheet (index is 0-based).
  function gcode(sheet, index, total, sameDir, feed, gap) {
    var L = ['(NESTR)', '(Sheet ' + (index + 1) + ' of ' + total + ' - ' + fmt(sheet.w) + ' x ' + fmt(sheet.h) + ' mm)',
      '(Units mm, absolute positioning, X0 Y0 = bottom-left)'];
    if (sameDir) L.push('(Same direction cuts: right to left, top to bottom)');
    if (gap > 0) L.push('(Gap: cuts stop ' + fmt(gap) + ' mm short of the sheet border and of crossing cuts)');
    L.push('(A axis = direction of the next cut: +X = 0, +Y = 90, -X = 180, -Y = 270)');
    L.push('G21', 'G90', 'M21');
    var paths = cutPaths(sheet, sameDir, gap);
    for (var i = 0; i < paths.length; i++) {
      var g = paths[i];
      var ang = norm(Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180 / Math.PI);
      L.push('G0 X' + fmt(g.x1) + ' Y' + fmt(g.y1) + ' A' + fmt(ang));
      L.push('M20', 'G1 X' + fmt(g.x2) + ' Y' + fmt(g.y2) + ' F' + fmt(feed), 'M21');
    }
    L.push('G0 X0 Y0 A0', 'M30');
    return L.join('\r\n') + '\r\n';
  }

  root.Nestr = { nest: nest, cutPaths: cutPaths, gcode: gcode };
})(typeof window !== 'undefined' ? window : globalThis);
