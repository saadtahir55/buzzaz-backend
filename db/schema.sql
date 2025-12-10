-- Minimal Postgres schema to keep Firebase for auth (ID tokens)
-- and store application data in Postgres.

CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'content_creator',
  display_name TEXT,
  social_connections JSONB,
  password_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Instagram profile (mirrors users/{uid}/instagram/profile)
CREATE TABLE IF NOT EXISTS instagram_profiles (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  username TEXT,
  full_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  profile_pic_url_hd TEXT,
  followers INTEGER,
  following INTEGER,
  posts_count INTEGER,
  is_verified BOOLEAN,
  is_private BOOLEAN,
  location TEXT,
  gender TEXT,
  categories TEXT[],
  content_types TEXT[],
  is_active BOOLEAN DEFAULT TRUE,
  external_url TEXT,
  business_category_name TEXT,
  category_name TEXT,
  is_business_account BOOLEAN,
  is_professional_account BOOLEAN,
  business_email TEXT,
  business_phone_number TEXT,
  business_address_json JSONB,
  engagement_rate NUMERIC,
  created_at TIMESTAMPTZ,
  last_updated TIMESTAMPTZ,
  original_json JSONB,
  UNIQUE(uid)
);

-- Instagram reels (mirrors users/{uid}/instagram/reels.reels[])
CREATE TABLE IF NOT EXISTS instagram_reels (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  reel_id TEXT,
  short_code TEXT,
  display_url TEXT,
  caption TEXT,
  owner_full_name TEXT,
  owner_username TEXT,
  url TEXT,
  comments_count INTEGER,
  likes_count INTEGER,
  views_count INTEGER,
  timestamp TIMESTAMPTZ,
  video_duration INTEGER,
  video_url TEXT,
  hashtags JSONB,
  mentions JSONB,
  is_sponsored BOOLEAN,
  original_json JSONB
);

-- Optional: detailed data mirror (instagramDetailedData/{uid})
CREATE TABLE IF NOT EXISTS instagram_detailed_data (
  uid TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  data JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_ip_username_trgm ON instagram_profiles USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ip_full_name_trgm ON instagram_profiles USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ip_followers ON instagram_profiles (followers);

-- Password reset tokens (Postgres replacement for Firestore password_resets)
CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

-- Conversations (Postgres replacement for Firestore conversations)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  participants TEXT[] NOT NULL,
  participant_details JSONB,
  last_message TEXT,
  last_message_time TIMESTAMPTZ,
  last_message_sender TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_participants ON conversations USING gin (participants);

-- Conversation messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_name TEXT,
  message TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  is_filtered BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);

-- Influencers (mirror of Firestore 'influencers')
CREATE TABLE IF NOT EXISTS influencers (
  uid TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  bio TEXT,
  instagram_username TEXT,
  followers INTEGER,
  following INTEGER,
  posts_count INTEGER,
  engagement_rate NUMERIC,
  is_verified BOOLEAN,
  is_private BOOLEAN,
  avatar_url TEXT,
  location TEXT,
  niche TEXT[],
  content_style TEXT[],
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  original_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_influencers_username_trgm ON influencers USING gin (instagram_username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_influencers_followers ON influencers(followers);

-- UGC Creators (mirror of Firestore 'ugc_creators')
CREATE TABLE IF NOT EXISTS ugc_creators (
  uid TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  bio TEXT,
  location TEXT,
  categories TEXT[],
  content_types TEXT[],
  is_active BOOLEAN DEFAULT TRUE,
  pricing JSONB,
  sample_content JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  original_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_ugc_categories ON ugc_creators USING gin (categories);
CREATE INDEX IF NOT EXISTS idx_ugc_content_types ON ugc_creators USING gin (content_types);

-- YouTube Analytics (mirror of Firestore 'youtubeAnalytics')
CREATE TABLE IF NOT EXISTS youtube_analytics (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  channel_id TEXT,
  channel_title TEXT,
  channel_url TEXT,
  user_type TEXT,
  subscriber_count INTEGER,
  view_count INTEGER,
  video_count INTEGER,
  analytics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_youtube_analytics_uid ON youtube_analytics(uid);
