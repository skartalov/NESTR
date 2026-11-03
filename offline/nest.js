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

  function nest(stockW, stockH, pieces, allowRotate, allowance) {
    var sorts = [
      function (a, b) { return b.w * b.h - a.w * a.h; },
      function (a, b) { return Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h; },
      function (a, b) { return b.h - a.h || b.w - a.w; },
      function (a, b) { return b.w - a.w || b.h - a.h; },
      function (a, b) { return Math.min(b.w, b.h) - Math.min(a.w, a.h) || b.w * b.h - a.w * a.h; }
    ];
    var modes = ['auto', 'H', 'V'];
    var best = null, bestLast = 0;
    for (var s = 0; s < sorts.length; s++) for (var m = 0; m < modes.length; m++) {
      var bins = run(stockW, stockH, pieces, allowRotate, sorts[s], modes[m], allowance);
      var last = 0, lb = bins[bins.length - 1].placed;
      for (var k = 0; k < lb.length; k++) last += lb[k].w * lb[k].h;
      if (!best || bins.length < best.length || (bins.length === best.length && last < bestLast)) { best = bins; bestLast = last; }
    }
    var out = [];
    for (var i = 0; i < best.length; i++) out.push({ w: best[i].w, h: best[i].h, placed: best[i].placed, cuts: best[i].cuts });
    return out;
  }

  // Cuts ordered by nearest neighbour; with sameDir every cut runs right to left / top to bottom.
  function cutPaths(sheet, sameDir) {
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
  function gcode(sheet, index, total, sameDir, feed) {
    var L = ['(NESTR)', '(Sheet ' + (index + 1) + ' of ' + total + ' - ' + fmt(sheet.w) + ' x ' + fmt(sheet.h) + ' mm)',
      '(Units mm, absolute positioning, X0 Y0 = bottom-left)'];
    if (sameDir) L.push('(Same direction cuts: right to left, top to bottom)');
    L.push('(A axis = direction of the next cut: +X = 0, +Y = 90, -X = 180, -Y = 270)');
    L.push('G21', 'G90', 'M21');
    var paths = cutPaths(sheet, sameDir);
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
