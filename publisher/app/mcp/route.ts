import { createSitesBlogMcpEndpoint } from '@/lib/mcp-server';
import { createWritingService } from '@/lib/writing-service';
import { account, database, files } from '@/lib/server';

export const dynamic = 'force-dynamic';

function handle(request: Request) {
  return createSitesBlogMcpEndpoint(
    createWritingService({
      db: database(),
      getAccount: account,
      storage: files(),
    }),
  )(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
