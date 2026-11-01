document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('error');
  err.textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: document.getElementById('code').value }),
    });
    const d = await r.json();
    if (r.ok) location.href = d.next;
    else err.textContent = d.error || 'Login failed';
  } catch (x) {
    err.textContent = 'Cannot reach the server.';
  }
});
