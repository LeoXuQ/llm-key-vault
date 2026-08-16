// 测试用模拟 OpenAI 兼容服务（仅本地开发验证用）
// 有效 Key: sk-valid-123 → /models 返回 200；其他 Key → 401
'use strict';
const http = require('http');

const VALID_KEY = 'sk-valid-123';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const auth = req.headers.authorization || '';
  if (url.pathname.endsWith('/models')) {
    if (auth === `Bearer ${VALID_KEY}`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }));
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'invalid_request_error' } }));
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not Found' } }));
});

server.listen(3299, '127.0.0.1', () => {
  console.log('Mock OpenAI server on http://127.0.0.1:3299 (valid key: sk-valid-123)');
});
