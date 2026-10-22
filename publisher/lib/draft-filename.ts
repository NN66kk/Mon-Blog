import { database } from './server';
import { createDraftStore } from './draft-store';

// Compatibility entry point; shared with the web/MCP writing service.
export async function ensureDraftFilename(owner: string, id: string) {
  return createDraftStore(database()).ensureDraftFilename(owner, id);
}
