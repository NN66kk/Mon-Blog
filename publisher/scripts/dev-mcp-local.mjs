#!/usr/bin/env node
/**
 * Serve the real UI against isolated local D1/R2, or check its production build.
 * This deliberately bypasses vinext's CLI and every project deployment config.
 * Each run keeps its state in a new temporary directory; it never cleans up or
 * imports a previous local/remote database, environment file, or credential.
 */
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const usage =
  'Usage: node publisher/scripts/dev-mcp-local.mjs [--port 5173 | --check-build]';
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(
    `${usage}\nFresh local data; loopback only; no project secrets or deployment config.`,
  );
  process.exit(0);
}
const checkBuild = args.length === 1 && args[0] === '--check-build';
if (
  !checkBuild &&
  args.length !== 0 &&
  (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1]))
) {
  throw new Error(usage);
}
const port = !checkBuild && args.length ? Number(args[1]) : 5173;
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Use a local port between 1024 and 65535.');
}

const publisherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localRoot = await mkdtemp(join(tmpdir(), 'mon-blog-mcp-preview-'));
const stateRoot = join(localRoot, '.state');
const styleRoot = join(localRoot, 'style-sources');
const databaseId = '00000000-0000-4000-8000-000000000000';
await mkdir(join(localRoot, '.wrangler'), { recursive: true });
await mkdir(styleRoot);
// Only application source is a Tailwind candidate. In particular, neither the
// temporary D1/WAL files nor the original project's hidden config is scanned.
for (const directory of ['app', 'components', 'lib']) {
  await symlink(
    join(publisherRoot, directory),
    join(styleRoot, directory),
    'dir',
  );
}
await writeFile(
  join(localRoot, 'package.json'),
  JSON.stringify({
    name: 'mon-blog-isolated-preview',
    private: true,
    type: 'module',
  }),
);
await symlink(
  join(publisherRoot, 'node_modules'),
  join(localRoot, 'node_modules'),
  'dir',
);

// The Cloudflare Vite plugin calls loadEnv(root) even with Vite envDir:false.
// Wrangler's dev-vars loader falls back to cwd when no config file is supplied.
// Both locations must therefore be this new empty root BEFORE importing them.
process.chdir(localRoot);
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_WRITE_LOGS = 'false';
process.env.WRANGLER_LOG_PATH = join(localRoot, '.wrangler', 'logs');
process.env.MINIFLARE_REGISTRY_PATH = join(localRoot, '.wrangler', 'registry');
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false';
process.env.NODE_ENV = checkBuild ? 'production' : 'development';
// An inherited Cloudflare project override must not redirect local discovery.
delete process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH;
delete process.env.CLOUDFLARE_ENV;

if (!checkBuild) {
  const { Miniflare } = await import('miniflare');
  const bootstrap = new Miniflare({
    name: 'mon-blog-isolated-preview',
    host: '127.0.0.1',
    port: 0,
    modules: true,
    script:
      'export default { fetch() { return new Response("Local database bootstrap"); } };',
    compatibilityDate: '2026-05-15',
    defaultPersistRoot: join(stateRoot, 'v3'),
    d1Databases: { DB: databaseId },
    telemetry: { enabled: false },
  });
  try {
    const database = await bootstrap.getD1Database('DB');
    const migrationDir = join(publisherRoot, 'drizzle');
    const migrations = (await readdir(migrationDir))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
      .sort();
    if (!migrations.length) throw new Error('No local SQL migrations found.');
    for (const name of migrations) {
      const statements = (await readFile(join(migrationDir, name), 'utf8'))
        .split('--> statement-breakpoint')
        .map((sql) => sql.trim())
        .filter(Boolean);
      await database.batch(statements.map((sql) => database.prepare(sql)));
    }
    console.log(
      `Initialized ${migrations.length} migrations in the isolated local database.`,
    );
  } finally {
    await bootstrap.dispose();
  }
}

const [
  { createServer, createBuilder },
  { default: vinext },
  { cloudflare },
  { default: tailwindcss },
] = await Promise.all([
  import('vite'),
  import('vinext'),
  import('@cloudflare/vite-plugin'),
  import('@tailwindcss/postcss'),
]);
// The Sites build hook copies deployment metadata. Never load it in build mode.
const localSignInPlugins = checkBuild
  ? []
  : [(await import('@openai/sites-vite-plugin')).sites()];

const config = {
  configFile: false,
  root: localRoot,
  envDir: false,
  mode: checkBuild ? 'production' : 'development',
  cacheDir: join(localRoot, '.vite'),
  publicDir: join(publisherRoot, 'public'),
  resolve: { alias: { '@': publisherRoot } },
  css: { postcss: { plugins: [tailwindcss({ base: styleRoot })] } },
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    watch: {
      useFsEvents: false,
      usePolling: true,
      ignored: [
        join(stateRoot, '**'),
        join(localRoot, '.wrangler', '**'),
        join(localRoot, '.vite', '**'),
      ],
    },
    fs: { allow: [localRoot, publisherRoot] },
  },
  plugins: [
    // Vinext's appDir option is the BASE containing app/, not app/ itself.
    // Passing .../app makes it look for app/app and select the Pages Router.
    vinext({ appDir: publisherRoot }),
    // This plugin only touches .openai/hosting.json during build, never serve.
    ...localSignInPlugins,
    cloudflare({
      remoteBindings: false,
      inspectorPort: false,
      persistState: { path: stateRoot },
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      config: {
        name: 'mon-blog-isolated-preview',
        main: 'vinext/server/fetch-handler',
        compatibility_date: '2026-05-15',
        compatibility_flags: ['nodejs_compat'],
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'mon-blog-local',
            database_id: databaseId,
          },
        ],
        r2_buckets: [{ binding: 'FILES', bucket_name: 'mon-blog-local' }],
      },
    }),
  ],
};

if (checkBuild) {
  console.log(`Checking the production Worker build in ${localRoot}`);
  const builder = await createBuilder(config);
  await builder.buildApp();
  console.log(
    `Production build completed. Isolated output: ${join(localRoot, 'dist')}`,
  );
  console.log(
    'This check compiled the application only; nothing was deployed.',
  );
  process.exit(0);
}

const server = await createServer(config);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  console.log(`Local preview stopped. Temporary data retained at ${localRoot}`);
  process.exit(0);
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
try {
  await server.listen();
} catch (error) {
  await server.close();
  throw error;
}
console.log(`Local preview: http://127.0.0.1:${port}`);
console.log(
  `Local sign-in: http://127.0.0.1:${port}/signin-with-chatgpt?return_to=/`,
);
console.log(`Isolated state: ${localRoot}`);
console.log(
  'No real GitHub connection is loaded. Use local draft and MCP key operations for this preview.',
);
