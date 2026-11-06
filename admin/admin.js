(function () {
  const $ = id => document.getElementById(id);

  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { location.href = '/login'; throw new Error('Session expired'); }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error');
    return d;
  }

  async function refresh() {
    const list = await api('GET', '/api/admin/codes');
    const tb = document.querySelector('#codes tbody');
    tb.innerHTML = '';
    list.forEach(c => {
      const tr = document.createElement('tr');
      const n = document.createElement('td'); n.textContent = c.label;
      const d = document.createElement('td'); d.textContent = new Date(c.created).toLocaleString();
      const a = document.createElement('td');
      const b = document.createElement('button');
      b.className = 'del'; b.textContent = 'Remove';
      b.onclick = async () => {
        if (!confirm('Remove access code "' + c.label + '"?')) return;
        await api('DELETE', '/api/admin/codes/' + c.id);
        refresh();
      };
      a.appendChild(b);
      const s = document.createElement('td');
      s.textContent = c.lastSeen ? new Date(c.lastSeen).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
      tr.append(n, d, a, s);
      tb.appendChild(tr);
    });
    $('empty').style.display = list.length ? 'none' : '';
  }

  $('gen').onclick = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const v = crypto.getRandomValues(new Uint32Array(10));
    $('newCode').value = Array.from(v, x => chars[x % chars.length]).join('');
  };

  $('add').onclick = async () => {
    $('addMsg').textContent = '';
    try {
      await api('POST', '/api/admin/codes', { label: $('newLabel').value, code: $('newCode').value });
      $('addMsg').style.color = '#1a7f37';
      $('addMsg').textContent = 'Added. Code: ' + $('newCode').value + ' (it cannot be shown again)';
      $('newLabel').value = ''; $('newCode').value = '';
      refresh();
    } catch (e) { $('addMsg').style.color = ''; $('addMsg').textContent = e.message; }
  };

  $('chg').onclick = async () => {
    $('pwMsg').textContent = '';
    try {
      await api('POST', '/api/admin/password', { current: $('curPw').value, next: $('newPw').value });
      $('pwMsg').style.color = '#1a7f37';
      $('pwMsg').textContent = 'Administrator code changed.';
      $('curPw').value = ''; $('newPw').value = '';
    } catch (e) { $('pwMsg').style.color = ''; $('pwMsg').textContent = e.message; }
  };

  $('logout').onclick = async () => { await api('POST', '/api/logout'); location.href = '/login'; };
  refresh();
})();
