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
});

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
  { brand: "Nike", model: "Pegasus 41", max_km: 640, type: "일반형", keywords: ["pegasus 41", "pegasus41", "페가수스 41"] },
  { brand: "Nike", model: "Pegasus 40", max_km: 640, type: "일반형", keywords: ["pegasus 40", "페가수스 40"] },
  { brand: "Nike", model: "Pegasus 39", max_km: 640, type: "일반형", keywords: ["pegasus 39", "페가수스 39"] },
  { brand: "Nike", model: "Vaporfly 3", max_km: 300, type: "카본 레이싱", keywords: ["vaporfly 3", "vaporfly3", "베이퍼플라이 3"] },
  { brand: "Nike", model: "Vaporfly 2", max_km: 300, type: "카본 레이싱", keywords: ["vaporfly 2", "베이퍼플라이 2"] },
  { brand: "Nike", model: "Alphafly 3", max_km: 300, type: "카본 레이싱", keywords: ["alphafly 3", "alphafly3", "알파플라이 3"] },
  { brand: "Nike", model: "Alphafly 2", max_km: 300, type: "카본 레이싱", keywords: ["alphafly 2", "알파플라이 2"] },
  { brand: "Nike", model: "Invincible 3", max_km: 640, type: "맥스쿠션", keywords: ["invincible 3", "invincible3", "인빈시블 3"] },
  { brand: "Nike", model: "Invincible 2", max_km: 640, type: "맥스쿠션", keywords: ["invincible 2", "인빈시블 2"] },
  { brand: "Nike", model: "Infinity Run 4", max_km: 650, type: "안정화", keywords: ["infinity run 4", "인피니티 4"] },
  { brand: "Nike", model: "Infinity Run 3", max_km: 650, type: "안정화", keywords: ["infinity run 3", "인피니티 3"] },
  { brand: "Nike", model: "Zoom Fly 5", max_km: 500, type: "내구형", keywords: ["zoom fly 5", "zoomfly5", "줌플라이 5"] },
  { brand: "Nike", model: "Zoom Fly 4", max_km: 500, type: "내구형", keywords: ["zoom fly 4", "줌플라이 4"] },
  { brand: "Nike", model: "Structure 25", max_km: 700, type: "안정화", keywords: ["structure 25", "스트럭처 25"] },
  { brand: "Nike", model: "Structure 24", max_km: 700, type: "안정화", keywords: ["structure 24", "스트럭처 24"] },
  { brand: "Nike", model: "Ultrafly", max_km: 800, type: "트레일", keywords: ["ultrafly", "울트라플라이"] },
  { brand: "Nike", model: "Streakfly", max_km: 350, type: "카본 레이싱", keywords: ["streakfly", "스트리크플라이"] },
  { brand: "Nike", model: "Winflo 10", max_km: 600, type: "일반형", keywords: ["winflo 10", "윈플로 10"] },
  { brand: "Nike", model: "Winflo 9", max_km: 600, type: "일반형", keywords: ["winflo 9", "윈플로 9"] },
  { brand: "Nike", model: "React Infinity Run 3", max_km: 640, type: "안정화", keywords: ["react infinity", "리액트 인피니티"] },
  { brand: "ASICS", model: "Superblast 2", max_km: 700, type: "맥스쿠션", keywords: ["superblast 2", "superblast2", "슈퍼블라스트 2", "슈퍼블라스트"] },
  { brand: "ASICS", model: "Gel-Kayano 31", max_km: 700, type: "안정화", keywords: ["gel-kayano 31", "kayano 31", "카야노 31"] },
  { brand: "ASICS", model: "Gel-Kayano 30", max_km: 700, type: "안정화", keywords: ["gel-kayano 30", "kayano 30", "카야노 30"] },
  { brand: "ASICS", model: "Gel-Kayano 29", max_km: 700, type: "안정화", keywords: ["gel-kayano 29", "kayano 29", "카야노 29"] },
  { brand: "ASICS", model: "Gel-Nimbus 26", max_km: 800, type: "맥스쿠션", keywords: ["gel-nimbus 26", "nimbus 26", "님버스 26"] },
  { brand: "ASICS", model: "Gel-Nimbus 25", max_km: 800, type: "맥스쿠션", keywords: ["gel-nimbus 25", "nimbus 25", "님버스 25"] },
  { brand: "ASICS", model: "Gel-Cumulus 26", max_km: 700, type: "일반형", keywords: ["gel-cumulus 26", "cumulus 26", "큐물러스 26"] },
  { brand: "ASICS", model: "Gel-Cumulus 25", max_km: 700, type: "일반형", keywords: ["gel-cumulus 25", "cumulus 25", "큐물러스 25"] },
  { brand: "ASICS", model: "Metaspeed Sky+", max_km: 400, type: "카본 레이싱", keywords: ["metaspeed sky", "메타스피드 스카이"] },
  { brand: "ASICS", model: "Metaspeed Edge+", max_km: 400, type: "카본 레이싱", keywords: ["metaspeed edge", "메타스피드 엣지"] },
  { brand: "ASICS", model: "Novablast 4", max_km: 600, type: "일반형", keywords: ["novablast 4", "노바블라스트 4"] },
  { brand: "ASICS", model: "Novablast 3", max_km: 600, type: "일반형", keywords: ["novablast 3", "노바블라스트 3"] },
  { brand: "ASICS", model: "GT-2000 12", max_km: 700, type: "안정화", keywords: ["gt-2000 12", "gt2000", "지티2000"] },
  { brand: "ASICS", model: "GT-1000 12", max_km: 650, type: "안정화", keywords: ["gt-1000 12", "gt1000", "지티1000"] },
  { brand: "ASICS", model: "Gel-DS Trainer 28", max_km: 600, type: "경량형", keywords: ["ds trainer 28", "ds트레이너"] },
  { brand: "ASICS", model: "Gel-Pulse 15", max_km: 600, type: "일반형", keywords: ["gel-pulse 15", "pulse 15", "펄스 15"] },
  { brand: "ASICS", model: "Gel-Contend 9", max_km: 550, type: "일반형", keywords: ["gel-contend 9", "contend 9"] },
  { brand: "ASICS", model: "Gel-Venture 9", max_km: 500, type: "트레일", keywords: ["venture 9", "벤처 9"] },
  { brand: "ASICS", model: "Gel-Sonoma 7", max_km: 600, type: "트레일", keywords: ["sonoma 7", "소노마 7"] },
  { brand: "Brooks", model: "Ghost 16", max_km: 700, type: "일반형", keywords: ["ghost 16", "ghost16", "고스트 16"] },
  { brand: "Brooks", model: "Ghost 15", max_km: 700, type: "일반형", keywords: ["ghost 15", "고스트 15"] },
  { brand: "Brooks", model: "Ghost 14", max_km: 700, type: "일반형", keywords: ["ghost 14", "고스트 14"] },
  { brand: "Brooks", model: "Glycerin 21", max_km: 700, type: "맥스쿠션", keywords: ["glycerin 21", "글리세린 21"] },
  { brand: "Brooks", model: "Glycerin 20", max_km: 700, type: "맥스쿠션", keywords: ["glycerin 20", "글리세린 20"] },
  { brand: "Brooks", model: "Adrenaline GTS 24", max_km: 700, type: "안정화", keywords: ["adrenaline gts 24", "gts 24", "아드레날린 24"] },
  { brand: "Brooks", model: "Adrenaline GTS 23", max_km: 700, type: "안정화", keywords: ["adrenaline gts 23", "gts 23", "아드레날린 23"] },
  { brand: "Brooks", model: "Hyperion Elite 4", max_km: 400, type: "카본 레이싱", keywords: ["hyperion elite 4", "하이페리온 엘리트 4"] },
  { brand: "Brooks", model: "Hyperion Elite 3", max_km: 400, type: "카본 레이싱", keywords: ["hyperion elite 3", "하이페리온 엘리트 3"] },
  { brand: "Brooks", model: "Hyperion Max 2", max_km: 600, type: "맥스쿠션", keywords: ["hyperion max 2", "하이페리온 맥스"] },
  { brand: "Brooks", model: "Levitate 7", max_km: 600, type: "일반형", keywords: ["levitate 7", "레비테이트 7"] },
  { brand: "Brooks", model: "Launch 10", max_km: 600, type: "경량형", keywords: ["launch 10", "런치 10"] },
  { brand: "Brooks", model: "Cascadia 17", max_km: 700, type: "트레일", keywords: ["cascadia 17", "캐스케이디아 17"] },
  { brand: "Adidas", model: "Adizero Boston 12", max_km: 800, type: "내구형", keywords: ["adizero boston 12", "boston 12", "보스턴 12"] },
  { brand: "Adidas", model: "Adizero Boston 11", max_km: 800, type: "내구형", keywords: ["adizero boston 11", "boston 11", "보스턴 11"] },
  { brand: "Adidas", model: "Adizero Adios Pro 3", max_km: 400, type: "카본 레이싱", keywords: ["adios pro 3", "아디오스 프로 3"] },
  { brand: "Adidas", model: "Adizero Adios Pro Evo 1", max_km: 300, type: "카본 레이싱", keywords: ["adios pro evo", "아디오스 프로 에보"] },
  { brand: "Adidas", model: "Ultraboost 23", max_km: 800, type: "맥스쿠션", keywords: ["ultraboost 23", "울트라부스트 23"] },
  { brand: "Adidas", model: "Ultraboost 22", max_km: 800, type: "맥스쿠션", keywords: ["ultraboost 22", "울트라부스트 22"] },
  { brand: "Adidas", model: "Ultraboost Light", max_km: 700, type: "맥스쿠션", keywords: ["ultraboost light", "울트라부스트 라이트"] },
  { brand: "Adidas", model: "Solarboost 5", max_km: 700, type: "일반형", keywords: ["solarboost 5", "솔라부스트 5"] },
  { brand: "Adidas", model: "Supernova Rise", max_km: 600, type: "일반형", keywords: ["supernova rise", "수퍼노바 라이즈"] },
  { brand: "Adidas", model: "Adizero SL", max_km: 600, type: "경량형", keywords: ["adizero sl", "아디제로 sl"] },
  { brand: "Adidas", model: "Terrex Agravic 3", max_km: 700, type: "트레일", keywords: ["terrex agravic 3", "테렉스 아그라빅"] },
  { brand: "Saucony", model: "Endorphin Pro 4", max_km: 400, type: "카본 레이싱", keywords: ["endorphin pro 4", "엔돌핀 프로 4"] },
  { brand: "Saucony", model: "Endorphin Pro 3", max_km: 400, type: "카본 레이싱", keywords: ["endorphin pro 3", "엔돌핀 프로 3"] },
  { brand: "Saucony", model: "Endorphin Speed 4", max_km: 700, type: "일반형", keywords: ["endorphin speed 4", "엔돌핀 스피드 4"] },
  { brand: "Saucony", model: "Endorphin Speed 3", max_km: 700, type: "일반형", keywords: ["endorphin speed 3", "엔돌핀 스피드 3"] },
  { brand: "Saucony", model: "Endorphin Shift 3", max_km: 700, type: "맥스쿠션", keywords: ["endorphin shift 3", "엔돌핀 시프트 3"] },
  { brand: "Saucony", model: "Kinvara 15", max_km: 600, type: "경량형", keywords: ["kinvara 15", "킨바라 15"] },
  { brand: "Saucony", model: "Kinvara 14", max_km: 600, type: "경량형", keywords: ["kinvara 14", "킨바라 14"] },
  { brand: "Saucony", model: "Triumph 22", max_km: 800, type: "맥스쿠션", keywords: ["triumph 22", "트라이엄프 22"] },
  { brand: "Saucony", model: "Triumph 21", max_km: 800, type: "맥스쿠션", keywords: ["triumph 21", "트라이엄프 21"] },
  { brand: "Saucony", model: "Ride 17", max_km: 700, type: "일반형", keywords: ["ride 17", "라이드 17"] },
  { brand: "Saucony", model: "Ride 16", max_km: 700, type: "일반형", keywords: ["ride 16", "라이드 16"] },
  { brand: "Saucony", model: "Guide 17", max_km: 700, type: "안정화", keywords: ["guide 17", "가이드 17"] },
  { brand: "Saucony", model: "Peregrine 14", max_km: 700, type: "트레일", keywords: ["peregrine 14", "페레그린 14"] },
  { brand: "Hoka", model: "Clifton 9", max_km: 800, type: "맥스쿠션", keywords: ["clifton 9", "clifton9", "클리프턴 9"] },
  { brand: "Hoka", model: "Clifton 8", max_km: 800, type: "맥스쿠션", keywords: ["clifton 8", "클리프턴 8"] },
  { brand: "Hoka", model: "Bondi 8", max_km: 800, type: "맥스쿠션", keywords: ["bondi 8", "bondi8", "본디 8"] },
  { brand: "Hoka", model: "Bondi X", max_km: 700, type: "맥스쿠션", keywords: ["bondi x", "본디x"] },
  { brand: "Hoka", model: "Mach 6", max_km: 700, type: "일반형", keywords: ["mach 6", "mach6", "마하 6"] },
  { brand: "Hoka", model: "Mach 5", max_km: 700, type: "일반형", keywords: ["mach 5", "마하 5"] },
  { brand: "Hoka", model: "Carbon X 3", max_km: 500, type: "카본 레이싱", keywords: ["carbon x 3", "카본x3"] },
  { brand: "Hoka", model: "Cielo X1", max_km: 400, type: "카본 레이싱", keywords: ["cielo x1", "시엘로 x1"] },
  { brand: "Hoka", model: "Speedgoat 6", max_km: 600, type: "트레일", keywords: ["speedgoat 6", "스피드고트 6"] },
  { brand: "Hoka", model: "Speedgoat 5", max_km: 600, type: "트레일", keywords: ["speedgoat 5", "스피드고트 5"] },
  { brand: "Hoka", model: "Rincon 3", max_km: 600, type: "경량형", keywords: ["rincon 3", "링콘 3"] },
  { brand: "Hoka", model: "Kawana 2", max_km: 700, type: "일반형", keywords: ["kawana 2", "카와나 2"] },
  { brand: "Hoka", model: "Arahi 7", max_km: 700, type: "안정화", keywords: ["arahi 7", "아라히 7"] },
  { brand: "Hoka", model: "Challenger 7", max_km: 700, type: "트레일", keywords: ["challenger 7", "챌린저 7"] },
  { brand: "New Balance", model: "Fresh Foam X 1080 v14", max_km: 700, type: "맥스쿠션", keywords: ["1080 v14", "1080v14", "프레시폼 1080"] },
  { brand: "New Balance", model: "Fresh Foam X 1080 v13", max_km: 700, type: "맥스쿠션", keywords: ["1080 v13", "1080v13"] },
  { brand: "New Balance", model: "Fresh Foam X 880 v14", max_km: 700, type: "일반형", keywords: ["880 v14", "880v14", "프레시폼 880"] },
  { brand: "New Balance", model: "Fresh Foam X 860 v14", max_km: 700, type: "안정화", keywords: ["860 v14", "860v14", "프레시폼 860"] },
  { brand: "New Balance", model: "FuelCell SC Elite v4", max_km: 400, type: "카본 레이싱", keywords: ["sc elite v4", "퓨얼셀 엘리트"] },
  { brand: "New Balance", model: "FuelCell Rebel v4", max_km: 600, type: "경량형", keywords: ["fuelcell rebel v4", "퓨얼셀 레벨"] },
  { brand: "New Balance", model: "FuelCell SC Trainer v2", max_km: 600, type: "일반형", keywords: ["sc trainer v2", "퓨얼셀 트레이너"] },
  { brand: "New Balance", model: "More v4", max_km: 700, type: "맥스쿠션", keywords: ["more v4", "모어 v4"] },
  { brand: "New Balance", model: "Hierro v8", max_km: 700, type: "트레일", keywords: ["hierro v8", "히에로 v8"] },
  { brand: "On", model: "Cloudmonster 2", max_km: 700, type: "맥스쿠션", keywords: ["cloudmonster 2", "클라우드몬스터 2"] },
  { brand: "On", model: "Cloudmonster", max_km: 700, type: "맥스쿠션", keywords: ["cloudmonster", "클라우드몬스터"] },
  { brand: "On", model: "Cloudsurfer 7", max_km: 650, type: "일반형", keywords: ["cloudsurfer 7", "클라우드서퍼 7"] },
  { brand: "On", model: "Cloud X 3", max_km: 600, type: "일반형", keywords: ["cloud x 3", "클라우드x3"] },
  { brand: "On", model: "Cloudflow 4", max_km: 600, type: "경량형", keywords: ["cloudflow 4", "클라우드플로우 4"] },
  { brand: "On", model: "Cloudstratus 3", max_km: 700, type: "안정화", keywords: ["cloudstratus 3", "클라우드스트라투스"] },
  { brand: "On", model: "Cloudvista", max_km: 650, type: "트레일", keywords: ["cloudvista", "클라우드비스타"] },
  { brand: "On", model: "Cloudboom Echo 3", max_km: 400, type: "카본 레이싱", keywords: ["cloudboom echo 3", "클라우드붐 에코"] },
  { brand: "Mizuno", model: "Wave Rider 27", max_km: 700, type: "일반형", keywords: ["wave rider 27", "웨이브라이더 27"] },
  { brand: "Mizuno", model: "Wave Rider 26", max_km: 700, type: "일반형", keywords: ["wave rider 26", "웨이브라이더 26"] },
  { brand: "Mizuno", model: "Wave Inspire 20", max_km: 700, type: "안정화", keywords: ["wave inspire 20", "웨이브인스파이어 20"] },
  { brand: "Mizuno", model: "Wave Sky 7", max_km: 750, type: "맥스쿠션", keywords: ["wave sky 7", "웨이브스카이 7"] },
  { brand: "Mizuno", model: "Wave Creation 21", max_km: 800, type: "맥스쿠션", keywords: ["wave creation 21", "웨이브크리에이션 21"] },
  { brand: "Mizuno", model: "Wave Rebellion Pro 2", max_km: 400, type: "카본 레이싱", keywords: ["wave rebellion pro 2", "웨이브리벨리온 프로"] },
  { brand: "Mizuno", model: "Wave Neo Ultra", max_km: 400, type: "카본 레이싱", keywords: ["wave neo ultra", "웨이브네오 울트라"] },
  { brand: "Puma", model: "Deviate Nitro Elite 3", max_km: 400, type: "카본 레이싱", keywords: ["deviate nitro elite 3", "데비에이트 나이트로"] },
  { brand: "Puma", model: "Velocity Nitro 3", max_km: 650, type: "일반형", keywords: ["velocity nitro 3", "벨로시티 나이트로 3"] },
  { brand: "Puma", model: "Magnify Nitro 2", max_km: 700, type: "맥스쿠션", keywords: ["magnify nitro 2", "매그니파이 나이트로"] },
  { brand: "Salomon", model: "Speedcross 6", max_km: 600, type: "트레일", keywords: ["speedcross 6", "스피드크로스 6"] },
  { brand: "Salomon", model: "Speedcross 5", max_km: 600, type: "트레일", keywords: ["speedcross 5", "스피드크로스 5"] },
  { brand: "Salomon", model: "Sense Ride 5", max_km: 650, type: "트레일", keywords: ["sense ride 5", "센스라이드 5"] },
  { brand: "Altra", model: "Torin 7", max_km: 700, type: "맥스쿠션", keywords: ["torin 7", "토린 7"] },
  { brand: "Altra", model: "Lone Peak 8", max_km: 700, type: "트레일", keywords: ["lone peak 8", "론피크 8"] },

  // Nike 2024-2025
  { brand: "Nike", model: "Pegasus 42", max_km: 640, type: "일반형", keywords: ["pegasus 42", "pegasus42", "페가수스 42"] },
  { brand: "Nike", model: "Pegasus Plus", max_km: 640, type: "맥스쿠션", keywords: ["pegasus plus", "페가수스 플러스"] },
  { brand: "Nike", model: "Invincible 4", max_km: 640, type: "맥스쿠션", keywords: ["invincible 4", "invincible4", "인빈시블 4"] },
  { brand: "Nike", model: "Vaporfly 4", max_km: 300, type: "카본 레이싱", keywords: ["vaporfly 4", "vaporfly4", "베이퍼플라이 4"] },
  { brand: "Nike", model: "Structure 26", max_km: 700, type: "안정화", keywords: ["structure 26", "스트럭처 26"] },
  { brand: "Nike", model: "Infinity Run 5", max_km: 650, type: "안정화", keywords: ["infinity run 5", "인피니티 5"] },
  { brand: "Nike", model: "Winflo 11", max_km: 600, type: "일반형", keywords: ["winflo 11", "윈플로 11"] },

  // ASICS 2024-2025
  { brand: "ASICS", model: "Metaspeed Sky Paris", max_km: 400, type: "카본 레이싱", keywords: ["metaspeed sky paris", "메타스피드 스카이 파리", "sky paris"] },
  { brand: "ASICS", model: "Metaspeed Edge Paris", max_km: 400, type: "카본 레이싱", keywords: ["metaspeed edge paris", "메타스피드 엣지 파리", "edge paris"] },
  { brand: "ASICS", model: "Superblast 3", max_km: 700, type: "맥스쿠션", keywords: ["superblast 3", "superblast3", "슈퍼블라스트 3"] },
  { brand: "ASICS", model: "Gel-Kayano 32", max_km: 700, type: "안정화", keywords: ["gel-kayano 32", "kayano 32", "카야노 32"] },
  { brand: "ASICS", model: "Gel-Nimbus 27", max_km: 800, type: "맥스쿠션", keywords: ["gel-nimbus 27", "nimbus 27", "님버스 27"] },
  { brand: "ASICS", model: "Gel-Cumulus 27", max_km: 700, type: "일반형", keywords: ["gel-cumulus 27", "cumulus 27", "큐물러스 27"] },
  { brand: "ASICS", model: "Novablast 5", max_km: 600, type: "일반형", keywords: ["novablast 5", "노바블라스트 5"] },
  { brand: "ASICS", model: "GT-2000 13", max_km: 700, type: "안정화", keywords: ["gt-2000 13", "gt2000 13", "지티2000 13"] },
  { brand: "ASICS", model: "Gel-Trabuco 13", max_km: 600, type: "트레일", keywords: ["gel-trabuco 13", "trabuco 13", "트라부코"] },

  // Hoka 2024-2025
  { brand: "Hoka", model: "Bondi 9", max_km: 800, type: "맥스쿠션", keywords: ["bondi 9", "bondi9", "본디 9"] },
  { brand: "Hoka", model: "Clifton 10", max_km: 800, type: "맥스쿠션", keywords: ["clifton 10", "clifton10", "클리프턴 10"] },
  { brand: "Hoka", model: "Mach X", max_km: 600, type: "카본 레이싱", keywords: ["mach x", "machx", "마하x"] },
  { brand: "Hoka", model: "Mach X 2", max_km: 600, type: "카본 레이싱", keywords: ["mach x 2", "mach x2", "마하x2"] },
  { brand: "Hoka", model: "Skyward X", max_km: 700, type: "맥스쿠션", keywords: ["skyward x", "스카이워드x"] },
  { brand: "Hoka", model: "Kawana 3", max_km: 700, type: "일반형", keywords: ["kawana 3", "카와나 3"] },
  { brand: "Hoka", model: "Arahi 8", max_km: 700, type: "안정화", keywords: ["arahi 8", "아라히 8"] },
  { brand: "Hoka", model: "Speedgoat 7", max_km: 600, type: "트레일", keywords: ["speedgoat 7", "스피드고트 7"] },

  // Brooks 2024-2025
  { brand: "Brooks", model: "Ghost 17", max_km: 700, type: "일반형", keywords: ["ghost 17", "ghost17", "고스트 17"] },
  { brand: "Brooks", model: "Glycerin 22", max_km: 700, type: "맥스쿠션", keywords: ["glycerin 22", "글리세린 22"] },
  { brand: "Brooks", model: "Adrenaline GTS 25", max_km: 700, type: "안정화", keywords: ["adrenaline gts 25", "gts 25", "아드레날린 25"] },
  { brand: "Brooks", model: "Hyperion Elite 4", max_km: 400, type: "카본 레이싱", keywords: ["hyperion elite 4", "하이페리온 엘리트 4"] },
  { brand: "Brooks", model: "Aurora-BL", max_km: 500, type: "카본 레이싱", keywords: ["aurora bl", "aurora-bl", "오로라"] },

  // Adidas 2024-2025
  { brand: "Adidas", model: "Ultraboost 24", max_km: 800, type: "맥스쿠션", keywords: ["ultraboost 24", "울트라부스트 24"] },
  { brand: "Adidas", model: "Ultraboost 25", max_km: 800, type: "맥스쿠션", keywords: ["ultraboost 25", "울트라부스트 25"] },
  { brand: "Adidas", model: "Adizero Adios Pro 4", max_km: 400, type: "카본 레이싱", keywords: ["adios pro 4", "아디오스 프로 4"] },
  { brand: "Adidas", model: "Adizero Boston 13", max_km: 800, type: "내구형", keywords: ["adizero boston 13", "boston 13", "보스턴 13"] },
  { brand: "Adidas", model: "Adizero Prime X 2 Strung", max_km: 300, type: "카본 레이싱", keywords: ["prime x 2", "프라임x2", "adizero prime"] },

  // New Balance 2024-2025
  { brand: "New Balance", model: "Fresh Foam X 1080 v15", max_km: 700, type: "맥스쿠션", keywords: ["1080 v15", "1080v15", "프레시폼 1080 v15"] },
  { brand: "New Balance", model: "Fresh Foam X 880 v15", max_km: 700, type: "일반형", keywords: ["880 v15", "880v15"] },
  { brand: "New Balance", model: "Fresh Foam X 860 v15", max_km: 700, type: "안정화", keywords: ["860 v15", "860v15"] },
  { brand: "New Balance", model: "FuelCell SC Elite v5", max_km: 400, type: "카본 레이싱", keywords: ["sc elite v5", "퓨얼셀 엘리트 v5"] },
  { brand: "New Balance", model: "FuelCell Rebel v4", max_km: 600, type: "경량형", keywords: ["fuelcell rebel v4", "퓨얼셀 레벨 v4"] },

  // Saucony 2024-2025
  { brand: "Saucony", model: "Endorphin Speed 5", max_km: 700, type: "일반형", keywords: ["endorphin speed 5", "엔돌핀 스피드 5"] },
  { brand: "Saucony", model: "Endorphin Pro 4", max_km: 400, type: "카본 레이싱", keywords: ["endorphin pro 4", "엔돌핀 프로 4"] },
  { brand: "Saucony", model: "Triumph 23", max_km: 800, type: "맥스쿠션", keywords: ["triumph 23", "트라이엄프 23"] },
  { brand: "Saucony", model: "Ride 18", max_km: 700, type: "일반형", keywords: ["ride 18", "라이드 18"] },
  { brand: "Saucony", model: "Guide 18", max_km: 700, type: "안정화", keywords: ["guide 18", "가이드 18"] },
  { brand: "Saucony", model: "Kinvara 15", max_km: 600, type: "경량형", keywords: ["kinvara 15", "킨바라 15"] },

  // On Running 2024-2025
  { brand: "On", model: "Cloudmonster Hyper", max_km: 500, type: "카본 레이싱", keywords: ["cloudmonster hyper", "클라우드몬스터 하이퍼"] },
  { brand: "On", model: "Cloudsurfer Next", max_km: 650, type: "일반형", keywords: ["cloudsurfer next", "클라우드서퍼 넥스트"] },
  { brand: "On", model: "Cloudultra 2", max_km: 600, type: "트레일", keywords: ["cloudultra 2", "클라우드울트라 2"] },
  { brand: "On", model: "Cloudboom Strike LS", max_km: 400, type: "카본 레이싱", keywords: ["cloudboom strike", "클라우드붐 스트라이크"] },

  // Mizuno 2024-2025
  { brand: "Mizuno", model: "Wave Rider 28", max_km: 700, type: "일반형", keywords: ["wave rider 28", "웨이브라이더 28"] },
  { brand: "Mizuno", model: "Wave Inspire 21", max_km: 700, type: "안정화", keywords: ["wave inspire 21", "웨이브인스파이어 21"] },
  { brand: "Mizuno", model: "Wave Sky 8", max_km: 750, type: "맥스쿠션", keywords: ["wave sky 8", "웨이브스카이 8"] },
  { brand: "Mizuno", model: "Wave Rebellion Flash", max_km: 600, type: "경량형", keywords: ["wave rebellion flash", "웨이브리벨리온 플래시"] },

  // Puma 2024-2025
  { brand: "Puma", model: "Fast-R Nitro Elite 3", max_km: 400, type: "카본 레이싱", keywords: ["fast-r nitro elite 3", "패스트r 나이트로"] },
  { brand: "Puma", model: "Deviate Nitro Elite 2", max_km: 400, type: "카본 레이싱", keywords: ["deviate nitro elite 2", "데비에이트 나이트로 2"] },

  // Salomon 2024-2025
  { brand: "Salomon", model: "Speedcross 6 GTX", max_km: 600, type: "트레일", keywords: ["speedcross 6 gtx", "스피드크로스 6 gtx"] },
  { brand: "Salomon", model: "Genesis", max_km: 600, type: "트레일", keywords: ["salomon genesis", "살로몬 제네시스"] },
  { brand: "Salomon", model: "Pulsar Trail Pro 2", max_km: 500, type: "트레일", keywords: ["pulsar trail pro 2", "펄사 트레일"] },

  // Under Armour
  { brand: "Under Armour", model: "Flow Velociti Elite 2", max_km: 400, type: "카본 레이싱", keywords: ["velociti elite 2", "벨로시티 엘리트", "under armour"] },
  { brand: "Under Armour", model: "Flow Machina 3", max_km: 650, type: "일반형", keywords: ["flow machina 3", "플로우 마키나", "machina"] },

  // Craft
  { brand: "Craft", model: "CTM Ultra Carbon 2", max_km: 500, type: "카본 레이싱", keywords: ["ctm ultra carbon 2", "크래프트 카본"] },

  // Topo Athletic
  { brand: "Topo Athletic", model: "Ultrafly 5", max_km: 700, type: "일반형", keywords: ["ultrafly 5", "토포 울트라플라이"] },
  { brand: "Topo Athletic", model: "MT-5", max_km: 600, type: "트레일", keywords: ["mt-5", "토포 mt5"] },

  // Nike 추가
  { brand: "Nike", model: "Free Run 5.0", max_km: 500, type: "경량형", keywords: ["free run 5", "free run5", "프리런 5"] },
  { brand: "Nike", model: "React Miler 3", max_km: 600, type: "일반형", keywords: ["react miler 3", "리액트 마일러 3"] },
  { brand: "Nike", model: "Zoom Tempo NEXT%", max_km: 400, type: "카본 레이싱", keywords: ["zoom tempo", "줌 템포", "tempo next"] },
  { brand: "Nike", model: "Air Zoom Terra Kiger 8", max_km: 600, type: "트레일", keywords: ["terra kiger 8", "kiger 8", "테라카이거 8"] },
  { brand: "Nike", model: "Zegama 2", max_km: 700, type: "트레일", keywords: ["zegama 2", "제가마 2"] },

  // ASICS 추가
  { brand: "ASICS", model: "Gel-Excite 10", max_km: 500, type: "일반형", keywords: ["gel-excite 10", "excite 10", "엑사이트 10"] },
  { brand: "ASICS", model: "Gel-Kayano 33", max_km: 700, type: "안정화", keywords: ["gel-kayano 33", "kayano 33", "카야노 33"] },
  { brand: "ASICS", model: "Gel-Nimbus Lite 4", max_km: 700, type: "경량형", keywords: ["nimbus lite 4", "님버스 라이트 4"] },
  { brand: "ASICS", model: "Gel-Pulse 16", max_km: 600, type: "일반형", keywords: ["gel-pulse 16", "pulse 16", "펄스 16"] },

  // Brooks 추가
  { brand: "Brooks", model: "Trace 3", max_km: 600, type: "일반형", keywords: ["trace 3", "브룩스 트레이스 3"] },
  { brand: "Brooks", model: "Revel 6", max_km: 600, type: "경량형", keywords: ["revel 6", "레벨 6"] },
  { brand: "Brooks", model: "Caldera 7", max_km: 600, type: "트레일", keywords: ["caldera 7", "칼데라 7"] },
  { brand: "Brooks", model: "Divide 4", max_km: 600, type: "트레일", keywords: ["divide 4", "디바이드 4"] },

  // Hoka 추가
  { brand: "Hoka", model: "Rincon 4", max_km: 600, type: "경량형", keywords: ["rincon 4", "링콘 4"] },
  { brand: "Hoka", model: "Gaviota 5", max_km: 700, type: "안정화", keywords: ["gaviota 5", "가비오타 5"] },
  { brand: "Hoka", model: "Stinson 7", max_km: 700, type: "트레일", keywords: ["stinson 7", "스틴슨 7"] },
  { brand: "Hoka", model: "Torrent 3", max_km: 600, type: "트레일", keywords: ["torrent 3", "토렌트 3"] },
  { brand: "Hoka", model: "EVO Speedgoat", max_km: 500, type: "트레일", keywords: ["evo speedgoat", "에보 스피드고트"] },

  // New Balance 추가
  { brand: "New Balance", model: "FuelCell Propel v4", max_km: 600, type: "경량형", keywords: ["fuelcell propel v4", "propel v4", "퓨얼셀 프로펠"] },
  { brand: "New Balance", model: "Fresh Foam X 840 v2", max_km: 600, type: "일반형", keywords: ["840 v2", "프레시폼 840"] },
  { brand: "New Balance", model: "Trail 410 v8", max_km: 600, type: "트레일", keywords: ["trail 410 v8", "410 v8", "트레일 410"] },

  // Saucony 추가
  { brand: "Saucony", model: "Kinvara Pro", max_km: 400, type: "카본 레이싱", keywords: ["kinvara pro", "킨바라 프로"] },
  { brand: "Saucony", model: "Peregrine 15", max_km: 700, type: "트레일", keywords: ["peregrine 15", "페레그린 15"] },
  { brand: "Saucony", model: "Xodus Ultra 2", max_km: 700, type: "트레일", keywords: ["xodus ultra 2", "엑소더스 울트라 2"] },

  // On Running 추가
  { brand: "On", model: "Cloud 5", max_km: 600, type: "일반형", keywords: ["cloud 5", "클라우드 5"] },
  { brand: "On", model: "Cloudswift 3", max_km: 600, type: "일반형", keywords: ["cloudswift 3", "클라우드스위프트 3"] },
  { brand: "On", model: "Cloudrunner 2", max_km: 650, type: "안정화", keywords: ["cloudrunner 2", "클라우드러너 2"] },
  { brand: "On", model: "Cloudgo", max_km: 600, type: "일반형", keywords: ["cloudgo", "클라우드고"] },

  // Adidas 추가
  { brand: "Adidas", model: "Adizero SL 2", max_km: 600, type: "경량형", keywords: ["adizero sl 2", "아디제로 sl2"] },
  { brand: "Adidas", model: "Duramo SL", max_km: 500, type: "일반형", keywords: ["duramo sl", "두라모 sl"] },
  { brand: "Adidas", model: "Supernova Solution", max_km: 600, type: "안정화", keywords: ["supernova solution", "수퍼노바 솔루션"] },

  // Mizuno 추가
  { brand: "Mizuno", model: "Wave Horizon 7", max_km: 750, type: "안정화", keywords: ["wave horizon 7", "웨이브호라이즌 7"] },
  { brand: "Mizuno", model: "Wave Prodigy 5", max_km: 600, type: "일반형", keywords: ["wave prodigy 5", "웨이브프로디지 5"] },
  { brand: "Mizuno", model: "Wave Daichi 7", max_km: 600, type: "트레일", keywords: ["wave daichi 7", "웨이브다이치 7"] },

  // Salomon 추가
  { brand: "Salomon", model: "S/LAB Ultra 3", max_km: 700, type: "트레일", keywords: ["s/lab ultra 3", "slab ultra 3", "살로몬 울트라"] },
  { brand: "Salomon", model: "Thundercross", max_km: 600, type: "트레일", keywords: ["thundercross", "썬더크로스"] },

  // Karhu
  { brand: "Karhu", model: "Fusion 4.5", max_km: 700, type: "일반형", keywords: ["karhu fusion", "카르후 퓨전", "fusion 4.5"] },
  { brand: "Karhu", model: "Ikoni 3 Evo", max_km: 600, type: "경량형", keywords: ["ikoni 3 evo", "이코니 3", "karhu ikoni"] },

  // Scott
  { brand: "Scott", model: "Speed Carbon RC", max_km: 400, type: "카본 레이싱", keywords: ["scott speed carbon", "스캇 스피드 카본"] },
  { brand: "Scott", model: "Kinabalu RC 3", max_km: 500, type: "트레일", keywords: ["kinabalu rc 3", "키나발루 rc3"] },
  { brand: "Scott", model: "Supertrac RC 3", max_km: 600, type: "트레일", keywords: ["supertrac rc 3", "수퍼트랙 rc3"] },

  // Inov-8
  { brand: "Inov-8", model: "Trailfly Ultra G 300 Max", max_km: 700, type: "트레일", keywords: ["trailfly ultra g 300", "이노브8 트레일플라이", "inov8"] },
  { brand: "Inov-8", model: "Mudclaw G 260 v2", max_km: 500, type: "트레일", keywords: ["mudclaw g 260", "머드클로우"] },

  // La Sportiva
  { brand: "La Sportiva", model: "Jackal II", max_km: 600, type: "트레일", keywords: ["jackal ii", "자칼 2", "la sportiva jackal"] },
  { brand: "La Sportiva", model: "Mutant", max_km: 600, type: "트레일", keywords: ["mutant", "뮤턴트", "la sportiva mutant"] },
  { brand: "La Sportiva", model: "Prodigio", max_km: 700, type: "일반형", keywords: ["prodigio", "프로디지오", "la sportiva"] },

  // Merrell
  { brand: "Merrell", model: "Agility Peak 5", max_km: 600, type: "트레일", keywords: ["agility peak 5", "어질리티 피크 5", "merrell"] },
  { brand: "Merrell", model: "Trail Glove 7", max_km: 500, type: "트레일", keywords: ["trail glove 7", "트레일 글로브 7"] },

  // Norda
  { brand: "Norda", model: "001", max_km: 700, type: "트레일", keywords: ["norda 001", "노르다 001"] },
  { brand: "Norda", model: "002", max_km: 600, type: "트레일", keywords: ["norda 002", "노르다 002"] },

  // Veja
  { brand: "Veja", model: "Condor 3", max_km: 600, type: "일반형", keywords: ["veja condor 3", "베자 콩도르 3", "condor 3"] },

  // Lululemon
  { brand: "Lululemon", model: "Blissfeel 2", max_km: 600, type: "일반형", keywords: ["blissfeel 2", "블리스필 2", "lululemon"] },
  { brand: "Lululemon", model: "Beyondfeel", max_km: 600, type: "일반형", keywords: ["beyondfeel", "비욘드필"] },

  // Reebok
  { brand: "Reebok", model: "Floatride Energy 5", max_km: 600, type: "일반형", keywords: ["floatride energy 5", "플로트라이드 에너지 5", "reebok"] },
  { brand: "Reebok", model: "Forever Floatride Grow", max_km: 500, type: "경량형", keywords: ["forever floatride", "포에버 플로트라이드"] },

  // 361°
  { brand: "361°", model: "Flame 5", max_km: 600, type: "일반형", keywords: ["flame 5", "플레임 5", "361"] },
  { brand: "361°", model: "Spire 6", max_km: 650, type: "일반형", keywords: ["spire 6", "스파이어 6", "361 spire"] }
];

app.get('/api/shoes/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const results = SHOE_DB.filter(s => {
    const brandMatch = s.brand.toLowerCase().includes(q);
    const modelMatch = s.model.toLowerCase().includes(q);
    const kwMatch = s.keywords.some(k => k.includes(q) || q.includes(k.substring(0, Math.min(k.length, q.length))));
    return brandMatch || modelMatch || kwMatch;
  }).slice(0, 50);
  res.json(results);
});

app.listen(PORT, () => {
  console.log(`✅ SoleLife 서버 실행 중: http://localhost:${PORT}`);
});
