import { database, identity } from '@/lib/server';
import { createMcpKeyRoutes } from '@/lib/mcp-key-routes';

export const dynamic = 'force-dynamic';
const routes = createMcpKeyRoutes({ database, identity });
export const GET = routes.GET;
export const POST = routes.POST;
