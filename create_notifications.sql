-- Run this in Supabase SQL editor for persistent notification history
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'system', -- 'invite' | 'friend_request' | 'message' | 'system'
  icon TEXT NOT NULL DEFAULT '🔔',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_user_time ON notifications(user_id, created_at DESC);
