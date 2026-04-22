const express = require('express');
const cors = require('cors');
require('dotenv').config();

console.log('Starting server...');

// Supabase (geheimer Key!)
const { createClient } = require('@supabase/supabase-js');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'Not set');
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'Set' : 'Not set');

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

console.log('Supabase client created');

const app = express();
app.use(express.json());
app.use(cors());
console.log('Express app configured');
// Root route
app.get('/', (req, res) => {
  res.json({ message: "Willkommen bei ArcadeBox Backend! API ist verfügbar." });
});


// Root route
app.get('/', (req, res) => {
  res.json({ message: 'Willkommen bei ArcadeBox Backend! API ist verfügbar.' });
});

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
    
    // Passwort aus Antwort entfernen (Sicherheit!)
    delete user.pass;
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
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
        games_played: 0,
        avatar_seed: Math.random().toString(36).substring(2, 10)
      })
      .select('*')
      .single();
    
    if (error) {
      return res.status(400).json({ error: 'Fehler beim Erstellen' });
    }
    
    delete user.pass;
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
    updates[game_type] = Math.max(user[game_type] || 0, score);
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

// Get Global Highscores
app.get('/api/global-highscores', async (req, res) => {
  try {
    const { data: scores, error } = await db
      .from('highscores')
      .select('users!user_id(name, avatar_seed), score, game_type')
      .order('score', { ascending: false })
      .limit(50);
    
    if (error) {
      return res.status(400).json({ error: 'Fehler beim Laden' });
    }
    
    // Gruppiere pro User
    const userMap = {};
    scores.forEach(item => {
      const u = item.users;
      if (!u) return;
      const uid = u.name.toLowerCase(); // Verwende name als key
      if (!userMap[uid]) {
        userMap[uid] = { name: u.name, avatar_seed: u.avatar_seed, memory: 0, stack: 0 };
      }
      if (item.game_type === 'memory') {
        userMap[uid].memory = Math.max(userMap[uid].memory, item.score);
      } else if (item.game_type === 'stack') {
        userMap[uid].stack = Math.max(userMap[uid].stack, item.score);
      }
    });
    
    // In Array umwandeln und nach Gesamtscore sortieren
    const result = Object.values(userMap)
      .map(user => ({ ...user, total: user.memory + user.stack }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    
    res.json(result);
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
