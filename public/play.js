const AVATARS = ['😎', '🤠', '🦊', '🐱', '🐶', '🐸', '👽', '🤖', '👻', '🦄', '🍕', '🔥'];
const GAMES = [
  { id: 'quip', icon: '⚡', name: 'Papo Furado' },
  { id: 'bluff', icon: '🤥', name: 'Mentira Sincera' },
  { id: 'sketch', icon: '🎨', name: 'Rabisco Caótico' },
  { id: 'impostor', icon: '🕵️', name: 'O Impostor' },
];

const stage = document.getElementById('playStage');
const timerEl = document.getElementById('playTimer');
const meBadge = document.getElementById('playMeBadge');
const errorBanner = document.getElementById('errorBanner');

let ws = null;
let joined = false;
let lastRenderKey = null;
let secretHidden = false;

let playerId = localStorage.getItem('partybox_pid');
if (!playerId) {
  playerId = 'p_' + Math.random().toString(36).slice(2, 10);
  localStorage.setItem('partybox_pid', playerId);
}
let savedName = localStorage.getItem('partybox_name') || '';
let selectedAvatar = localStorage.getItem('partybox_avatar') || AVATARS[0];

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

let errTimer = null;
function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove('hidden');
  clearTimeout(errTimer);
  errTimer = setTimeout(() => errorBanner.classList.add('hidden'), 3500);
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// Initial Join Screen setup
const avatarGrid = document.getElementById('avatarGrid');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');

nameInput.value = savedName;
avatarGrid.innerHTML = AVATARS.map(
  (av) => `<button type="button" class="avatar-btn ${av === selectedAvatar ? 'selected' : ''}" data-av="${av}">${av}</button>`
).join('');

avatarGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.avatar-btn');
  if (!btn) return;
  selectedAvatar = btn.dataset.av;
  avatarGrid.querySelectorAll('.avatar-btn').forEach((b) => b.classList.toggle('selected', b === btn));
});

function doJoin() {
  const name = nameInput.value.trim() || 'Jogador';
  localStorage.setItem('partybox_name', name);
  localStorage.setItem('partybox_avatar', selectedAvatar);
  savedName = name;
  joined = true;
  send({ type: 'join', player_id: playerId, name, avatar: selectedAvatar });
}

joinBtn.addEventListener('click', doJoin);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

function render(state) {
  const { phase, isVip, me, remaining, selectedGame } = state;

  if (me) {
    meBadge.textContent = `${me.avatar} ${me.name} • ${me.score} pts`;
  }

  if (remaining > 0 && phase.type !== 'lobby' && phase.type !== 'game_over') {
    timerEl.textContent = `${remaining}s`;
    timerEl.classList.remove('hidden');
    timerEl.classList.toggle('urgent', remaining <= 10);
  } else {
    timerEl.classList.add('hidden');
  }

  // Only re-render DOM when phase or key state changes (never interrupt typing/drawing!)
  const renderKey = JSON.stringify({
    t: phase.type,
    vip: isVip,
    g: selectedGame,
    pc: phase.playerCount,
    done: phase.done,
    voted: phase.voted,
    p: phase.prompts,
    q: phase.question,
    pr: phase.prompt,
    c: phase.choices?.length,
    s: phase.suspects?.length,
    imp: phase.isImpostor,
    art: phase.isArtist,
    cont: phase.isContestant,
    hid: secretHidden,
  });
  if (renderKey === lastRenderKey) return;
  lastRenderKey = renderKey;

  if (phase.type === 'lobby') {
    if (isVip) {
      stage.innerHTML = `
        <div class="play-card">
          <h2>Você é o VIP 👑</h2>
          <p>Escolha o jogo e aperte Iniciar quando todos entrarem (${phase.playerCount} conectado(s)):</p>
          <div class="vote-list">
            ${GAMES.map((g) => `
              <button class="btn vote-btn ${selectedGame === g.id ? 'btn-primary' : ''}" data-pick="${g.id}">
                ${g.icon} ${g.name}
              </button>
            `).join('')}
          </div>
          <button class="btn btn-cyan btn-lg btn-block" id="vipStartBtn" ${phase.playerCount < 2 ? 'disabled' : ''}>
            ▶ Iniciar Jogo
          </button>
        </div>
      `;
      stage.querySelectorAll('[data-pick]').forEach((b) => {
        b.addEventListener('click', () => send({ type: 'select_game', game: b.dataset.pick }));
      });
      document.getElementById('vipStartBtn')?.addEventListener('click', () => {
        send({ type: 'start_game', game: selectedGame });
      });
    } else {
      stage.innerHTML = `
        <div class="play-card">
          <h2>Você está na sala! 🎉</h2>
          <p>Olhe para a TV e aguarde o VIP iniciar o jogo.</p>
        </div>
      `;
    }
    return;
  }

  if (phase.type === 'quip_answer') {
    const nextPrompt = (phase.prompts || []).find((p) => !p.done);
    if (!nextPrompt) {
      stage.innerHTML = `<div class="play-card"><h2>Respostas enviadas! ✅</h2><p>Aguarde os outros jogadores terminarem.</p></div>`;
      return;
    }
    stage.innerHTML = `
      <div class="play-card">
        <h2>⚡ Papo Furado</h2>
        <p style="color:var(--text);font-size:1.1rem;font-weight:700">${esc(nextPrompt.prompt)}</p>
        <textarea class="textarea-big" id="ansInput" rows="3" maxlength="100" placeholder="Digite sua resposta mais engraçada…"></textarea>
        <button class="btn btn-primary btn-lg btn-block" id="sendAnsBtn">Enviar Resposta</button>
      </div>
    `;
    document.getElementById('sendAnsBtn').addEventListener('click', () => {
      const text = document.getElementById('ansInput').value.trim();
      if (text) send({ type: 'submit_text', text, slot: nextPrompt.slot });
    });
    return;
  }

  if (phase.type === 'quip_vote') {
    if (phase.isContestant) {
      stage.innerHTML = `<div class="play-card"><h2>Sua resposta está na tela! 🤞</h2><p>Torça pelos votos na TV!</p></div>`;
      return;
    }
    if (phase.voted) {
      stage.innerHTML = `<div class="play-card"><h2>Voto enviado! ✅</h2><p>Olhe para a TV!</p></div>`;
      return;
    }
    stage.innerHTML = `
      <div class="play-card">
        <h2>Vote na mais engraçada! 😂</h2>
        <p>${esc(phase.prompt)}</p>
        <div class="vote-list">
          <button class="btn vote-btn" data-vote="a">${esc(phase.answerA)}</button>
          <button class="btn vote-btn" data-vote="b">${esc(phase.answerB)}</button>
        </div>
      </div>
    `;
    stage.querySelectorAll('[data-vote]').forEach((b) => {
      b.addEventListener('click', () => send({ type: 'submit_vote', choice: b.dataset.vote }));
    });
    return;
  }

  if (phase.type === 'bluff_write') {
    if (phase.done) {
      stage.innerHTML = `<div class="play-card"><h2>Mentira enviada! 🤥</h2><p>Aguarde os outros jogadores.</p></div>`;
      return;
    }
    stage.innerHTML = `
      <div class="play-card">
        <h2>🤥 Invente uma Mentira</h2>
        <p style="color:var(--text);font-weight:700">${esc(phase.question)}</p>
        <input class="input-big" id="bluffInput" maxlength="70" placeholder="O que completa a lacuna?" autocomplete="off" />
        <button class="btn btn-primary btn-lg btn-block" id="sendBluffBtn">Enviar Mentira</button>
      </div>
    `;
    document.getElementById('sendBluffBtn').addEventListener('click', () => {
      const text = document.getElementById('bluffInput').value.trim();
      if (text) send({ type: 'submit_text', text });
    });
    return;
  }

  if (phase.type === 'bluff_vote' || phase.type === 'sketch_vote') {
    if (phase.isArtist) {
      stage.innerHTML = `<div class="play-card"><h2>É o seu desenho! 🎨</h2><p>Torça para adivinharem o título real na TV!</p></div>`;
      return;
    }
    if (phase.voted) {
      stage.innerHTML = `<div class="play-card"><h2>Voto registrado! ✅</h2><p>Olhe para a TV!</p></div>`;
      return;
    }
    stage.innerHTML = `
      <div class="play-card">
        <h2>${phase.type === 'bluff_vote' ? 'Qual é a VERDADE? 🧐' : 'Qual é o título REAL? 🎨'}</h2>
        <div class="vote-list">
          ${(phase.choices || []).map((c) => `<button class="btn vote-btn" data-vote="${esc(c.id)}">${esc(c.text)}</button>`).join('')}
        </div>
      </div>
    `;
    stage.querySelectorAll('[data-vote]').forEach((b) => {
      b.addEventListener('click', () => send({ type: 'submit_vote', choice: b.dataset.vote }));
    });
    return;
  }

  if (phase.type === 'sketch_draw') {
    if (phase.done) {
      stage.innerHTML = `<div class="play-card"><h2>Obra de arte enviada! 🎨</h2><p>Aguarde os outros artistas.</p></div>`;
      return;
    }
    renderDrawingPad(phase.prompt);
    return;
  }

  if (phase.type === 'sketch_bluff') {
    if (phase.isArtist) {
      stage.innerHTML = `<div class="play-card"><h2>Seu desenho está na TV! 🎨</h2><p>Os outros estão inventando títulos falsos…</p></div>`;
      return;
    }
    if (phase.done) {
      stage.innerHTML = `<div class="play-card"><h2>Título enviado! ✅</h2><p>Aguarde os outros jogadores.</p></div>`;
      return;
    }
    stage.innerHTML = `
      <div class="play-card">
        <h2>🎨 O que é isso na TV?</h2>
        <p>Escreva um título convincente (ou engraçado) para enganar os outros!</p>
        <input class="input-big" id="sketchBluffInput" maxlength="70" placeholder="Seu título falso…" autocomplete="off" />
        <button class="btn btn-primary btn-lg btn-block" id="sendSketchBluffBtn">Enviar Título</button>
      </div>
    `;
    document.getElementById('sendSketchBluffBtn').addEventListener('click', () => {
      const text = document.getElementById('sketchBluffInput').value.trim();
      if (text) send({ type: 'submit_text', text });
    });
    return;
  }

  if (phase.type === 'impostor_discuss') {
    stage.innerHTML = `
      <div class="play-card">
        <div class="secret-box ${phase.isImpostor ? 'impostor' : ''}">
          <div style="font-size:0.9rem;color:var(--muted)">Categoria: <strong>${esc(phase.category)}</strong></div>
          ${
            secretHidden
              ? '<div class="secret-word">🙈 Oculto</div>'
              : phase.isImpostor
              ? '<div class="secret-word">🕵️ VOCÊ É O IMPOSTOR!</div><p>Finja que sabe a palavra e tente descobrir o que é!</p>'
              : `<div class="secret-word">${esc(phase.word)}</div><p>Dê uma dica em voz alta sem entregar a palavra pro Impostor!</p>`
          }
        </div>
        <button class="btn btn-block" id="toggleSecretBtn">${secretHidden ? '👁️ Mostrar Palavra' : '🙈 Esconder Tela'}</button>
        ${isVip ? '<button class="btn btn-primary btn-lg btn-block" id="vipVoteBtn">Ir para Votação 🗳️</button>' : ''}
      </div>
    `;
    document.getElementById('toggleSecretBtn').addEventListener('click', () => {
      secretHidden = !secretHidden;
      lastRenderKey = null;
      render(state);
    });
    document.getElementById('vipVoteBtn')?.addEventListener('click', () => send({ type: 'advance' }));
    return;
  }

  if (phase.type === 'impostor_vote') {
    if (phase.voted) {
      stage.innerHTML = `<div class="play-card"><h2>Voto secreto enviado! 🗳️</h2><p>Olhe para a TV!</p></div>`;
      return;
    }
    stage.innerHTML = `
      <div class="play-card">
        <h2>🕵️ Quem é o Impostor?</h2>
        <div class="vote-list">
          ${(phase.suspects || []).map((s) => `<button class="btn vote-btn" data-vote="${esc(s.id)}">${esc(s.name)}</button>`).join('')}
        </div>
      </div>
    `;
    stage.querySelectorAll('[data-vote]').forEach((b) => {
      b.addEventListener('click', () => send({ type: 'submit_vote', choice: b.dataset.vote }));
    });
    return;
  }

  if (phase.type === 'impostor_guess') {
    if (!phase.isImpostor) {
      stage.innerHTML = `<div class="play-card"><h2>Você pegou o Impostor! 🎯</h2><p>Ele tem 1 última chance de chutar a palavra na TV…</p></div>`;
      return;
    }
    stage.innerHTML = `
      <div class="play-card">
        <h2>🕵️ Última Chance!</h2>
        <p>Você foi descoberto! Chute a palavra secreta da categoria <strong>${esc(phase.category)}</strong> para roubar a vitória:</p>
        <input class="input-big" id="guessInput" maxlength="60" placeholder="Qual era a palavra?" autocomplete="off" />
        <button class="btn btn-primary btn-lg btn-block" id="sendGuessBtn">Arriscar Palavra!</button>
      </div>
    `;
    document.getElementById('sendGuessBtn').addEventListener('click', () => {
      const text = document.getElementById('guessInput').value.trim();
      if (text) send({ type: 'submit_text', text });
    });
    return;
  }

  if (phase.type === 'watch_tv') {
    stage.innerHTML = `
      <div class="play-card">
        <h2>${esc(phase.message || 'Olhe para a TV! 📺')}</h2>
        ${isVip ? '<button class="btn btn-block" id="vipNextBtn">Avançar ⏭</button>' : ''}
      </div>
    `;
    document.getElementById('vipNextBtn')?.addEventListener('click', () => send({ type: 'advance' }));
    return;
  }

  if (phase.type === 'game_over') {
    stage.innerHTML = `
      <div class="play-card">
        <h2>🏆 Fim de Jogo!</h2>
        <p>Veja o pódio final na TV!</p>
        ${
          isVip
            ? `<button class="btn btn-primary btn-lg btn-block" id="vipAgainBtn">🔄 Jogar de Novo</button>
               <button class="btn btn-block" id="vipLobbyBtn">🏠 Voltar ao Lobby</button>`
            : ''
        }
      </div>
    `;
    document.getElementById('vipAgainBtn')?.addEventListener('click', () => send({ type: 'start_game', game: selectedGame }));
    document.getElementById('vipLobbyBtn')?.addEventListener('click', () => send({ type: 'back_to_lobby' }));
  }
}

function renderDrawingPad(prompt) {
  const colors = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
  stage.innerHTML = `
    <div class="play-card">
      <h2>🎨 Desenhe:</h2>
      <p style="color:var(--yellow);font-size:1.15rem;font-weight:800">${esc(prompt)}</p>
      <div class="canvas-wrap">
        <canvas id="drawCanvas" width="420" height="340"></canvas>
      </div>
      <div class="palette" id="palette">
        ${colors.map((c, i) => `<button type="button" class="swatch ${i === 0 ? 'active' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn" id="undoBtn" style="flex:1">↩ Desfazer</button>
        <button type="button" class="btn" id="clearBtn" style="flex:1">🗑 Limpar</button>
      </div>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="sendDrawBtn">Enviar Desenho 🎨</button>
    </div>
  `;

  const canvas = document.getElementById('drawCanvas');
  const ctx = canvas.getContext('2d');
  let color = colors[0];
  let strokes = [];
  let current = null;

  function redraw() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      if (s.pts.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
      ctx.stroke();
    }
  }
  redraw();

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    return {
      x: ((pt.clientX - rect.left) / rect.width) * canvas.width,
      y: ((pt.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startDraw(e) {
    e.preventDefault();
    const pos = getPos(e);
    current = { color, pts: [pos, { x: pos.x + 0.1, y: pos.y + 0.1 }] };
    strokes.push(current);
    redraw();
  }
  function moveDraw(e) {
    if (!current) return;
    e.preventDefault();
    current.pts.push(getPos(e));
    redraw();
  }
  function endDraw() { current = null; }

  canvas.addEventListener('pointerdown', startDraw);
  canvas.addEventListener('pointermove', moveDraw);
  window.addEventListener('pointerup', endDraw);

  document.getElementById('palette').addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    color = sw.dataset.color;
    document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === sw));
  });
  document.getElementById('undoBtn').addEventListener('click', () => { strokes.pop(); redraw(); });
  document.getElementById('clearBtn').addEventListener('click', () => { strokes = []; redraw(); });
  document.getElementById('sendDrawBtn').addEventListener('click', () => {
    const dataUrl = canvas.toDataURL('image/png');
    send({ type: 'submit_drawing', image_data: dataUrl });
  });
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onopen = () => {
    if (joined && savedName) {
      send({ type: 'join', player_id: playerId, name: savedName, avatar: selectedAvatar });
    }
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'error') {
        showError(msg.message);
      } else if (msg.role === 'player') {
        render(msg);
      }
    } catch {}
  };
  ws.onclose = () => setTimeout(connect, 1500);
}

connect();
