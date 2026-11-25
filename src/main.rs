mod game;
mod prompts;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path as AxumPath, State,
    },
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use game::{GameKind, Room};
use qrcode::{render::svg, QrCode};
use serde::Deserialize;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, Mutex};

#[derive(Clone)]
struct AppState {
    room: Arc<Mutex<Room>>,
    notify_tx: broadcast::Sender<()>,
    public_dir: PathBuf,
    port: u16,
    join_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMsg {
    WatchTv,
    Join {
        player_id: String,
        name: String,
        avatar: String,
    },
    SelectGame {
        game: GameKind,
    },
    StartGame {
        game: Option<GameKind>,
    },
    SubmitText {
        text: String,
        slot: Option<usize>,
    },
    SubmitDrawing {
        image_data: String,
    },
    SubmitVote {
        choice: String,
    },
    Advance,
    BackToLobby,
}

fn find_public_dir() -> PathBuf {
    if let Ok(cwd) = std::env::current_dir() {
        let p = cwd.join("public");
        if p.exists() {
            return p;
        }
        let p2 = cwd.join("apps").join("party-box").join("public");
        if p2.exists() {
            return p2;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
            let p = root.join("apps").join("party-box").join("public");
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from("public")
}

fn detect_lan_ip() -> String {
    if let Ok(ip) = local_ip_address::local_ip() {
        if ip.is_ipv4() && !ip.is_loopback() {
            return ip.to_string();
        }
    }
    "localhost".to_string()
}

fn content_type_for(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        _ => "application/octet-stream",
    }
}

async fn serve_file(state: &AppState, name: &str) -> Response {
    let clean = name.trim_start_matches('/');
    if clean.contains("..") {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    let full = state.public_dir.join(clean);
    match tokio::fs::read(&full).await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type_for(&full)),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

async fn serve_play(State(state): State<AppState>) -> Response {
    serve_file(&state, "play.html").await
}

async fn serve_tv(State(state): State<AppState>) -> Response {
    serve_file(&state, "tv.html").await
}

async fn serve_asset(State(state): State<AppState>, AxumPath(path): AxumPath<String>) -> Response {
    serve_file(&state, &path).await
}

async fn serve_qr(State(state): State<AppState>) -> Response {
    let code = QrCode::new(state.join_url.as_bytes()).expect("QR generation failed");
    let svg_str = code
        .render::<svg::Color>()
        .min_dimensions(260, 260)
        .dark_color(svg::Color("#0b0e14"))
        .light_color(svg::Color("#ffffff"))
        .quiet_zone(true)
        .build();
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "image/svg+xml"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        svg_str,
    )
        .into_response()
}

async fn api_info(State(state): State<AppState>) -> Json<serde_json::Value> {
    let room = state.room.lock().await;
    Json(serde_json::json!({
        "joinUrl": state.join_url,
        "roomCode": room.code,
        "port": state.port,
    }))
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.notify_tx.subscribe();

    let role: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None)); // Some("tv") | Some("player:<id>")

    let send_state = |room: &Room, role_str: &Option<String>| -> Option<String> {
        match role_str.as_deref() {
            Some("tv") => Some(room.tv_view().to_string()),
            Some(s) if s.starts_with("player:") => {
                let pid = &s["player:".len()..];
                Some(room.player_view(pid).to_string())
            }
            _ => None,
        }
    };

    loop {
        tokio::select! {
            _ = rx.recv() => {
                let r = role.lock().await.clone();
                let payload = {
                    let room = state.room.lock().await;
                    send_state(&room, &r)
                };
                if let Some(txt) = payload {
                    if sender.send(Message::Text(txt.into())).await.is_err() {
                        break;
                    }
                }
            }
            maybe_msg = receiver.next() => {
                let Some(Ok(msg)) = maybe_msg else { break };
                let Message::Text(text) = msg else { continue };
                let Ok(parsed) = serde_json::from_str::<ClientMsg>(&text) else { continue };

                let mut err_msg: Option<String> = None;
                let mut should_broadcast = false;

                match parsed {
                    ClientMsg::WatchTv => {
                        *role.lock().await = Some("tv".to_string());
                        let payload = {
                            let room = state.room.lock().await;
                            room.tv_view().to_string()
                        };
                        let _ = sender.send(Message::Text(payload.into())).await;
                    }
                    ClientMsg::Join { player_id, name, avatar } => {
                        let pid = player_id.trim().to_string();
                        if !pid.is_empty() {
                            *role.lock().await = Some(format!("player:{pid}"));
                            {
                                let mut room = state.room.lock().await;
                                room.join_player(pid, name, avatar);
                            }
                            should_broadcast = true;
                        }
                    }
                    ClientMsg::SelectGame { game } => {
                        state.room.lock().await.select_game(game);
                        should_broadcast = true;
                    }
                    ClientMsg::StartGame { game } => {
                        let res = state.room.lock().await.start_game(game);
                        if let Err(e) = res { err_msg = Some(e); } else { should_broadcast = true; }
                    }
                    ClientMsg::SubmitText { text, slot } => {
                        let r = role.lock().await.clone();
                        if let Some(pid) = r.as_deref().and_then(|s| s.strip_prefix("player:")) {
                            let res = state.room.lock().await.submit_text(pid, text, slot);
                            if let Err(e) = res { err_msg = Some(e); } else { should_broadcast = true; }
                        }
                    }
                    ClientMsg::SubmitDrawing { image_data } => {
                        let r = role.lock().await.clone();
                        if let Some(pid) = r.as_deref().and_then(|s| s.strip_prefix("player:")) {
                            let res = state.room.lock().await.submit_drawing(pid, image_data);
                            if let Err(e) = res { err_msg = Some(e); } else { should_broadcast = true; }
                        }
                    }
                    ClientMsg::SubmitVote { choice } => {
                        let r = role.lock().await.clone();
                        if let Some(pid) = r.as_deref().and_then(|s| s.strip_prefix("player:")) {
                            let res = state.room.lock().await.submit_vote(pid, choice);
                            if let Err(e) = res { err_msg = Some(e); } else { should_broadcast = true; }
                        }
                    }
                    ClientMsg::Advance => {
                        state.room.lock().await.advance();
                        should_broadcast = true;
                    }
                    ClientMsg::BackToLobby => {
                        state.room.lock().await.back_to_lobby();
                        should_broadcast = true;
                    }
                }

                if let Some(e) = err_msg {
                    let payload = serde_json::json!({ "type": "error", "message": e }).to_string();
                    let _ = sender.send(Message::Text(payload.into())).await;
                }
                if should_broadcast {
                    let _ = state.notify_tx.send(());
                }
            }
        }
    }

    // Mark player disconnected on socket close
    let r = role.lock().await.clone();
    if let Some(pid) = r.as_deref().and_then(|s| s.strip_prefix("player:")) {
        state.room.lock().await.set_connected(pid, false);
        let _ = state.notify_tx.send(());
    }
}

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3102);

    let lan_ip = detect_lan_ip();
    let join_url = format!("http://{lan_ip}:{port}/");
    let public_dir = find_public_dir();

    let room = Arc::new(Mutex::new(Room::new()));
    let (notify_tx, _) = broadcast::channel::<()>(64);

    // 1-second ticker for countdown timers and automatic phase transitions
    {
        let tick_room = Arc::clone(&room);
        let tick_tx = notify_tx.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                let mut r = tick_room.lock().await;
                let has_timer = r.phase_ends_at.is_some();
                let changed = r.tick();
                drop(r);
                if has_timer || changed {
                    let _ = tick_tx.send(());
                }
            }
        });
    }

    let state = AppState {
        room,
        notify_tx,
        public_dir,
        port,
        join_url: join_url.clone(),
    };

    let app = Router::new()
        .route("/", get(serve_play))
        .route("/tv", get(serve_tv))
        .route("/qr.svg", get(serve_qr))
        .route("/api/info", get(api_info))
        .route("/ws", get(ws_handler))
        .route("/{*path}", get(serve_asset))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind PartyBox port");

    println!("PartyBox (Rust) running!");
    println!("  TV Screen:  http://localhost:{port}/tv");
    println!("  Phones LAN: {join_url}");

    axum::serve(listener, app).await.expect("PartyBox error");
}
