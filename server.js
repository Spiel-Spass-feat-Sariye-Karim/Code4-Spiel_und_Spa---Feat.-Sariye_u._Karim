const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Supabase (geheimer Key!)
const { createClient } = require('@supabase/supabase-js');
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const app = express();
app.use(express.json());
app.use(cors());

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
      .select('score, game_type, user_id, users(name, avatar_seed)')
      .order('score', { ascending: false })
      .limit(10);
    
    if (error) {
      return res.status(400).json({ error: 'Fehler beim Laden' });
    }
    
    res.json(scores);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= SERVER STARTEN =============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎮 ArcadeBox Server läuft auf http://localhost:${PORT}`);
});
