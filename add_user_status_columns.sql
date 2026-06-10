-- Run this in your Supabase SQL editor to enable user presence status & settings
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'online'; -- 'online' | 'away' | 'dnd'
ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_chat_icons BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accept_invites BOOLEAN DEFAULT true;
