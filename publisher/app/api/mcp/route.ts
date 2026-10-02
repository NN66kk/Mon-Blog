import { createBlogMcpEndpoint } from '@/lib/mcp-server';
import { createMcpKeyStore } from '@/lib/mcp-keys';
import { createWritingService } from '@/lib/writing-service';
import { account, database, files } from '@/lib/server';

function handle(request: Request) {
  const db = database();
  return createBlogMcpEndpoint({
    authenticate: (key) => createMcpKeyStore(db).authenticate(key),
    writing: createWritingService({
      db,
      getAccount: account,
      storage: files(),
    }),
  })(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
