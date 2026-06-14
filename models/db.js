// ============================================================================
// models/db.js — 단일 better-sqlite3 연결 + 전체 스키마(단일 출처)
// ============================================================================
// 기존 server.js 가 인라인으로 만들던 DB 연결/DDL 을 여기로 모은다. server.js 와
// v1 게이미피케이션 모듈(services/*)이 **같은 연결**을 공유하도록 싱글톤을 export 한다.
//
// iron law: 기존 테이블/컬럼(users·shoes·runs)과 데이터는 절대 파괴하지 않는다.
//   · CREATE TABLE IF NOT EXISTS — 기존 데이터 보존.
//   · ALTER TABLE ... ADD COLUMN 은 try/catch(이미 있으면 무시) — 멱등.
//   · v1 테이블은 모두 신규(CREATE IF NOT EXISTS)라 기존 동작에 영향 없다.
// ============================================================================
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'solelife.db'));
db.pragma('journal_mode = WAL'); // 동시 읽기 안정성(쓰기 1, 읽기 다수).

// ── 기존 스키마(server.js 에서 이관 — 동일 정의, 멱등) ────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    device_id TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shoes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    max_km INTEGER NOT NULL DEFAULT 600,
    start_km REAL NOT NULL DEFAULT 0,
    purchase_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    shoe_id TEXT NOT NULL,
    km REAL NOT NULL,
    run_date TEXT NOT NULL,
    memo TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',
    duration INTEGER DEFAULT 0,
    cadence INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (shoe_id) REFERENCES shoes(id)
  );
`);

// 기존 DB 에 없을 수 있는 컬럼을 안전하게 추가(이미 있으면 무시).
const safeAlter = sql => {
  try {
    db.exec(sql);
  } catch (e) {
    /* 이미 존재 — 무시 */
  }
};
safeAlter('ALTER TABLE shoes ADD COLUMN retired INTEGER DEFAULT 0');
safeAlter('ALTER TABLE runs ADD COLUMN route TEXT DEFAULT ""');
safeAlter('ALTER TABLE runs ADD COLUMN location TEXT DEFAULT ""');
safeAlter('ALTER TABLE runs ADD COLUMN heart_rate INTEGER DEFAULT 0');

// ── v1 식별자 브릿지 ────────────────────────────────────────────────────────
// 기존 user 는 device_id 기반(users.id = uuid)인데, v1 게이미피케이션은 Firebase UID 를
// 주 식별자로 쓴다. 둘을 잇기 위해 users 에 firebase_uid 를 추가한다(선택, NULL 허용).
// POST /api/v1/users/me/link 로 인증된 uid 를 기존 device 계정에 연결하면, 서버측
// 재계산이 firebase_uid → users.id → shoes/runs 로 검증된 데이터를 모은다.
safeAlter('ALTER TABLE users ADD COLUMN firebase_uid TEXT');
safeAlter('CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid)');

// ── v1 게이미피케이션 스키마(전부 신규) ───────────────────────────────────────
// 모든 테이블의 주 식별자는 uid(Firebase UID). 점수/랭크/포인트는 클라가 아니라
// 서버가 검증된 shoes/runs 로 재계산해 채운다(클라 제출 점수 불신).
db.exec(`
  CREATE TABLE IF NOT EXISTS user_profiles (
    uid TEXT PRIMARY KEY,
    nickname TEXT DEFAULT '',
    profile_image_url TEXT DEFAULT '',
    rank TEXT DEFAULT 'bronze',
    rank_color TEXT DEFAULT '#CD7F32',
    rank_score REAL DEFAULT 0,
    equipped_title TEXT DEFAULT '',
    total_distance REAL DEFAULT 0,
    total_runs INTEGER DEFAULT 0,
    total_shoes INTEGER DEFAULT 0,
    retired_shoes INTEGER DEFAULT 0,
    progress_points INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS monthly_stats (
    uid TEXT NOT NULL,
    year_month TEXT NOT NULL,
    distance_km REAL DEFAULT 0,
    run_count INTEGER DEFAULT 0,
    active_days INTEGER DEFAULT 0,
    shoes_used_count INTEGER DEFAULT 0,
    rotation_score REAL DEFAULT 0,
    shoe_health_score REAL DEFAULT 0,
    progress_points INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (uid, year_month)
  );

  CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    achievement_key TEXT NOT NULL,
    category TEXT DEFAULT '',
    rarity TEXT DEFAULT 'bronze',
    unlocked_at TEXT DEFAULT (datetime('now')),
    UNIQUE (uid, achievement_key)
  );

  CREATE TABLE IF NOT EXISTS titles (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    title_key TEXT NOT NULL,
    category TEXT DEFAULT '',
    tier TEXT DEFAULT 'bronze',
    is_equipped INTEGER DEFAULT 0,
    unlocked_at TEXT DEFAULT (datetime('now')),
    UNIQUE (uid, title_key)
  );

  CREATE TABLE IF NOT EXISTS challenge_progress (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    challenge_key TEXT NOT NULL,
    year_month TEXT NOT NULL,
    progress REAL DEFAULT 0,
    target REAL DEFAULT 0,
    completed INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE (uid, challenge_key, year_month)
  );

  CREATE TABLE IF NOT EXISTS leaderboard_entries (
    uid TEXT NOT NULL,
    year_month TEXT NOT NULL,
    category TEXT NOT NULL,
    rank INTEGER DEFAULT 0,
    score REAL DEFAULT 0,
    nickname TEXT DEFAULT '',
    rank_tier TEXT DEFAULT 'bronze',
    rank_color TEXT DEFAULT '#CD7F32',
    equipped_title TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (uid, year_month, category)
  );

  CREATE INDEX IF NOT EXISTS idx_monthly_uid ON monthly_stats(uid);
  CREATE INDEX IF NOT EXISTS idx_leaderboard_lookup ON leaderboard_entries(category, year_month, rank);
`);

module.exports = db;
