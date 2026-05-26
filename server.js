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
      updates[game_type] = (user[game_type] === 0) ? score : Math.min(user[game_type], score);
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
        userMap[uid] = { name: u.name, avatar_seed: u.avatar_seed, memory: 0, stack: 0, reaction_ms: 0 };
      }
      if (item.game_type === 'memory') {
        userMap[uid].memory = Math.max(userMap[uid].memory, item.score);
      } else if (item.game_type === 'stack') {
        userMap[uid].stack = Math.max(userMap[uid].stack, item.score);
      } else if (item.game_type === 'reaction' && item.score > 0) {
        userMap[uid].reaction_ms = userMap[uid].reaction_ms === 0
          ? item.score
          : Math.min(userMap[uid].reaction_ms, item.score);
      }
    });

    const users = Object.values(userMap);

    // Rang-Punkte vergeben pro Spiel
    function rankPts(i) { return i === 0 ? 10 : i === 1 ? 8 : i <= 4 ? 5 : 1; }

    const memRanked      = [...users].sort((a, b) => b.memory - a.memory);
    const stackRanked    = [...users].sort((a, b) => b.stack - a.stack);
    const reactionRanked = [...users].sort((a, b) => {
      if (!a.reaction_ms && !b.reaction_ms) return 0;
      if (!a.reaction_ms) return 1;
      if (!b.reaction_ms) return -1;
      return a.reaction_ms - b.reaction_ms; // niedrigere ms = besser
    });

    const pts = {};
    users.forEach(u => { pts[u.name.toLowerCase()] = 0; });
    memRanked.forEach((u, i)      => { if (u.memory     > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    stackRanked.forEach((u, i)    => { if (u.stack      > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    reactionRanked.forEach((u, i) => { if (u.reaction_ms > 0) pts[u.name.toLowerCase()] += rankPts(i); });

    const result = users
      .map(u => ({ ...u, rank_points: pts[u.name.toLowerCase()] }))
      .sort((a, b) => b.rank_points - a.rank_points)
      .slice(0, 10);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= TÄGLICHE CHALLENGE =============

const DAILY_ROTATION = ['memory', 'reaction', 'stack'];
const DAILY_NAMES = { memory: 'Farb-Gedächtnis', reaction: 'Reaktionstest', stack: 'Turm-Stapler' };

function getDailyGame() {
  const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  return DAILY_ROTATION[dayIndex % DAILY_ROTATION.length];
}

app.get('/api/daily-challenge', (req, res) => {
  const game = getDailyGame();
  res.json({ game, name: DAILY_NAMES[game] });
});

app.get('/api/daily-scores', async (req, res) => {
  try {
    const game = getDailyGame();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const { data: scores, error } = await db
      .from('highscores')
      .select('users!user_id(name, avatar_seed), score')
      .eq('game_type', game)
      .gte('created_at', today.toISOString())
      .lt('created_at', tomorrow.toISOString())
      .order('score', { ascending: game === 'reaction' }) // reaction: niedrigere ms = besser
      .limit(10);

    if (error) return res.status(400).json({ error: 'Fehler beim Laden' });

    const result = (scores || []).map(s => ({
      name: s.users?.name || 'Unbekannt',
      avatar_seed: s.users?.avatar_seed,
      score: s.score
    }));
    res.json({ game, name: DAILY_NAMES[game], scores: result });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= USER SUCHE =============

app.get('/api/users/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const me = parseInt(req.query.me);
  if (!q || q.length < 1) return res.json([]);
  try {
    const { data: users, error } = await db
      .from('users')
      .select('id, name, avatar_seed, is_online, last_seen')
      .ilike('name', '%' + q + '%')
      .limit(10);
    if (error) return res.status(400).json({ error: 'Fehler' });
    const result = (users || []).filter(u => u.id !== me);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= HEARTBEAT =============

app.post('/api/users/heartbeat', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Fehlende Daten' });
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
