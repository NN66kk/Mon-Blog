import { getChatGPTUser } from '../chatgpt-auth';
import Writer from '../writer';
export const dynamic = 'force-dynamic';
export default async function WritePage() {
  const user = await getChatGPTUser();
  return (
    <Writer user={user ? { name: user.displayName, id: user.userId } : null} />
  );
}
