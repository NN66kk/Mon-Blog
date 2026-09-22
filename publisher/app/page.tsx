import { getChatGPTUser } from './chatgpt-auth';
import Manager from './manager';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const user = await getChatGPTUser();
  return (
    <Manager user={user ? { name: user.displayName, id: user.userId } : null} />
  );
}
