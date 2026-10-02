import { database, identity } from '@/lib/server';
import { createMcpKeyRoutes } from '@/lib/mcp-key-routes';

export const dynamic = 'force-dynamic';
const routes = createMcpKeyRoutes({ database, identity });
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return routes.revoke(request, (await context.params).id);
}
