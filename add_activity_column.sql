-- Run this in your Supabase SQL editor to enable live activity tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS activity TEXT DEFAULT 'main';
