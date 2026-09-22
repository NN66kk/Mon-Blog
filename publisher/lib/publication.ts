import { splitMarkdown, REPO } from './content';
import { readArticle, type GitCall } from './github';
import { ApiError } from './github';

export type Publication = {
  id: string;
  state: string;
  commit_sha?: string | null;
  target_path?: string | null;
  url: string;
  created_at: string;
  error?: string | null;
  action?: string;
};

export function needsPublicationCheck(state: string) {
  // A later build can deploy the article after this build was cancelled.
  return !['live', 'failed', 'superseded'].includes(state);
}

export async function checkPublication<T extends Publication>(
  publication: T,
  call: GitCall,
  confirmCommit: (
    blobSha: string,
    firstPublishedAt: string | null,
  ) => Promise<void>,
  request: typeof fetch = fetch,
  now = Date.now(),
  hasLiveSuccessor = false,
): Promise<T> {
  const job = { ...publication };
  if (!needsPublicationCheck(job.state)) return job;
  if (job.commit_sha && hasLiveSuccessor) {
    job.state = 'superseded';
    job.error = null;
    return job;
  }
  if (!job.commit_sha) {
    if (now - Date.parse(job.created_at) > 180000) {
      job.state = 'failed';
      job.error = '发布准备超时，请保存草稿新版本后重试。';
    }
    return job;
  }
  if (job.state === 'verifying' && job.target_path) {
    const comparison = await call(
      `/repos/${REPO}/compare/${job.commit_sha}...main`,
    );
    if (['identical', 'ahead'].includes(comparison.status)) {
      if (job.action === 'delete') {
        let absent = false;
        try {
          await readArticle(call, job.target_path, job.commit_sha);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) absent = true;
          else throw error;
        }
        if (!absent)
          return {
            ...job,
            state: 'failed',
            error: '删除提交中仍有这篇文章，请检查仓库记录。',
          };
        await confirmCommit('', null);
      } else {
        const remote = await readArticle(call, job.target_path, job.commit_sha);
        const publishedAt =
          remote.encoding === 'base64' && remote.content
            ? splitMarkdown(
                Buffer.from(remote.content, 'base64').toString('utf8'),
              ).data.published_at
            : null;
        await confirmCommit(
          remote.sha,
          typeof publishedAt === 'string' ? publishedAt : null,
        );
      }
      job.state = 'submitted';
      job.error = null;
    } else if (now - Date.parse(job.created_at) > 30000) {
      job.state = 'failed';
      job.error =
        '发布未写入主分支。请重新导入最新文章，保留当前草稿后合并修改。';
    }
  }
  let onlineMissing = false;
  try {
    const online = await request(`${job.url}?publisher_check=${job.id}`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(8000),
    });
    onlineMissing = online.status === 404 || online.status === 410;
    if (
      job.action !== 'delete' &&
      online.ok &&
      (await online.text()).includes(`<!-- publisher-release:${job.id} -->`)
    ) {
      job.state = 'live';
      job.error = null;
    }
  } catch {
    /* The deployment may still be propagating. */
  }
  if (['live', 'failed'].includes(job.state)) return job;
  const result = await call(
    `/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${job.commit_sha}&per_page=5`,
  );
  const run = result.workflow_runs?.[0];
  // A later build may include this deletion after its own build was cancelled.
  if (
    job.action === 'delete' &&
    onlineMissing &&
    run?.conclusion !== 'success'
  ) {
    const deployed = await call(
      `/repos/${REPO}/actions/workflows/ci.yml/runs?branch=main&status=success&per_page=1`,
    );
    const deployedSha = deployed.workflow_runs?.[0]?.head_sha;
    if (deployedSha) {
      const comparison = await call(
        `/repos/${REPO}/compare/${job.commit_sha}...${deployedSha}`,
      );
      if (['identical', 'ahead'].includes(comparison.status)) {
        job.state = 'live';
        job.error = null;
        return job;
      }
    }
  }
  if (run) {
    if (run.status !== 'completed') job.state = 'building';
    else if (run.conclusion === 'success') {
      job.state = job.action === 'delete' && onlineMissing ? 'live' : 'built';
      job.error = null;
    } else if (run.conclusion === 'cancelled') {
      job.state = 'cancelled';
      job.error = '本次构建被后续发布替代，仍在检查文章是否上线。';
    } else {
      job.state = 'failed';
      job.error = '博客构建失败，请打开 GitHub Actions 查看详情。';
    }
  } else if (
    now - Date.parse(job.created_at) > 180000 &&
    job.state === 'verifying'
  ) {
    job.state = 'failed';
    job.error = '未确认提交进入发布分支，请核对 GitHub 后保存新版本重试。';
  }
  return job;
}
