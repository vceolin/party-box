import { Component, ElementRef, OnDestroy, OnInit, ViewChild, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

const AVATARS = ['😎', '🤠', '🦊', '🐱', '🐶', '🐸', '👽', '🤖', '👻', '🦄', '🍕', '🔥'];
const GAMES = [
  { id: 'quip', icon: '⚡', name: 'Papo Furado' },
  { id: 'bluff', icon: '🤥', name: 'Mentira Sincera' },
  { id: 'sketch', icon: '🎨', name: 'Rabisco Caótico' },
  { id: 'impostor', icon: '🕵️', name: 'O Impostor' },
];
const DRAW_COLORS = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];

@Component({
  selector: 'app-party-play',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="play-shell">
      <header class="play-top">
        <div class="brand"><span>🎉</span><strong>PartyBox</strong></div>
        <div class="top-right">
          @if (state()?.remaining > 0 && state()?.phase?.type !== 'lobby' && state()?.phase?.type !== 'game_over') {
            <span class="timer-mini" [class.urgent]="state().remaining <= 10">{{ state().remaining }}s</span>
          }
          @if (state()?.me; as me) {
            <span class="me-badge">{{ me.avatar }} {{ me.name }} • {{ me.score }} pts</span>
          }
        </div>
      </header>

      @if (!joined() || !state()) {
        <mat-card appearance="outlined" class="play-card">
          <h2>Entrar na Festa 🎉</h2>
          <p class="muted">Escolha seu avatar e apelido para jogar na TV!</p>
          <div class="avatar-grid">
            @for (av of avatars; track av) {
              <button type="button" class="av-btn" [class.selected]="selectedAvatar() === av" (click)="selectedAvatar.set(av)">
                {{ av }}
              </button>
            }
          </div>
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Seu apelido</mat-label>
            <input matInput maxlength="18" [ngModel]="name()" (ngModelChange)="name.set($event)" (keydown.enter)="doJoin()" />
          </mat-form-field>
          <button mat-flat-button class="big-btn" (click)="doJoin()">Entrar no Jogo</button>
        </mat-card>
      } @else {
        @let st = state();
        @let ph = st.phase;

        @switch (ph.type) {
          @case ('lobby') {
            <mat-card appearance="outlined" class="play-card">
              @if (st.isVip) {
                <h2>Você é o VIP 👑</h2>
                <p class="muted">Escolha o jogo e aperte Iniciar ({{ ph.playerCount }} conectado(s)):</p>
                <div class="col">
                  @for (g of games; track g.id) {
                    <button
                      [attr.mat-flat-button]="st.selectedGame === g.id ? '' : null"
                      mat-stroked-button
                      class="choice-btn"
                      [class.active-game]="st.selectedGame === g.id"
                      (click)="send({ type: 'select_game', game: g.id })"
                    >
                      {{ g.icon }} {{ g.name }}
                    </button>
                  }
                </div>
                <button mat-flat-button class="big-btn" [disabled]="ph.playerCount < 2" (click)="send({ type: 'start_game', game: st.selectedGame })">
                  <mat-icon>play_arrow</mat-icon> Iniciar Jogo
                </button>
              } @else {
                <h2>Você está na sala! 🎉</h2>
                <p class="muted">Olhe para a TV e aguarde o VIP iniciar o jogo.</p>
              }
            </mat-card>
          }

          @case ('quip_answer') {
            <mat-card appearance="outlined" class="play-card">
              @if (nextQuipPrompt(ph.prompts); as qp) {
                <h2>⚡ Papo Furado</h2>
                <p class="prompt-txt">{{ qp.prompt }}</p>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Sua resposta mais engraçada</mat-label>
                  <textarea matInput rows="3" maxlength="100" [ngModel]="textInput()" (ngModelChange)="textInput.set($event)"></textarea>
                </mat-form-field>
                <button mat-flat-button class="big-btn" [disabled]="!textInput().trim()" (click)="submitText(qp.slot)">Enviar Resposta</button>
              } @else {
                <h2>Respostas enviadas! ✅</h2>
                <p class="muted">Aguarde os outros jogadores terminarem.</p>
              }
            </mat-card>
          }

          @case ('quip_vote') {
            <mat-card appearance="outlined" class="play-card">
              @if (ph.isContestant) {
                <h2>Sua resposta está na tela! 🤞</h2>
                <p class="muted">Torça pelos votos na TV!</p>
              } @else if (ph.voted) {
                <h2>Voto enviado! ✅</h2>
                <p class="muted">Olhe para a TV!</p>
              } @else {
                <h2>Vote na mais engraçada! 😂</h2>
                <p class="muted">{{ ph.prompt }}</p>
                <div class="col">
                  <button mat-tonal-button class="choice-btn" (click)="send({ type: 'submit_vote', choice: 'a' })">{{ ph.answerA }}</button>
                  <button mat-tonal-button class="choice-btn" (click)="send({ type: 'submit_vote', choice: 'b' })">{{ ph.answerB }}</button>
                </div>
              }
            </mat-card>
          }

          @case ('bluff_write') {
            <mat-card appearance="outlined" class="play-card">
              @if (ph.done) {
                <h2>Mentira enviada! 🤥</h2>
                <p class="muted">Aguarde os outros jogadores.</p>
              } @else {
                <h2>🤥 Invente uma Mentira</h2>
                <p class="prompt-txt">{{ ph.question }}</p>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>O que completa a lacuna?</mat-label>
                  <input matInput maxlength="70" [ngModel]="textInput()" (ngModelChange)="textInput.set($event)" (keydown.enter)="submitText()" />
                </mat-form-field>
                <button mat-flat-button class="big-btn" [disabled]="!textInput().trim()" (click)="submitText()">Enviar Mentira</button>
              }
            </mat-card>
          }

          @case ('bluff_vote') {
            <mat-card appearance="outlined" class="play-card">
              @if (ph.voted) {
                <h2>Voto registrado! ✅</h2>
                <p class="muted">Olhe para a TV!</p>
              } @else {
                <h2>Qual é a VERDADE? 🧐</h2>
                <div class="col">
                  @for (c of ph.choices; track c.id) {
                    <button mat-tonal-button class="choice-btn" (click)="send({ type: 'submit_vote', choice: c.id })">{{ c.text }}</button>
                  }
                </div>
              }
            </mat-card>
          }

          @case ('sketch_draw') {
            <mat-card appearance="outlined" class="play-card">
              @if (ph.done) {
                <h2>Obra de arte enviada! 🎨</h2>
                <p class="muted">Aguarde os outros artistas.</p>
              } @else {
                <h2>🎨 Desenhe:</h2>
                <p class="draw-prompt">{{ ph.prompt }}</p>
                <div class="canvas-wrap">
                  <canvas
                    #drawCanvas
                    width="420"
                    height="340"
                    (pointerdown)="startDraw($event)"
                    (pointermove)="moveDraw($event)"
                    (pointerup)="endDraw()"
                    (pointercancel)="endDraw()"
                  ></canvas>
                </div>
                <div class="palette">
                  @for (c of drawColors; track c) {
                    <button type="button" class="swatch" [class.active]="drawColor() === c" [style.background]="c" (click)="drawColor.set(c)"></button>
                  }
                </div>
                <div class="row">
                  <button mat-stroked-button class="grow" (click)="undoDraw()"><mat-icon>undo</mat-icon> Desfazer</button>
                  <button mat-stroked-button class="grow" (click)="clearDraw()"><mat-icon>delete</mat-icon> Limpar</button>
                </div>
                <button mat-flat-button class="big-btn" (click)="sendDrawing()">Enviar Desenho 🎨</button>
              }
            </mat-card>
          }

          @case ('sketch_bluff') {
            <mat-card appearance="outlined" class="play-card">
              @if (ph.isArtist) {
                <h2>Seu desenho está na TV! 🎨</h2>
                <p class="muted">Os outros estão inventando títulos falsos…</p>
              } @else if (ph.done) {
                <h2>Título enviado! ✅</h2>
                <p class="muted">Aguarde os outros jogadores.</p>
              } @else {
                <h2>🎨 O que é isso na TV?</h2>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Seu título falso</mat-label>
                  <input matInput maxlength="70" [ngModel]="textInput()" (ngModelChange)="textInput.set($event)" (keydown.enter)="submitText()" />
                </mat-form-field>
                <button mat-flat-button class="big-btn" [disabled]="!textInput().trim()" (click)="submitText()">Enviar Título</button>
              }
            </mat-card>
          }

          @case ('sketch_vote') {
            <mat-card appearance="outlined" class="play-card">
              @if (ph.isArtist) {
                <h2>É o seu desenho! 🎨</h2>
                <p class="muted">Torça para adivinharem o título real na TV!</p>
              } @else if (ph.voted) {
                <h2>Voto registrado! ✅</h2>
                <p class="muted">Olhe para a TV!</p>
              } @else {
                <h2>Qual é o título REAL? 🎨</h2>
                <div class="col">
                  @for (c of ph.choices; track c.id) {
                    <button mat-tonal-button class="choice-btn" (click)="send({ type: 'submit_vote', choice: c.id })">{{ c.text }}</button>
                  }
                </div>
              }
            </mat-card>
          }

          @case ('impostor_discuss') {
            <mat-card appearance="outlined" class="play-card">
              <div class="secret-box" [class.impostor]="ph.isImpostor">
                <div class="muted">Categoria: <strong>{{ ph.category }}</strong></div>
                @if (secretHidden()) {
                  <div class="secret-word">🙈 Oculto</div>
                } @else if (ph.isImpostor) {
                  <div class="secret-word">🕵️ VOCÊ É O IMPOSTOR!</div>
                  <p class="muted">Finja que sabe a palavra e tente descobrir o que é!</p>
                } @else {
                  <div class="secret-word">{{ ph.word }}</div>
                  <p class="muted">Dê uma dica em voz alta sem entregar a palavra pro Impostor!</p>
                }
              </div>
              <button mat-stroked-button (click)="secretHidden.set(!secretHidden())">
                {{ secretHidden() ? '👁️ Mostrar Palavra' : '🙈 Esconder Tela' }}
              </button>
              @if (st.isVip) {
                <button mat-flat-button class="big-btn" (click)="send({ type: 'advance' })">Ir para Votação 🗳️</button>
              }
            </mat-card>
          }

          @case ('impostor_vote') {
            <mat-card appearance="outlined" class="play-card">
              @if (ph.voted) {
                <h2>Voto secreto enviado! 🗳️</h2>
                <p class="muted">Olhe para a TV!</p>
              } @else {
                <h2>🕵️ Quem é o Impostor?</h2>
                <div class="col">
                  @for (s of ph.suspects; track s.id) {
                    <button mat-tonal-button class="choice-btn" (click)="send({ type: 'submit_vote', choice: s.id })">{{ s.name }}</button>
                  }
                </div>
              }
            </mat-card>
          }

          @case ('impostor_guess') {
            <mat-card appearance="outlined" class="play-card">
              @if (!ph.isImpostor) {
                <h2>Você pegou o Impostor! 🎯</h2>
                <p class="muted">Ele tem 1 última chance de chutar a palavra na TV…</p>
              } @else {
                <h2>🕵️ Última Chance!</h2>
                <p class="muted">Chute a palavra secreta da categoria <strong>{{ ph.category }}</strong> para roubar a vitória:</p>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Qual era a palavra?</mat-label>
                  <input matInput maxlength="60" [ngModel]="textInput()" (ngModelChange)="textInput.set($event)" (keydown.enter)="submitText()" />
                </mat-form-field>
                <button mat-flat-button class="big-btn" [disabled]="!textInput().trim()" (click)="submitText()">Arriscar Palavra!</button>
              }
            </mat-card>
          }

          @case ('watch_tv') {
            <mat-card appearance="outlined" class="play-card">
              <h2>{{ ph.message || 'Olhe para a TV! 📺' }}</h2>
              @if (st.isVip) {
                <button mat-stroked-button (click)="send({ type: 'advance' })">Avançar ⏭</button>
              }
            </mat-card>
          }

          @case ('game_over') {
            <mat-card appearance="outlined" class="play-card">
              <h2>🏆 Fim de Jogo!</h2>
              <p class="muted">Veja o pódio final na TV!</p>
              @if (st.isVip) {
                <button mat-flat-button class="big-btn" (click)="send({ type: 'start_game', game: st.selectedGame })">🔄 Jogar de Novo</button>
                <button mat-stroked-button (click)="send({ type: 'back_to_lobby' })">🏠 Voltar ao Lobby</button>
              }
            </mat-card>
          }
        }
      }
    </div>
  `,
  styles: [`
    .play-shell { max-width: 480px; margin: 0 auto; min-height: 100vh; padding: calc(16px + env(safe-area-inset-top)) 16px calc(32px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 16px; }
    .play-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .brand { display: flex; align-items: center; gap: 8px; font-size: 1.15rem; }
    .top-right { display: flex; align-items: center; gap: 8px; }
    .timer-mini { font-weight: 800; font-size: 0.9rem; padding: 3px 10px; border-radius: 999px; border: 1.5px solid #22d3ee; color: #22d3ee; }
    .timer-mini.urgent { border-color: #fb7185; color: #fb7185; }
    .me-badge { font-size: 0.86rem; opacity: 0.72; }
    .play-card { padding: 20px; border-radius: 20px !important; display: flex; flex-direction: column; gap: 14px; background: rgba(20, 23, 42, 0.9); }
    .play-card h2 { margin: 0; font-size: 1.3rem; }
    .muted { margin: 0; opacity: 0.72; line-height: 1.45; }
    .prompt-txt { margin: 0; font-size: 1.08rem; font-weight: 600; line-height: 1.4; }
    .draw-prompt { margin: 0; font-size: 1.15rem; font-weight: 800; color: #facc15; }
    .avatar-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
    .av-btn { font-size: 1.45rem; padding: 8px 0; border-radius: 12px; border: 2px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.25); cursor: pointer; }
    .av-btn.selected { border-color: #ff3d8b; background: rgba(255, 61, 139, 0.24); }
    .col { display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; gap: 8px; }
    .grow { flex: 1; }
    .big-btn { height: 48px !important; font-size: 1.02rem !important; border-radius: 14px !important; }
    .choice-btn { height: auto !important; min-height: 48px; padding: 12px 16px !important; justify-content: flex-start !important; text-align: left; white-space: normal !important; border-radius: 14px !important; }
    .active-game { border-color: #ff3d8b !important; background: rgba(255, 61, 139, 0.2) !important; }
    .canvas-wrap { background: #fff; border-radius: 14px; overflow: hidden; touch-action: none; }
    canvas { width: 100%; height: auto; display: block; touch-action: none; }
    .palette { display: flex; justify-content: space-between; gap: 6px; }
    .swatch { width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; }
    .swatch.active { border-color: #fff; transform: scale(1.15); }
    .secret-box { border: 2px solid #22d3ee; background: rgba(34, 211, 238, 0.12); border-radius: 16px; padding: 20px; text-align: center; }
    .secret-box.impostor { border-color: #fb7185; background: rgba(251, 113, 133, 0.16); }
    .secret-word { font-size: 1.7rem; font-weight: 900; margin: 10px 0; }
  `],
})
export class PlayComponent implements OnInit, OnDestroy {
  private snack = inject(MatSnackBar);

  avatars = AVATARS;
  games = GAMES;
  drawColors = DRAW_COLORS;

  name = signal(localStorage.getItem('partybox_name') || '');
  selectedAvatar = signal(localStorage.getItem('partybox_avatar') || AVATARS[0]);
  joined = signal(false);
  state = signal<any>(null);
  textInput = signal('');
  secretHidden = signal(false);
  drawColor = signal(DRAW_COLORS[0]);

  @ViewChild('drawCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;
  private strokes: { color: string; pts: { x: number; y: number }[] }[] = [];
  private activeStroke: { color: string; pts: { x: number; y: number }[] } | null = null;
  private lastPhaseType = '';

  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private playerId: string;

  constructor() {
    let pid = localStorage.getItem('partybox_pid');
    if (!pid) {
      pid = 'p_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('partybox_pid', pid);
    }
    this.playerId = pid;

    effect(() => {
      const pt = this.state()?.phase?.type || '';
      if (pt !== this.lastPhaseType) {
        this.lastPhaseType = pt;
        this.textInput.set('');
        this.secretHidden.set(false);
        if (pt === 'sketch_draw') {
          this.strokes = [];
          setTimeout(() => this.redraw(), 30);
        }
      }
    });
  }

  ngOnInit() {
    this.connect();
  }

  ngOnDestroy() {
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws.onopen = () => {
      if (this.joined() && this.name().trim()) {
        this.send({ type: 'join', player_id: this.playerId, name: this.name().trim(), avatar: this.selectedAvatar() });
      }
    };
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'error') {
          this.snack.open(msg.message, undefined, { duration: 3200 });
        } else if (msg.role === 'player') {
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

  doJoin() {
    const clean = this.name().trim() || 'Jogador';
    this.name.set(clean);
    localStorage.setItem('partybox_name', clean);
    localStorage.setItem('partybox_avatar', this.selectedAvatar());
    this.joined.set(true);
    this.send({ type: 'join', player_id: this.playerId, name: clean, avatar: this.selectedAvatar() });
  }

  nextQuipPrompt(prompts: any[]): any {
    return (prompts || []).find((p) => !p.done) || null;
  }

  submitText(slot?: number) {
    const text = this.textInput().trim();
    if (!text) return;
    this.send(slot !== undefined ? { type: 'submit_text', text, slot } : { type: 'submit_text', text });
    this.textInput.set('');
  }

  private getCanvasPos(e: PointerEvent) {
    const canvas = this.canvasRef!.nativeElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  startDraw(e: PointerEvent) {
    if (!this.canvasRef) return;
    e.preventDefault();
    this.canvasRef.nativeElement.setPointerCapture(e.pointerId);
    const pos = this.getCanvasPos(e);
    this.activeStroke = { color: this.drawColor(), pts: [pos, { x: pos.x + 0.1, y: pos.y + 0.1 }] };
    this.strokes.push(this.activeStroke);
    this.redraw();
  }

  moveDraw(e: PointerEvent) {
    if (!this.activeStroke || !this.canvasRef) return;
    e.preventDefault();
    this.activeStroke.pts.push(this.getCanvasPos(e));
    this.redraw();
  }

  endDraw() {
    this.activeStroke = null;
  }

  undoDraw() {
    this.strokes.pop();
    this.redraw();
  }

  clearDraw() {
    this.strokes = [];
    this.redraw();
  }

  private redraw() {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of this.strokes) {
      if (s.pts.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
      ctx.stroke();
    }
  }

  sendDrawing() {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    this.send({ type: 'submit_drawing', image_data: canvas.toDataURL('image/png') });
  }
}
