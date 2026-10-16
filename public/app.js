(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KEY_RE = /^[A-Za-z0-9_-]{4,64}$/;
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
  const NICK_STORAGE_KEY = 'mat-sohbet:nick';

  // Ses algılama (VAD) ayarları
  const VAD_INTERVAL_MS = 40;
  const VAD_THRESHOLD = 0.018; // RMS
  const VAD_HOLD_MS = 220; // kelime aralarında halka titremesin

  // Aynı kişinin art arda mesajları bu süre içinde tek başlık altında toplanır
  const GROUP_WINDOW_MS = 5 * 60 * 1000;

  /* ---------------- İkonlar (satır içi SVG, ağ bağımlılığı yok) ---------------- */

  const ICONS = {
    audio: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    micOff: '<path d="m2 2 20 20"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M12 19v3"/>',
    headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    headphonesOff: '<path d="M21 14h-1.343"/><path d="M9.128 3.47A9 9 0 0 1 21 12v3.343"/><path d="m2 2 20 20"/><path d="M20.414 20.414A2 2 0 0 1 19 21h-1a2 2 0 0 1-2-2v-3"/><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.636-6.364"/>',
    phoneOff: '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><path d="M22 2 2 22"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };

  function icon(name, className = '', strokeWidth = 2) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(strokeWidth));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', ('icon ' + className).trim());
    svg.innerHTML = ICONS[name];
    return svg;
  }

  function setIcon(svg, name, className) {
    svg.innerHTML = ICONS[name];
    if (className !== undefined) svg.setAttribute('class', ('icon ' + className).trim());
  }

  document.querySelectorAll('i[data-icon]').forEach((el) => {
    const svg = icon(el.dataset.icon, el.className);
    if (el.id) svg.id = el.id;
    el.replaceWith(svg);
  });

  /* ---------------- Takma ad ---------------- */

  let memoryNick = '';

  function cleanNick(nick) {
    return String(nick || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  }

  function loadNick() {
    try { return cleanNick(localStorage.getItem(NICK_STORAGE_KEY)) || memoryNick; } catch { return memoryNick; }
  }

  function saveNick(nick) {
    memoryNick = nick;
    try { localStorage.setItem(NICK_STORAGE_KEY, nick); } catch {}
  }

  // 12 karakterli, kriptografik rastgele anahtar (62 karakterlik alfabe, sapmasız örnekleme)
  function generateKey(length = 12) {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let out = '';
    while (out.length < length) {
      for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
        if (b < 248 && out.length < length) out += alphabet[b % 62];
      }
    }
    return out;
  }

  function showView(id) {
    for (const view of ['nickView', 'choiceView', 'roomView']) $(view).hidden = view !== id;
  }

  /* ---------------- Yönlendirme ---------------- */

  const route = location.pathname.match(/^\/r\/([A-Za-z0-9_-]{4,64})\/?$/);
  const pendingKey = route ? route[1] : null;
  if (!pendingKey && location.pathname !== '/') history.replaceState(null, '', '/');

  setupLanding();

  if (pendingKey && loadNick()) initRoom(pendingKey, loadNick());
  else showNickView();

  function showNickView() {
    showView('nickView');
    const input = $('nickInput');
    input.value = loadNick();
    input.focus();
    input.select();
  }

  function showChoiceView(nick) {
    showView('choiceView');
    $('nickLabel').textContent = nick;
  }

  /* ---------------- 1 + 2. Takma ad ve oda seçimi ---------------- */

  function setupLanding() {
    const nickInput = $('nickInput');
    const nickError = $('nickError');
    const createBtn = $('createBtn');
    const joinToggle = $('joinToggle');
    const joinPanel = $('joinPanel');
    const joinInput = $('joinInput');
    const joinSubmit = $('joinSubmit');
    const feedback = $('choiceFeedback');

    function say(text, isError = false) {
      feedback.hidden = !text;
      feedback.textContent = text;
      feedback.classList.toggle('error', isError);
    }

    nickInput.addEventListener('input', () => { nickError.hidden = true; });

    $('nickForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const nick = cleanNick(nickInput.value);
      if (!nick) {
        nickError.hidden = false;
        nickInput.focus();
        return;
      }
      saveNick(nick);
      if (pendingKey) initRoom(pendingKey, nick);
      else showChoiceView(nick);
    });

    $('changeNickBtn').addEventListener('click', showNickView);

    createBtn.addEventListener('click', () => {
      createBtn.disabled = true;
      say('Yeni ses alanı oluşturuluyor...');
      location.assign('/r/' + generateKey());
    });

    joinToggle.addEventListener('click', () => {
      const open = joinPanel.hidden;
      joinPanel.hidden = !open;
      joinToggle.setAttribute('aria-expanded', String(open));
      if (open) joinInput.focus();
      else say('');
    });

    joinInput.addEventListener('input', () => say(''));

    joinPanel.addEventListener('submit', async (e) => {
      e.preventDefault();
      let key = joinInput.value.trim();
      // Tam davet bağlantısı yapıştırılırsa anahtarı ayıkla
      const fromUrl = key.match(/\/r\/([A-Za-z0-9_-]+)/);
      if (fromUrl) key = fromUrl[1];

      if (!KEY_RE.test(key)) {
        say('Lütfen geçerli bir oda anahtarı girin.', true);
        joinInput.focus();
        return;
      }

      joinSubmit.disabled = true;
      say(`${key} alanına bağlanılıyor...`);
      try {
        const res = await fetch('/api/rooms/' + encodeURIComponent(key));
        const { exists } = await res.json();
        if (!exists) {
          say('Oda bulunamadı.', true);
          joinSubmit.disabled = false;
          return;
        }
        location.assign('/r/' + key);
      } catch {
        say('Sunucuya ulaşılamadı.', true);
        joinSubmit.disabled = false;
      }
    });

    // Geri tuşuyla önbellekten dönülünce butonlar kilitli kalmasın
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      createBtn.disabled = false;
      joinSubmit.disabled = false;
      say('');
    });
  }

  /* ---------------- 3. Oda ---------------- */

  function initRoom(key, nick) {
    showView('roomView');
    document.title = 'Echo';

    const membersEl = $('members');
    const messagesEl = $('messages');
    const emptyState = $('emptyState');
    const chatInput = $('chatInput');
    const connectBtn = $('connectBtn');
    const micBtn = $('micBtn');
    const deafBtn = $('deafBtn');
    const leaveBtn = $('leaveBtn');
    const roomHint = $('roomHint');
    const audioSinks = $('audioSinks');

    const members = new Map(); // id -> { num, nick, voice, muted, speaking, el, badgeIcon }
    const peers = new Map(); // id -> { pc, audio, pendingCandidates }
    let self = null;
    let historyRendered = false;
    let lastMessage = null; // gruplama için { id, ts }

    // Ses durumu
    let localStream = null;
    let audioCtx = null;
    let vadTimer = null;
    let muted = false;
    let deafened = false;
    let selfSpeaking = false;

    setupKeyCopy(key);

    const socket = io();

    /* --- Bağlantı ve oda üyeliği --- */

    socket.on('connect', () => {
      socket.emit('join', { key, nick }, (res) => {
        if (!res || res.error) {
          hint('Odaya katılınamadı.');
          return;
        }
        hint('');
        members.clear();
        membersEl.replaceChildren();
        self = res.self;
        res.members.forEach(addMember);
        document.title = `${self.nick} · Echo`;

        if (!historyRendered) {
          res.history.forEach(renderMessage);
          historyRendered = true;
        } else {
          systemMessage('yeniden bağlandı');
        }
      });
    });

    socket.on('disconnect', () => {
      if (localStream) leaveVoice();
      systemMessage('bağlantı koptu');
    });

    socket.on('member-joined', (m) => {
      addMember(m);
      systemMessage(`${m.nick} katıldı`);
    });

    socket.on('member-left', ({ id }) => {
      const m = members.get(id);
      closePeer(id);
      removeMember(id);
      if (m) systemMessage(`${m.nick} ayrıldı`);
    });

    socket.on('voice-state', ({ id, voice, muted: isMuted }) => {
      const patch = { voice, muted: !!isMuted };
      if (!voice || isMuted) patch.speaking = false;
      updateMember(id, patch);
      if (!voice) closePeer(id);
    });

    socket.on('speaking', ({ id, speaking }) => updateMember(id, { speaking }));

    socket.on('chat', renderMessage);

    socket.on('signal', handleSignal);

    function hint(text) {
      roomHint.hidden = !text;
      roomHint.textContent = text;
    }

    /* --- Katılımcı daireleri --- */

    function addMember({ id, num, nick: memberNick, voice, muted: isMuted, speaking }) {
      if (members.has(id)) removeMember(id);
      const isSelf = !!self && id === self.id;

      const el = document.createElement('div');
      el.className = 'member' + (isSelf ? ' self' : '');

      const wrap = document.createElement('div');
      wrap.className = 'avatar-wrap';
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = num;
      const badge = document.createElement('span');
      badge.className = 'mic-badge';
      const badgeIcon = icon('mic', '', 3);
      badge.appendChild(badgeIcon);
      wrap.append(avatar, badge);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = isSelf ? 'Sen' : memberNick;

      el.append(wrap, name);
      members.set(id, { num, nick: memberNick, voice: false, muted: false, speaking: false, el, badgeIcon });
      updateMember(id, { voice, muted: isMuted, speaking });
      placeInOrder();
      updateCount();
    }

    function removeMember(id) {
      const m = members.get(id);
      if (!m) return;
      m.el.remove();
      members.delete(id);
      updateCount();
    }

    function updateMember(id, patch) {
      const m = members.get(id);
      if (!m) return;
      Object.assign(m, patch);
      const voice = !!m.voice;
      const isMuted = voice && !!m.muted;
      m.el.classList.toggle('voice', voice);
      m.el.classList.toggle('muted', isMuted);
      m.el.classList.toggle('speaking', voice && !isMuted && !!m.speaking);
      setIcon(m.badgeIcon, isMuted ? 'micOff' : 'mic');
      const state = !voice ? 'yazılı sohbette' : isMuted ? 'sesli · susturulmuş' : 'sesli';
      m.el.title = `${m.num} · ${m.nick} · ${state}`;
    }

    function placeInOrder() {
      [...members.values()]
        .sort((a, b) => a.num - b.num)
        .forEach((m) => membersEl.appendChild(m.el));
    }

    function updateCount() {
      $('memberCount').textContent = `${members.size} Katılımcı`;
    }

    /* --- Yazılı sohbet --- */

    $('chatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text || !socket.connected) return;
      socket.emit('chat', text);
      chatInput.value = '';
    });

    function formatTime(ts) {
      return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    }

    function renderMessage({ id, num, nick: author, text, ts }) {
      const mine = !!self && id === self.id;
      const grouped = !!lastMessage && lastMessage.id === id && ts - lastMessage.ts < GROUP_WINDOW_MS;
      lastMessage = { id, ts };

      const row = document.createElement('div');
      row.className = 'msg' + (mine ? ' mine' : '') + (grouped ? ' cont' : '');

      if (!grouped) {
        const meta = document.createElement('div');
        meta.className = 'msg-meta';
        const name = document.createElement('span');
        name.className = 'msg-author';
        name.textContent = mine ? 'Sen' : (author || String(num));
        const time = document.createElement('span');
        time.className = 'msg-time';
        time.textContent = formatTime(ts);
        if (mine) meta.append(time, name);
        else meta.append(name, time);
        row.appendChild(meta);
      }

      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;
      row.appendChild(bubble);
      appendToChat(row, mine);
    }

    function systemMessage(text) {
      lastMessage = null;
      const row = document.createElement('div');
      row.className = 'msg sys';
      row.textContent = text;
      appendToChat(row, false);
    }

    function appendToChat(node, forceScroll) {
      emptyState.hidden = true;
      const nearBottom =
        messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
      messagesEl.appendChild(node);
      if (nearBottom || forceScroll) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    /* --- Ses kontrolleri --- */

    connectBtn.addEventListener('click', joinVoice);

    micBtn.addEventListener('click', () => {
      muted = !muted;
      localStream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
      if (muted && selfSpeaking) {
        selfSpeaking = false;
        socket.emit('speaking', false);
      }
      socket.emit('mute', muted);
      if (self) updateMember(self.id, { muted, speaking: false });
      renderMicButton();
    });

    deafBtn.addEventListener('click', () => {
      deafened = !deafened;
      peers.forEach((p) => { p.audio.muted = deafened; });
      renderDeafButton();
    });

    leaveBtn.addEventListener('click', () => {
      if (localStream) {
        leaveVoice();
      } else {
        socket.close();
        location.assign('/');
      }
    });

    function renderMicButton() {
      setIcon($('micIcon'), muted ? 'micOff' : 'mic', muted ? 'off' : 'accent');
      $('micLabel').textContent = muted ? 'Sessiz' : 'Mikrofon';
    }

    function renderDeafButton() {
      setIcon($('deafIcon'), deafened ? 'headphonesOff' : 'headphones', deafened ? 'off' : '');
      $('deafLabel').textContent = deafened ? 'Kapalı' : 'Kulaklık';
    }

    function setVoiceUI(connected) {
      connectBtn.disabled = false;
      connectBtn.hidden = connected;
      micBtn.hidden = !connected;
      deafBtn.hidden = !connected;
      setIcon($('leaveIcon'), connected ? 'phoneOff' : 'logout');
      $('leaveLabel').textContent = connected ? 'Ayrıl' : 'Odadan Çık';
      leaveBtn.title = connected ? 'Sesli sohbetten ayrıl' : 'Odadan çık';
      renderMicButton();
      renderDeafButton();
    }

    async function joinVoice() {
      if (!self || !socket.connected) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        hint('Mikrofon için HTTPS veya localhost gerekli.');
        return;
      }
      connectBtn.disabled = true;
      hint('');
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch {
        hint('Mikrofon izni alınamadı.');
        connectBtn.disabled = false;
        return;
      }

      muted = false;
      deafened = false;
      startVAD();
      updateMember(self.id, { voice: true, muted: false, speaking: false });
      setVoiceUI(true);

      socket.emit('voice-join', (res) => {
        (res?.peers || []).forEach(callPeer);
      });
    }

    function leaveVoice() {
      stopVAD();
      [...peers.keys()].forEach(closePeer);
      localStream?.getTracks().forEach((t) => t.stop());
      localStream = null;
      muted = false;
      deafened = false;
      selfSpeaking = false;
      if (socket.connected) socket.emit('voice-leave');
      if (self) updateMember(self.id, { voice: false, muted: false, speaking: false });
      setVoiceUI(false);
    }

    /* --- Ses algılama: Web Audio AnalyserNode --- */

    function startVAD() {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(localStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);

      const buf = new Float32Array(analyser.fftSize);
      let lastLoud = 0;

      // requestAnimationFrame arka plan sekmesinde durur; setInterval devam eder.
      vadTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);

        const now = performance.now();
        if (!muted && rms > VAD_THRESHOLD) lastLoud = now;
        const speaking = !muted && now - lastLoud < VAD_HOLD_MS;

        if (speaking !== selfSpeaking) {
          selfSpeaking = speaking;
          updateMember(self.id, { speaking });
          socket.emit('speaking', speaking);
        }
      }, VAD_INTERVAL_MS);
    }

    function stopVAD() {
      clearInterval(vadTimer);
      vadTimer = null;
      audioCtx?.close().catch(() => {});
      audioCtx = null;
    }

    /* --- WebRTC mesh --- */

    function createPeer(id) {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.muted = deafened;
      audioSinks.appendChild(audio);

      const peer = { pc, audio, pendingCandidates: [] };
      peers.set(id, peer);

      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('signal', { to: id, data: { candidate: e.candidate } });
      };
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0] || new MediaStream([e.track]);
        audio.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') closePeer(id);
      };
      return peer;
    }

    async function callPeer(id) {
      if (!localStream || peers.has(id)) return;
      const { pc } = createPeer(id);
      try {
        await pc.setLocalDescription(await pc.createOffer());
        socket.emit('signal', { to: id, data: { sdp: pc.localDescription } });
      } catch (err) {
        console.error('offer', err);
        closePeer(id);
      }
    }

    async function handleSignal({ from, data }) {
      if (!localStream || !data) return;
      let peer = peers.get(from);

      try {
        if (data.sdp?.type === 'offer') {
          if (!peer) peer = createPeer(from);
          await peer.pc.setRemoteDescription(data.sdp);
          await flushCandidates(peer);
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          socket.emit('signal', { to: from, data: { sdp: peer.pc.localDescription } });
        } else if (data.sdp?.type === 'answer') {
          if (!peer) return;
          await peer.pc.setRemoteDescription(data.sdp);
          await flushCandidates(peer);
        } else if (data.candidate) {
          if (!peer) return;
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
          else peer.pendingCandidates.push(data.candidate);
        }
      } catch (err) {
        console.error('signal', err);
      }
    }

    async function flushCandidates(peer) {
      for (const c of peer.pendingCandidates.splice(0)) {
        try { await peer.pc.addIceCandidate(c); } catch (err) { console.error('ice', err); }
      }
    }

    function closePeer(id) {
      const peer = peers.get(id);
      if (!peer) return;
      peer.pc.close();
      peer.audio.srcObject = null;
      peer.audio.remove();
      peers.delete(id);
    }

    window.addEventListener('pagehide', () => {
      if (localStream) leaveVoice();
      socket.close();
    });

    setVoiceUI(false);
  }

  /* --- Anahtar kopyalama --- */

  function setupKeyCopy(key) {
    const btn = $('keyBtn');
    const text = $('keyText');
    const keyIcon = $('keyIcon');
    const label = `#${key} • Ses Kanalı`;
    text.textContent = label;
    let resetTimer = null;

    btn.addEventListener('click', async () => {
      const ok = await copyText(key);
      text.textContent = ok ? 'Anahtar kopyalandı' : 'Kopyalanamadı';
      btn.classList.toggle('copied', ok);
      setIcon(keyIcon, ok ? 'check' : 'copy');
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        text.textContent = label;
        btn.classList.remove('copied');
        setIcon(keyIcon, 'copy');
      }, 1500);
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // HTTP üzerinden (LAN) açıldığında Clipboard API olmayabilir
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
      return ok;
    }
  }
})();
