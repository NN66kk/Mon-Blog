import { ApiError } from './github';

export const MCP_SCOPES = [
  'content:read',
  'drafts:write',
  'publications:write',
] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export type McpKeySummary = {
  id: string;
  name: string;
  prefix: string;
  scopes: McpScope[];
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};
export type McpIdentity = { owner: string; keyId: string; scopes: McpScope[] };
export type McpKeyInput = {
  name: string;
  scopes?: McpScope[];
  expiresInDays?: number;
};
type KeyRow = Omit<McpKeySummary, 'scopes'> & { scopes: string };
type KeyDatabase = Pick<D1Database, 'prepare'>;
const KEY_PATTERN = /^mon_[a-f0-9]{64}$/;
const ID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SUMMARY_COLUMNS =
  'id,name,prefix,scopes,created_at,expires_at,revoked_at,last_used_at';

function scopesFrom(value: unknown): McpScope[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MCP_SCOPES.length ||
    value.some((scope) => !MCP_SCOPES.includes(scope)) ||
    new Set(value).size !== value.length ||
    !value.includes('content:read')
  ) {
    throw new ApiError(400, '权限无效。所有密钥都需要保留读取内容权限。');
  }
  return MCP_SCOPES.filter((scope) => value.includes(scope));
}

function validatedInput(value: unknown): Required<McpKeyInput> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(400, '密钥设置格式无效。');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (field) => !['name', 'scopes', 'expiresInDays'].includes(field),
    )
  )
    throw new ApiError(400, '密钥设置包含未知字段。');
  if (
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 80 ||
    Array.from(input.name).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new ApiError(400, '请填写 1 到 80 个字符的密钥名称。');
  const expiresInDays =
    input.expiresInDays === undefined ? 90 : input.expiresInDays;
  if (
    typeof expiresInDays !== 'number' ||
    !Number.isInteger(expiresInDays) ||
    expiresInDays < 1 ||
    expiresInDays > 365
  )
    throw new ApiError(400, '有效期应为 1 到 365 天。');
  return {
    name: input.name.trim(),
    scopes: scopesFrom(
      input.scopes === undefined
        ? ['content:read', 'drafts:write']
        : input.scopes,
    ),
    expiresInDays,
  };
}

function summary(row: KeyRow): McpKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: scopesFrom(JSON.parse(row.scopes)),
    created_at: row.created_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    last_used_at: row.last_used_at,
  };
}

async function hashKey(key: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** MCP credentials belong in headers; query strings are never an auth channel. */
export function readMcpBearerKey(request: Request): string {
  if (new URL(request.url).search)
    throw new ApiError(
      400,
      'MCP 地址不能包含查询参数，请在 Authorization 请求头中提供密钥。',
    );
  const match = /^Bearer (mon_[a-f0-9]{64})$/.exec(
    request.headers.get('authorization') || '',
  );
  if (!match) throw new ApiError(401, '请提供有效的 MCP Bearer 密钥。');
  return match[1];
}

/** The store only receives a database binding, so it is shared by HTTP and MCP. */
export function createMcpKeyStore(db: KeyDatabase) {
  return {
    async create(
      owner: string,
      value: unknown,
    ): Promise<{ key: string; record: McpKeySummary }> {
      const input = validatedInput(value);
      const key = `mon_${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      const now = new Date();
      const record: McpKeySummary = {
        id: crypto.randomUUID(),
        name: input.name,
        prefix: key.slice(0, 12),
        scopes: input.scopes,
        created_at: now.toISOString(),
        expires_at: new Date(
          now.getTime() + input.expiresInDays * 86400000,
        ).toISOString(),
        revoked_at: null,
        last_used_at: null,
      };
      await db
        .prepare(
          'INSERT INTO mcp_keys (id,hash,prefix,name,owner,scopes,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .bind(
          record.id,
          await hashKey(key),
          record.prefix,
          record.name,
          owner,
          JSON.stringify(record.scopes),
          record.created_at,
          record.expires_at,
        )
        .run();
      return { key, record };
    },
    async list(owner: string): Promise<McpKeySummary[]> {
      const rows = await db
        .prepare(
          `SELECT ${SUMMARY_COLUMNS} FROM mcp_keys WHERE owner=? ORDER BY created_at DESC,id DESC`,
        )
        .bind(owner)
        .all<KeyRow>();
      return rows.results.map(summary);
    },
    async revoke(owner: string, id: string): Promise<McpKeySummary> {
      if (!ID_PATTERN.test(id)) throw new ApiError(400, '密钥编号无效。');
      const row = await db
        .prepare(
          `UPDATE mcp_keys SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND owner=? RETURNING ${SUMMARY_COLUMNS}`,
        )
        .bind(new Date().toISOString(), id, owner)
        .first<KeyRow>();
      if (!row) throw new ApiError(404, '找不到这把密钥。');
      return summary(row);
    },
    async authenticate(rawKey: string): Promise<McpIdentity> {
      if (!KEY_PATTERN.test(rawKey))
        throw new ApiError(401, 'MCP 密钥无效、已过期或已撤销。');
      const now = new Date().toISOString();
      // Check revocation and expiry in the same statement that marks the use.
      const row = await db
        .prepare(
          'UPDATE mcp_keys SET last_used_at=? WHERE hash=? AND revoked_at IS NULL AND expires_at>? RETURNING id,owner,scopes',
        )
        .bind(now, await hashKey(rawKey), now)
        .first<{ id: string; owner: string; scopes: string }>();
      if (!row) throw new ApiError(401, 'MCP 密钥无效、已过期或已撤销。');
      let scopes: McpScope[];
      try {
        scopes = scopesFrom(JSON.parse(row.scopes));
      } catch {
        throw new ApiError(401, 'MCP 密钥权限无效，请重新生成。');
      }
      return { owner: row.owner, keyId: row.id, scopes };
    },
  };
}
