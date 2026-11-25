const GAMES = [
  { id: 'quip', icon: '⚡', name: 'Papo Furado', desc: 'Escreva a resposta mais engraçada e enfrente seus amigos na votação!' },
  { id: 'bluff', icon: '🤥', name: 'Mentira Sincera', desc: 'Invente mentiras convincentes para curiosidades bizarras e engane a sala!' },
  { id: 'sketch', icon: '🎨', name: 'Rabisco Caótico', desc: 'Desenhe no celular e tente adivinhar o título real dos desenhos na TV!' },
  { id: 'impostor', icon: '🕵️', name: 'O Impostor', desc: 'Todos sabem a palavra secreta, menos o Impostor. Descubra quem está blefando!' },
];

const stage = document.getElementById('tvStage');
const timerEl = document.getElementById('tvTimer');
const subtitleEl = document.getElementById('tvSubtitle');
const soundBtn = document.getElementById('soundBtn');
const nextBtn = document.getElementById('tvNextBtn');
const lobbyBtn = document.getElementById('tvLobbyBtn');

let ws = null;
let joinUrl = window.location.origin + '/';
let soundOn = true;
let audioCtx = null;
let lastPhaseType = null;
let lastPlayerCount = 0;

function playTone(freq, dur = 0.14, type = 'triangle', gainVal = 0.14) {
  if (!soundOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch {}
}

function playFanfare() {
  [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => playTone(f, 0.2, 'triangle', 0.16), i * 95));
}

soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  soundBtn.textContent = soundOn ? '🔊 Som' : '🔇 Mudo';
  if (soundOn) playTone(660, 0.12);
});

nextBtn.addEventListener('click', () => send({ type: 'advance' }));
lobbyBtn.addEventListener('click', () => send({ type: 'back_to_lobby' }));

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderPlayerChips(players, vipId, doneSet = null) {
  if (!players.length) {
    return '<p style="color:var(--muted);margin:0">Nenhum jogador entrou ainda — aponte a câmera do celular para o QR Code!</p>';
  }
  return players
    .map((p) => {
      const done = doneSet && doneSet.has(p.id);
      const cls = `player-chip ${done ? 'done' : ''} ${!p.connected ? 'offline' : ''}`;
      return `<div class="${cls}">
        <span>${esc(p.avatar)}</span>
        <span>${esc(p.name)}</span>
        ${p.id === vipId ? '<span class="vip-tag">VIP</span>' : ''}
        ${done ? '<span>✅</span>' : ''}
      </div>`;
    })
    .join('');
}

function render(state) {
  const { phase, players, vipId, selectedGame, remaining } = state;

  // Sounds on transitions
  const connectedCount = players.filter((p) => p.connected).length;
  if (connectedCount > lastPlayerCount) playTone(740, 0.12);
  lastPlayerCount = connectedCount;

  if (phase.type !== lastPhaseType) {
    if (phase.type.endsWith('_reveal') || phase.type === 'game_over') playFanfare();
    else if (phase.type !== 'lobby') playTone(520, 0.14);
    lastPhaseType = phase.type;
  } else if (remaining > 0 && remaining <= 5 && phase.type !== 'lobby' && phase.type !== 'game_over') {
    playTone(880, 0.06, 'sine', 0.08);
  }

  // Header controls
  const inLobby = phase.type === 'lobby';
  lobbyBtn.classList.toggle('hidden', inLobby);
  nextBtn.classList.toggle('hidden', inLobby || phase.type === 'game_over');

  if (remaining > 0 && !inLobby && phase.type !== 'game_over') {
    timerEl.textContent = `${remaining}s`;
    timerEl.classList.remove('hidden');
    timerEl.classList.toggle('urgent', remaining <= 10);
  } else {
    timerEl.classList.add('hidden');
  }

  const gameMeta = GAMES.find((g) => g.id === selectedGame) || GAMES[0];
  subtitleEl.textContent = inLobby
    ? `Acesse no celular: ${joinUrl}`
    : `${gameMeta.icon} ${gameMeta.name} — ${connectedCount} jogadores`;

  // Stage rendering
  if (phase.type === 'lobby') {
    stage.innerHTML = `
      <div class="lobby-grid">
        <div class="qr-panel">
          <h2 style="margin:0;font-size:1.5rem">Entre pelo Celular 📱</h2>
          <div class="qr-box"><img src="/qr.svg" alt="QR Code" /></div>
          <div class="join-url">${esc(joinUrl)}</div>
          <p style="color:var(--muted);margin:0;font-size:0.95rem">Todos no mesmo Wi-Fi podem escanear e jogar sem instalar nada!</p>
        </div>

        <div class="lobby-main">
          <div class="games-grid">
            ${GAMES.map((g) => `
              <button class="game-tile ${selectedGame === g.id ? 'selected' : ''}" data-select-game="${g.id}">
                <div class="g-icon">${g.icon}</div>
                <h3>${g.name}</h3>
                <p>${g.desc}</p>
              </button>
            `).join('')}
          </div>

          <div class="players-bar">
            <h4>Jogadores na Sala (${connectedCount})</h4>
            <div class="player-chips">${renderPlayerChips(players, vipId)}</div>
          </div>

          <div style="display:flex;justify-content:flex-end">
            <button class="btn btn-primary btn-lg" id="tvStartBtn" ${connectedCount < 2 ? 'disabled' : ''}>
              ▶ Iniciar ${gameMeta.name} ${connectedCount < 2 ? '(mín. 2 jogadores)' : ''}
            </button>
          </div>
        </div>
      </div>
    `;
    stage.querySelectorAll('[data-select-game]').forEach((el) => {
      el.addEventListener('click', () => send({ type: 'select_game', game: el.dataset.selectGame }));
    });
    document.getElementById('tvStartBtn')?.addEventListener('click', () => {
      send({ type: 'start_game', game: selectedGame });
    });
    return;
  }

  if (phase.type === 'quip_answer') {
    const doneSet = new Set(phase.doneIds || []);
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">⚡ Papo Furado • Rodada ${phase.round}/${phase.totalRounds}${phase.round === phase.totalRounds ? ' (2x PONTOS!)' : ''}</span>
        <h2 class="big-prompt">Olhe para o seu celular e responda! 📱</h2>
        <p class="sub-msg">Escreva a resposta mais engraçada que conseguir.</p>
        <div class="player-chips">${renderPlayerChips(players, null, doneSet)}</div>
      </div>
    `;
    return;
  }

  if (phase.type === 'quip_vote') {
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">⚡ Duelo ${phase.index}/${phase.total} • Vote no celular!</span>
        <h2 class="big-prompt">${esc(phase.prompt)}</h2>
        <div class="versus-grid">
          <div class="answer-card"><div class="answer-text">${esc(phase.answerA)}</div></div>
          <div class="vs-badge">VS</div>
          <div class="answer-card"><div class="answer-text">${esc(phase.answerB)}</div></div>
        </div>
        <p class="sub-msg">${phase.voteCount} voto(s) recebido(s)</p>
      </div>
    `;
    return;
  }

  if (phase.type === 'quip_reveal') {
    const aWins = phase.votesA > phase.votesB;
    const bWins = phase.votesB > phase.votesA;
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">⚡ Resultado do Duelo</span>
        <h2 class="big-prompt">${esc(phase.prompt)}</h2>
        <div class="versus-grid">
          <div class="answer-card ${aWins ? 'winner' : ''}">
            <div class="answer-text">${esc(phase.answerA)}</div>
            <div class="answer-meta">${esc(phase.authorA)} • <strong>${phase.votesA} voto(s)</strong> (+${phase.pointsA} pts)</div>
          </div>
          <div class="vs-badge">VS</div>
          <div class="answer-card ${bWins ? 'winner' : ''}">
            <div class="answer-text">${esc(phase.answerB)}</div>
            <div class="answer-meta">${esc(phase.authorB)} • <strong>${phase.votesB} voto(s)</strong> (+${phase.pointsB} pts)</div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  if (phase.type === 'bluff_write') {
    const doneSet = new Set(phase.doneIds || []);
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🤥 Mentira Sincera • ${esc(phase.category)} • Rodada ${phase.round}/${phase.totalRounds}</span>
        <h2 class="big-prompt">${esc(phase.question)}</h2>
        <p class="sub-msg">Invente uma mentira convincente no seu celular!</p>
        <div class="player-chips">${renderPlayerChips(players, null, doneSet)}</div>
      </div>
    `;
    return;
  }

  if (phase.type === 'bluff_vote') {
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🤥 Qual é a VERDADE? Vote no celular!</span>
        <h2 class="big-prompt">${esc(phase.question)}</h2>
        <div class="choices-grid">
          ${phase.choices.map((c) => `<div class="choice-card">${esc(c.text)}</div>`).join('')}
        </div>
        <p class="sub-msg">${phase.voteCount} voto(s) recebido(s)</p>
      </div>
    `;
    return;
  }

  if (phase.type === 'bluff_reveal') {
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🤥 A Verdade Revelada!</span>
        <h2 class="big-prompt">${esc(phase.question)}</h2>
        <div class="choices-grid">
          ${phase.items.map((it) => `
            <div class="choice-card ${it.isTruth ? 'truth' : ''}">
              <div>${it.isTruth ? '✅ ' : '🤥 '}${esc(it.text)}</div>
              <div class="choice-sub">${it.isTruth ? 'A VERDADE!' : `Mentira de ${esc(it.author)}`}</div>
              ${it.voters.length ? `<div class="choice-sub">Votaram: ${it.voters.map(esc).join(', ')}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    return;
  }

  if (phase.type === 'sketch_draw') {
    const doneSet = new Set(phase.doneIds || []);
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🎨 Rabisco Caótico</span>
        <h2 class="big-prompt">Hora de desenhar no celular! ✏️</h2>
        <p class="sub-msg">Faça a sua melhor obra de arte — os outros vão tentar adivinhar o que é!</p>
        <div class="player-chips">${renderPlayerChips(players, null, doneSet)}</div>
      </div>
    `;
    return;
  }

  if (phase.type === 'sketch_bluff') {
    const doneSet = new Set(phase.doneIds || []);
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🎨 Obra ${phase.index}/${phase.total} • Dê um título falso no celular!</span>
        <div class="sketch-frame"><img src="${phase.imageData}" alt="Desenho" /></div>
        <div class="player-chips">${renderPlayerChips(players, null, doneSet)}</div>
      </div>
    `;
    return;
  }

  if (phase.type === 'sketch_vote') {
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🎨 Obra ${phase.index}/${phase.total} • Qual é o título REAL?</span>
        <div class="sketch-frame"><img src="${phase.imageData}" alt="Desenho" /></div>
        <div class="choices-grid">
          ${phase.choices.map((c) => `<div class="choice-card">${esc(c.text)}</div>`).join('')}
        </div>
        <p class="sub-msg">${phase.voteCount} voto(s) recebido(s)</p>
      </div>
    `;
    return;
  }

  if (phase.type === 'sketch_reveal') {
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🎨 Artista: ${esc(phase.artist)}</span>
        <div class="sketch-frame"><img src="${phase.imageData}" alt="Desenho" /></div>
        <div class="choices-grid">
          ${phase.items.map((it) => `
            <div class="choice-card ${it.isTruth ? 'truth' : ''}">
              <div>${it.isTruth ? '✅ ' : '🎭 '}${esc(it.text)}</div>
              <div class="choice-sub">${it.isTruth ? 'TÍTULO REAL!' : `Título de ${esc(it.author)}`}</div>
              ${it.voters.length ? `<div class="choice-sub">Votaram: ${it.voters.map(esc).join(', ')}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    return;
  }

  if (phase.type === 'impostor_discuss') {
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🕵️ O Impostor • Rodada ${phase.round}/${phase.totalRounds}</span>
        <h2 class="big-prompt">Categoria: ${esc(phase.category)}</h2>
        <p class="sub-msg">Olhem a palavra secreta no celular! Cada pessoa fala 1 dica em voz alta sem entregar demais.<br>Há <strong>${phase.impostorCount} Impostor(es)</strong> entre vocês!</p>
        <button class="btn btn-primary btn-lg" id="goVoteBtn">Ir para Votação 🗳️</button>
      </div>
    `;
    document.getElementById('goVoteBtn')?.addEventListener('click', () => send({ type: 'advance' }));
    return;
  }

  if (phase.type === 'impostor_vote') {
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🕵️ Hora da Votação!</span>
        <h2 class="big-prompt">Quem é o Impostor? Vote no celular!</h2>
        <p class="sub-msg">${phase.voteCount} voto(s) recebido(s)</p>
      </div>
    `;
    return;
  }

  if (phase.type === 'impostor_guess') {
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🕵️ Impostor Descoberto!</span>
        <h2 class="big-prompt">${esc(phase.accusedName)} é o Impostor!</h2>
        <p class="sub-msg">Última chance: o Impostor tem ${remaining}s para chutar a palavra secreta da categoria <strong>${esc(phase.category)}</strong> e roubar a vitória!</p>
      </div>
    `;
    return;
  }

  if (phase.type === 'impostor_reveal') {
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🕵️ Fim da Rodada ${phase.round}/${phase.totalRounds}</span>
        <h2 class="big-prompt">${esc(phase.headline)}</h2>
        <p class="sub-msg">Impostor(es): <strong>${phase.impostorNames.map(esc).join(', ')}</strong> • Palavra secreta: <strong>${esc(phase.word)}</strong></p>
      </div>
    `;
    return;
  }

  if (phase.type === 'game_over') {
    const medals = ['🥇', '🥈', '🥉'];
    stage.innerHTML = `
      <div class="stage-center">
        <span class="kicker">🏆 Fim de Jogo!</span>
        <h2 class="big-prompt">Placar Final</h2>
        <div class="podium">
          ${phase.podium.map((p, i) => `
            <div class="podium-row">
              <span>${medals[i] || `${i + 1}º`} ${esc(p.avatar)} ${esc(p.name)}</span>
              <span style="color:var(--yellow)">${p.score} pts</span>
            </div>
          `).join('')}
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center">
          <button class="btn btn-primary btn-lg" id="playAgainBtn">🔄 Jogar de Novo</button>
          <button class="btn btn-lg" id="backLobbyEndBtn">🏠 Trocar de Jogo</button>
        </div>
      </div>
    `;
    document.getElementById('playAgainBtn')?.addEventListener('click', () => send({ type: 'start_game', game: selectedGame }));
    document.getElementById('backLobbyEndBtn')?.addEventListener('click', () => send({ type: 'back_to_lobby' }));
  }
}

async function init() {
  try {
    const info = await (await fetch('/api/info')).json();
    joinUrl = info.joinUrl || joinUrl;
  } catch {}

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => send({ type: 'watch_tv' });
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.role === 'tv') render(msg);
      } catch {}
    };
    ws.onclose = () => setTimeout(connect, 1500);
  }
  connect();
}

init();
