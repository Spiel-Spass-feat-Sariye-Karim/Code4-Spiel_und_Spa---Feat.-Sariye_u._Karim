-- Erstelle die highscores Tabelle in Supabase
CREATE TABLE highscores (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  game_type VARCHAR(50) NOT NULL,
  score INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index für bessere Performance
CREATE INDEX idx_highscores_score ON highscores(score DESC);
CREATE INDEX idx_highscores_user_id ON highscores(user_id);
