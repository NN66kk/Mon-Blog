import { ApiError } from './github';
import { createMcpKeyStore } from './mcp-keys';

const MAX_BODY_BYTES = 4096;
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

async function readSettings(request: Request) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get('content-type') || '',
    )
  )
    throw new ApiError(415, '请使用 JSON 提交密钥设置。');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES))
    throw new ApiError(413, '密钥设置过长。');
  if (!request.body) throw new ApiError(400, '请填写密钥设置。');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError(413, '密钥设置过长。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400, '密钥设置格式无效。');
  }
}

export function createMcpKeyRoutes(deps: {
  identity: (request: Request) => Promise<string>;
  database: () => Pick<D1Database, 'prepare'>;
}) {
  async function handle(
    request: Request,
    action: 'list' | 'create' | 'revoke',
    id?: string,
  ) {
    try {
      // A key must never be able to mint or revoke other keys, even if the
      // caller also presents a browser session. Use the existing website login.
      if (request.headers.has('authorization') || new URL(request.url).search)
        throw new ApiError(403, '请在已登录的写作室中管理 MCP 密钥。');
      const owner = await deps.identity(request);
      const store = createMcpKeyStore(deps.database());
      if (action === 'list') return json({ keys: await store.list(owner) });
      if (action === 'create')
        return json(
          await store.create(owner, await readSettings(request)),
          201,
        );
      if (request.body) {
        const input = await readSettings(request);
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new ApiError(400, '撤销密钥不接受额外字段。');
      }
      return json({ record: await store.revoke(owner, id || '') });
    } catch (error) {
      return json(
        {
          error:
            error instanceof ApiError
              ? error.message
              : '密钥操作未完成，请稍后重试。',
        },
        error instanceof ApiError ? error.status : 500,
      );
    }
  }
  return {
    GET: (request: Request) => handle(request, 'list'),
    POST: (request: Request) => handle(request, 'create'),
    revoke: (request: Request, id: string) => handle(request, 'revoke', id),
  };
}
