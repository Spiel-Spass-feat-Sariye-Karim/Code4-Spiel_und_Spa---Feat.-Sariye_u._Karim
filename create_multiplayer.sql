CREATE TABLE game_lobbies (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  guest_id INTEGER REFERENCES users(id),
  game_type VARCHAR(50) DEFAULT 'tictactoe',
  status VARCHAR(20) DEFAULT 'waiting',
  game_state JSONB DEFAULT '{}',
  winner_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE game_invites (
  id SERIAL PRIMARY KEY,
  lobby_id INTEGER REFERENCES game_lobbies(id) ON DELETE CASCADE,
  from_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
