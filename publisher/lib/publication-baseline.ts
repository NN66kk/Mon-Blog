type ConfirmedDraftPublication = {
  owner: string;
  draftId: string;
  path: string;
  blobSha: string;
  firstPublishedAt: string | null;
  expectedBaseSha: string | null;
};

// A publish may finish after another request has confirmed a newer commit.
// Guard the publication baseline, not the editable revision: writing can
// continue while a publication is in flight without losing its confirmation.
export function draftPublicationUpdate(
  db: Pick<D1Database, 'prepare'>,
  publication: ConfirmedDraftPublication,
) {
  return db
    .prepare(
      'UPDATE drafts SET source_path=?,base_sha=?,first_published_at=COALESCE(first_published_at,?) WHERE id=? AND owner=? AND base_sha IS ?',
    )
    .bind(
      publication.path,
      publication.blobSha,
      publication.firstPublishedAt,
      publication.draftId,
      publication.owner,
      publication.expectedBaseSha,
    );
}
