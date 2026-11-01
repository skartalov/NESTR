(function () {
  const $ = id => document.getElementById(id);
  const tbody = document.querySelector('#pieces tbody');
  let sheets = [];

  function addRow(w = '', h = '', q = 1, note = '') {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="number" min="0.1" step="any" class="pw"></td>' +
      '<td><input type="number" min="0.1" step="any" class="ph"></td>' +
      '<td><input type="number" min="1" step="1" class="pq"></td>' +
      '<td><input type="text" maxlength="40" class="pn" placeholder="e.g. Kitchen"></td>' +
      '<td><button type="button" class="del" title="Remove">✕</button></td>';
    tr.querySelector('.pn').value = note;
    tr.querySelector('.pw').value = w;
    tr.querySelector('.ph').value = h;
    tr.querySelector('.pq').value = q;
    tr.querySelector('.del').onclick = () => { tr.remove(); if (!tbody.children.length) addRow(); };
    tbody.appendChild(tr);
  }

  const fmt = n => String(Math.round(n * 100) / 100);
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function readInput() {
    const sw = parseFloat($('stockW').value), sh = parseFloat($('stockH').value);
    if (!(sw > 0) || !(sh > 0)) throw new Error('Enter valid stock tile dimensions.');
    const pieces = [];
    tbody.querySelectorAll('tr').forEach(tr => {
      const w = parseFloat(tr.querySelector('.pw').value);
      const h = parseFloat(tr.querySelector('.ph').value);
      const q = parseInt(tr.querySelector('.pq').value, 10);
      if (!tr.querySelector('.pw').value && !tr.querySelector('.ph').value) return;
      if (!(w > 0) || !(h > 0) || !(q > 0)) throw new Error('Every piece needs width, height and quantity greater than 0.');
      const note = tr.querySelector('.pn').value.trim();
      for (let i = 0; i < q; i++) pieces.push({ w, h, note });
    });
    if (!pieces.length) throw new Error('Add at least one piece.');
    if (pieces.length > 5000) throw new Error('Too many pieces (max 5000).');
    return { sw, sh, pieces, allowRotate: !$('respectDir').checked };
  }

  function svgFor(sheet) {
    const pad = Math.max(sheet.w, sheet.h) * 0.02;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${sheet.w + 2 * pad} ${sheet.h + 2 * pad}`);
    const sw = Math.max(sheet.w, sheet.h) / 600;
    let html = `<rect x="0" y="0" width="${sheet.w}" height="${sheet.h}" fill="#f3efe6" stroke="#222" stroke-width="${sw * 2}"/>`;
    for (const p of sheet.placed) {
      // flip Y so that origin (0,0) is bottom-left, like the G-code
      const y = sheet.h - p.y - p.h;
      const fs = Math.min(p.w / (fmt(p.w).length + fmt(p.h).length + 3) * 1.6, p.h / 2.2, Math.max(sheet.w, sheet.h) / 30);
      html += `<rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" fill="${p.rotated ? '#bcd7f5' : '#cfe8c9'}" stroke="#1c2430" stroke-width="${sw}"/>`;
      const cx = p.x + p.w / 2, cy = y + p.h / 2;
      const dy = p.note ? fs * 0.65 : 0;
      html += `<text x="${cx}" y="${cy - dy}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" font-family="Arial" fill="#111">${fmt(p.w)} × ${fmt(p.h)}${p.rotated ? ' ↻' : ''}</text>`;
      if (p.note) {
        const nfs = Math.min(fs, p.w / (p.note.length * 0.6 + 1));
        html += `<text x="${cx}" y="${cy + dy}" font-size="${nfs}" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-style="italic" fill="#7a1f00">${esc(p.note)}</text>`;
      }
    }
    svg.innerHTML = html;
    return svg;
  }

  function render(sw, sh, pieces) {
    const total = sheets.length;
    const stockArea = sw * sh;
    const used = sheets.reduce((t, s) => t + s.placed.reduce((a, p) => a + p.w * p.h, 0), 0);
    $('summaryText').innerHTML =
      `<strong>${total}</strong> stock tile${total > 1 ? 's' : ''} (${fmt(sw)} × ${fmt(sh)} mm) for <strong>${pieces.length}</strong> pieces · ` +
      `utilisation <strong>${(used / (stockArea * total) * 100).toFixed(1)}%</strong>`;
    const box = $('sheets');
    box.innerHTML = '';
    sheets.forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'sheet';
      const u = s.placed.reduce((a, p) => a + p.w * p.h, 0) / stockArea * 100;
      div.innerHTML = `<h3>Sheet ${i + 1} of ${total} — ${s.placed.length} pieces, ${u.toFixed(1)}% used</h3>`;
      div.appendChild(svgFor(s));
      // legend so notes stay readable even on tiles too small for text
      const counts = new Map();
      s.placed.filter(p => p.note).forEach(p => {
        const k = `${p.note} — ${fmt(p.w)} × ${fmt(p.h)}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      });
      if (counts.size) {
        const ul = document.createElement('ul');
        ul.className = 'notes';
        counts.forEach((n, k) => { const li = document.createElement('li'); li.textContent = `${k} (×${n})`; ul.appendChild(li); });
        div.appendChild(ul);
      }
      box.appendChild(div);
    });
    $('result').classList.remove('hidden');
  }

  $('nestBtn').onclick = () => {
    $('error').textContent = '';
    try {
      const { sw, sh, pieces, allowRotate } = readInput();
      sheets = Nestr.nest(sw, sh, pieces, allowRotate);
      render(sw, sh, pieces);
    } catch (e) {
      $('error').textContent = e.message;
      $('result').classList.add('hidden');
      sheets = [];
    }
  };

  $('pdfBtn').onclick = () => window.print();

  $('gcodeBtn').onclick = () => {
    if (!sheets.length) return;
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const stamp = `NESTR_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
    // one file per sheet, staggered so the browser accepts multiple downloads
    sheets.forEach((s, i) => setTimeout(() => {
      const blob = new Blob([Nestr.gcode(s, i, sheets.length)], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${stamp}_Sheet${i + 1}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, i * 400));
  };

  $('addRow').onclick = () => addRow();
  addRow(300, 300, 4, 'Kitchen');
  addRow(250, 450, 3);
})();
