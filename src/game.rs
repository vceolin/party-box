use crate::prompts::{BLUFF_PROMPTS, IMPOSTOR_WORDS, QUIP_PROMPTS, SKETCH_PROMPTS};
use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GameKind {
    Quip,
    Bluff,
    Sketch,
    Impostor,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: String,
    pub name: String,
    pub avatar: String,
    pub score: i32,
    pub connected: bool,
}

#[derive(Debug, Clone)]
pub struct QuipMatchup {
    pub prompt: String,
    pub player_a: String,
    pub player_b: String,
    pub answer_a: Option<String>,
    pub answer_b: Option<String>,
    pub votes: HashMap<String, String>, // voter_id -> "a" | "b"
}

#[derive(Debug, Clone)]
pub struct BluffChoice {
    pub id: String,
    pub text: String,
    pub author_id: Option<String>, // None = real truth
}

#[derive(Debug, Clone)]
pub struct SketchEntry {
    pub artist_id: String,
    pub prompt: String,
    pub image_data: String,
    pub bluffs: HashMap<String, String>, // player_id -> fake title
    pub choices: Vec<BluffChoice>,
    pub votes: HashMap<String, String>,  // voter_id -> choice_id
}

#[derive(Debug, Clone)]
pub enum Phase {
    Lobby,

    // 1. Papo Furado (Quiplash)
    QuipAnswer {
        round: u8,
        total_rounds: u8,
        matchups: Vec<QuipMatchup>,
    },
    QuipVote {
        round: u8,
        total_rounds: u8,
        matchups: Vec<QuipMatchup>,
        current_idx: usize,
    },
    QuipReveal {
        round: u8,
        total_rounds: u8,
        matchups: Vec<QuipMatchup>,
        current_idx: usize,
        round_points: HashMap<String, i32>,
    },

    // 2. Mentira Sincera (Fibbage)
    BluffWrite {
        round: u8,
        total_rounds: u8,
        category: String,
        question: String,
        truth: String,
        lies: HashMap<String, String>,
    },
    BluffVote {
        round: u8,
        total_rounds: u8,
        category: String,
        question: String,
        truth: String,
        choices: Vec<BluffChoice>,
        votes: HashMap<String, String>,
    },
    BluffReveal {
        round: u8,
        total_rounds: u8,
        category: String,
        question: String,
        truth: String,
        choices: Vec<BluffChoice>,
        votes: HashMap<String, String>,
        round_points: HashMap<String, i32>,
    },

    // 3. Rabisco Caótico (Drawful)
    SketchDraw {
        prompts: HashMap<String, String>,
        drawings: HashMap<String, String>,
    },
    SketchBluff {
        entries: Vec<SketchEntry>,
        current_idx: usize,
    },
    SketchVote {
        entries: Vec<SketchEntry>,
        current_idx: usize,
    },
    SketchReveal {
        entries: Vec<SketchEntry>,
        current_idx: usize,
        round_points: HashMap<String, i32>,
    },

    // 4. O Impostor (Undercover / Spyfall)
    ImpostorDiscuss {
        round: u8,
        total_rounds: u8,
        category: String,
        word: String,
        impostors: Vec<String>,
    },
    ImpostorVote {
        round: u8,
        total_rounds: u8,
        category: String,
        word: String,
        impostors: Vec<String>,
        votes: HashMap<String, String>, // voter_id -> suspect_id
    },
    ImpostorGuess {
        round: u8,
        total_rounds: u8,
        category: String,
        word: String,
        impostors: Vec<String>,
        accused_id: String,
        votes: HashMap<String, String>,
    },
    ImpostorReveal {
        round: u8,
        total_rounds: u8,
        category: String,
        word: String,
        impostors: Vec<String>,
        accused_id: Option<String>,
        impostor_guess: Option<String>,
        impostor_won: bool,
        headline: String,
    },

    GameOver {
        game: GameKind,
    },
}

pub struct Room {
    pub code: String,
    pub players: Vec<Player>,
    pub selected_game: GameKind,
    pub phase: Phase,
    pub phase_ends_at: Option<u64>,
    used_quips: HashSet<usize>,
    used_bluffs: HashSet<usize>,
    used_sketches: HashSet<usize>,
    used_impostors: HashSet<usize>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn format_choice_text(s: &str) -> String {
    s.trim()
        .trim_end_matches('.')
        .to_lowercase()
}

fn normalize_text(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .replace(['.', '!', '?', ',', ';', ':'], "")
}

fn random_room_code() -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
    let mut rng = rand::thread_rng();
    (0..4)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

impl Room {
    pub fn new() -> Self {
        Self {
            code: random_room_code(),
            players: Vec::new(),
            selected_game: GameKind::Quip,
            phase: Phase::Lobby,
            phase_ends_at: None,
            used_quips: HashSet::new(),
            used_bluffs: HashSet::new(),
            used_sketches: HashSet::new(),
            used_impostors: HashSet::new(),
        }
    }

    pub fn vip_id(&self) -> Option<&str> {
        self.players
            .iter()
            .find(|p| p.connected)
            .or_else(|| self.players.first())
            .map(|p| p.id.as_str())
    }

    pub fn join_player(&mut self, id: String, name: String, avatar: String) -> Player {
        let clean_name = name.trim().chars().take(18).collect::<String>();
        let clean_name = if clean_name.is_empty() {
            format!("Jogador {}", self.players.len() + 1)
        } else {
            clean_name
        };
        let clean_avatar = if avatar.trim().is_empty() {
            "😎".to_string()
        } else {
            avatar.trim().chars().take(4).collect()
        };

        if let Some(p) = self.players.iter_mut().find(|p| p.id == id) {
            p.name = clean_name;
            p.avatar = clean_avatar;
            p.connected = true;
            return p.clone();
        }

        let player = Player {
            id,
            name: clean_name,
            avatar: clean_avatar,
            score: 0,
            connected: true,
        };
        self.players.push(player.clone());
        player
    }

    pub fn set_connected(&mut self, player_id: &str, connected: bool) {
        if let Some(p) = self.players.iter_mut().find(|p| p.id == player_id) {
            p.connected = connected;
        }
    }

    pub fn back_to_lobby(&mut self) {
        self.phase = Phase::Lobby;
        self.phase_ends_at = None;
        for p in &mut self.players {
            p.score = 0;
        }
        // Remove disconnected players when returning to lobby
        self.players.retain(|p| p.connected);
    }

    pub fn select_game(&mut self, game: GameKind) {
        if matches!(self.phase, Phase::Lobby) {
            self.selected_game = game;
        }
    }

    pub fn start_game(&mut self, game: Option<GameKind>) -> Result<(), String> {
        if let Some(g) = game {
            self.selected_game = g;
        }
        let active: Vec<String> = self
            .players
            .iter()
            .filter(|p| p.connected)
            .map(|p| p.id.clone())
            .collect();

        if active.len() < 2 {
            return Err("Precisa de pelo menos 2 jogadores conectados para começar!".to_string());
        }

        for p in &mut self.players {
            p.score = 0;
        }

        match self.selected_game {
            GameKind::Quip => self.start_quip_round(1, 2),
            GameKind::Bluff => self.start_bluff_round(1, 3),
            GameKind::Sketch => self.start_sketch_draw(),
            GameKind::Impostor => self.start_impostor_round(1, 2),
        }
        Ok(())
    }

    fn pick_index(len: usize, used: &mut HashSet<usize>) -> usize {
        if used.len() >= len {
            used.clear();
        }
        let mut rng = rand::thread_rng();
        let avail: Vec<usize> = (0..len).filter(|i| !used.contains(i)).collect();
        let chosen = *avail.choose(&mut rng).unwrap_or(&0);
        used.insert(chosen);
        chosen
    }

    fn active_player_ids(&self) -> Vec<String> {
        self.players
            .iter()
            .filter(|p| p.connected)
            .map(|p| p.id.clone())
            .collect()
    }

    fn add_score(&mut self, player_id: &str, delta: i32) {
        if let Some(p) = self.players.iter_mut().find(|p| p.id == player_id) {
            p.score += delta;
        }
    }

    // ---- 1. PAPO FURADO (QUIP) ----
    fn start_quip_round(&mut self, round: u8, total_rounds: u8) {
        let mut ids = self.active_player_ids();
        let mut rng = rand::thread_rng();
        ids.shuffle(&mut rng);

        let mut matchups = Vec::new();
        let n = ids.len();
        if n == 2 {
            let idx = Self::pick_index(QUIP_PROMPTS.len(), &mut self.used_quips);
            matchups.push(QuipMatchup {
                prompt: QUIP_PROMPTS[idx].to_string(),
                player_a: ids[0].clone(),
                player_b: ids[1].clone(),
                answer_a: None,
                answer_b: None,
                votes: HashMap::new(),
            });
        } else {
            // Ring pairing: each player gets 2 matchups (paired with neighbor)
            for i in 0..n {
                let idx = Self::pick_index(QUIP_PROMPTS.len(), &mut self.used_quips);
                matchups.push(QuipMatchup {
                    prompt: QUIP_PROMPTS[idx].to_string(),
                    player_a: ids[i].clone(),
                    player_b: ids[(i + 1) % n].clone(),
                    answer_a: None,
                    answer_b: None,
                    votes: HashMap::new(),
                });
            }
        }

        self.phase = Phase::QuipAnswer {
            round,
            total_rounds,
            matchups,
        };
        self.phase_ends_at = Some(now_secs() + 75);
    }

    // ---- 2. MENTIRA SINCERA (BLUFF) ----
    fn start_bluff_round(&mut self, round: u8, total_rounds: u8) {
        let idx = Self::pick_index(BLUFF_PROMPTS.len(), &mut self.used_bluffs);
        let p = &BLUFF_PROMPTS[idx];
        self.phase = Phase::BluffWrite {
            round,
            total_rounds,
            category: p.category.to_string(),
            question: p.question.to_string(),
            truth: p.answer.to_string(),
            lies: HashMap::new(),
        };
        self.phase_ends_at = Some(now_secs() + 60);
    }

    // ---- 3. RABISCO CAÓTICO (SKETCH) ----
    fn start_sketch_draw(&mut self) {
        let ids = self.active_player_ids();
        let mut prompts = HashMap::new();
        for id in ids {
            let idx = Self::pick_index(SKETCH_PROMPTS.len(), &mut self.used_sketches);
            prompts.insert(id, SKETCH_PROMPTS[idx].to_string());
        }
        self.phase = Phase::SketchDraw {
            prompts,
            drawings: HashMap::new(),
        };
        self.phase_ends_at = Some(now_secs() + 75);
    }

    // ---- 4. O IMPOSTOR ----
    fn start_impostor_round(&mut self, round: u8, total_rounds: u8) {
        let mut ids = self.active_player_ids();
        let mut rng = rand::thread_rng();
        ids.shuffle(&mut rng);
        let impostor_count = if ids.len() >= 6 { 2 } else { 1 };
        let impostors: Vec<String> = ids.into_iter().take(impostor_count).collect();
        let idx = Self::pick_index(IMPOSTOR_WORDS.len(), &mut self.used_impostors);
        let w = &IMPOSTOR_WORDS[idx];
        self.phase = Phase::ImpostorDiscuss {
            round,
            total_rounds,
            category: w.category.to_string(),
            word: w.word.to_string(),
            impostors,
        };
        self.phase_ends_at = Some(now_secs() + 90);
    }

    // ---- PLAYER ACTIONS ----
    pub fn submit_text(&mut self, player_id: &str, text: String, slot: Option<usize>) -> Result<(), String> {
        let clean = text.trim().chars().take(110).collect::<String>();
        if clean.is_empty() {
            return Err("Escreva alguma coisa antes de enviar!".to_string());
        }

        let active = self.active_player_ids();
        match &mut self.phase {
            Phase::QuipAnswer { matchups, .. } => {
                let mut updated = false;
                if let Some(idx) = slot {
                    if let Some(m) = matchups.get_mut(idx) {
                        if m.player_a == player_id {
                            m.answer_a = Some(clean.clone());
                            updated = true;
                        } else if m.player_b == player_id {
                            m.answer_b = Some(clean.clone());
                            updated = true;
                        }
                    }
                }
                if !updated {
                    for m in matchups.iter_mut() {
                        if m.player_a == player_id && m.answer_a.is_none() {
                            m.answer_a = Some(clean);
                            break;
                        } else if m.player_b == player_id && m.answer_b.is_none() {
                            m.answer_b = Some(clean);
                            break;
                        }
                    }
                }
                let all_done = matchups
                    .iter()
                    .all(|m| m.answer_a.is_some() && m.answer_b.is_some());
                if all_done {
                    self.advance();
                }
                Ok(())
            }
            Phase::BluffWrite { truth, lies, .. } => {
                if normalize_text(&clean) == normalize_text(truth) {
                    return Err("Opa! Você digitou a VERDADE! Invente uma mentira convincente!".to_string());
                }
                lies.insert(player_id.to_string(), clean);
                if active.iter().all(|id| lies.contains_key(id)) {
                    self.advance();
                }
                Ok(())
            }
            Phase::SketchBluff { entries, current_idx } => {
                if let Some(entry) = entries.get_mut(*current_idx) {
                    if entry.artist_id == player_id {
                        return Ok(());
                    }
                    if normalize_text(&clean) == normalize_text(&entry.prompt) {
                        return Err("Você acertou o título real! Invente um título falso para enganar os outros!".to_string());
                    }
                    entry.bluffs.insert(player_id.to_string(), clean);
                    let all_done = active
                        .iter()
                        .filter(|id| *id != &entry.artist_id)
                        .all(|id| entry.bluffs.contains_key(id));
                    if all_done {
                        self.advance();
                    }
                }
                Ok(())
            }
            Phase::ImpostorGuess {
                round,
                total_rounds,
                category,
                word,
                impostors,
                accused_id,
                ..
            } => {
                if !impostors.iter().any(|i| i == player_id) {
                    return Ok(());
                }
                let norm_guess = normalize_text(&clean);
                let norm_word = normalize_text(word);
                let hit = norm_guess == norm_word
                    || (norm_guess.len() >= 4 && norm_word.contains(&norm_guess));

                let imps = impostors.clone();
                let r = *round;
                let tr = *total_rounds;
                let cat = category.clone();
                let w = word.clone();
                let acc = accused_id.clone();

                let headline = if hit {
                    for imp in &imps {
                        self.add_score(imp, 1500);
                    }
                    format!("O Impostor acertou a palavra ('{w}') e ROUBOU A VITÓRIA!")
                } else {
                    for p in &mut self.players {
                        if !imps.contains(&p.id) {
                            p.score += 1000;
                        }
                    }
                    format!("Os Inocentes venceram! O Impostor chutou '{clean}', mas era '{w}'.")
                };

                self.phase = Phase::ImpostorReveal {
                    round: r,
                    total_rounds: tr,
                    category: cat,
                    word: w,
                    impostors: imps,
                    accused_id: Some(acc),
                    impostor_guess: Some(clean),
                    impostor_won: hit,
                    headline,
                };
                self.phase_ends_at = Some(now_secs() + 9);
                Ok(())
            }
            _ => Ok(()),
        }
    }

    pub fn submit_drawing(&mut self, player_id: &str, data_url: String) -> Result<(), String> {
        if !data_url.starts_with("data:image/") || data_url.len() > 450_000 {
            return Err("Desenho inválido ou grande demais.".to_string());
        }
        if let Phase::SketchDraw { prompts, drawings } = &mut self.phase {
            if prompts.contains_key(player_id) {
                drawings.insert(player_id.to_string(), data_url);
                if prompts.keys().all(|id| drawings.contains_key(id)) {
                    self.advance();
                }
            }
        }
        Ok(())
    }

    pub fn submit_vote(&mut self, player_id: &str, choice: String) -> Result<(), String> {
        let active_count = self.active_player_ids().len();
        let active = self.active_player_ids();
        match &mut self.phase {
            Phase::QuipVote {
                matchups,
                current_idx,
                ..
            } => {
                if let Some(m) = matchups.get_mut(*current_idx) {
                    let is_contestant = m.player_a == player_id || m.player_b == player_id;
                    if is_contestant && active_count > 2 {
                        return Ok(());
                    }
                    if choice == "a" || choice == "b" {
                        m.votes.insert(player_id.to_string(), choice);
                    }
                    let expected = if active_count > 2 {
                        active_count.saturating_sub(2)
                    } else {
                        active_count
                    };
                    if m.votes.len() >= expected && expected > 0 {
                        self.advance();
                    }
                }
                Ok(())
            }
            Phase::BluffVote { choices, votes, .. } => {
                if let Some(ch) = choices.iter().find(|c| c.id == choice) {
                    if ch.author_id.as_deref() == Some(player_id) {
                        return Err("Você não pode votar na sua própria mentira!".to_string());
                    }
                    votes.insert(player_id.to_string(), choice);
                    if votes.len() >= active_count {
                        self.advance();
                    }
                }
                Ok(())
            }
            Phase::SketchVote {
                entries,
                current_idx,
            } => {
                if let Some(entry) = entries.get_mut(*current_idx) {
                    if entry.artist_id == player_id {
                        return Ok(());
                    }
                    if let Some(ch) = entry.choices.iter().find(|c| c.id == choice) {
                        if ch.author_id.as_deref() == Some(player_id) {
                            return Err("Você não pode votar no seu próprio título!".to_string());
                        }
                        entry.votes.insert(player_id.to_string(), choice);
                        let expected = active_count.saturating_sub(1);
                        if entry.votes.len() >= expected && expected > 0 {
                            self.advance();
                        }
                    }
                }
                Ok(())
            }
            Phase::ImpostorVote { votes, .. } => {
                if self.players.iter().any(|p| p.id == choice) {
                    votes.insert(player_id.to_string(), choice);
                    if votes.len() >= active_count {
                        self.advance();
                    }
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    pub fn tick(&mut self) -> bool {
        if let Some(ends) = self.phase_ends_at {
            if now_secs() >= ends {
                self.advance();
                return true;
            }
        }
        false
    }

    pub fn advance(&mut self) {
        let phase = std::mem::replace(&mut self.phase, Phase::Lobby);
        match phase {
            Phase::Lobby => {
                self.phase = Phase::Lobby;
            }
            // ---- QUIP ----
            Phase::QuipAnswer {
                round,
                total_rounds,
                mut matchups,
            } => {
                for m in &mut matchups {
                    m.answer_a = Some(match &m.answer_a {
                        Some(a) => format_choice_text(a),
                        None => "(sem resposta 😅)".to_string(),
                    });
                    m.answer_b = Some(match &m.answer_b {
                        Some(b) => format_choice_text(b),
                        None => "(sem resposta 😅)".to_string(),
                    });
                }
                self.phase = Phase::QuipVote {
                    round,
                    total_rounds,
                    matchups,
                    current_idx: 0,
                };
                self.phase_ends_at = Some(now_secs() + 25);
            }
            Phase::QuipVote {
                round,
                total_rounds,
                matchups,
                current_idx,
            } => {
                let mult: i32 = if round == total_rounds { 2 } else { 1 };
                let mut round_points = HashMap::new();
                if let Some(m) = matchups.get(current_idx) {
                    let votes_a = m.votes.values().filter(|v| *v == "a").count() as i32;
                    let votes_b = m.votes.values().filter(|v| *v == "b").count() as i32;
                    let mut pts_a = votes_a * 500 * mult;
                    let mut pts_b = votes_b * 500 * mult;
                    if votes_a > 0 && votes_b == 0 {
                        pts_a += 500 * mult;
                    } else if votes_b > 0 && votes_a == 0 {
                        pts_b += 500 * mult;
                    }
                    self.add_score(&m.player_a, pts_a);
                    self.add_score(&m.player_b, pts_b);
                    round_points.insert(m.player_a.clone(), pts_a);
                    round_points.insert(m.player_b.clone(), pts_b);
                }
                self.phase = Phase::QuipReveal {
                    round,
                    total_rounds,
                    matchups,
                    current_idx,
                    round_points,
                };
                self.phase_ends_at = Some(now_secs() + 7);
            }
            Phase::QuipReveal {
                round,
                total_rounds,
                matchups,
                current_idx,
                ..
            } => {
                if current_idx + 1 < matchups.len() {
                    self.phase = Phase::QuipVote {
                        round,
                        total_rounds,
                        matchups,
                        current_idx: current_idx + 1,
                    };
                    self.phase_ends_at = Some(now_secs() + 25);
                } else if round < total_rounds {
                    self.start_quip_round(round + 1, total_rounds);
                } else {
                    self.phase = Phase::GameOver {
                        game: GameKind::Quip,
                    };
                    self.phase_ends_at = None;
                }
            }

            // ---- BLUFF ----
            Phase::BluffWrite {
                round,
                total_rounds,
                category,
                question,
                truth,
                lies,
            } => {
                let mut choices = Vec::new();
                choices.push(BluffChoice {
                    id: "truth".to_string(),
                    text: format_choice_text(&truth),
                    author_id: None,
                });
                let mut seen = HashSet::new();
                seen.insert(normalize_text(&truth));
                for (pid, lie) in lies {
                    let norm = normalize_text(&lie);
                    if seen.insert(norm) {
                        choices.push(BluffChoice {
                            id: format!("lie_{pid}"),
                            text: format_choice_text(&lie),
                            author_id: Some(pid),
                        });
                    }
                }
                let mut rng = rand::thread_rng();
                choices.shuffle(&mut rng);
                self.phase = Phase::BluffVote {
                    round,
                    total_rounds,
                    category,
                    question,
                    truth,
                    choices,
                    votes: HashMap::new(),
                };
                self.phase_ends_at = Some(now_secs() + 30);
            }
            Phase::BluffVote {
                round,
                total_rounds,
                category,
                question,
                truth,
                choices,
                votes,
            } => {
                let mult: i32 = if round == total_rounds { 2 } else { 1 };
                let mut round_points: HashMap<String, i32> = HashMap::new();
                for (voter_id, choice_id) in &votes {
                    if choice_id == "truth" {
                        let pts = 1000 * mult;
                        self.add_score(voter_id, pts);
                        *round_points.entry(voter_id.clone()).or_insert(0) += pts;
                    } else if let Some(ch) = choices.iter().find(|c| &c.id == choice_id) {
                        if let Some(author) = &ch.author_id {
                            let pts = 500 * mult;
                            self.add_score(author, pts);
                            *round_points.entry(author.clone()).or_insert(0) += pts;
                        }
                    }
                }
                self.phase = Phase::BluffReveal {
                    round,
                    total_rounds,
                    category,
                    question,
                    truth,
                    choices,
                    votes,
                    round_points,
                };
                self.phase_ends_at = Some(now_secs() + 9);
            }
            Phase::BluffReveal {
                round,
                total_rounds,
                ..
            } => {
                if round < total_rounds {
                    self.start_bluff_round(round + 1, total_rounds);
                } else {
                    self.phase = Phase::GameOver {
                        game: GameKind::Bluff,
                    };
                    self.phase_ends_at = None;
                }
            }

            // ---- SKETCH ----
            Phase::SketchDraw { prompts, drawings } => {
                let mut entries: Vec<SketchEntry> = prompts
                    .into_iter()
                    .filter_map(|(artist_id, prompt)| {
                        drawings.get(&artist_id).map(|img| SketchEntry {
                            artist_id,
                            prompt,
                            image_data: img.clone(),
                            bluffs: HashMap::new(),
                            choices: Vec::new(),
                            votes: HashMap::new(),
                        })
                    })
                    .collect();
                let mut rng = rand::thread_rng();
                entries.shuffle(&mut rng);
                if entries.is_empty() {
                    self.phase = Phase::GameOver {
                        game: GameKind::Sketch,
                    };
                    self.phase_ends_at = None;
                } else {
                    self.phase = Phase::SketchBluff {
                        entries,
                        current_idx: 0,
                    };
                    self.phase_ends_at = Some(now_secs() + 45);
                }
            }
            Phase::SketchBluff {
                mut entries,
                current_idx,
            } => {
                if let Some(entry) = entries.get_mut(current_idx) {
                    let mut choices = Vec::new();
                    choices.push(BluffChoice {
                        id: "truth".to_string(),
                        text: format_choice_text(&entry.prompt),
                        author_id: None,
                    });
                    let mut seen = HashSet::new();
                    seen.insert(normalize_text(&entry.prompt));
                    for (pid, text) in &entry.bluffs {
                        if seen.insert(normalize_text(text)) {
                            choices.push(BluffChoice {
                                id: format!("lie_{pid}"),
                                text: format_choice_text(text),
                                author_id: Some(pid.clone()),
                            });
                        }
                    }
                    let mut rng = rand::thread_rng();
                    choices.shuffle(&mut rng);
                    entry.choices = choices;
                }
                self.phase = Phase::SketchVote {
                    entries,
                    current_idx,
                };
                self.phase_ends_at = Some(now_secs() + 30);
            }
            Phase::SketchVote {
                entries,
                current_idx,
            } => {
                let mut round_points: HashMap<String, i32> = HashMap::new();
                if let Some(entry) = entries.get(current_idx) {
                    for (voter_id, choice_id) in &entry.votes {
                        if choice_id == "truth" {
                            self.add_score(voter_id, 1000);
                            *round_points.entry(voter_id.clone()).or_insert(0) += 1000;
                            self.add_score(&entry.artist_id, 500);
                            *round_points.entry(entry.artist_id.clone()).or_insert(0) += 500;
                        } else if let Some(ch) = entry.choices.iter().find(|c| &c.id == choice_id) {
                            if let Some(author) = &ch.author_id {
                                self.add_score(author, 500);
                                *round_points.entry(author.clone()).or_insert(0) += 500;
                            }
                        }
                    }
                }
                self.phase = Phase::SketchReveal {
                    entries,
                    current_idx,
                    round_points,
                };
                self.phase_ends_at = Some(now_secs() + 9);
            }
            Phase::SketchReveal {
                entries,
                current_idx,
                ..
            } => {
                if current_idx + 1 < entries.len() {
                    self.phase = Phase::SketchBluff {
                        entries,
                        current_idx: current_idx + 1,
                    };
                    self.phase_ends_at = Some(now_secs() + 45);
                } else {
                    self.phase = Phase::GameOver {
                        game: GameKind::Sketch,
                    };
                    self.phase_ends_at = None;
                }
            }

            // ---- IMPOSTOR ----
            Phase::ImpostorDiscuss {
                round,
                total_rounds,
                category,
                word,
                impostors,
            } => {
                self.phase = Phase::ImpostorVote {
                    round,
                    total_rounds,
                    category,
                    word,
                    impostors,
                    votes: HashMap::new(),
                };
                self.phase_ends_at = Some(now_secs() + 35);
            }
            Phase::ImpostorVote {
                round,
                total_rounds,
                category,
                word,
                impostors,
                votes,
            } => {
                let mut tally: HashMap<String, usize> = HashMap::new();
                for target in votes.values() {
                    *tally.entry(target.clone()).or_insert(0) += 1;
                }
                let top = tally
                    .into_iter()
                    .max_by_key(|(_, count)| *count)
                    .map(|(id, _)| id);

                if let Some(accused_id) = top {
                    if impostors.contains(&accused_id) {
                        // Caught! Give impostor 1 last-chance guess
                        self.phase = Phase::ImpostorGuess {
                            round,
                            total_rounds,
                            category,
                            word,
                            impostors,
                            accused_id,
                            votes,
                        };
                        self.phase_ends_at = Some(now_secs() + 25);
                        return;
                    }
                    for imp in &impostors {
                        self.add_score(imp, 1500);
                    }
                    let accused_name = self
                        .players
                        .iter()
                        .find(|p| p.id == accused_id)
                        .map(|p| p.name.clone())
                        .unwrap_or_else(|| "alguém".to_string());
                    self.phase = Phase::ImpostorReveal {
                        round,
                        total_rounds,
                        category,
                        word: word.clone(),
                        impostors,
                        accused_id: Some(accused_id),
                        impostor_guess: None,
                        impostor_won: true,
                        headline: format!(
                            "Vocês votaram em {accused_name} (Inocente)! O Impostor escapou!"
                        ),
                    };
                } else {
                    for imp in &impostors {
                        self.add_score(imp, 1500);
                    }
                    self.phase = Phase::ImpostorReveal {
                        round,
                        total_rounds,
                        category,
                        word: word.clone(),
                        impostors,
                        accused_id: None,
                        impostor_guess: None,
                        impostor_won: true,
                        headline: "Ninguém votou! O Impostor venceu por W.O.!".to_string(),
                    };
                }
                self.phase_ends_at = Some(now_secs() + 9);
            }
            Phase::ImpostorGuess {
                round,
                total_rounds,
                category,
                word,
                impostors,
                accused_id,
                ..
            } => {
                for p in &mut self.players {
                    if !impostors.contains(&p.id) {
                        p.score += 1000;
                    }
                }
                self.phase = Phase::ImpostorReveal {
                    round,
                    total_rounds,
                    category,
                    word: word.clone(),
                    impostors,
                    accused_id: Some(accused_id),
                    impostor_guess: None,
                    impostor_won: false,
                    headline: format!(
                        "O tempo acabou! Os Inocentes venceram — a palavra era '{word}'."
                    ),
                };
                self.phase_ends_at = Some(now_secs() + 9);
            }
            Phase::ImpostorReveal {
                round,
                total_rounds,
                ..
            } => {
                if round < total_rounds {
                    self.start_impostor_round(round + 1, total_rounds);
                } else {
                    self.phase = Phase::GameOver {
                        game: GameKind::Impostor,
                    };
                    self.phase_ends_at = None;
                }
            }
            Phase::GameOver { game } => {
                self.phase = Phase::GameOver { game };
            }
        }
    }

    // ---- VIEW SERIALIZATION ----
    fn remaining_secs(&self) -> u64 {
        self.phase_ends_at
            .map(|end| end.saturating_sub(now_secs()))
            .unwrap_or(0)
    }

    fn player_name(&self, id: &str) -> String {
        self.players
            .iter()
            .find(|p| p.id == id)
            .map(|p| format!("{} {}", p.avatar, p.name))
            .unwrap_or_else(|| "Jogador".to_string())
    }

    pub fn tv_view(&self) -> serde_json::Value {
        let mut sorted_players = self.players.clone();
        sorted_players.sort_by(|a, b| b.score.cmp(&a.score));

        let phase_json = match &self.phase {
            Phase::Lobby => serde_json::json!({ "type": "lobby" }),

            Phase::QuipAnswer {
                round,
                total_rounds,
                matchups,
            } => {
                let mut done_ids = HashSet::new();
                for p in &self.players {
                    let my_done = matchups
                        .iter()
                        .filter(|m| m.player_a == p.id || m.player_b == p.id)
                        .all(|m| {
                            (m.player_a != p.id || m.answer_a.is_some())
                                && (m.player_b != p.id || m.answer_b.is_some())
                        });
                    if my_done {
                        done_ids.insert(p.id.clone());
                    }
                }
                serde_json::json!({
                    "type": "quip_answer",
                    "round": round,
                    "totalRounds": total_rounds,
                    "doneIds": done_ids,
                })
            }
            Phase::QuipVote {
                round,
                total_rounds,
                matchups,
                current_idx,
            } => {
                let m = &matchups[*current_idx];
                serde_json::json!({
                    "type": "quip_vote",
                    "round": round,
                    "totalRounds": total_rounds,
                    "index": current_idx + 1,
                    "total": matchups.len(),
                    "prompt": m.prompt,
                    "answerA": m.answer_a,
                    "answerB": m.answer_b,
                    "voteCount": m.votes.len(),
                })
            }
            Phase::QuipReveal {
                round,
                total_rounds,
                matchups,
                current_idx,
                round_points,
            } => {
                let m = &matchups[*current_idx];
                let votes_a = m.votes.values().filter(|v| *v == "a").count();
                let votes_b = m.votes.values().filter(|v| *v == "b").count();
                serde_json::json!({
                    "type": "quip_reveal",
                    "round": round,
                    "totalRounds": total_rounds,
                    "prompt": m.prompt,
                    "answerA": m.answer_a,
                    "answerB": m.answer_b,
                    "authorA": self.player_name(&m.player_a),
                    "authorB": self.player_name(&m.player_b),
                    "votesA": votes_a,
                    "votesB": votes_b,
                    "pointsA": round_points.get(&m.player_a).copied().unwrap_or(0),
                    "pointsB": round_points.get(&m.player_b).copied().unwrap_or(0),
                })
            }

            Phase::BluffWrite {
                round,
                total_rounds,
                category,
                question,
                lies,
                ..
            } => serde_json::json!({
                "type": "bluff_write",
                "round": round,
                "totalRounds": total_rounds,
                "category": category,
                "question": question,
                "doneIds": lies.keys().collect::<Vec<_>>(),
            }),
            Phase::BluffVote {
                round,
                total_rounds,
                category,
                question,
                choices,
                votes,
                ..
            } => serde_json::json!({
                "type": "bluff_vote",
                "round": round,
                "totalRounds": total_rounds,
                "category": category,
                "question": question,
                "choices": choices.iter().map(|c| serde_json::json!({ "id": c.id, "text": c.text })).collect::<Vec<_>>(),
                "voteCount": votes.len(),
            }),
            Phase::BluffReveal {
                round,
                total_rounds,
                category,
                question,
                truth,
                choices,
                votes,
                ..
            } => {
                let items: Vec<_> = choices
                    .iter()
                    .map(|c| {
                        let voters: Vec<String> = votes
                            .iter()
                            .filter(|(_, cid)| *cid == &c.id)
                            .map(|(vid, _)| self.player_name(vid))
                            .collect();
                        serde_json::json!({
                            "id": c.id,
                            "text": c.text,
                            "isTruth": c.author_id.is_none(),
                            "author": c.author_id.as_deref().map(|a| self.player_name(a)),
                            "voters": voters,
                        })
                    })
                    .collect();
                serde_json::json!({
                    "type": "bluff_reveal",
                    "round": round,
                    "totalRounds": total_rounds,
                    "category": category,
                    "question": question,
                    "truth": truth,
                    "items": items,
                })
            }

            Phase::SketchDraw { drawings, .. } => serde_json::json!({
                "type": "sketch_draw",
                "doneIds": drawings.keys().collect::<Vec<_>>(),
            }),
            Phase::SketchBluff {
                entries,
                current_idx,
            } => {
                let e = &entries[*current_idx];
                serde_json::json!({
                    "type": "sketch_bluff",
                    "index": current_idx + 1,
                    "total": entries.len(),
                    "imageData": e.image_data,
                    "doneIds": e.bluffs.keys().collect::<Vec<_>>(),
                })
            }
            Phase::SketchVote {
                entries,
                current_idx,
            } => {
                let e = &entries[*current_idx];
                serde_json::json!({
                    "type": "sketch_vote",
                    "index": current_idx + 1,
                    "total": entries.len(),
                    "imageData": e.image_data,
                    "choices": e.choices.iter().map(|c| serde_json::json!({ "id": c.id, "text": c.text })).collect::<Vec<_>>(),
                    "voteCount": e.votes.len(),
                })
            }
            Phase::SketchReveal {
                entries,
                current_idx,
                ..
            } => {
                let e = &entries[*current_idx];
                let items: Vec<_> = e
                    .choices
                    .iter()
                    .map(|c| {
                        let voters: Vec<String> = e
                            .votes
                            .iter()
                            .filter(|(_, cid)| *cid == &c.id)
                            .map(|(vid, _)| self.player_name(vid))
                            .collect();
                        serde_json::json!({
                            "text": c.text,
                            "isTruth": c.author_id.is_none(),
                            "author": c.author_id.as_deref().map(|a| self.player_name(a)),
                            "voters": voters,
                        })
                    })
                    .collect();
                serde_json::json!({
                    "type": "sketch_reveal",
                    "index": current_idx + 1,
                    "total": entries.len(),
                    "artist": self.player_name(&e.artist_id),
                    "prompt": e.prompt,
                    "imageData": e.image_data,
                    "items": items,
                })
            }

            Phase::ImpostorDiscuss {
                round,
                total_rounds,
                category,
                impostors,
                ..
            } => serde_json::json!({
                "type": "impostor_discuss",
                "round": round,
                "totalRounds": total_rounds,
                "category": category,
                "impostorCount": impostors.len(),
            }),
            Phase::ImpostorVote {
                round,
                total_rounds,
                category,
                votes,
                ..
            } => serde_json::json!({
                "type": "impostor_vote",
                "round": round,
                "totalRounds": total_rounds,
                "category": category,
                "voteCount": votes.len(),
            }),
            Phase::ImpostorGuess {
                round,
                total_rounds,
                category,
                accused_id,
                ..
            } => serde_json::json!({
                "type": "impostor_guess",
                "round": round,
                "totalRounds": total_rounds,
                "category": category,
                "accusedName": self.player_name(accused_id),
            }),
            Phase::ImpostorReveal {
                round,
                total_rounds,
                category,
                word,
                impostors,
                impostor_guess,
                impostor_won,
                headline,
                ..
            } => serde_json::json!({
                "type": "impostor_reveal",
                "round": round,
                "totalRounds": total_rounds,
                "category": category,
                "word": word,
                "impostorNames": impostors.iter().map(|id| self.player_name(id)).collect::<Vec<_>>(),
                "impostorGuess": impostor_guess,
                "impostorWon": impostor_won,
                "headline": headline,
            }),

            Phase::GameOver { game } => serde_json::json!({
                "type": "game_over",
                "game": game,
                "podium": sorted_players,
            }),
        };

        serde_json::json!({
            "role": "tv",
            "roomCode": self.code,
            "selectedGame": self.selected_game,
            "vipId": self.vip_id(),
            "players": self.players,
            "remaining": self.remaining_secs(),
            "phase": phase_json,
        })
    }

    pub fn player_view(&self, player_id: &str) -> serde_json::Value {
        let is_vip = self.vip_id() == Some(player_id);
        let me = self.players.iter().find(|p| p.id == player_id).cloned();
        let active_count = self.active_player_ids().len();

        let phase_json = match &self.phase {
            Phase::Lobby => serde_json::json!({
                "type": "lobby",
                "playerCount": active_count,
            }),

            Phase::QuipAnswer { matchups, .. } => {
                let my_prompts: Vec<_> = matchups
                    .iter()
                    .enumerate()
                    .filter_map(|(idx, m)| {
                        if m.player_a == player_id {
                            Some(serde_json::json!({
                                "slot": idx,
                                "prompt": m.prompt,
                                "done": m.answer_a.is_some(),
                            }))
                        } else if m.player_b == player_id {
                            Some(serde_json::json!({
                                "slot": idx,
                                "prompt": m.prompt,
                                "done": m.answer_b.is_some(),
                            }))
                        } else {
                            None
                        }
                    })
                    .collect();
                serde_json::json!({
                    "type": "quip_answer",
                    "prompts": my_prompts,
                })
            }
            Phase::QuipVote {
                matchups,
                current_idx,
                ..
            } => {
                let m = &matchups[*current_idx];
                let is_contestant = (m.player_a == player_id || m.player_b == player_id) && active_count > 2;
                serde_json::json!({
                    "type": "quip_vote",
                    "prompt": m.prompt,
                    "answerA": m.answer_a,
                    "answerB": m.answer_b,
                    "isContestant": is_contestant,
                    "voted": m.votes.contains_key(player_id),
                })
            }
            Phase::QuipReveal { .. } => serde_json::json!({ "type": "watch_tv", "message": "Olhe para a TV! 📺" }),

            Phase::BluffWrite {
                category,
                question,
                lies,
                ..
            } => serde_json::json!({
                "type": "bluff_write",
                "category": category,
                "question": question,
                "done": lies.contains_key(player_id),
            }),
            Phase::BluffVote {
                question,
                choices,
                votes,
                ..
            } => serde_json::json!({
                "type": "bluff_vote",
                "question": question,
                "voted": votes.contains_key(player_id),
                "choices": choices
                    .iter()
                    .filter(|c| c.author_id.as_deref() != Some(player_id))
                    .map(|c| serde_json::json!({ "id": c.id, "text": c.text }))
                    .collect::<Vec<_>>(),
            }),
            Phase::BluffReveal { .. } => serde_json::json!({ "type": "watch_tv", "message": "Revelando a verdade na TV! 📺" }),

            Phase::SketchDraw { prompts, drawings } => serde_json::json!({
                "type": "sketch_draw",
                "prompt": prompts.get(player_id).cloned().unwrap_or_default(),
                "done": drawings.contains_key(player_id),
            }),
            Phase::SketchBluff {
                entries,
                current_idx,
            } => {
                let e = &entries[*current_idx];
                serde_json::json!({
                    "type": "sketch_bluff",
                    "isArtist": e.artist_id == player_id,
                    "done": e.bluffs.contains_key(player_id),
                })
            }
            Phase::SketchVote {
                entries,
                current_idx,
            } => {
                let e = &entries[*current_idx];
                serde_json::json!({
                    "type": "sketch_vote",
                    "isArtist": e.artist_id == player_id,
                    "voted": e.votes.contains_key(player_id),
                    "choices": e.choices
                        .iter()
                        .filter(|c| c.author_id.as_deref() != Some(player_id))
                        .map(|c| serde_json::json!({ "id": c.id, "text": c.text }))
                        .collect::<Vec<_>>(),
                })
            }
            Phase::SketchReveal { .. } => serde_json::json!({ "type": "watch_tv", "message": "Veja o resultado na TV! 🎨" }),

            Phase::ImpostorDiscuss {
                category,
                word,
                impostors,
                ..
            } => {
                let is_imp = impostors.iter().any(|id| id == player_id);
                serde_json::json!({
                    "type": "impostor_discuss",
                    "category": category,
                    "isImpostor": is_imp,
                    "word": if is_imp { serde_json::Value::Null } else { serde_json::json!(word) },
                })
            }
            Phase::ImpostorVote { votes, .. } => serde_json::json!({
                "type": "impostor_vote",
                "voted": votes.contains_key(player_id),
                "suspects": self.players
                    .iter()
                    .filter(|p| p.connected)
                    .map(|p| serde_json::json!({ "id": p.id, "name": format!("{} {}", p.avatar, p.name) }))
                    .collect::<Vec<_>>(),
            }),
            Phase::ImpostorGuess {
                category,
                impostors,
                ..
            } => {
                let is_imp = impostors.iter().any(|id| id == player_id);
                serde_json::json!({
                    "type": "impostor_guess",
                    "category": category,
                    "isImpostor": is_imp,
                })
            }
            Phase::ImpostorReveal { .. } => serde_json::json!({ "type": "watch_tv", "message": "Resultado na TV! 🕵️" }),

            Phase::GameOver { .. } => serde_json::json!({ "type": "game_over" }),
        };

        serde_json::json!({
            "role": "player",
            "roomCode": self.code,
            "selectedGame": self.selected_game,
            "isVip": is_vip,
            "me": me,
            "remaining": self.remaining_secs(),
            "phase": phase_json,
        })
    }
}
