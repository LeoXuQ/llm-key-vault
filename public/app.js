/* ============================================================
   LLM API Key Vault — 前端逻辑（原生 JS，无依赖）
   ============================================================ */
'use strict';

// ---------- 供应商预设 ----------
const PROVIDERS = {
  openai:       { label: 'OpenAI',                color: '#10a37f', base: 'https://api.openai.com/v1' },
  deepseek:     { label: 'DeepSeek',              color: '#4d6bfe', base: 'https://api.deepseek.com' },
  anthropic:    { label: 'Anthropic Claude',      color: '#d97757', base: 'https://api.anthropic.com' },
  gemini:       { label: 'Google Gemini',         color: '#4285f4', base: 'https://generativelanguage.googleapis.com' },
  moonshot:     { label: 'Kimi (Moonshot)',       color: '#2f6bff', base: 'https://api.moonshot.cn/v1' },
  qwen:         { label: '通义千问 (DashScope)',   color: '#615ced', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  zhipu:        { label: '智谱 GLM',              color: '#3859ff', base: 'https://open.bigmodel.cn/api/paas/v4' },
  siliconflow:  { label: 'SiliconFlow 硅基流动',   color: '#00c3ff', base: 'https://api.siliconflow.cn/v1' },
  openrouter:   { label: 'OpenRouter',            color: '#6461e5', base: 'https://openrouter.ai/api/v1' },
  'other-openai': { label: '其他（OpenAI 兼容）',  color: '#8b5cf6', base: '' },
  custom:       { label: '自定义请求',             color: '#f59e0b', base: '' },
};

// 供应商 -> 服务端测试类型（服务端按 provider 决定测试逻辑）
const TYPE_BY_PROVIDER = {
  openai: 'openai', deepseek: 'openai', moonshot: 'openai', qwen: 'openai',
  zhipu: 'openai', siliconflow: 'openai', openrouter: 'openai', 'other-openai': 'openai',
  anthropic: 'anthropic', gemini: 'gemini', custom: 'custom',
};

// ---------- 状态 ----------
let entries = [];
let editingId = null;      // 正在编辑的条目 id
let providerFilter = 'all';
let searchText = '';
let serverInfo = { encrypted: false, locked: false };

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const cardList = $('cardList');
const emptyState = $('emptyState');

// ---------- 工具 ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = {};
  try { data = await resp.json(); } catch { /* ignore */ }
  if (!resp.ok) {
    throw new Error(data.error || `请求失败 (${resp.status})`);
  }
  return data;
}

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

async function copyText(text, tip = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(tip, 'ok');
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return '••••••••' + key.slice(-4);
}

function maskProviderKey(key) {
  if (!key) return '';
  if (key.length <= 10) return '••••••••';
  return key.slice(0, 4) + '••••••' + key.slice(-4);
}

function fmtLatency(ms) {
  if (ms == null) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

// ---------- 初始化 ----------
async function init() {
  serverInfo = await api('/api/status');
  renderEncBadge();

  // 填充供应商下拉
  const opts = Object.entries(PROVIDERS)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  $('fProvider').innerHTML = opts;
  $('providerFilter').innerHTML =
    '<option value="all">全部供应商</option>' +
    Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  if (serverInfo.locked) {
    showUnlock();
  } else {
    await loadEntries();
  }
}

function renderEncBadge() {
  const b = $('encBadge');
  if (serverInfo.encrypted) {
    b.className = 'badge enc';
    b.textContent = serverInfo.locked ? '🔒 已加密 · 已锁定' : '🔒 已加密';
    $('lockBtn').classList.remove('hidden');
  } else {
    b.className = 'badge plain';
    b.textContent = '⚠ 明文模式（未加密）';
    $('lockBtn').classList.add('hidden');
  }
}

async function loadEntries() {
  const data = await api('/api/entries');
  entries = data.entries || [];
  render();
}

// ---------- 解锁 / 锁定 ----------
function showUnlock() {
  $('unlockOverlay').classList.remove('hidden');
  $('unlockPassword').value = '';
  $('unlockError').classList.add('hidden');
  setTimeout(() => $('unlockPassword').focus(), 50);
}

$('unlockBtn').addEventListener('click', async () => {
  const pw = $('unlockPassword').value;
  $('unlockError').classList.add('hidden');
  try {
    const data = await api('/api/unlock', { method: 'POST', body: JSON.stringify({ password: pw }) });
    entries = data.entries || [];
    serverInfo.locked = false;
    renderEncBadge();
    $('unlockOverlay').classList.add('hidden');
    render();
    toast('🔓 解锁成功', 'ok');
  } catch (e) {
    $('unlockError').textContent = e.message;
    $('unlockError').classList.remove('hidden');
  }
});
$('unlockPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('unlockBtn').click(); });

$('lockBtn').addEventListener('click', async () => {
  await api('/api/lock', { method: 'POST' });
  serverInfo.locked = true;
  entries = [];
  render();
  renderEncBadge();
  showUnlock();
  toast('已锁定，内存中的密钥已清除');
});

// ---------- 渲染 ----------
function filteredEntries() {
  const q = searchText.toLowerCase();
  return entries.filter((e) => {
    if (providerFilter !== 'all' && e.provider !== providerFilter) return false;
    if (!q) return true;
    return (e.name + ' ' + (e.baseUrl || '') + ' ' + (e.notes || '') + ' ' + (e.model || '')).toLowerCase().includes(q);
  });
}

function testStatusHtml(e) {
  const t = e.lastTest;
  if (!t) return '<div class="test-status"><span class="dot"></span>尚未测试</div>';
  if (t.ok) {
    return `<div class="test-status"><span class="dot ok"></span>✅ 连通正常 · ${t.status || ''} · ${fmtLatency(t.latencyMs)} · ${esc(t.url || '')}</div>`;
  }
  return `<div class="test-status"><span class="dot fail"></span>❌ 测试失败${t.status ? ' · HTTP ' + t.status : ''}${t.latencyMs ? ' · ' + fmtLatency(t.latencyMs) : ''}</div>`;
}

function render() {
  const list = filteredEntries();
  cardList.innerHTML = list.map((e) => {
    const p = PROVIDERS[e.provider] || PROVIDERS['other-openai'];
    const detail = e.lastTest && e.lastTest.error ? e.lastTest.error : (e.lastTest && !e.lastTest.ok ? 'HTTP ' + (e.lastTest.status ?? '?') : '');
    return `
    <div class="card" data-id="${e.id}">
      <div class="card-top">
        <span class="provider-pill" style="background:${p.color}">${esc(p.label)}</span>
        <span class="card-name" title="${esc(e.name)}">${esc(e.name)}</span>
        <button class="btn ghost icon sm" data-act="edit" title="编辑">✏️</button>
        <button class="btn ghost icon sm danger-ghost" data-act="del" title="删除">🗑</button>
      </div>

      <div class="kv-row" title="${esc(e.apiKey)}">
        <span class="kv-label">Key</span>
        <span class="kv-value" data-key-mask="${e.id}">${esc(maskProviderKey(e.apiKey))}</span>
        <button class="copy-btn" data-act="toggleKey" data-id="${e.id}" title="显示/隐藏">👁</button>
        <button class="copy-btn" data-act="copyKey" data-id="${e.id}" title="复制 API Key">📋</button>
      </div>

      <div class="kv-row" title="${esc(e.baseUrl)}">
        <span class="kv-label">URL</span>
        <span class="kv-value">${esc(e.baseUrl)}</span>
        <button class="copy-btn" data-act="copyUrl" data-id="${e.id}" title="复制 Base URL">📋</button>
      </div>

      ${e.notes ? `<div class="card-notes">💬 ${esc(e.notes)}</div>` : ''}

      <div class="test-status" id="status-${e.id}">
        ${e.testing ? '<span class="dot testing"></span>正在测试…' : testStatusHtml(e)}
      </div>
      <div class="test-detail hidden" id="detail-${e.id}">${esc(detail)}</div>

      <div class="card-actions">
        <button class="btn sm" data-act="test" data-id="${e.id}">🧪 测试</button>
        <button class="btn sm" data-act="copyFull" data-id="${e.id}" title="复制完整调用地址">🔗 完整地址</button>
        <button class="btn sm" data-act="snippet" data-id="${e.id}">📜 代码</button>
      </div>
    </div>`;
  }).join('');

  emptyState.classList.toggle('hidden', list.length > 0);
  cardList.classList.toggle('hidden', list.length === 0);
}

cardList.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;

  if (act === 'test') return runTest(entry);
  if (act === 'copyKey') return copyText(entry.apiKey, 'API Key 已复制');
  if (act === 'copyUrl') return copyText(entry.baseUrl, 'Base URL 已复制');
  if (act === 'copyFull') return copyText(chatUrl(entry), '完整调用地址已复制');
  if (act === 'toggleKey') {
    const span = cardList.querySelector(`[data-key-mask="${id}"]`);
    const showing = span.dataset.shown === '1';
    span.textContent = showing ? esc(maskProviderKey(entry.apiKey)) : esc(entry.apiKey);
    span.dataset.shown = showing ? '0' : '1';
    return;
  }
  if (act === 'snippet') return openSnippets(entry);
  if (act === 'edit') return openEditor(entry);
  if (act === 'del') {
    if (!confirm(`确定删除「${entry.name}」吗？此操作不可恢复。`)) return;
    try {
      await api(`/api/entries/${id}`, { method: 'DELETE' });
      entries = entries.filter((e) => e.id !== id);
      render();
      toast('已删除', 'ok');
    } catch (e) { toast(e.message, 'fail'); }
  }
});

// ---------- 测试 ----------
async function runTest(entry, saveResult = true) {
  const statusEl = $(`status-${entry.id}`);
  const detailEl = $(`detail-${entry.id}`);
  if (statusEl) statusEl.innerHTML = '<span class="dot testing"></span>正在测试…';
  if (detailEl) detailEl.classList.add('hidden');
  try {
    const data = await api('/api/test', {
      method: 'POST',
      body: JSON.stringify(saveResult ? { id: entry.id } : { entry }),
    });
    const r = data.result;
    if (saveResult) {
      const idx = entries.findIndex((e) => e.id === entry.id);
      if (idx >= 0) entries[idx].lastTest = r;
    }
    if (r.ok) {
      toast(`✅ ${entry.name}: 连通正常 (HTTP ${r.status}, ${fmtLatency(r.latencyMs)})`, 'ok');
    } else if (r.authFailed) {
      toast(`❌ ${entry.name}: API Key 无效 (HTTP 401/403)`, 'fail');
    } else if (r.error) {
      toast(`❌ ${entry.name}: ${r.error}`, 'fail');
    } else {
      toast(`❌ ${entry.name}: HTTP ${r.status}`, 'fail');
    }
    if (saveResult) render();
    return r;
  } catch (e) {
    if (saveResult) {
      const idx = entries.findIndex((x) => x.id === entry.id);
      if (idx >= 0) {
        entries[idx].lastTest = { ok: false, error: e.message };
        render();
      }
    }
    toast('测试失败: ' + e.message, 'fail');
    return { ok: false, error: e.message };
  }
}

// ---------- 编辑弹窗 ----------
function openEditor(entry) {
  editingId = entry ? entry.id : null;
  $('editorTitle').textContent = entry ? '编辑 API Key' : '添加 API Key';
  $('fName').value = entry?.name || '';
  $('fProvider').value = entry?.provider || 'deepseek';
  $('fBaseUrl').value = entry?.baseUrl || PROVIDERS[$('fProvider').value].base || '';
  $('fApiKey').value = entry?.apiKey || '';
  $('fModel').value = entry?.model || '';
  $('fNotes').value = entry?.notes || '';
  $('fApiKey').type = 'password';
  $('fKeyEye').textContent = '👁';

  const tc = entry?.testConfig || {};
  $('fMethod').value = tc.method || 'GET';
  $('fPath').value = tc.path || '/';
  $('fAuthMode').value = tc.authMode || 'bearer';
  $('fHeaderName').value = tc.headerName || 'x-api-key';
  $('fQueryParam').value = tc.queryParam || 'api_key';
  $('fUsername').value = tc.username || '';
  $('fHeaders').value = tc.headers && Object.keys(tc.headers).length ? JSON.stringify(tc.headers, null, 2) : '';
  $('fBody').value = tc.body || '';

  onProviderChange();
  $('draftTestResult').textContent = '';
  $('draftTestResult').className = 'inline-test-result';
  $('editorOverlay').classList.remove('hidden');
}

function closeEditor() {
  $('editorOverlay').classList.add('hidden');
  editingId = null;
}

function onProviderChange() {
  const p = $('fProvider').value;
  $('customConfig').classList.toggle('hidden', p !== 'custom');
}

$('addBtn').addEventListener('click', () => openEditor(null));
$('editorCancel').addEventListener('click', closeEditor);
$('fProvider').addEventListener('change', () => {
  const p = $('fProvider').value;
  // 仅当 Base URL 为空或等于上一个预设默认值时自动填充
  const prev = $('fBaseUrl').dataset.prevDefault || '';
  const cur = $('fBaseUrl').value.trim();
  if (!cur || cur === prev) {
    $('fBaseUrl').value = PROVIDERS[p].base || '';
  }
  $('fBaseUrl').dataset.prevDefault = PROVIDERS[p].base || '';
  onProviderChange();
});

$('fKeyEye').addEventListener('click', () => {
  const input = $('fApiKey');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  $('fKeyEye').textContent = showing ? '👁' : '🙈';
});

function collectEntryForm() {
  const p = $('fProvider').value;
  const entry = {
    name: $('fName').value,
    provider: p,
    baseUrl: $('fBaseUrl').value,
    apiKey: $('fApiKey').value,
    model: $('fModel').value,
    notes: $('fNotes').value,
  };
  if (p === 'custom') {
    let headers = {};
    if ($('fHeaders').value.trim()) {
      try { headers = JSON.parse($('fHeaders').value); }
      catch { throw new Error('额外请求头不是合法的 JSON'); }
    }
    entry.testConfig = {
      method: $('fMethod').value,
      path: $('fPath').value,
      authMode: $('fAuthMode').value,
      headerName: $('fHeaderName').value,
      queryParam: $('fQueryParam').value,
      username: $('fUsername').value,
      headers,
      body: $('fBody').value,
    };
  }
  return entry;
}

$('draftTestBtn').addEventListener('click', async () => {
  const btn = $('draftTestBtn');
  const res = $('draftTestResult');
  btn.disabled = true;
  res.textContent = '测试中…';
  res.className = 'inline-test-result';
  try {
    const entry = collectEntryForm();
    const r = await runTest(entry, false);
    res.textContent = r.ok
      ? `✅ 连通正常 (HTTP ${r.status}, ${fmtLatency(r.latencyMs)})`
      : `❌ ${r.authFailed ? 'API Key 无效 (401/403)' : (r.error || 'HTTP ' + r.status)}`;
    res.className = 'inline-test-result ' + (r.ok ? 'ok' : 'fail');
  } catch (e) {
    res.textContent = '❌ ' + e.message;
    res.className = 'inline-test-result fail';
  } finally {
    btn.disabled = false;
  }
});

$('editorSave').addEventListener('click', async () => {
  try {
    const entry = collectEntryForm();
    if (!entry.name.trim()) throw new Error('请填写名称');
    if (!entry.baseUrl.trim()) throw new Error('请填写 Base URL');
    if (!entry.apiKey.trim()) throw new Error('请填写 API Key');
    if (editingId) {
      await api(`/api/entries/${editingId}`, { method: 'PUT', body: JSON.stringify(entry) });
      const idx = entries.findIndex((e) => e.id === editingId);
      if (idx >= 0) entries[idx] = { ...entries[idx], ...entry, lastTest: entries[idx].lastTest };
      toast('已保存修改', 'ok');
    } else {
      const data = await api('/api/entries', { method: 'POST', body: JSON.stringify(entry) });
      entries.unshift(data.entry);
      toast('已添加', 'ok');
    }
    closeEditor();
    render();
  } catch (e) {
    toast(e.message, 'fail');
  }
});

// ---------- 代码片段 ----------
function chatUrl(entry) {
  const p = entry.provider;
  const base = entry.baseUrl;
  if (p === 'anthropic') return base.endsWith('/v1') ? base + '/messages' : base + '/v1/messages';
  if (p === 'gemini') return `${base}/v1beta/models/${entry.model || '{model}'}:generateContent`;
  return base + '/chat/completions';
}

function buildSnippets(entry) {
  const key = entry.apiKey;
  const model = entry.model || '{your-model}';
  const base = entry.baseUrl;
  const url = chatUrl(entry);
  const p = entry.provider;

  if (p === 'anthropic') {
    return {
      'curl': `curl ${url} \\
  -H "x-api-key: ${key}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "${model}",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好"}]
  }'`,
      'Python (anthropic SDK)': `import anthropic

client = anthropic.Anthropic(
    api_key="${key}",
    base_url="${base}",
)
msg = client.messages.create(
    model="${model}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "你好"}],
)
print(msg.content[0].text)`,
    };
  }

  if (p === 'gemini') {
    return {
      'curl': `curl "${url}" \\
  -H "Content-Type: application/json" \\
  -d '{"contents": [{"parts": [{"text": "你好"}]}]}'`,
      'Python (google-genai)': `import google.generativeai as genai

genai.configure(api_key="${key}")
model = genai.GenerativeModel("${model}")
resp = model.generate_content("你好")
print(resp.text)`,
    };
  }

  if (p === 'custom') {
    const tc = entry.testConfig || {};
    const method = (tc.method || 'GET').toUpperCase();
    let headers = { ...(tc.headers || {}) };
    if (tc.authMode === 'bearer') headers['Authorization'] = 'Bearer ' + key;
    else if (tc.authMode === 'apiKey') headers[tc.headerName || 'x-api-key'] = key;
    else if (tc.authMode === 'basic') headers['Authorization'] = 'Basic ' + btoa(`${tc.username || ''}:${key}`);
    const h = Object.entries(headers).map(([k, v]) => `  -H "${k}: ${v}" \\`).join('\n');
    let cmd = `curl -X ${method} ${base}${(tc.path || '/').startsWith('/') ? tc.path : '/' + (tc.path || '')} \\\n${h}`;
    if (tc.authMode === 'query') cmd += `?${tc.queryParam || 'api_key'}=${key}`;
    if (tc.body) cmd += `\n  -d '${tc.body}'`;
    return { 'curl (自定义)': cmd };
  }

  // OpenAI 兼容
  return {
    'curl': `curl ${url} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${key}" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'`,
    'Python (openai SDK)': `from openai import OpenAI

client = OpenAI(
    api_key="${key}",
    base_url="${base}",
)
resp = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "你好"}],
)
print(resp.choices[0].message.content)`,
    'Python (requests)': `import requests

resp = requests.post(
    "${url}",
    headers={"Authorization": "Bearer ${key}"},
    json={"model": "${model}", "messages": [{"role": "user", "content": "你好"}]},
)
print(resp.json())`,
  };
}

let snippetEntry = null;
function openSnippets(entry) {
  snippetEntry = entry;
  const snippets = buildSnippets(entry);
  const tabs = Object.keys(snippets);
  $('snippetTabs').innerHTML = tabs.map((t, i) =>
    `<button class="tab${i === 0 ? ' active' : ''}" data-tab="${i}">${esc(t)}</button>`).join('');
  showSnippet(0);
  $('snippetOverlay').classList.remove('hidden');
}

function showSnippet(idx) {
  const snippets = buildSnippets(snippetEntry);
  const keys = Object.keys(snippets);
  $('snippetCode').textContent = snippets[keys[idx]] || '';
  document.querySelectorAll('#snippetTabs .tab').forEach((t, i) =>
    t.classList.toggle('active', i === idx));
}

$('snippetTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) showSnippet(parseInt(tab.dataset.tab, 10));
});
$('snippetCopy').addEventListener('click', () => copyText($('snippetCode').textContent, '代码已复制'));
$('snippetClose').addEventListener('click', () => $('snippetOverlay').classList.add('hidden'));

// ---------- 主密码设置 ----------
$('passwordBtn').addEventListener('click', () => {
  const enc = serverInfo.encrypted;
  $('passwordStateText').textContent = enc
    ? '当前：已加密。修改主密码或关闭加密（留空新密码 = 关闭加密）。'
    : '当前：明文模式（数据未加密）。设置主密码后，数据将以 AES-256 加密保存。';
  $('pwChangeFields').classList.toggle('hidden', !enc);
  $('pwEnableFields').classList.toggle('hidden', enc);
  $('pwError').classList.add('hidden');
  ['pwCurrent', 'pwNew', 'pwConfirm', 'pwNew2', 'pwConfirm2'].forEach((i) => $(i).value = '');
  $('passwordOverlay').classList.remove('hidden');
});

$('pwCancel').addEventListener('click', () => $('passwordOverlay').classList.add('hidden'));

$('pwSave').addEventListener('click', async () => {
  try {
    if (serverInfo.encrypted) {
      const cur = $('pwCurrent').value;
      const nw = $('pwNew').value;
      if (nw && nw !== $('pwConfirm').value) throw new Error('两次输入的新密码不一致');
      const data = await api('/api/password', { method: 'POST', body: JSON.stringify({ current: cur, new: nw }) });
      serverInfo.encrypted = data.encrypted;
      renderEncBadge();
      toast(data.message, 'ok');
    } else {
      const nw = $('pwNew2').value;
      if (!nw) throw new Error('请输入要设置的主密码');
      if (nw !== $('pwConfirm2').value) throw new Error('两次输入的密码不一致');
      const data = await api('/api/password', { method: 'POST', body: JSON.stringify({ current: '', new: nw }) });
      serverInfo.encrypted = data.encrypted;
      renderEncBadge();
      toast(data.message, 'ok');
    }
    $('passwordOverlay').classList.add('hidden');
  } catch (e) {
    $('pwError').textContent = e.message;
    $('pwError').classList.remove('hidden');
  }
});

// ---------- 搜索 / 过滤 ----------
$('searchInput').addEventListener('input', (e) => { searchText = e.target.value.trim(); render(); });
$('providerFilter').addEventListener('change', (e) => { providerFilter = e.target.value; render(); });

// 点击遮罩空白处关闭弹窗
document.querySelectorAll('.overlay').forEach((ov) => {
  ov.addEventListener('mousedown', (e) => {
    if (e.target === ov && ov.id !== 'unlockOverlay') ov.classList.add('hidden');
  });
});

init().catch((e) => toast('初始化失败: ' + e.message, 'fail'));
