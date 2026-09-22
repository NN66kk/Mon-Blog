import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const drafts = sqliteTable(
  'drafts',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    title: text('title').notNull(),
    collection: text('collection').notNull(),
    body: text('body').notNull(),
    metadata: text('metadata').notNull(),
    sourcePath: text('source_path'),
    baseSha: text('base_sha'),
    firstPublishedAt: text('first_published_at'),
    deletedAt: text('deleted_at'),
    revision: integer('revision').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('idx_drafts_owner_updated').on(t.owner, t.updatedAt)],
);

export const connections = sqliteTable('connections', {
  owner: text('owner').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  login: text('login').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const publications = sqliteTable(
  'publications',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    draftId: text('draft_id').notNull(),
    revision: integer('revision').notNull(),
    state: text('state').notNull(),
    commitSha: text('commit_sha'),
    url: text('url'),
    error: text('error'),
    targetPath: text('target_path'),
    action: text('action').notNull().default('publish'),
    title: text('title'),
    trashId: text('trash_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_publications_draft_revision').on(t.draftId, t.revision),
    index('idx_publications_owner').on(t.owner, t.createdAt),
  ],
);

export const draftVersions = sqliteTable(
  'draft_versions',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    draftId: text('draft_id').notNull(),
    revision: integer('revision').notNull(),
    title: text('title').notNull(),
    collection: text('collection').notNull(),
    body: text('body').notNull(),
    metadata: text('metadata').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_draft_versions_revision').on(t.draftId, t.revision),
    index('idx_draft_versions_owner').on(t.owner, t.draftId),
  ],
);

export const articleCache = sqliteTable(
  'article_cache',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    path: text('path').notNull(),
    sha: text('sha').notNull(),
    title: text('title').notNull(),
    tags: text('tags').notNull(),
    description: text('description').notNull(),
    publishedAt: text('published_at'),
    updatedAt: text('updated_at'),
    syncedAt: text('synced_at').notNull(),
  },
  (t) => [uniqueIndex('idx_article_cache_owner_path').on(t.owner, t.path)],
);

export const articleTrash = sqliteTable(
  'article_trash',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    path: text('path').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    originalSha: text('original_sha').notNull(),
    state: text('state').notNull(),
    publicationId: text('publication_id'),
    createdAt: text('created_at').notNull(),
    restoredAt: text('restored_at'),
  },
  (t) => [index('idx_article_trash_owner').on(t.owner, t.createdAt)],
);

export const mediaEntries = sqliteTable(
  'media_entries',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    originalName: text('original_name'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('idx_media_entries_owner_name').on(t.owner, t.name)],
);
