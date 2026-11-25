import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';

interface GameMeta {
  id: string;
  icon: string;
  name: string;
  desc: string;
}

const GAMES: GameMeta[] = [
  { id: 'quip', icon: '⚡', name: 'Papo Furado', desc: 'Escreva a resposta mais engraçada e enfrente seus amigos na votação!' },
  { id: 'bluff', icon: '🤥', name: 'Mentira Sincera', desc: 'Invente mentiras convincentes para curiosidades bizarras e engane a sala!' },
  { id: 'sketch', icon: '🎨', name: 'Rabisco Caótico', desc: 'Desenhe no celular e tente adivinhar o título real dos desenhos na TV!' },
  { id: 'impostor', icon: '🕵️', name: 'O Impostor', desc: 'Todos sabem a palavra secreta, menos o Impostor. Descubra quem está blefando!' },
];

@Component({
  selector: 'app-party-tv',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, MatChipsModule],
  template: `
    <div class="tv-shell">
      <header class="tv-header">
        <div class="tv-brand">
          <div class="tv-logo">🎉</div>
          <div>
            <h1 class="tv-title">PartyBox</h1>
            <div class="tv-sub">
              @if (state()?.phase?.type === 'lobby') {
                Acesse no celular: {{ joinUrl() }}
              } @else {
                {{ currentGameMeta().icon }} {{ currentGameMeta().name }} — {{ connectedCount() }} jogadores
              }
            </div>
          </div>
        </div>

        <div class="tv-actions">
          @if (showTimer()) {
            <div class="timer-pill" [class.urgent]="(state()?.remaining ?? 0) <= 10">
              {{ state()?.remaining }}s
            </div>
          }
          <button mat-stroked-button (click)="toggleSound()">
            <mat-icon>{{ soundOn() ? 'volume_up' : 'volume_off' }}</mat-icon>
            {{ soundOn() ? 'Som' : 'Mudo' }}
          </button>
          @if (state()?.phase?.type && state()?.phase?.type !== 'lobby' && state()?.phase?.type !== 'game_over') {
            <button mat-stroked-button (click)="send({ type: 'advance' })">
              <mat-icon>skip_next</mat-icon> Avançar
            </button>
          }
          @if (state()?.phase?.type && state()?.phase?.type !== 'lobby') {
            <button mat-stroked-button (click)="send({ type: 'back_to_lobby' })">
              <mat-icon>home</mat-icon> Lobby
            </button>
          }
        </div>
      </header>

      @if (state(); as st) {
        <main class="tv-stage">
          @switch (st.phase.type) {
            @case ('lobby') {
              <div class="lobby-grid">
                <mat-card appearance="outlined" class="qr-card">
                  <h2>Entre pelo Celular 📱</h2>
                  <div class="qr-box"><img src="/qr.svg" alt="QR Code" /></div>
                  <div class="join-url">{{ joinUrl() }}</div>
                  <p class="muted">Todos no mesmo Wi-Fi podem escanear e jogar sem instalar nada!</p>
                </mat-card>

                <div class="lobby-main">
                  <div class="games-grid">
                    @for (g of games; track g.id) {
                      <mat-card
                        appearance="outlined"
                        class="game-tile"
                        [class.selected]="st.selectedGame === g.id"
                        (click)="send({ type: 'select_game', game: g.id })"
                      >
                        <div class="g-icon">{{ g.icon }}</div>
                        <h3>{{ g.name }}</h3>
                        <p>{{ g.desc }}</p>
                      </mat-card>
                    }
                  </div>

                  <mat-card appearance="outlined" class="players-card">
                    <h4>Jogadores na Sala ({{ connectedCount() }})</h4>
                    <div class="chips">
                      @if (st.players.length === 0) {
                        <p class="muted">Nenhum jogador entrou ainda — aponte a câmera do celular para o QR Code!</p>
                      } @else {
                        @for (p of st.players; track p.id) {
                          <div class="p-chip" [class.offline]="!p.connected">
                            <span>{{ p.avatar }}</span>
                            <span>{{ p.name }}</span>
                            @if (p.id === st.vipId) {
                              <span class="vip-tag">VIP</span>
                            }
                          </div>
                        }
                      }
                    </div>
                  </mat-card>

                  <div class="start-row">
                    <button
                      mat-flat-button
                      class="start-btn"
                      [disabled]="connectedCount() < 2"
                      (click)="send({ type: 'start_game', game: st.selectedGame })"
                    >
                      <mat-icon>play_arrow</mat-icon>
                      Iniciar {{ currentGameMeta().name }}
                      @if (connectedCount() < 2) { (mín. 2 jogadores) }
                    </button>
                  </div>
                </div>
              </div>
            }

            @case ('quip_answer') {
              <div class="center">
                <span class="kicker">⚡ Papo Furado • Rodada {{ st.phase.round }}/{{ st.phase.totalRounds }}{{ st.phase.round === st.phase.totalRounds ? ' (2x PONTOS!)' : '' }}</span>
                <h2 class="big-prompt">Olhe para o seu celular e responda! 📱</h2>
                <p class="sub-msg">Escreva a resposta mais engraçada que conseguir.</p>
                <div class="chips">
                  @for (p of st.players; track p.id) {
                    <div class="p-chip" [class.done]="isDone(st.phase.doneIds, p.id)" [class.offline]="!p.connected">
                      <span>{{ p.avatar }}</span><span>{{ p.name }}</span>
                      @if (isDone(st.phase.doneIds, p.id)) { <span>✅</span> }
                    </div>
                  }
                </div>
              </div>
            }

            @case ('quip_vote') {
              <div class="center">
                <span class="kicker">⚡ Duelo {{ st.phase.index }}/{{ st.phase.total }} • Vote no celular!</span>
                <h2 class="big-prompt">{{ st.phase.prompt }}</h2>
                <div class="versus">
                  <mat-card appearance="outlined" class="ans-card"><div class="ans-text">{{ st.phase.answerA }}</div></mat-card>
                  <div class="vs">VS</div>
                  <mat-card appearance="outlined" class="ans-card"><div class="ans-text">{{ st.phase.answerB }}</div></mat-card>
                </div>
                <p class="sub-msg">{{ st.phase.voteCount }} voto(s) recebido(s)</p>
              </div>
            }

            @case ('quip_reveal') {
              <div class="center">
                <span class="kicker">⚡ Resultado do Duelo</span>
                <h2 class="big-prompt">{{ st.phase.prompt }}</h2>
                <div class="versus">
                  <mat-card appearance="outlined" class="ans-card" [class.winner]="st.phase.votesA > st.phase.votesB">
                    <div class="ans-text">{{ st.phase.answerA }}</div>
                    <div class="ans-meta">{{ st.phase.authorA }} • <strong>{{ st.phase.votesA }} voto(s)</strong> (+{{ st.phase.pointsA }} pts)</div>
                  </mat-card>
                  <div class="vs">VS</div>
                  <mat-card appearance="outlined" class="ans-card" [class.winner]="st.phase.votesB > st.phase.votesA">
                    <div class="ans-text">{{ st.phase.answerB }}</div>
                    <div class="ans-meta">{{ st.phase.authorB }} • <strong>{{ st.phase.votesB }} voto(s)</strong> (+{{ st.phase.pointsB }} pts)</div>
                  </mat-card>
                </div>
              </div>
            }

            @case ('bluff_write') {
              <div class="center">
                <span class="kicker">🤥 Mentira Sincera • {{ st.phase.category }} • Rodada {{ st.phase.round }}/{{ st.phase.totalRounds }}</span>
                <h2 class="big-prompt">{{ st.phase.question }}</h2>
                <p class="sub-msg">Invente uma mentira convincente no seu celular!</p>
                <div class="chips">
                  @for (p of st.players; track p.id) {
                    <div class="p-chip" [class.done]="isDone(st.phase.doneIds, p.id)">
                      <span>{{ p.avatar }}</span><span>{{ p.name }}</span>
                      @if (isDone(st.phase.doneIds, p.id)) { <span>✅</span> }
                    </div>
                  }
                </div>
              </div>
            }

            @case ('bluff_vote') {
              <div class="center">
                <span class="kicker">🤥 Qual é a VERDADE? Vote no celular!</span>
                <h2 class="big-prompt">{{ st.phase.question }}</h2>
                <div class="choices-grid">
                  @for (c of st.phase.choices; track c.id) {
                    <mat-card appearance="outlined" class="choice-card">{{ c.text }}</mat-card>
                  }
                </div>
                <p class="sub-msg">{{ st.phase.voteCount }} voto(s) recebido(s)</p>
              </div>
            }

            @case ('bluff_reveal') {
              <div class="center">
                <span class="kicker">🤥 A Verdade Revelada!</span>
                <h2 class="big-prompt">{{ st.phase.question }}</h2>
                <div class="choices-grid">
                  @for (it of st.phase.items; track $index) {
                    <mat-card appearance="outlined" class="choice-card" [class.truth]="it.isTruth">
                      <div>{{ it.isTruth ? '✅ ' : '🤥 ' }}{{ it.text }}</div>
                      <div class="choice-sub">{{ it.isTruth ? 'A VERDADE!' : 'Mentira de ' + it.author }}</div>
                      @if (it.voters?.length) {
                        <div class="choice-sub">Votaram: {{ it.voters.join(', ') }}</div>
                      }
                    </mat-card>
                  }
                </div>
              </div>
            }

            @case ('sketch_draw') {
              <div class="center">
                <span class="kicker">🎨 Rabisco Caótico</span>
                <h2 class="big-prompt">Hora de desenhar no celular! ✏️</h2>
                <p class="sub-msg">Faça a sua melhor obra de arte — os outros vão tentar adivinhar o que é!</p>
                <div class="chips">
                  @for (p of st.players; track p.id) {
                    <div class="p-chip" [class.done]="isDone(st.phase.doneIds, p.id)">
                      <span>{{ p.avatar }}</span><span>{{ p.name }}</span>
                      @if (isDone(st.phase.doneIds, p.id)) { <span>✅</span> }
                    </div>
                  }
                </div>
              </div>
            }

            @case ('sketch_bluff') {
              <div class="center">
                <span class="kicker">🎨 Obra {{ st.phase.index }}/{{ st.phase.total }} • Dê um título falso no celular!</span>
                <div class="sketch-frame"><img [src]="st.phase.imageData" alt="Desenho" /></div>
                <div class="chips">
                  @for (p of st.players; track p.id) {
                    <div class="p-chip" [class.done]="isDone(st.phase.doneIds, p.id)">
                      <span>{{ p.avatar }}</span><span>{{ p.name }}</span>
                      @if (isDone(st.phase.doneIds, p.id)) { <span>✅</span> }
                    </div>
                  }
                </div>
              </div>
            }

            @case ('sketch_vote') {
              <div class="center">
                <span class="kicker">🎨 Obra {{ st.phase.index }}/{{ st.phase.total }} • Qual é o título REAL?</span>
                <div class="sketch-frame"><img [src]="st.phase.imageData" alt="Desenho" /></div>
                <div class="choices-grid">
                  @for (c of st.phase.choices; track c.id) {
                    <mat-card appearance="outlined" class="choice-card">{{ c.text }}</mat-card>
                  }
                </div>
                <p class="sub-msg">{{ st.phase.voteCount }} voto(s) recebido(s)</p>
              </div>
            }

            @case ('sketch_reveal') {
              <div class="center">
                <span class="kicker">🎨 Artista: {{ st.phase.artist }}</span>
                <div class="sketch-frame"><img [src]="st.phase.imageData" alt="Desenho" /></div>
                <div class="choices-grid">
                  @for (it of st.phase.items; track $index) {
                    <mat-card appearance="outlined" class="choice-card" [class.truth]="it.isTruth">
                      <div>{{ it.isTruth ? '✅ ' : '🎭 ' }}{{ it.text }}</div>
                      <div class="choice-sub">{{ it.isTruth ? 'TÍTULO REAL!' : 'Título de ' + it.author }}</div>
                      @if (it.voters?.length) {
                        <div class="choice-sub">Votaram: {{ it.voters.join(', ') }}</div>
                      }
                    </mat-card>
                  }
                </div>
              </div>
            }

            @case ('impostor_discuss') {
              <div class="center">
                <span class="kicker">🕵️ O Impostor • Rodada {{ st.phase.round }}/{{ st.phase.totalRounds }}</span>
                <h2 class="big-prompt">Categoria: {{ st.phase.category }}</h2>
                <p class="sub-msg">Olhem a palavra secreta no celular! Cada pessoa fala 1 dica em voz alta.<br />Há <strong>{{ st.phase.impostorCount }} Impostor(es)</strong> entre vocês!</p>
                <button mat-flat-button class="start-btn" (click)="send({ type: 'advance' })">
                  <mat-icon>how_to_vote</mat-icon> Ir para Votação
                </button>
              </div>
            }

            @case ('impostor_vote') {
              <div class="center">
                <span class="kicker">🕵️ Hora da Votação!</span>
                <h2 class="big-prompt">Quem é o Impostor? Vote no celular!</h2>
                <p class="sub-msg">{{ st.phase.voteCount }} voto(s) recebido(s)</p>
              </div>
            }

            @case ('impostor_guess') {
              <div class="center">
                <span class="kicker">🕵️ Impostor Descoberto!</span>
                <h2 class="big-prompt">{{ st.phase.accusedName }} é o Impostor!</h2>
                <p class="sub-msg">Última chance: {{ st.remaining }}s para chutar a palavra da categoria <strong>{{ st.phase.category }}</strong>!</p>
              </div>
            }

            @case ('impostor_reveal') {
              <div class="center">
                <span class="kicker">🕵️ Fim da Rodada {{ st.phase.round }}/{{ st.phase.totalRounds }}</span>
                <h2 class="big-prompt">{{ st.phase.headline }}</h2>
                <p class="sub-msg">Impostor(es): <strong>{{ st.phase.impostorNames.join(', ') }}</strong> • Palavra: <strong>{{ st.phase.word }}</strong></p>
              </div>
            }

            @case ('game_over') {
              <div class="center">
                <span class="kicker">🏆 Fim de Jogo!</span>
                <h2 class="big-prompt">Placar Final</h2>
                <div class="podium">
                  @for (p of st.phase.podium; track p.id; let i = $index) {
                    <mat-card appearance="outlined" class="podium-row" [class.first]="i === 0">
                      <span>{{ medals[i] || (i + 1) + 'º' }} {{ p.avatar }} {{ p.name }}</span>
                      <span class="pts">{{ p.score }} pts</span>
                    </mat-card>
                  }
                </div>
                <div class="end-actions">
                  <button mat-flat-button class="start-btn" (click)="send({ type: 'start_game', game: st.selectedGame })">
                    <mat-icon>replay</mat-icon> Jogar de Novo
                  </button>
                  <button mat-stroked-button (click)="send({ type: 'back_to_lobby' })">
                    <mat-icon>home</mat-icon> Trocar de Jogo
                  </button>
                </div>
              </div>
            }
          }
        </main>
      } @else {
        <div class="center"><p class="sub-msg">Conectando ao PartyBox…</p></div>
      }
    </div>
  `,
  styles: [`
    .tv-shell { min-height: 100vh; display: flex; flex-direction: column; padding: 24px 36px 32px; max-width: 1680px; margin: 0 auto; }
    .tv-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
    .tv-brand { display: flex; align-items: center; gap: 14px; }
    .tv-logo { font-size: 2rem; background: linear-gradient(135deg, #ff3d8b, #8b5cf6); width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; box-shadow: 0 10px 28px rgba(255, 61, 139, 0.35); }
    .tv-title { margin: 0; font-size: 1.9rem; font-weight: 900; letter-spacing: -0.03em; }
    .tv-sub { font-size: 0.95rem; opacity: 0.72; }
    .tv-actions { display: flex; align-items: center; gap: 10px; }
    .timer-pill { font-size: 1.35rem; font-weight: 800; padding: 6px 18px; border-radius: 999px; border: 2px solid #22d3ee; color: #22d3ee; background: rgba(34, 211, 238, 0.1); }
    .timer-pill.urgent { border-color: #fb7185; color: #fb7185; }
    .tv-stage { flex: 1; display: flex; flex-direction: column; justify-content: center; }
    .lobby-grid { display: grid; grid-template-columns: 360px 1fr; gap: 28px; align-items: stretch; }
    .qr-card { padding: 26px; border-radius: 24px !important; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 14px; background: rgba(20, 23, 42, 0.85); }
    .qr-card h2 { margin: 0; font-size: 1.45rem; }
    .qr-box { background: #fff; padding: 14px; border-radius: 20px; width: 240px; height: 240px; display: grid; place-items: center; }
    .qr-box img { width: 100%; height: 100%; }
    .join-url { font-family: ui-monospace, monospace; font-size: 1.02rem; color: #22d3ee; background: rgba(34, 211, 238, 0.12); padding: 8px 14px; border-radius: 10px; word-break: break-all; }
    .muted { opacity: 0.68; margin: 0; font-size: 0.94rem; }
    .lobby-main { display: flex; flex-direction: column; gap: 20px; }
    .games-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .game-tile { padding: 20px 22px; border-radius: 20px !important; cursor: pointer; background: rgba(20, 23, 42, 0.85); transition: transform 0.15s ease, border-color 0.15s ease; }
    .game-tile:hover { transform: translateY(-2px); border-color: #a78bfa; }
    .game-tile.selected { border-color: #ff3d8b !important; border-width: 2px; background: linear-gradient(135deg, rgba(255, 61, 139, 0.18), rgba(139, 92, 246, 0.2)); }
    .game-tile h3 { margin: 8px 0 6px; font-size: 1.3rem; font-weight: 700; }
    .game-tile p { margin: 0; opacity: 0.72; font-size: 0.95rem; line-height: 1.4; }
    .g-icon { font-size: 1.9rem; }
    .players-card { padding: 18px 22px; border-radius: 20px !important; background: rgba(20, 23, 42, 0.85); }
    .players-card h4 { margin: 0 0 12px; opacity: 0.65; font-size: 0.88rem; text-transform: uppercase; letter-spacing: 0.08em; }
    .chips { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
    .players-card .chips { justify-content: flex-start; }
    .p-chip { display: inline-flex; align-items: center; gap: 9px; background: rgba(255,255,255,0.06); border: 1.5px solid rgba(255,255,255,0.14); border-radius: 999px; padding: 7px 15px; font-size: 1.1rem; font-weight: 700; }
    .p-chip.done { border-color: #34d399; background: rgba(52, 211, 153, 0.16); }
    .p-chip.offline { opacity: 0.45; }
    .vip-tag { font-size: 0.7rem; background: #facc15; color: #000; padding: 2px 7px; border-radius: 999px; font-weight: 900; }
    .start-row { display: flex; justify-content: flex-end; }
    .start-btn { height: 50px !important; padding: 0 28px !important; font-size: 1.08rem !important; border-radius: 14px !important; }
    .center { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 22px; }
    .kicker { font-size: 0.98rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.09em; color: #facc15; background: rgba(250, 204, 21, 0.12); border: 1px solid rgba(250, 204, 21, 0.35); padding: 6px 16px; border-radius: 999px; }
    .big-prompt { font-size: clamp(1.8rem, 3.2vw, 3rem); font-weight: 900; line-height: 1.2; max-width: 1100px; margin: 0; }
    .sub-msg { font-size: 1.3rem; opacity: 0.78; margin: 0; }
    .versus { display: grid; grid-template-columns: 1fr auto 1fr; gap: 24px; width: 100%; max-width: 1200px; align-items: stretch; }
    .vs { align-self: center; font-size: 2rem; font-weight: 900; color: #ff3d8b; }
    .ans-card { padding: 30px 26px; border-radius: 22px !important; display: flex; flex-direction: column; justify-content: center; gap: 12px; background: rgba(20, 23, 42, 0.9); }
    .ans-card.winner { border-color: #34d399 !important; background: rgba(52, 211, 153, 0.14); }
    .ans-text { font-size: clamp(1.5rem, 2.5vw, 2.3rem); font-weight: 800; word-break: break-word; }
    .ans-meta { font-size: 1.1rem; opacity: 0.75; }
    .choices-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 16px; width: 100%; max-width: 1200px; }
    .choice-card { padding: 20px 22px; border-radius: 18px !important; font-size: 1.3rem; font-weight: 700; display: flex; flex-direction: column; gap: 8px; background: rgba(20, 23, 42, 0.9); }
    .choice-card.truth { border-color: #34d399 !important; background: rgba(52, 211, 153, 0.18); }
    .choice-sub { font-size: 0.94rem; opacity: 0.72; font-weight: 500; }
    .sketch-frame { background: #fff; border-radius: 22px; padding: 12px; max-width: 540px; width: 100%; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5); }
    .sketch-frame img { width: 100%; display: block; border-radius: 12px; }
    .podium { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 680px; }
    .podium-row { display: flex; flex-direction: row; align-items: center; justify-content: space-between; padding: 16px 24px; border-radius: 18px !important; font-size: 1.4rem; font-weight: 800; background: rgba(20, 23, 42, 0.9); }
    .podium-row.first { border-color: #facc15 !important; background: rgba(250, 204, 21, 0.14); font-size: 1.65rem; }
    .pts { color: #facc15; }
    .end-actions { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
    @media (max-width: 900px) { .lobby-grid, .versus { grid-template-columns: 1fr; } }
  `],
})
export class TvComponent implements OnInit, OnDestroy {
  games = GAMES;
  medals = ['🥇', '🥈', '🥉'];
  state = signal<any>(null);
  joinUrl = signal(window.location.origin + '/');
  soundOn = signal(true);

  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private audioCtx: AudioContext | null = null;
  private lastPhaseType: string | null = null;
  private lastConnected = 0;

  connectedCount = computed(() =>
    (this.state()?.players || []).filter((p: any) => p.connected).length,
  );
  currentGameMeta = computed(
    () => GAMES.find((g) => g.id === this.state()?.selectedGame) || GAMES[0],
  );
  showTimer = computed(() => {
    const st = this.state();
    return Boolean(st && st.remaining > 0 && st.phase?.type !== 'lobby' && st.phase?.type !== 'game_over');
  });

  async ngOnInit() {
    try {
      const res = await fetch('/api/info');
      const info = await res.json();
      if (info.joinUrl) this.joinUrl.set(info.joinUrl);
    } catch {}
    this.connect();
  }

  ngOnDestroy() {
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws.onopen = () => this.send({ type: 'watch_tv' });
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.role === 'tv') {
          this.handleSfx(msg);
          this.state.set(msg);
        }
      } catch {}
    };
    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
  }

  send(obj: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  toggleSound() {
    this.soundOn.update((v) => !v);
    if (this.soundOn()) this.playTone(660, 0.12);
  }

  isDone(doneIds: string[] | undefined, id: string): boolean {
    return Array.isArray(doneIds) && doneIds.includes(id);
  }

  private handleSfx(st: any) {
    const conn = (st.players || []).filter((p: any) => p.connected).length;
    if (conn > this.lastConnected) this.playTone(740, 0.12);
    this.lastConnected = conn;

    const pt = st.phase?.type;
    if (pt !== this.lastPhaseType) {
      if (pt?.endsWith('_reveal') || pt === 'game_over') {
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.playTone(f, 0.2, 'triangle', 0.15), i * 95));
      } else if (pt !== 'lobby') {
        this.playTone(520, 0.14);
      }
      this.lastPhaseType = pt;
    } else if (st.remaining > 0 && st.remaining <= 5 && pt !== 'lobby' && pt !== 'game_over') {
      this.playTone(880, 0.06, 'sine', 0.08);
    }
  }

  private playTone(freq: number, dur = 0.14, type: OscillatorType = 'triangle', gainVal = 0.13) {
    if (!this.soundOn()) return;
    try {
      if (!this.audioCtx) this.audioCtx = new AudioContext();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainVal, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + dur);
      osc.connect(gain).connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + dur);
    } catch {}
  }
}
