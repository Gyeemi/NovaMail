/**
 * Novamail - database migrations.
 *
 * Migrations are append-only. Each entry runs exactly once and is recorded in
 * PRAGMA user_version. Never edit an applied migration; add a new one.
 */
import type { Database } from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  up: (db: Database) => void
}

const sql = (db: Database, statements: string): void => {
  db.exec(statements)
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    up: (db) =>
      sql(
        db,
        `
-- ----------------------------------------------------------------- accounts
CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  provider_id     TEXT NOT NULL,
  auth_type       TEXT NOT NULL,
  oauth_provider  TEXT,
  username        TEXT NOT NULL,
  imap_host       TEXT NOT NULL,
  imap_port       INTEGER NOT NULL,
  imap_secure     INTEGER NOT NULL DEFAULT 1,
  smtp_host       TEXT NOT NULL,
  smtp_port       INTEGER NOT NULL,
  smtp_secure     INTEGER NOT NULL DEFAULT 1,
  color           TEXT NOT NULL DEFAULT '#3f7d8c',
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  last_sync_at    TEXT,
  sync_state      TEXT NOT NULL DEFAULT 'idle',
  last_error      TEXT,
  capabilities    TEXT NOT NULL DEFAULT '{}',
  signature_id    TEXT,
  imap_last_uid   INTEGER NOT NULL DEFAULT 0,
  smtp_last_check TEXT
);

-- ------------------------------------------------------------------ folders
CREATE TABLE folders (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  name          TEXT NOT NULL,
  delimiter     TEXT NOT NULL DEFAULT '/',
  kind          TEXT NOT NULL DEFAULT 'folder',
  parent_path   TEXT,
  unread_count  INTEGER NOT NULL DEFAULT 0,
  total_count   INTEGER NOT NULL DEFAULT 0,
  uid_validity  INTEGER,
  last_seen_uid INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, path)
);
CREATE INDEX idx_folders_account ON folders(account_id);

-- ----------------------------------------------------------------- messages
CREATE TABLE messages (
  id                   TEXT PRIMARY KEY,
  account_id           TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder_id            TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  uid                  INTEGER NOT NULL,
  message_id           TEXT,
  thread_id            TEXT NOT NULL,
  subject              TEXT NOT NULL DEFAULT '',
  from_name            TEXT NOT NULL DEFAULT '',
  from_address         TEXT NOT NULL DEFAULT '',
  to_json              TEXT NOT NULL DEFAULT '[]',
  cc_json              TEXT NOT NULL DEFAULT '[]',
  bcc_json             TEXT NOT NULL DEFAULT '[]',
  reply_to_json        TEXT NOT NULL DEFAULT '[]',
  snippet              TEXT NOT NULL DEFAULT '',
  date                 TEXT NOT NULL,
  size                 INTEGER NOT NULL DEFAULT 0,
  is_read              INTEGER NOT NULL DEFAULT 0,
  is_starred           INTEGER NOT NULL DEFAULT 0,
  is_important         INTEGER NOT NULL DEFAULT 0,
  is_draft             INTEGER NOT NULL DEFAULT 0,
  is_snoozed           INTEGER NOT NULL DEFAULT 0,
  snooze_until         TEXT,
  has_attachments      INTEGER NOT NULL DEFAULT 0,
  attachment_count     INTEGER NOT NULL DEFAULT 0,
  blocked_remote_count INTEGER NOT NULL DEFAULT 0,
  labels_json          TEXT NOT NULL DEFAULT '[]',
  categories_json      TEXT NOT NULL DEFAULT '[]',
  html_body            TEXT,
  text_body            TEXT,
  headers_json         TEXT NOT NULL DEFAULT '{}',
  in_reply_to          TEXT,
  references_json      TEXT NOT NULL DEFAULT '[]',
  list_unsubscribe     TEXT,
  imap_flags           TEXT NOT NULL DEFAULT '',
  has_remote_content   INTEGER NOT NULL DEFAULT 0,
  body_synced          INTEGER NOT NULL DEFAULT 0,
  is_encrypted         INTEGER NOT NULL DEFAULT 0,
  deleted_at           TEXT,
  UNIQUE (folder_id, uid)
);
CREATE INDEX idx_messages_folder_date ON messages(folder_id, date DESC);
CREATE INDEX idx_messages_account_date ON messages(account_id, date DESC);
CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_flags ON messages(is_starred, is_important, is_read);
CREATE INDEX idx_messages_message_id ON messages(message_id);

-- -------------------------------------------------------------- attachments
CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
  size        INTEGER NOT NULL DEFAULT 0,
  content_id  TEXT,
  disposition TEXT NOT NULL DEFAULT 'attachment',
  kind        TEXT NOT NULL DEFAULT 'unknown',
  cache_path  TEXT,
  checksum    TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_attachments_message ON attachments(message_id);

-- ------------------------------------------------------------------- drafts
CREATE TABLE drafts (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_drafts_account ON drafts(account_id, updated_at DESC);

-- ------------------------------------------------------------------- outbox
CREATE TABLE outbox (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  scheduled_at  TEXT,
  created_at    TEXT NOT NULL,
  sent_at       TEXT,
  dedupe_key    TEXT NOT NULL UNIQUE
);
CREATE INDEX idx_outbox_status ON outbox(status, scheduled_at);

-- ----------------------------------------------------------------- contacts
CREATE TABLE contacts (
  id            TEXT PRIMARY KEY,
  account_id    TEXT,
  display_name  TEXT NOT NULL,
  emails_json   TEXT NOT NULL DEFAULT '[]',
  phone         TEXT,
  company       TEXT,
  notes         TEXT,
  is_favorite   INTEGER NOT NULL DEFAULT 0,
  groups_json   TEXT NOT NULL DEFAULT '[]',
  last_used_at  TEXT,
  source        TEXT NOT NULL DEFAULT 'local',
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_contacts_display ON contacts(display_name, emails_json);

-- ---------------------------------------------------------------- signatures
CREATE TABLE signatures (
  id          TEXT PRIMARY KEY,
  account_id  TEXT,
  name        TEXT NOT NULL,
  html        TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- --------------------------------------------------------------------- rules
CREATE TABLE rules (
  id             TEXT PRIMARY KEY,
  account_id     TEXT,
  name           TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  match_all      INTEGER NOT NULL DEFAULT 1,
  conditions_json TEXT NOT NULL DEFAULT '[]',
  actions_json   TEXT NOT NULL DEFAULT '[]',
  stop_processing INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  match_count    INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------ calendar
CREATE TABLE calendar_events (
  id             TEXT PRIMARY KEY,
  account_id     TEXT,
  calendar_name  TEXT NOT NULL DEFAULT 'Personal',
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  location       TEXT NOT NULL DEFAULT '',
  start_at       TEXT NOT NULL,
  end_at         TEXT NOT NULL,
  all_day        INTEGER NOT NULL DEFAULT 0,
  attendees_json TEXT NOT NULL DEFAULT '[]',
  organizer      TEXT,
  is_recurring   INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT,
  reminder_minutes INTEGER,
  status         TEXT NOT NULL DEFAULT 'confirmed',
  my_response    TEXT NOT NULL DEFAULT 'needs-action',
  source         TEXT NOT NULL DEFAULT 'local',
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_events_start ON calendar_events(start_at);

-- --------------------------------------------------------------------- tasks
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  account_id   TEXT,
  title        TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  due_at       TEXT,
  completed    INTEGER NOT NULL DEFAULT 0,
  priority     TEXT NOT NULL DEFAULT 'normal',
  reminder_at  TEXT,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);

-- ------------------------------------------------------------ search helpers
CREATE TABLE saved_searches (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  query      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE recent_searches (
  query      TEXT PRIMARY KEY,
  used_at    TEXT NOT NULL,
  hit_count  INTEGER NOT NULL DEFAULT 1
);

-- --------------------------------------------------------------- sync queue
CREATE TABLE sync_queue (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  op_type         TEXT NOT NULL,
  payload_json    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  last_error      TEXT,
  dedupe_key      TEXT
);
CREATE INDEX idx_queue_status ON sync_queue(status, next_attempt_at);
CREATE UNIQUE INDEX idx_queue_dedupe ON sync_queue(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- --------------------------------------------------------------- key / value
CREATE TABLE kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ------------------------------------------------------------ full text index
CREATE VIRTUAL TABLE messages_fts USING fts5(
  subject, sender, recipients, body, tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, subject, sender, recipients, body)
  VALUES (
    new.rowid,
    new.subject,
    new.from_name || ' ' || new.from_address,
    new.to_json || ' ' || new.cc_json,
    coalesce(new.text_body, '') || ' ' || coalesce(new.html_body, '')
  );
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE OF subject, from_name, from_address, to_json, cc_json, text_body, html_body ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
  INSERT INTO messages_fts(rowid, subject, sender, recipients, body)
  VALUES (
    new.rowid,
    new.subject,
    new.from_name || ' ' || new.from_address,
    new.to_json || ' ' || new.cc_json,
    coalesce(new.text_body, '') || ' ' || coalesce(new.html_body, '')
  );
END;
`
      )
  },
  {
    version: 2,
    name: 'message-labels-index',
    up: (db) =>
      sql(
        db,
        `
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC);
CREATE INDEX IF NOT EXISTS idx_messages_snooze ON messages(is_snoozed, snooze_until);
CREATE TABLE IF NOT EXISTS labels (
  id         TEXT PRIMARY KEY,
  account_id TEXT,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#3f7d8c',
  UNIQUE (account_id, name)
);
`
      )
  },
  {
    version: 3,
    name: 'focused-inbox-flag',
    up: (db) => {
      // The repository writes is_focused for the Focused/Other split; the
      // original schema predates it. ALTER is guarded so the migration is
      // re-runnable against a database created by a newer build.
      const columns = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
      if (!columns.some((column) => column.name === 'is_focused')) {
        sql(db, 'ALTER TABLE messages ADD COLUMN is_focused INTEGER NOT NULL DEFAULT 1;')
      }
      sql(db, 'CREATE INDEX IF NOT EXISTS idx_messages_focused ON messages(folder_id, is_focused);')
    }
  }
]

export const LATEST_VERSION = migrations[migrations.length - 1]!.version
