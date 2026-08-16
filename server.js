// ============================================================
// LLM API Key Vault — 本地密钥管理服务（零依赖）
// 功能：CRUD 密钥条目 / 主密码 AES-256-GCM 加密存储 / 连通性测试代理
// 启动：node server.js  （默认 http://127.0.0.1:3210）
// ============================================================
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = process.env.KV_HOST || '127.0.0.1';
const PORT = parseInt(process.env.KV_PORT || '3210', 10);
const DATA_FILE = process.env.KV_DATA_FILE || path.join(__dirname, 'data', 'keys.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 2 * 1024 * 1024; // 2MB
const TEST_TIMEOUT_MS = 15000;
const SCRYPT_N = 2 ** 14; // 16MB 内存（OpenSSL 默认 maxmem 32MB 内）

// ---------------- 存储 ----------------
const state = {
  entries: [],          // 解密后的条目
  masterPassword: null, // 仅保存在内存中
  encrypted: false,     // 数据文件当前是否加密
  unlockFails: { count: 0, lockedUntil: 0 }, // 解锁失败计数与冻结时间
};

function loadFile() {
  if (!fs.existsSync(DATA_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveFile(plain) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const payload = state.encrypted && state.masterPassword
    ? encryptJson(plain, state.masterPassword)
    : { version: 1, encrypted: false, entries: plain.entries };
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function persist() {
  saveFile({ entries: state.entries });
}

// ---------------- 加密 ----------------
function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32, { N: SCRYPT_N, r: 8, p: 1 });
}

function encryptJson(obj, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    encrypted: true,
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  };
}

function decryptJson(file, password) {
  if (!file || file.encrypted !== true) return null;
  const salt = Buffer.from(file.salt, 'base64');
  const iv = Buffer.from(file.iv, 'base64');
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
  const enc = Buffer.from(file.data, 'base64');
  // GCM 校验失败会抛异常 => 密码错误
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function initFromDisk() {
  const file = loadFile();
  if (!file) {
    // 首次运行：创建空文件
    state.entries = [];
    state.encrypted = false;
    persist();
    return;
  }
  state.encrypted = file.encrypted === true;
  if (!state.encrypted) {
    state.entries = Array.isArray(file.entries) ? file.entries : [];
    state.masterPassword = null;
  } else {
    state.entries = []; // 加密状态下需 unlock 才能读取
    state.masterPassword = null;
  }
}

// ---------------- 工具 ----------------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function normalizeBaseUrl(url) {
  if (typeof url !== 'string') return null;
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) return null; // 仅允许 http/https，避免 file:// 等
  return u.replace(/\/+$/, '');
}

// URL 查询字符串脱敏：把指定参数名（携带 API Key）的值替换为 ***，防止 Key 落盘 / 展示
function redactUrl(rawUrl, params) {
  if (!rawUrl) return rawUrl;
  const names = Array.isArray(params) && params.length
    ? params.map((p) => String(p || '').toLowerCase()).filter(Boolean)
    : [];
  if (!names.length) return rawUrl; // 无需脱敏的请求直接返回原 url
  try {
    const u = new URL(rawUrl);
    let changed = false;
    for (const name of names) {
      if (u.searchParams.has(name)) {
        u.searchParams.set(name, '***');
        changed = true;
      }
    }
    return changed ? u.toString() : rawUrl;
  } catch {
    return rawUrl; // 解析失败（不应发生，req.url 已是 http(s)），保守返回原值
  }
}

function isOpenAIish(provider) {
  return ['openai', 'deepseek', 'moonshot', 'zhipu', 'qwen', 'siliconflow', 'openrouter', 'other-openai'].includes(provider);
}

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

// 常量时间比较，避免对主密码做明文 !== 比较引入时序侧信道
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ---------------- 测试请求 ----------------
function buildTestRequests(entry) {
  const base = normalizeBaseUrl(entry.baseUrl);
  if (!base) return null;
  const provider = entry.provider || 'openai';
  const key = entry.apiKey || '';

  if (provider === 'anthropic') {
    const mk = (b) => ({
      url: `${b}/models`,
      options: {
        method: 'GET',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'User-Agent': 'llm-key-vault',
        },
      },
    });
    return base.endsWith('/v1') ? [mk(base)] : [mk(`${base}/v1`), mk(base)];
  }

  if (provider === 'gemini') {
    const mk = (b) => ({
      url: `${b}/models?key=${encodeURIComponent(key)}`,
      options: { method: 'GET', headers: { 'User-Agent': 'llm-key-vault' } },
      redactParams: ['key'], // URL 携带 key，落盘前需脱敏
    });
    if (base.endsWith('/v1beta')) return [mk(base), mk(base.replace(/\/v1beta$/, '/v1'))];
    if (base.endsWith('/v1')) return [mk(base), mk(base.replace(/\/v1$/, '/v1beta'))];
    return [mk(`${base}/v1beta/models`), mk(`${base}/v1/models`)];
  }

  if (provider === 'custom' && entry.testConfig) {
    const tc = entry.testConfig;
    const method = (tc.method || 'GET').toUpperCase();
    const p = (tc.path || '/').startsWith('/') ? tc.path : '/' + (tc.path || '');
    const headers = { 'User-Agent': 'llm-key-vault', ...(tc.headers || {}) };
    if (tc.authMode === 'bearer') headers['Authorization'] = `Bearer ${key}`;
    else if (tc.authMode === 'apiKey') headers[tc.headerName || 'x-api-key'] = key;
    else if (tc.authMode === 'basic') headers['Authorization'] = 'Basic ' + Buffer.from(`${tc.username || ''}:${key}`).toString('base64');
    let url = `${base}${p}`;
    if (tc.authMode === 'query') {
      url += (url.includes('?') ? '&' : '?') + `${tc.queryParam || 'api_key'}=${encodeURIComponent(key)}`;
    }
    const body = tc.body ? String(tc.body) : undefined;
    const options = { method, headers };
    if (body) options.body = body;
    return [{ url, options, redactParams: tc.authMode === 'query' ? [tc.queryParam || 'api_key'] : [] }];
  }

  // 默认：OpenAI 兼容
  const mk = (b) => ({
    url: `${b}/models`,
    options: {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'llm-key-vault' },
    },
  });
  if (base.endsWith('/v1')) return [mk(base), mk(base.replace(/\/v1$/, ''))];
  return [mk(base), mk(`${base}/v1`)];
}

async function runTest(entry) {
  const requests = buildTestRequests(entry);
  if (!requests) return { ok: false, error: 'Base URL 无效（必须以 http:// 或 https:// 开头）' };
  if (!entry.apiKey) return { ok: false, error: 'API Key 为空' };

  const attempts = [];
  for (const req of requests) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
      const resp = await fetch(req.url, { ...req.options, redirect: 'manual', signal: controller.signal });
      const latencyMs = Date.now() - started;
      const text = await resp.text().catch(() => '');
      const result = {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        statusText: resp.statusText || '',
        url: redactUrl(req.url, req.redactParams),
        latencyMs,
        authFailed: resp.status === 401 || resp.status === 403,
        bodyPreview: previewBody(text),
      };
      attempts.push(result);
      if (result.ok || result.authFailed) return result; // 成功或鉴权失败即返回
      if (resp.status === 404 || resp.status === 405) continue; // 路径不对，试下一个
      return result;
    } catch (err) {
      const latencyMs = Date.now() - started;
      const reason = err.name === 'AbortError' ? '请求超时' : (err.cause ? err.cause.code || err.message : err.message);
      attempts.push({ ok: false, url: redactUrl(req.url, req.redactParams), latencyMs, error: reason });
      if (err.name === 'AbortError') return attempts[attempts.length - 1];
      // DNS/连接类错误：不再尝试第二个候选地址
      if (err.cause && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'].includes(err.cause.code)) {
        return attempts[attempts.length - 1];
      }
    } finally {
      clearTimeout(timer);
    }
  }
  const last = attempts[attempts.length - 1];
  return last || { ok: false, error: '无法发起请求' };
}

function previewBody(text) {
  if (!text) return '';
  try {
    const obj = JSON.parse(text);
    const pretty = JSON.stringify(obj, null, 2);
    return pretty.length > 600 ? pretty.slice(0, 600) + '\n…(已截断)' : pretty;
  } catch {
    return text.length > 600 ? text.slice(0, 600) + '\n…(已截断)' : text;
  }
}

// ---------------- 条目校验 ----------------
function sanitizeEntry(raw, existing) {
  const now = new Date().toISOString();
  const base = existing || { id: genId(), createdAt: now };
  const entry = { ...base };
  if (typeof raw.name === 'string') entry.name = raw.name.trim().slice(0, 100);
  if (typeof raw.provider === 'string') entry.provider = raw.provider;
  if (typeof raw.baseUrl === 'string') {
    const nb = normalizeBaseUrl(raw.baseUrl);
    if (!nb) throw new Error('Base URL 无效（必须以 http:// 或 https:// 开头）');
    entry.baseUrl = nb;
  }
  if (typeof raw.apiKey === 'string') entry.apiKey = raw.apiKey.trim();
  if (typeof raw.model === 'string') entry.model = raw.model.trim().slice(0, 100);
  if (typeof raw.notes === 'string') entry.notes = raw.notes.slice(0, 2000);
  if (raw.testConfig && typeof raw.testConfig === 'object') {
    entry.testConfig = {
      method: String(raw.testConfig.method || 'GET').toUpperCase(),
      path: String(raw.testConfig.path || '/'),
      authMode: ['bearer', 'apiKey', 'basic', 'query', 'none'].includes(raw.testConfig.authMode) ? raw.testConfig.authMode : 'bearer',
      headerName: String(raw.testConfig.headerName || 'x-api-key'),
      queryParam: String(raw.testConfig.queryParam || 'api_key'),
      username: String(raw.testConfig.username || ''),
      headers: raw.testConfig.headers && typeof raw.testConfig.headers === 'object' ? raw.testConfig.headers : {},
      body: String(raw.testConfig.body || ''),
    };
  }
  if (!entry.name) entry.name = '未命名';
  if (!entry.apiKey) throw new Error('API Key 不能为空');
  if (!entry.baseUrl) throw new Error('Base URL 不能为空');
  return entry;
}

function isLocked() {
  return state.encrypted && state.masterPassword === null;
}

function requireUnlocked() {
  if (isLocked()) {
    const err = new Error('已锁定，请先输入主密码解锁');
    err.status = 423;
    throw err;
  }
}

// ---------------- 路由 ----------------
async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/status' && req.method === 'GET') {
    return sendJSON(res, 200, {
      encrypted: state.encrypted,
      locked: isLocked(),
      entryCount: state.entries.length,
      dataFile: DATA_FILE,
      port: PORT,
    });
  }

  if (p === '/api/unlock' && req.method === 'POST') {
    // 冻结期内直接拒绝
    if (state.unlockFails.lockedUntil > 0 && Date.now() < state.unlockFails.lockedUntil) {
      const retryAfterSec = Math.ceil((state.unlockFails.lockedUntil - Date.now()) / 1000);
      const mins = Math.ceil(retryAfterSec / 60);
      return sendJSON(res, 429, { ok: false, error: `尝试次数过多，请约 ${mins} 分钟后再试`, retryAfterSec });
    }
    const body = await readBody(req);
    if (!state.encrypted) return sendJSON(res, 200, { ok: true, entries: state.entries, alreadyPlain: true });
    let plain = null;
    try {
      plain = decryptJson(loadFile(), String(body.password || ''));
    } catch {
      plain = null; // GCM 校验失败 => 密码错误
    }
    if (plain) {
      state.entries = Array.isArray(plain.entries) ? plain.entries : [];
      state.masterPassword = String(body.password);
      state.unlockFails = { count: 0, lockedUntil: 0 };
      return sendJSON(res, 200, { ok: true, entries: state.entries });
    }
    // 解密失败
    state.unlockFails.count += 1;
    if (state.unlockFails.count >= 3) {
      state.unlockFails.lockedUntil = Date.now() + 5 * 60 * 1000;
      state.unlockFails.count = 0;
      return sendJSON(res, 429, { ok: false, error: '密码错误次数过多，已冻结 5 分钟', retryAfterSec: 300 });
    }
    const remaining = 3 - state.unlockFails.count;
    return sendJSON(res, 401, { ok: false, error: `主密码错误（剩余 ${remaining} 次尝试机会）` });
  }

  if (p === '/api/lock' && req.method === 'POST') {
    if (state.encrypted) {
      state.entries = [];
      state.masterPassword = null;
    }
    return sendJSON(res, 200, { ok: true });
  }

  if (p === '/api/entries' && req.method === 'GET') {
    requireUnlocked();
    return sendJSON(res, 200, { ok: true, entries: state.entries });
  }

  if (p === '/api/entries' && req.method === 'POST') {
    requireUnlocked();
    const body = await readBody(req);
    const entry = sanitizeEntry(body, null);
    // 测试结果字段：新增时不带
    state.entries.unshift(entry);
    persist();
    return sendJSON(res, 200, { ok: true, entry });
  }

  if (p.startsWith('/api/entries/') && req.method === 'PUT') {
    requireUnlocked();
    const id = decodeURIComponent(p.slice('/api/entries/'.length));
    const body = await readBody(req);
    const idx = state.entries.findIndex((e) => e.id === id);
    if (idx < 0) return sendJSON(res, 404, { ok: false, error: '条目不存在' });
    const entry = sanitizeEntry(body, state.entries[idx]);
    entry.updatedAt = new Date().toISOString();
    state.entries[idx] = entry;
    persist();
    return sendJSON(res, 200, { ok: true, entry });
  }

  if (p.startsWith('/api/entries/') && req.method === 'DELETE') {
    requireUnlocked();
    const id = decodeURIComponent(p.slice('/api/entries/'.length));
    const before = state.entries.length;
    state.entries = state.entries.filter((e) => e.id !== id);
    if (state.entries.length === before) return sendJSON(res, 404, { ok: false, error: '条目不存在' });
    persist();
    return sendJSON(res, 200, { ok: true });
  }

  if (p === '/api/test' && req.method === 'POST') {
    const body = await readBody(req);
    let entry;
    if (body.id) {
      requireUnlocked();
      entry = state.entries.find((e) => e.id === body.id);
      if (!entry) return sendJSON(res, 404, { ok: false, error: '条目不存在' });
    } else {
      entry = body.entry || body;
    }
    if (!entry || !entry.baseUrl || !entry.apiKey) {
      return sendJSON(res, 400, { ok: false, error: '缺少 baseUrl 或 apiKey' });
    }
    const result = await runTest(entry);
    if (body.id && state.entries.length) {
      const idx = state.entries.findIndex((e) => e.id === body.id);
      if (idx >= 0) {
        state.entries[idx].lastTest = {
          at: new Date().toISOString(),
          ok: result.ok,
          status: result.status || null,
          latencyMs: result.latencyMs || null,
          error: result.error || null,
          url: result.url || null,
        };
        persist();
      }
    }
    return sendJSON(res, 200, { ok: result.ok, result });
  }

  if (p === '/api/password' && req.method === 'POST') {
    requireUnlocked();
    const body = await readBody(req);
    const current = String(body.current || '');
    const next = String(body.new || '');

    if (state.encrypted) {
      if (!safeEqual(current, state.masterPassword)) return sendJSON(res, 401, { ok: false, error: '当前主密码错误' });
      if (next === '') {
        // 关闭加密
        state.encrypted = false;
        state.masterPassword = null;
        persist();
        return sendJSON(res, 200, { ok: true, encrypted: false, message: '已关闭加密，数据将以明文保存' });
      }
      state.masterPassword = next;
      persist();
      return sendJSON(res, 200, { ok: true, encrypted: true, message: '主密码已更新' });
    } else {
      if (next === '') return sendJSON(res, 200, { ok: true, encrypted: false, message: '当前未加密' });
      state.encrypted = true;
      state.masterPassword = next;
      persist();
      return sendJSON(res, 200, { ok: true, encrypted: true, message: '已开启主密码加密' });
    }
  }

  return sendJSON(res, 404, { ok: false, error: 'Not Found' });
}

// ---------------- 静态文件 ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res, url) {
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { ok: false, error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJSON(res, 404, { ok: false, error: 'Not Found' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

// ---------------- 启动 ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (err) {
    console.error('handler error:', err.message);
    sendJSON(res, err.status || 500, { ok: false, error: err.message || '服务器内部错误' });
  }
});

initFromDisk();
server.listen(PORT, HOST, () => {
  console.log('==============================================');
  console.log('  LLM API Key Vault 已启动');
  console.log(`  地址: http://${HOST}:${PORT}`);
  console.log(`  数据文件: ${DATA_FILE}`);
  console.log(`  加密状态: ${state.encrypted ? '已加密（需主密码解锁）' : '明文模式'}`);
  console.log('==============================================');
});
