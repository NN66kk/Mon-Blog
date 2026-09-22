export async function api(
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<any> {
  const result = await fetch(`/api/${path}`, {
    method,
    ...(data !== undefined && method !== 'GET' && method !== 'HEAD'
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      : {}),
  });
  const body: any = await result
    .json()
    .catch(() => ({ error: '服务暂时无法响应，请稍后重试。' }));
  if (!result.ok) throw new Error(body.error || '操作未完成，请稍后重试。');
  return body;
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export const normalize = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase().trim();
export function matches(query: string, ...fields: string[]) {
  const text = normalize(fields.join(' '));
  return normalize(query)
    .split(/\s+/)
    .every((word) => text.includes(word));
}
export function jobLabel(job: { state: string; action?: string }) {
  if (job.state === 'live')
    return job.action === 'delete'
      ? '已下线'
      : job.action === 'restore'
        ? '已恢复上线'
        : '已上线';
  return (
    (
      {
        preparing: '准备提交',
        verifying: '确认提交中',
        submitted: '等待部署',
        building: '部署中',
        built: '部署完成，核对页面中',
        failed: '操作未完成',
        cancelled: '构建已替代，核对中',
        superseded: '已由后续版本完成',
      } as Record<string, string>
    )[job.state] || job.state
  );
}
