const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

console.log('Starting server...');

// Supabase (geheimer Key!)
const { createClient } = require('@supabase/supabase-js');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'Not set');
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'Set' : 'Not set');

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { realtime: { transport: require('ws') } }
);

console.log('Supabase client created');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));
app.use(cookieParser());
app.use(express.static(__dirname));
console.log('Express app configured');

// ============= AUTH =============

// LOGIN
app.post('/api/login', async (req, res) => {
  const { name, pass } = req.body;
  if (!name || !pass) {
    return res.status(400).json({ error: 'Name und Passwort erforderlich' });
  }
  
  try {
    const { data: user, error } = await db
      .from('users')
      .select('*')
      .eq('name', name.toLowerCase())
      .single();
    
    if (error || !user) {
      return res.status(401).json({ error: 'Nutzername nicht gefunden' });
    }
    
    if (user.pass !== pass) {
      return res.status(401).json({ error: 'Passwort falsch' });
    }
    
    // Online-Status setzen
    await db.from('users').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', user.id);
    user.is_online = true;
    user.last_seen = new Date().toISOString();

    // Passwort aus Antwort entfernen (Sicherheit!)
    delete user.pass;
    res.cookie('arcadebox_user', JSON.stringify(user), {
      httpOnly: false,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// LOGOUT
app.post('/api/logout', async (req, res) => {
  const { user_id } = req.body;
  if (user_id) {
    try {
      await db.from('users').update({ is_online: false }).eq('id', user_id);
    } catch (err) { /* silent */ }
  }
  res.clearCookie('arcadebox_user');
  res.json({ success: true });
});

// REGISTRIEREN
app.post('/api/register', async (req, res) => {
  const { name, pass, pass2 } = req.body;
  let e = '';
  
  if (!name || !pass || !pass2) {
    return res.status(400).json({ error: 'Bitte alle Felder ausfuellen' });
  }
  if (name.length < 2) {
    return res.status(400).json({ error: 'Benutzername zu kurz' });
  }
  if (pass.length < 4) {
    return res.status(400).json({ error: 'Passwort zu kurz' });
  }
  if (pass !== pass2) {
    return res.status(400).json({ error: 'Passwoerter stimmen nicht ueberein' });
  }
  
  try {
    // Check ob Name schon existiert
    const { data: existing } = await db
      .from('users')
      .select('name')
      .eq('name', name.toLowerCase())
      .maybeSingle();
    
    if (existing) {
      return res.status(400).json({ error: 'Nutzername bereits vergeben' });
    }
    
    // Neuen User anlegen
    const { data: user, error } = await db
      .from('users')
      .insert({
        name: name.toLowerCase(),
        pass: pass,
        dodge: 0,
        stack: 0,
        memory: 0,
        reaction: 0,
        games_played: 0,
        avatar_seed: Math.random().toString(36).substring(2, 10)
      })
      .select('*')
      .single();
    
    if (error) {
      return res.status(400).json({ error: 'Fehler beim Erstellen' });
    }
    
    delete user.pass;
    res.cookie('arcadebox_user', JSON.stringify(user), {
      httpOnly: false,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= HIGHSCORES =============

app.post('/api/save-score', async (req, res) => {
  const { user_id, game_type, score } = req.body;
  
  if (!user_id || !game_type || score === undefined) {
    return res.status(400).json({ error: 'Fehlende Daten' });
  }
  
  try {
    // Score speichern
    const { error } = await db
      .from('highscores')
      .insert({ user_id, game_type, score });
    
    if (error) {
      return res.status(400).json({ error: 'Fehler beim Speichern' });
    }
    
    // User-Stats aktualisieren
    const { data: user } = await db
      .from('users')
      .select('*')
      .eq('id', user_id)
      .single();
    
    const updates = {};
    if (game_type === 'reaction') {
      // Reaction: niedrigere ms = besser; 0 = noch kein Score
      updates.reaction = (user.reaction === 0) ? score : Math.min(user.reaction, score);
    } else if (game_type === 'bubble') {
      updates.precision = Math.max(user.precision || 0, score);
    } else if (game_type === 'tictactoe' || game_type === 'multiplayer_wins' || game_type === 'flappy') {
      // Kein eigenes User-Feld; nur highscores + games_played
    } else {
      updates[game_type] = Math.max(user[game_type] || 0, score);
    }
    updates.games_played = (user.games_played || 0) + 1;
    
    await db
      .from('users')
      .update(updates)
      .eq('id', user_id);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Get User Stats
app.get('/api/user/:id', async (req, res) => {
  try {
    const { data: user, error } = await db
      .from('users')
      .select('*')
      .eq('id', req.params.id)
      .single();
    
    if (error || !user) {
      return res.status(404).json({ error: 'User nicht gefunden' });
    }
    
    delete user.pass;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Update User (Avatar)
app.put('/api/user/:id', async (req, res) => {
  const { avatar_seed } = req.body;
  
  if (!avatar_seed) {
    return res.status(400).json({ error: 'Avatar-Seed erforderlich' });
  }
  
  try {
    const { data: user, error } = await db
      .from('users')
      .update({ avatar_seed })
      .eq('id', req.params.id)
      .select('*')
      .single();
    
    if (error || !user) {
      return res.status(400).json({ error: 'Fehler beim Update' });
    }
    
    delete user.pass;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Get Global Highscores (Rang-Punkte System)
app.get('/api/global-highscores', async (req, res) => {
  try {
    const { data: scores, error } = await db
      .from('highscores')
      .select('users!user_id(name, avatar_seed), score, game_type')
      .limit(500);

    if (error) return res.status(400).json({ error: 'Fehler beim Laden' });

    // Beste Scores pro User und Spiel sammeln
    const userMap = {};
    (scores || []).forEach(item => {
      const u = item.users;
      if (!u) return;
      const uid = u.name.toLowerCase();
      if (!userMap[uid]) {
        userMap[uid] = { name: u.name, avatar_seed: u.avatar_seed, memory: 0, stack: 0, reaction_ms: 0, precision: 0, guess: 0, wordle: 0, flappy: 0 };
      }
      if (item.game_type === 'memory') {
        userMap[uid].memory = Math.max(userMap[uid].memory, item.score);
      } else if (item.game_type === 'stack') {
        userMap[uid].stack = Math.max(userMap[uid].stack, item.score);
      } else if (item.game_type === 'reaction' && item.score > 0) {
        userMap[uid].reaction_ms = userMap[uid].reaction_ms === 0
          ? item.score
          : Math.min(userMap[uid].reaction_ms, item.score);
      } else if (item.game_type === 'bubble' || item.game_type === 'precision') {
        userMap[uid].precision = Math.max(userMap[uid].precision, item.score);
      } else if (item.game_type === 'guess') {
        userMap[uid].guess = Math.max(userMap[uid].guess, item.score);
      } else if (item.game_type === 'wordle') {
        userMap[uid].wordle = Math.max(userMap[uid].wordle, item.score);
      } else if (item.game_type === 'flappy') {
        userMap[uid].flappy = Math.max(userMap[uid].flappy, item.score);
      }
    });

    const users = Object.values(userMap);

    // Rang-Punkte vergeben pro Spiel
    function rankPts(i) { return i === 0 ? 10 : i === 1 ? 8 : i <= 4 ? 5 : 1; }

    const memRanked       = [...users].sort((a, b) => b.memory - a.memory);
    const stackRanked     = [...users].sort((a, b) => b.stack - a.stack);
    const precisionRanked = [...users].sort((a, b) => b.precision - a.precision);
    const guessRanked     = [...users].sort((a, b) => b.guess - a.guess);
    const wordleRanked    = [...users].sort((a, b) => b.wordle - a.wordle);
    const flappyRanked    = [...users].sort((a, b) => b.flappy - a.flappy);
    const reactionRanked  = [...users].sort((a, b) => {
      if (!a.reaction_ms && !b.reaction_ms) return 0;
      if (!a.reaction_ms) return 1;
      if (!b.reaction_ms) return -1;
      return a.reaction_ms - b.reaction_ms;
    });

    const pts = {};
    users.forEach(u => { pts[u.name.toLowerCase()] = 0; });
    memRanked.forEach((u, i)       => { if (u.memory      > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    stackRanked.forEach((u, i)     => { if (u.stack       > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    reactionRanked.forEach((u, i)  => { if (u.reaction_ms > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    precisionRanked.forEach((u, i) => { if (u.precision   > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    guessRanked.forEach((u, i)     => { if (u.guess       > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    wordleRanked.forEach((u, i)    => { if (u.wordle      > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    flappyRanked.forEach((u, i)    => { if (u.flappy      > 0) pts[u.name.toLowerCase()] += rankPts(i); });

    const result = users
      .map(u => ({ ...u, rank_points: pts[u.name.toLowerCase()] }))
      .sort((a, b) => b.rank_points - a.rank_points)
      .slice(0, 20);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= USER SUCHE =============

app.get('/api/users/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const me = parseInt(req.query.me);
  try {
    let query = db.from('users').select('id, name, avatar_seed, is_online, last_seen').limit(100);
    if (q) query = query.ilike('name', '%' + q + '%');
    else query = query.order('name');
    const { data: users, error } = await query;
    if (error) return res.status(400).json({ error: 'Fehler' });
    const now = Date.now();
    // Compute real online status from last_seen (heartbeat every 30s, 3 min grace period)
    const result = (users || [])
      .filter(u => u.id !== me)
      .map(u => ({
        ...u,
        is_online: u.last_seen
          ? (now - new Date(u.last_seen).getTime()) < 3 * 60 * 1000
          : false
      }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= HEARTBEAT =============

// In-memory activity store — no DB column needed, resets on server restart (fine for live status)
const userActivities = new Map(); // user_id → activity string

app.post('/api/users/heartbeat', async (req, res) => {
  const { user_id, activity } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Fehlende Daten' });
  // Store activity in memory
  if (activity !== undefined) userActivities.set(parseInt(user_id), activity);
  try {
    await db.from('users').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', user_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= FREUNDE V2 =============

// WICHTIG: spezifische Routen VOR /:user_id registrieren!

// Freundschaftsanfrage senden
app.post('/api/friends/request', async (req, res) => {
  const { user_id, friend_id } = req.body;
  if (!user_id || !friend_id) return res.status(400).json({ error: 'Fehlende Daten' });
  if (parseInt(user_id) === parseInt(friend_id)) return res.status(400).json({ error: 'Du kannst dich nicht selbst hinzufügen' });
  try {
    // Prüfen ob schon eine Anfrage/Freundschaft existiert
    const { data: existing } = await db.from('friendships')
      .select('id, status')
      .or(`and(sender_id.eq.${user_id},receiver_id.eq.${friend_id}),and(sender_id.eq.${friend_id},receiver_id.eq.${user_id})`)
      .maybeSingle();
    if (existing) {
      if (existing.status === 'accepted') return res.status(400).json({ error: 'Ihr seid bereits befreundet' });
      if (existing.status === 'pending') return res.status(400).json({ error: 'Anfrage bereits gesendet' });
    }
    const { error } = await db.from('friendships').insert({
      sender_id: parseInt(user_id),
      receiver_id: parseInt(friend_id),
      status: 'pending'
    });
    if (error) return res.status(400).json({ error: 'Fehler beim Senden der Anfrage' });
    // Push notification to recipient
    const { data: sender } = await db.from('users').select('name').eq('id', user_id).single();
    sendPushToUser(parseInt(friend_id), '👥 Freundschaftsanfrage', (sender?.name || 'Jemand') + ' möchte dich als Freund hinzufügen!');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Offene Anfragen abrufen (MUSS vor /:user_id stehen!)
app.get('/api/friends/requests/:user_id', async (req, res) => {
  try {
    const { data: requests, error } = await db
      .from('friendships')
      .select('id, sender_id, created_at, users!sender_id(name, avatar_seed, is_online, last_seen)')
      .eq('receiver_id', req.params.user_id)
      .eq('status', 'pending');
    if (error) return res.status(400).json({ error: 'Fehler beim Laden' });
    const result = (requests || []).map(r => ({
      id: r.id,
      sender_id: r.sender_id,
      name: r.users?.name || 'Unbekannt',
      avatar_seed: r.users?.avatar_seed,
      is_online: r.users?.is_online,
      last_seen: r.users?.last_seen,
      created_at: r.created_at
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Anfrage beantworten (accept / decline)
app.post('/api/friends/respond', async (req, res) => {
  const { friendship_id, action } = req.body;
  if (!friendship_id || !action) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    if (action === 'accept') {
      // Status auf accepted setzen
      const { data: fs, error: e1 } = await db.from('friendships')
        .update({ status: 'accepted' })
        .eq('id', friendship_id)
        .select('sender_id, receiver_id')
        .single();
      if (e1 || !fs) return res.status(400).json({ error: 'Anfrage nicht gefunden' });
      // Gegenrichtung auch einfügen
      await db.from('friendships').insert({
        sender_id: fs.receiver_id,
        receiver_id: fs.sender_id,
        status: 'accepted'
      });
      res.json({ success: true });
    } else if (action === 'decline') {
      await db.from('friendships').delete().eq('id', friendship_id);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Ungültige Aktion' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Freundesliste abrufen
app.get('/api/friends/:user_id', async (req, res) => {
  try {
    const { data: friendships, error } = await db
      .from('friendships')
      .select('receiver_id, users!receiver_id(id, name, avatar_seed, memory, stack, reaction, is_online, last_seen)')
      .eq('sender_id', req.params.user_id)
      .eq('status', 'accepted');
    if (error) return res.status(400).json({ error: 'Fehler beim Laden' });
    const result = (friendships || []).map(f => ({
      id: f.users?.id,
      name: f.users?.name,
      avatar_seed: f.users?.avatar_seed,
      memory: f.users?.memory || 0,
      stack: f.users?.stack || 0,
      reaction_ms: f.users?.reaction || 0,
      is_online: f.users?.is_online,
      last_seen: f.users?.last_seen
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Freundschaft entfernen (beide Richtungen)
app.delete('/api/friends/remove', async (req, res) => {
  const { user_id, friend_id } = req.body;
  if (!user_id || !friend_id) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    await db.from('friendships').delete()
      .eq('sender_id', user_id).eq('receiver_id', friend_id);
    await db.from('friendships').delete()
      .eq('sender_id', friend_id).eq('receiver_id', user_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= MULTIPLAYER LOBBY =============
// WICHTIG: /invite/:user_id VOR /:id registrieren!

app.post('/api/lobby/create', async (req, res) => {
  const { host_id, game_type } = req.body;
  if (!host_id) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    // Initialize correct game_state per game type
    let initialState;
    if (game_type === 'connect4') {
      initialState = { board: Array(6 * 7).fill(''), currentTurn: 'R' };
    } else if (game_type === 'chess') {
      initialState = { moves: [], currentTurn: 'w' };
    } else if (game_type === 'rps') {
      initialState = { round: 1, hostChoice: null, guestChoice: null };
    } else if (game_type === 'pong') {
      initialState = {};
    } else {
      initialState = { board: Array(9).fill(''), currentTurn: 'X' };
    }
    const { data, error } = await db.from('game_lobbies')
      .insert({
        host_id,
        game_type: game_type || 'tictactoe',
        status: 'waiting',
        game_state: initialState
      })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.post('/api/lobby/join', async (req, res) => {
  const { lobby_id, guest_id } = req.body;
  if (!lobby_id || !guest_id) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    const { data, error } = await db.from('game_lobbies')
      .update({ guest_id, status: 'playing', updated_at: new Date().toISOString() })
      .eq('id', lobby_id)
      .eq('status', 'waiting')
      .select().single();
    if (error || !data) return res.status(400).json({ error: 'Lobby nicht verfügbar' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.post('/api/lobby/move', async (req, res) => {
  const { lobby_id, user_id, move } = req.body;
  if (!lobby_id || !user_id || move === undefined) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    const { data: lobby, error: e1 } = await db.from('game_lobbies').select('*').eq('id', lobby_id).single();
    if (e1 || !lobby) return res.status(404).json({ error: 'Lobby nicht gefunden' });
    const gameType = lobby.game_type || 'tictactoe';
    const state = lobby.game_state || {};
    const isHost = lobby.host_id === parseInt(user_id);

    if (gameType === 'tictactoe') {
      if (!state.board) state.board = Array(9).fill('');
      if (!state.currentTurn) state.currentTurn = 'X';
      const symbol = isHost ? 'X' : 'O';
      if (state.currentTurn !== symbol) return res.status(400).json({ error: 'Nicht dein Zug' });
      if (state.board[move]) return res.status(400).json({ error: 'Feld belegt' });
      state.board[move] = symbol;
      state.currentTurn = symbol === 'X' ? 'O' : 'X';

    } else if (gameType === 'connect4') {
      const COLS = 7, ROWS = 6;
      if (!state.board) state.board = Array(ROWS * COLS).fill('');
      if (!state.currentTurn) state.currentTurn = 'R';
      const symbol = isHost ? 'R' : 'Y';
      if (state.currentTurn !== symbol) return res.status(400).json({ error: 'Nicht dein Zug' });
      const col = parseInt(move);
      if (col < 0 || col >= COLS) return res.status(400).json({ error: 'Ungültige Spalte' });
      let row = -1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (!state.board[r * COLS + col]) { row = r; break; }
      }
      if (row === -1) return res.status(400).json({ error: 'Spalte voll' });
      state.board[row * COLS + col] = symbol;
      state.currentTurn = symbol === 'R' ? 'Y' : 'R';
      state.lastMove = { row, col, symbol };

    } else if (gameType === 'rps') {
      const playerKey = isHost ? 'hostChoice' : 'guestChoice';
      if (!state.round) state.round = 1;
      state[playerKey] = move;

    } else {
      return res.status(400).json({ error: 'Unbekannter Spieltyp' });
    }

    const { data, error: e2 } = await db.from('game_lobbies')
      .update({ game_state: state, updated_at: new Date().toISOString() })
      .eq('id', lobby_id).select().single();
    if (e2) throw e2;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Generic state patch (used by Pong for ball/paddle sync and RPS for round progression)
app.put('/api/lobby/state', async (req, res) => {
  const { lobby_id, user_id, patch } = req.body;
  if (!lobby_id || !user_id || !patch) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    const { data: lobby, error: e1 } = await db.from('game_lobbies').select('game_state').eq('id', lobby_id).single();
    if (e1 || !lobby) return res.status(404).json({ error: 'Lobby nicht gefunden' });
    const newState = Object.assign({}, lobby.game_state || {}, patch);
    const { error: e2 } = await db.from('game_lobbies')
      .update({ game_state: newState, updated_at: new Date().toISOString() })
      .eq('id', lobby_id);
    if (e2) throw e2;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.post('/api/lobby/invite', async (req, res) => {
  const { lobby_id, from_id, to_id } = req.body;
  if (!lobby_id || !from_id || !to_id) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    const { data, error } = await db.from('game_invites')
      .insert({ lobby_id, from_id, to_id, status: 'pending' })
      .select().single();
    if (error) throw error;
    // Send push notification to invited user
    const { data: fromUser } = await db.from('users').select('name').eq('id', from_id).single();
    const { data: lobby } = await db.from('game_lobbies').select('game_type').eq('id', lobby_id).single();
    const gameNames = { tictactoe:'TicTacToe', connect4:'4 Gewinnt', pong:'Pong', rps:'Schere Stein Papier', chess:'Schach' };
    const gameName = lobby ? (gameNames[lobby.game_type] || lobby.game_type) : 'einem Spiel';
    sendPushToUser(to_id, '⚔️ Spieleinladung', (fromUser?.name || 'Jemand') + ' lädt dich zu ' + gameName + ' ein!');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.get('/api/lobby/invite/:user_id', async (req, res) => {
  try {
    const { data, error } = await db.from('game_invites')
      .select('id, lobby_id, from_id, created_at, users!from_id(name, avatar_seed)')
      .eq('to_id', req.params.user_id)
      .eq('status', 'pending');
    if (error) throw error;
    // Fetch game_type for each lobby
    const lobbyIds = (data || []).map(i => i.lobby_id).filter(Boolean);
    let gameTypeMap = {};
    if (lobbyIds.length > 0) {
      const { data: lobbies } = await db.from('game_lobbies').select('id, game_type').in('id', lobbyIds);
      (lobbies || []).forEach(l => { gameTypeMap[l.id] = l.game_type; });
    }
    const result = (data || []).map(inv => ({
      id: inv.id,
      lobby_id: inv.lobby_id,
      from_id: inv.from_id,
      from_name: inv.users?.name || 'Unbekannt',
      avatar_seed: inv.users?.avatar_seed,
      game_type: gameTypeMap[inv.lobby_id] || 'tictactoe',
      created_at: inv.created_at
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.get('/api/lobby/:id', async (req, res) => {
  try {
    const { data, error } = await db.from('game_lobbies').select('*').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= PRIVATE CHAT =============

app.get('/api/chat/private/:user_id/:friend_id', async (req, res) => {
  try {
    const userId = parseInt(req.params.user_id);
    const friendId = parseInt(req.params.friend_id);
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const { data, error } = await db
      .from('private_chat')
      .select('id, sender_id, receiver_id, message, is_read, created_at')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    // Als gelesen markieren
    await db.from('private_chat')
      .update({ is_read: true })
      .eq('receiver_id', userId)
      .eq('sender_id', friendId)
      .eq('is_read', false);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.post('/api/chat/private', async (req, res) => {
  try {
    const { sender_id, receiver_id, message } = req.body;
    if (!sender_id || !receiver_id || !message) return res.status(400).json({ error: 'Fehlende Felder' });
    const trimmed = String(message).trim().slice(0, 200);
    if (!trimmed) return res.status(400).json({ error: 'Leere Nachricht' });
    const { data, error } = await db
      .from('private_chat')
      .insert({ sender_id, receiver_id, message: trimmed, is_read: false })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.get('/api/chat/unread/:user_id', async (req, res) => {
  try {
    const userId = parseInt(req.params.user_id);
    const { data, error } = await db
      .from('private_chat')
      .select('sender_id, message, created_at')
      .eq('receiver_id', userId)
      .eq('is_read', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    // Group by sender, keep latest message preview
    const map = {};
    (data || []).forEach(function(row) {
      if (!map[row.sender_id]) {
        map[row.sender_id] = { count: 0, latest_message: row.message };
      }
      map[row.sender_id].count++;
    });
    const result = Object.entries(map).map(function([friend_id, v]) {
      return { friend_id: parseInt(friend_id), count: v.count, latest_message: v.latest_message };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= GLOBAL CHAT =============

app.get('/api/chat/global', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const { data, error } = await db
      .from('global_chat')
      .select('id, user_id, user_name, avatar_seed, message, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.post('/api/chat/global', async (req, res) => {
  try {
    const { user_id, user_name, avatar_seed, message } = req.body;
    if (!user_id || !user_name || !message) return res.status(400).json({ error: 'Fehlende Felder' });
    const trimmed = String(message).trim().slice(0, 200);
    if (!trimmed) return res.status(400).json({ error: 'Leere Nachricht' });
    const { data, error } = await db
      .from('global_chat')
      .insert({ user_id, user_name, avatar_seed: avatar_seed || null, message: trimmed })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= LIVE ACTIVITY =============

app.get('/api/live-activity', async (req, res) => {
  try {
    const now = Date.now();
    const { data: users, error } = await db
      .from('users')
      .select('id, name, avatar_seed, last_seen')
      .order('last_seen', { ascending: false })
      .limit(50);
    if (error) throw error;
    // Only users active within last 3 minutes
    const active = (users || []).filter(u =>
      u.last_seen && (now - new Date(u.last_seen).getTime()) < 3 * 60 * 1000
    ).map(u => ({
      id: u.id,
      name: u.name,
      avatar_seed: u.avatar_seed,
      // Activity from in-memory map (updated via heartbeat)
      activity: userActivities.get(u.id) || 'main',
      last_seen: u.last_seen
    }));
    res.json(active);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= PUSH NOTIFICATIONS =============

let webpush = null;
let vapidPublicKey = null;
let vapidPrivateKey = null;

try {
  webpush = require('web-push');
  vapidPublicKey  = process.env.VAPID_PUBLIC_KEY;
  vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!vapidPublicKey || !vapidPrivateKey) {
    // Generate new VAPID keys and print them — user must add to .env
    const keys = webpush.generateVAPIDKeys();
    vapidPublicKey  = keys.publicKey;
    vapidPrivateKey = keys.privateKey;
    console.log('\n⚠️  VAPID keys not set! Add these to your .env file and redeploy:');
    console.log('VAPID_PUBLIC_KEY=' + vapidPublicKey);
    console.log('VAPID_PRIVATE_KEY=' + vapidPrivateKey + '\n');
  }
  webpush.setVapidDetails('mailto:admin@arcadebox.app', vapidPublicKey, vapidPrivateKey);
} catch(e) {
  console.warn('web-push not available, push notifications disabled:', e.message);
}

// Unsubscribe: remove all push subscriptions for a user (called on logout)
app.delete('/api/push/subscribe', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    await db.from('push_subscriptions').delete().eq('user_id', user_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Return VAPID public key to client
app.get('/api/push/vapid-public-key', (req, res) => {
  if (!vapidPublicKey) return res.status(503).json({ error: 'Push nicht konfiguriert' });
  res.json({ key: vapidPublicKey });
});

// Save push subscription for a user
app.post('/api/push/subscribe', async (req, res) => {
  const { user_id, subscription } = req.body;
  if (!user_id || !subscription) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    // Upsert: delete old for same endpoint, insert new
    await db.from('push_subscriptions')
      .delete()
      .eq('user_id', user_id)
      .eq('subscription->>endpoint', subscription.endpoint);
    await db.from('push_subscriptions').insert({ user_id, subscription });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Helper: send push notification to a specific user
async function sendPushToUser(userId, title, body, extra = {}) {
  if (!webpush) return;
  try {
    const { data: subs } = await db.from('push_subscriptions')
      .select('subscription').eq('user_id', userId);
    if (!subs || !subs.length) return;
    const payload = JSON.stringify({ title, body, ...extra });
    for (const row of subs) {
      try {
        await webpush.sendNotification(row.subscription, payload);
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          // Subscription expired — clean up
          await db.from('push_subscriptions')
            .delete()
            .eq('user_id', userId)
            .eq('subscription->>endpoint', row.subscription.endpoint);
        }
      }
    }
  } catch (e) {}
}

// ============= SERVER STARTEN =============
console.log('About to start server');
const PORT = process.env.PORT || 3000;
console.log('PORT value:', PORT, 'type:', typeof PORT);

try {
  app.listen(PORT, () => {
    console.log(`🎮 ArcadeBox Server läuft auf http://localhost:${PORT}`);
  });
} catch (err) {
  console.error('Error starting server:', err);
  process.exit(1);
}
