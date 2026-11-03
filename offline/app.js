(function () {
  function $(id) { return document.getElementById(id); }
  var tbody = document.getElementById('pieces').getElementsByTagName('tbody')[0];
  var sheets = [];

  function q(el, sel) { return el.querySelector(sel); }

  function addRow() {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="number" min="0.1" step="any" class="pw"></td>' +
      '<td><input type="number" min="0.1" step="any" class="ph"></td>' +
      '<td><input type="number" min="1" step="1" class="pq" value="1"></td>' +
      '<td><input type="text" maxlength="40" class="pn" placeholder="e.g. Kitchen"></td>' +
      '<td><button type="button" class="del" title="Remove">X</button></td>';
    q(tr, '.del').onclick = function () {
      tbody.removeChild(tr);
      if (!tbody.children.length) addRow();
    };
    tbody.appendChild(tr);
    return tr;
  }

  function fmt(n) { return String(Math.round(n * 100) / 100); }
  function esc(s) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, function (c) { return map[c]; });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function readInput() {
    var sw = parseFloat($('stockW').value), sh = parseFloat($('stockH').value);
    if (!(sw > 0) || !(sh > 0)) throw new Error('Enter valid stock tile dimensions.');
    var pieces = [], rows = tbody.getElementsByTagName('tr');
    for (var r = 0; r < rows.length; r++) {
      var tr = rows[r];
      var w = parseFloat(q(tr, '.pw').value);
      var h = parseFloat(q(tr, '.ph').value);
      var qty = parseInt(q(tr, '.pq').value, 10);
      if (!q(tr, '.pw').value && !q(tr, '.ph').value) continue;
      if (!(w > 0) || !(h > 0) || !(qty > 0)) throw new Error('Every piece needs width, height and quantity greater than 0.');
      var note = q(tr, '.pn').value.replace(/^\s+|\s+$/g, '');
      for (var i = 0; i < qty; i++) pieces.push({ w: w, h: h, note: note });
    }
    if (!pieces.length) throw new Error('Add at least one piece.');
    if (pieces.length > 5000) throw new Error('Too many pieces (max 5000).');
    return { sw: sw, sh: sh, pieces: pieces, allowRotate: !$('respectDir').checked };
  }

  function svgHtml(sheet) {
    var big = Math.max(sheet.w, sheet.h);
    var pad = big * 0.02;
    var sw = big / 600;
    var html = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-pad) + ' ' + (-pad) + ' ' + (sheet.w + 2 * pad) + ' ' + (sheet.h + 2 * pad) + '" preserveAspectRatio="xMidYMid meet">' +
      '<rect x="0" y="0" width="' + sheet.w + '" height="' + sheet.h + '" fill="#f3efe6" stroke="#222" stroke-width="' + (sw * 2) + '"/>';
    for (var i = 0; i < sheet.placed.length; i++) {
      var p = sheet.placed[i];
      var y = sheet.h - p.y - p.h; // origin (0,0) bottom-left, like the G-code
      var label = fmt(p.w) + ' x ' + fmt(p.h) + (p.rotated ? ' (R)' : '');
      var fs = Math.min(p.w / (label.length + 1) * 1.6, p.h / 2.2, big / 30);
      html += '<rect x="' + p.x + '" y="' + y + '" width="' + p.w + '" height="' + p.h + '" fill="' + (p.rotated ? '#bcd7f5' : '#cfe8c9') + '" stroke="#1c2430" stroke-width="' + sw + '"/>';
      var cx = p.x + p.w / 2, cy = y + p.h / 2;
      var dy = p.note ? fs * 0.65 : 0;
      html += '<text x="' + cx + '" y="' + (cy - dy) + '" font-size="' + fs + '" text-anchor="middle" dy="0.35em" font-family="Arial" fill="#111">' + label + '</text>';
      if (p.note) {
        var nfs = Math.min(fs, p.w / (p.note.length * 0.6 + 1));
        html += '<text x="' + cx + '" y="' + (cy + dy) + '" font-size="' + nfs + '" text-anchor="middle" dy="0.35em" font-family="Arial" font-style="italic" fill="#7a1f00">' + esc(p.note) + '</text>';
      }
    }
    return html + '</svg>';
  }

  function usedArea(s) {
    var t = 0;
    for (var i = 0; i < s.placed.length; i++) t += s.placed[i].w * s.placed[i].h;
    return t;
  }

  function render(sw, sh, pieces) {
    var total = sheets.length, stockArea = sw * sh, used = 0, i, j;
    for (i = 0; i < total; i++) used += usedArea(sheets[i]);
    $('summaryText').innerHTML =
      '<strong>' + total + '</strong> stock tile' + (total > 1 ? 's' : '') + ' (' + fmt(sw) + ' x ' + fmt(sh) + ' mm) for <strong>' + pieces.length + '</strong> pieces - ' +
      'utilisation <strong>' + (used / (stockArea * total) * 100).toFixed(1) + '%</strong>';
    var box = $('sheets');
    box.innerHTML = '';
    for (i = 0; i < total; i++) {
      var s = sheets[i];
      var div = document.createElement('div');
      div.className = 'sheet';
      var u = usedArea(s) / stockArea * 100;
      var html = '<h3>Sheet ' + (i + 1) + ' of ' + total + ' - ' + s.placed.length + ' pieces, ' + u.toFixed(1) + '% used</h3>' + svgHtml(s);
      // legend so notes stay readable even on tiles too small for text
      var counts = {}, keys = [];
      for (j = 0; j < s.placed.length; j++) {
        var p = s.placed[j];
        if (!p.note) continue;
        var k = p.note + ' - ' + fmt(p.w) + ' x ' + fmt(p.h);
        if (!counts[k]) { counts[k] = 0; keys.push(k); }
        counts[k]++;
      }
      if (keys.length) {
        html += '<ul class="notes">';
        for (j = 0; j < keys.length; j++) html += '<li>' + esc(keys[j]) + ' (x' + counts[keys[j]] + ')</li>';
        html += '</ul>';
      }
      div.innerHTML = html;
      box.appendChild(div);
    }
    $('result').className = '';
  }

  $('nestBtn').onclick = function () {
    $('error').innerHTML = '';
    try {
      var inp = readInput();
      sheets = Nestr.nest(inp.sw, inp.sh, inp.pieces, inp.allowRotate);
      render(inp.sw, inp.sh, inp.pieces);
    } catch (e) {
      $('error').appendChild(document.createTextNode(e.message));
      $('result').className = 'hidden';
      sheets = [];
    }
  };

  $('pdfBtn').onclick = function () { window.print(); };

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/plain' });
    if (navigator.msSaveBlob) { navigator.msSaveBlob(blob, name); return; }
    var URLo = window.URL || window.webkitURL;
    var a = document.createElement('a');
    a.href = URLo.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URLo.revokeObjectURL(a.href); }, 2000);
  }

  $('gcodeBtn').onclick = function () {
    if (!sheets.length) return;
    var d = new Date();
    var sameDir = $('sameDir').checked;
    var feed = parseFloat($('feed').value);
    if (!(feed > 0)) { $('error').innerHTML = 'Enter a valid feedrate.'; return; }
    $('error').innerHTML = '';
    var stamp = 'NESTR_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes());
    // one file per sheet, staggered so the browser accepts multiple downloads
    sheets.forEach(function (s, i) {
      setTimeout(function () {
        download(stamp + '_Sheet' + (i + 1) + '.txt', Nestr.gcode(s, i, sheets.length, sameDir, feed));
      }, i * 400);
    });
  };

  $('addRow').onclick = function () { addRow(); };

  // Enter in a piece field acts like "+ Add piece" and jumps to the new row
  tbody.onkeydown = function (e) {
    e = e || window.event;
    if ((e.key || e.keyCode) !== 'Enter' && e.keyCode !== 13) return;
    if (e.preventDefault) e.preventDefault();
    var last = tbody.lastElementChild || tbody.lastChild;
    var sels = ['.pw', '.ph', '.pn'], blank = true;
    for (var i = 0; i < sels.length; i++) if (q(last, sels[i]).value) blank = false;
    if (!blank) last = addRow();
    q(last, '.pw').focus();
  };

  addRow();
})();
