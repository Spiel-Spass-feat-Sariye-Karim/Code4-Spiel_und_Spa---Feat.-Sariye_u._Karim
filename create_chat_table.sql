CREATE TABLE global_chat (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  user_name VARCHAR(50) NOT NULL,
  avatar_seed VARCHAR(50),
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_global_chat_created ON global_chat(created_at DESC);
