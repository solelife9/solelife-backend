const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// DB 초기화
const db = new Database(path.join(__dirname, 'solelife.db'));

// 테이블 생성
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
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (shoe_id) REFERENCES shoes(id)
  );
`);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
  const fs = require('fs');
  const pub = path.join(__dirname, 'public', 'index.html');
  const root = path.join(__dirname, 'index.html');
  if (fs.existsSync(pub)) res.sendFile(pub);
  else if (fs.existsSync(root)) res.sendFile(root);
  else res.send('SoleLife 서버 실행 중!');
});app.use(express.static(path.join(__dirname, 'public')));

// ── 유저 등록/조회 (device_id 기반 자동 로그인) ──
app.post('/api/auth', (req, res) => {
  const { device_id } = req.body;
  if (!device_id) return res.status(400).json({ error: 'device_id 필요' });

  let user = db.prepare('SELECT * FROM users WHERE device_id = ?').get(device_id);
  if (!user) {
    const id = uuidv4();
    db.prepare('INSERT INTO users (id, device_id) VALUES (?, ?)').run(id, device_id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }
  res.json({ user_id: user.id });
});

// ── 러닝화 목록 조회 ──
app.get('/api/shoes', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id 필요' });
  const shoes = db.prepare('SELECT * FROM shoes WHERE user_id = ? ORDER BY created_at DESC').all(user_id);
  res.json(shoes);
});

// ── 러닝화 등록 ──
app.post('/api/shoes', (req, res) => {
  const { user_id, name, brand, model, max_km, start_km, purchase_date } = req.body;
  if (!user_id || !name) return res.status(400).json({ error: '필수값 누락' });
  const id = uuidv4();
  db.prepare(
    'INSERT INTO shoes (id, user_id, name, brand, model, max_km, start_km, purchase_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, user_id, name, brand || '', model || '', max_km || 600, start_km || 0, purchase_date || '');
  res.json({ id, name, brand, model, max_km, start_km, purchase_date });
});

// ── 러닝화 삭제 ──
app.delete('/api/shoes/:id', (req, res) => {
  const { user_id } = req.body;
  db.prepare('DELETE FROM runs WHERE shoe_id = ? AND user_id = ?').run(req.params.id, user_id);
  db.prepare('DELETE FROM shoes WHERE id = ? AND user_id = ?').run(req.params.id, user_id);
  res.json({ ok: true });
});

// ── 런 기록 목록 조회 ──
app.get('/api/runs', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id 필요' });
  const runs = db.prepare(
    'SELECT * FROM runs WHERE user_id = ? ORDER BY run_date DESC, created_at DESC'
  ).all(user_id);
  res.json(runs);
});

// ── 런 기록 추가 ──
app.post('/api/runs', (req, res) => {
  const { user_id, shoe_id, km, run_date, memo, source } = req.body;
  if (!user_id || !shoe_id || !km || !run_date) return res.status(400).json({ error: '필수값 누락' });
  const id = uuidv4();
  db.prepare(
    'INSERT INTO runs (id, user_id, shoe_id, km, run_date, memo, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, user_id, shoe_id, km, run_date, memo || '', source || 'manual');
  res.json({ id, shoe_id, km, run_date, memo, source });
});

// ── 런 기록 삭제 ──
app.delete('/api/runs/:id', (req, res) => {
  const { user_id } = req.body;
  db.prepare('DELETE FROM runs WHERE id = ? AND user_id = ?').run(req.params.id, user_id);
  res.json({ ok: true });
});

// ── 신발 DB 검색 (자동완성) ──
const SHOE_DB = [
  // Nike
  { brand: 'Nike', model: 'Pegasus 41', max_km: 640, type: '일반형', keywords: ['pegasus', 'pegasus41', 'pegasus 41', '페가수스'] },
  { brand: 'Nike', model: 'Pegasus 40', max_km: 640, type: '일반형', keywords: ['pegasus40', 'pegasus 40'] },
  { brand: 'Nike', model: 'Vaporfly 3', max_km: 300, type: '카본 레이싱', keywords: ['vaporfly', 'vaporfly3', 'vaporfly 3', '베이퍼플라이'] },
  { brand: 'Nike', model: 'Alphafly 3', max_km: 300, type: '카본 레이싱', keywords: ['alphafly', 'alphafly3', '알파플라이'] },
  { brand: 'Nike', model: 'Invincible 3', max_km: 640, type: '맥스쿠션', keywords: ['invincible', 'invincible3', '인빈시블'] },
  { brand: 'Nike', model: 'Infinity Run 4', max_km: 650, type: '안정화', keywords: ['infinity', 'infinity run', '인피니티'] },
  { brand: 'Nike', model: 'Zoom Fly 5', max_km: 500, type: '내구형', keywords: ['zoom fly', 'zoomfly', '줌플라이'] },
  { brand: 'Nike', model: 'Structure 25', max_km: 700, type: '안정화', keywords: ['structure', 'structure25', '스트럭처'] },
  { brand: 'Nike', model: 'Ultrafly', max_km: 800, type: '트레일', keywords: ['ultrafly', '울트라플라이'] },
  { brand: 'Nike', model: 'Streakfly', max_km: 350, type: '카본 레이싱', keywords: ['streakfly', '스트리크플라이'] },
  // ASICS
  { brand: 'ASICS', model: 'Superblast 2', max_km: 700, type: '맥스쿠션', keywords: ['superblast', '슈퍼블라스트', 'super blast'] },
  { brand: 'ASICS', model: 'Gel-Kayano 31', max_km: 700, type: '안정화', keywords: ['kayano', 'gel kayano', '카야노', 'gel-kayano'] },
  { brand: 'ASICS', model: 'Gel-Nimbus 26', max_km: 800, type: '맥스쿠션', keywords: ['nimbus', 'gel nimbus', '님버스', 'gel-nimbus'] },
  { brand: 'ASICS', model: 'Gel-Cumulus 26', max_km: 700, type: '일반형', keywords: ['cumulus', 'gel cumulus', '큐물러스'] },
  { brand: 'ASICS', model: 'Metaspeed Sky+', max_km: 400, type: '카본 레이싱', keywords: ['metaspeed', '메타스피드', 'meta speed'] },
  { brand: 'ASICS', model: 'Gel-DS Trainer 28', max_km: 600, type: '경량형', keywords: ['ds trainer', 'ds-trainer', 'ds트레이너'] },
  { brand: 'ASICS', model: 'Novablast 4', max_km: 600, type: '일반형', keywords: ['novablast', '노바블라스트', 'nova blast'] },
  // Brooks
  { brand: 'Brooks', model: 'Ghost 16', max_km: 700, type: '일반형', keywords: ['ghost', 'ghost16', '고스트'] },
  { brand: 'Brooks', model: 'Glycerin 21', max_km: 700, type: '맥스쿠션', keywords: ['glycerin', '글리세린'] },
  { brand: 'Brooks', model: 'Adrenaline GTS 23', max_km: 700, type: '안정화', keywords: ['adrenaline', 'gts', '아드레날린'] },
  { brand: 'Brooks', model: 'Hyperion Elite 4', max_km: 400, type: '카본 레이싱', keywords: ['hyperion elite', '하이페리온 엘리트'] },
  { brand: 'Brooks', model: 'Hyperion Max 2', max_km: 600, type: '맥스쿠션', keywords: ['hyperion max', '하이페리온 맥스'] },
  { brand: 'Brooks', model: 'Levitate 7', max_km: 600, type: '일반형', keywords: ['levitate', '레비테이트'] },
  // Adidas
  { brand: 'Adidas', model: 'Adizero Boston 12', max_km: 800, type: '내구형', keywords: ['boston', 'adizero boston', '보스턴'] },
  { brand: 'Adidas', model: 'Adizero Adios Pro 3', max_km: 400, type: '카본 레이싱', keywords: ['adios pro', 'adizero adios', '아디오스'] },
  { brand: 'Adidas', model: 'Ultraboost 23', max_km: 800, type: '맥스쿠션', keywords: ['ultraboost', '울트라부스트', 'ultra boost'] },
  { brand: 'Adidas', model: 'Solarboost 5', max_km: 700, type: '일반형', keywords: ['solarboost', '솔라부스트'] },
  { brand: 'Adidas', model: 'Supernova Rise', max_km: 600, type: '일반형', keywords: ['supernova', '수퍼노바'] },
  // Saucony
  { brand: 'Saucony', model: 'Endorphin Pro 4', max_km: 400, type: '카본 레이싱', keywords: ['endorphin pro', '엔돌핀 프로'] },
  { brand: 'Saucony', model: 'Endorphin Speed 4', max_km: 700, type: '일반형', keywords: ['endorphin speed', '엔돌핀 스피드'] },
  { brand: 'Saucony', model: 'Kinvara 15', max_km: 600, type: '경량형', keywords: ['kinvara', '킨바라'] },
  { brand: 'Saucony', model: 'Ride 17', max_km: 700, type: '일반형', keywords: ['ride', '라이드'] },
  { brand: 'Saucony', model: 'Triumph 22', max_km: 800, type: '맥스쿠션', keywords: ['triumph', '트라이엄프'] },
  // Hoka
  { brand: 'Hoka', model: 'Clifton 9', max_km: 800, type: '맥스쿠션', keywords: ['clifton', '클리프턴'] },
  { brand: 'Hoka', model: 'Bondi 8', max_km: 800, type: '맥스쿠션', keywords: ['bondi', '본디'] },
  { brand: 'Hoka', model: 'Mach 6', max_km: 700, type: '일반형', keywords: ['mach', '마하'] },
  { brand: 'Hoka', model: 'Carbon X 3', max_km: 500, type: '카본 레이싱', keywords: ['carbon x', 'carbonx', '카본x'] },
  { brand: 'Hoka', model: 'Speedgoat 5', max_km: 600, type: '트레일', keywords: ['speedgoat', '스피드고트'] },
  { brand: 'Hoka', model: 'Rincon 3', max_km: 600, type: '경량형', keywords: ['rincon', '링콘'] },
  // New Balance
  { brand: 'New Balance', model: 'Fresh Foam X 1080 v14', max_km: 700, type: '맥스쿠션', keywords: ['1080', 'fresh foam 1080', '1080v14'] },
  { brand: 'New Balance', model: 'FuelCell SC Elite v4', max_km: 400, type: '카본 레이싱', keywords: ['fuelcell', 'sc elite', '퓨얼셀'] },
  { brand: 'New Balance', model: 'Fresh Foam X 880 v14', max_km: 700, type: '일반형', keywords: ['880', 'fresh foam 880'] },
  { brand: 'New Balance', model: 'More v4', max_km: 700, type: '맥스쿠션', keywords: ['more v4', 'morv4', '모어'] },
];

app.get('/api/shoes/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const results = SHOE_DB.filter(s => {
    const brandMatch = s.brand.toLowerCase().includes(q);
    const modelMatch = s.model.toLowerCase().includes(q);
    const kwMatch = s.keywords.some(k => k.includes(q) || q.includes(k.substring(0, Math.min(k.length, q.length))));
    return brandMatch || modelMatch || kwMatch;
  }).slice(0, 8);
  res.json(results);
});

app.listen(PORT, () => {
  console.log(`✅ SoleLife 서버 실행 중: http://localhost:${PORT}`);
});
