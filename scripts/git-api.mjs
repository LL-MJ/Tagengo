import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
export function createGitApi(store) {
  const token = randomBytes(32).toString('hex');
  return createServer(async (req, res) => {
    const reply = (code, data) => {
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(data));
    };
    const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
    if (
      !['localhost:3000', '127.0.0.1:3000', '127.0.0.1:4319'].includes(
        req.headers.host,
      ) ||
      (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) ||
      ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])
    )
      return reply(403, { error: '只允许本机学习库访问' });
    try {
      if (req.method === 'GET' && req.url === '/api/git/state')
        return reply(200, {
          records: await store.exclusive(() => store.read()),
          token,
          repository: 'LL-MJ/Tagengo-data',
        });
      const received = req.headers['x-tagengo-token'];
      if (
        typeof received !== 'string' ||
        received.length !== token.length ||
        !timingSafeEqual(Buffer.from(received), Buffer.from(token))
      )
        return reply(403, { error: '会话已过期，请刷新页面' });
      if (
        req.method !== 'POST' ||
        !['/api/git/save', '/api/git/sync'].includes(req.url)
      )
        return reply(404, { error: '接口不存在' });
      if (!req.headers['content-type']?.startsWith('application/json'))
        return reply(415, { error: '需要 JSON 请求' });
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 12 * 1024 * 1024) {
          reply(413, { error: '请求超过 12MB' });
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (req.url === '/api/git/save')
        return reply(200, { records: await store.save(body.records) });
      reply(200, await store.sync());
    } catch (e) {
      reply(400, { error: e.message || '保存失败，本机数据已保留' });
    }
  });
}
