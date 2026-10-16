(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LIST_REFRESH_MS = 15000;
  const DETAIL_REFRESH_MS = 8000;

  /* ---------------- İkonlar ---------------- */

  const ICONS = {
    audio: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  };

  function icon(name, className = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', ('icon ' + className).trim());
    svg.innerHTML = ICONS[name];
    return svg;
  }

  document.querySelectorAll('i[data-icon]').forEach((el) => el.replaceWith(icon(el.dataset.icon, el.className)));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /* ---------------- Biçimlendirme ---------------- */

  const fmtDateTime = (ts) =>
    new Date(ts).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtTime = (ts) =>
    new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtDay = (ts) =>
    new Date(ts).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  function fmtAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'şimdi';
    if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
    if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} gün önce`;
    return new Date(ts).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  function shortUA(ua) {
    if (!ua) return '';
    const browser =
      /Edg\//.test(ua) ? 'Edge' :
      /OPR\//.test(ua) ? 'Opera' :
      /Firefox\//.test(ua) ? 'Firefox' :
      /Chrome\//.test(ua) ? 'Chrome' :
      /Safari\//.test(ua) ? 'Safari' : 'Tarayıcı';
    const os =
      /Android/.test(ua) ? 'Android' :
      /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
      /Windows/.test(ua) ? 'Windows' :
      /Mac OS X/.test(ua) ? 'macOS' :
      /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${browser} · ${os}` : browser;
  }

  /* ---------------- API ---------------- */

  class AuthError extends Error {}

  async function api(path, options = {}) {
    const res = await fetch('/admin/api' + path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401 && path !== '/login') {
      showLogin();
      throw new AuthError('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'request-failed'), { status: res.status, data });
    return data;
  }

  /* ---------------- Giriş ---------------- */

  const loginError = $('loginError');

  function showLogin() {
    stopTimers();
    $('panelView').hidden = true;
    $('loginView').hidden = false;
    $('passwordInput').value = '';
    $('passwordInput').focus();
  }

  $('passwordInput').addEventListener('input', () => { loginError.hidden = true; });

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('passwordInput').value;
    if (!password) {
      loginError.textContent = 'Şifre girin.';
      loginError.hidden = false;
      return;
    }
    const btn = $('loginBtn');
    btn.disabled = true;
    try {
      await api('/login', { method: 'POST', body: JSON.stringify({ password }) });
      showPanel();
    } catch (err) {
      if (err.status === 429) {
        const min = Math.max(1, Math.ceil((err.data?.retryAfterSec || 60) / 60));
        loginError.textContent = `Çok fazla hatalı deneme. ${min} dakika sonra tekrar deneyin.`;
      } else if (err.status === 401) {
        loginError.textContent = 'Şifre hatalı.';
      } else {
        loginError.textContent = 'Sunucuya ulaşılamadı.';
      }
      loginError.hidden = false;
      $('passwordInput').select();
    } finally {
      btn.disabled = false;
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST' }); } catch {}
    showLogin();
  });

  /* ---------------- Panel ---------------- */

  const state = {
    q: '',
    page: 0,
    rooms: [],
    selected: null,
    detail: null,
    filter: 'all',
  };
  let listTimer = null;
  let detailTimer = null;

  function stopTimers() {
    clearInterval(listTimer);
    clearInterval(detailTimer);
    listTimer = detailTimer = null;
  }

  function showPanel() {
    $('loginView').hidden = true;
    $('panelView').hidden = false;
    loadRooms();
    stopTimers();
    listTimer = setInterval(() => loadRooms({ silent: true }), LIST_REFRESH_MS);
    detailTimer = setInterval(() => {
      if (state.selected && state.detail?.active) loadDetail(state.selected, { silent: true });
    }, DETAIL_REFRESH_MS);
  }

  /* --- Oda listesi --- */

  async function loadRooms({ append = false, silent = false } = {}) {
    // Otomatik yenileme şimdiye kadar yüklenen tüm sayfaları tazeler.
    const pages = append ? [state.page + 1] : [...Array(state.page + 1).keys()];
    try {
      let rooms = append ? state.rooms.slice() : [];
      let last = null;
      for (const page of pages) {
        last = await api(`/rooms?q=${encodeURIComponent(state.q)}&page=${page}`);
        rooms = rooms.concat(last.rooms);
      }
      if (append) state.page += 1;
      state.rooms = rooms;
      renderStats(last);
      renderRoomList(last.hasMore);
    } catch (err) {
      if (err instanceof AuthError) return;
      if (!silent) renderListMessage('Odalar yüklenemedi.');
    }
  }

  function renderStats(data) {
    $('liveRooms').textContent = data.live.rooms;
    $('liveUsers').textContent = data.live.users;
    const chip = $('storageChip');
    if (data.storage === 'postgres') {
      chip.textContent = 'Postgres';
      chip.classList.remove('warn');
      chip.title = 'Kayıtlar kalıcı veritabanında';
    } else {
      chip.textContent = 'Yerel dosya';
      chip.classList.add('warn');
      chip.title = 'DATABASE_URL tanımlı değil: kayıtlar sunucu yeniden başlarsa kaybolabilir';
    }
  }

  function renderListMessage(text) {
    $('roomList').replaceChildren(el('p', 'list-empty', text));
    $('moreBtn').hidden = true;
  }

  function renderRoomList(hasMore) {
    const list = $('roomList');
    if (!state.rooms.length) {
      renderListMessage(state.q ? 'Aramayla eşleşen oda yok.' : 'Henüz kayıtlı oda yok.');
      return;
    }
    const scroll = list.scrollTop;
    list.replaceChildren(...state.rooms.map(roomItem));
    list.scrollTop = scroll;
    $('moreBtn').hidden = !hasMore;
  }

  function roomItem(r) {
    const btn = el('button', 'room-item' + (r.key === state.selected ? ' selected' : ''));
    btn.type = 'button';
    btn.dataset.key = r.key;

    const top = el('div', 'ri-top');
    const key = el('span', 'ri-key');
    key.append(el('span', 'dot' + (r.active ? '' : ' off')), el('span', '', r.key));
    const time = el('span', 'ri-time', fmtAgo(r.lastAt));
    time.title = 'Son etkinlik: ' + fmtDateTime(r.lastAt);
    top.append(key, time);

    const meta = el('div', 'ri-meta', `${r.messages} mesaj · ${r.people} kişi · ${fmtDateTime(r.createdAt)}`);
    if (r.active) {
      meta.append(' · ');
      meta.append(el('span', 'on', `${r.online} çevrimiçi`));
    }

    btn.append(top, meta);
    btn.addEventListener('click', () => selectRoom(r.key));
    return btn;
  }

  let searchTimer = null;
  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = e.target.value.trim();
      state.page = 0;
      loadRooms();
    }, 300);
  });

  $('moreBtn').addEventListener('click', () => loadRooms({ append: true }));

  /* --- Oda ayrıntısı --- */

  function selectRoom(key) {
    state.selected = key;
    document.querySelectorAll('.room-item').forEach((b) => b.classList.toggle('selected', b.dataset.key === key));
    $('layout').classList.add('show-detail');
    loadDetail(key);
  }

  $('backBtn').addEventListener('click', () => {
    $('layout').classList.remove('show-detail');
  });

  $('refreshBtn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.classList.remove('spin');
    void btn.offsetWidth;
    btn.classList.add('spin');
    if (state.selected) loadDetail(state.selected);
    loadRooms({ silent: true });
  });

  document.querySelectorAll('.seg').forEach((b) => {
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      document.querySelectorAll('.seg').forEach((s) => s.setAttribute('aria-pressed', String(s === b)));
      if (state.detail) renderTimeline();
    });
  });

  async function loadDetail(key, { silent = false } = {}) {
    try {
      const data = await api('/rooms/' + encodeURIComponent(key));
      if (state.selected !== key) return; // bu arada başka oda seçildiyse
      const switched = state.detail?.key !== key;
      state.detail = data;
      renderDetail(switched);
    } catch (err) {
      if (err instanceof AuthError || silent) return;
      $('placeholder').hidden = false;
      $('placeholder').textContent = 'Oda kayıtları yüklenemedi.';
      $('detailBody').hidden = true;
    }
  }

  function renderDetail(jumpToEnd = false) {
    const d = state.detail;
    $('placeholder').hidden = true;
    $('detailBody').hidden = false;
    $('detailKey').textContent = d.key;

    const status = $('detailStatus');
    status.textContent = d.active ? 'Aktif' : 'Kapalı';
    status.classList.toggle('live', d.active);

    const events = d.events;
    const chats = events.filter((e) => e.type === 'chat').length;
    const nicks = new Set(events.filter((e) => e.type === 'join').map((e) => e.nick));
    const ips = new Set(events.filter((e) => e.ip).map((e) => e.ip));
    $('detailMeta').textContent = events.length
      ? `İlk kayıt ${fmtDateTime(events[0].ts)} · Son kayıt ${fmtDateTime(events[events.length - 1].ts)} · ${chats} mesaj · ${nicks.size} takma ad · ${ips.size} IP`
      : 'Bu oda için kayıt yok.';

    const online = $('onlineBox');
    online.hidden = !d.online.length;
    if (d.online.length) {
      online.replaceChildren(el('span', 'label', 'Şu an odada'));
      for (const m of d.online) {
        const p = el('span', 'person');
        p.append(el('span', 'mono', '#' + m.num), el('span', '', m.nick));
        if (m.voice) p.append(icon('mic'));
        p.append(el('span', 'mono', m.ip || ''));
        online.append(p);
      }
    }

    renderTimeline(jumpToEnd);
  }

  const LABELS = {
    room_open: 'Oda açıldı',
    room_close: 'Oda kapandı',
    join: 'Katıldı',
    leave: 'Ayrıldı',
    voice_join: 'Sese girdi',
    voice_leave: 'Sesten çıktı',
    chat: 'Mesaj',
  };

  function renderTimeline(jumpToEnd = false) {
    const list = $('timeline');
    const pane = document.querySelector('.detail-pane');
    const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
    const events = state.filter === 'chat'
      ? state.detail.events.filter((e) => e.type === 'chat')
      : state.detail.events;

    if (!events.length) {
      list.replaceChildren(el('li', 'timeline-empty', state.filter === 'chat' ? 'Bu odada yazılı mesaj yok.' : 'Kayıt yok.'));
      return;
    }

    const items = [];
    let lastDay = '';
    for (const e of events) {
      const day = new Date(e.ts).toDateString();
      if (day !== lastDay) {
        items.push(el('li', 'day', fmtDay(e.ts)));
        lastDay = day;
      }
      items.push(eventRow(e));
    }
    list.replaceChildren(...items);
    if (atBottom || jumpToEnd) pane.scrollTop = pane.scrollHeight;
  }

  function who(e) {
    const frag = document.createDocumentFragment();
    if (e.nick) frag.append(el('span', 'who', e.nick));
    if (e.num != null) frag.append(el('span', 'n', '#' + e.num));
    return frag;
  }

  function eventRow(e) {
    const li = el('li', 'ev ev-' + e.type);
    const time = el('time', '', fmtTime(e.ts));
    time.dateTime = new Date(e.ts).toISOString();
    time.title = fmtDateTime(e.ts);
    const body = el('div', 'ev-body');

    switch (e.type) {
      case 'chat':
        body.append(who(e), document.createTextNode(e.text || ''));
        break;
      case 'join': {
        body.append(who(e));
        if (e.ip) body.append(el('span', 'ip', e.ip));
        const ua = shortUA(e.text);
        if (ua) {
          const meta = el('span', 'meta', ' · ' + ua);
          meta.title = e.text;
          body.append(meta);
        }
        break;
      }
      case 'room_open':
        body.append(el('span', 'meta', 'Kuran IP: '), el('span', 'ip', e.ip || '—'));
        break;
      case 'room_close':
        body.append(el('span', 'meta', 'Odada kimse kalmadı'));
        break;
      default:
        body.append(who(e));
    }

    li.append(time, el('span', 'tag', LABELS[e.type] || e.type), body);
    return li;
  }

  /* ---------------- Başlangıç ---------------- */

  api('/me')
    .then(({ authed }) => (authed ? showPanel() : showLogin()))
    .catch(() => showLogin());
})();
