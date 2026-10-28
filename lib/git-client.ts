import { mergeRevisions, type Revision } from './records';
let token = '';
async function call(path: string, records?: Revision[]) {
  const response = await fetch('/api/git/' + path, {
    method: path === 'state' ? 'GET' : 'POST',
    headers:
      path === 'state'
        ? {}
        : { 'Content-Type': 'application/json', 'X-Tagengo-Token': token },
    body: path === 'state' ? undefined : JSON.stringify({ records }),
    cache: 'no-store',
  });
  if (!response.headers.get('Content-Type')?.includes('application/json'))
    throw Error('当前页面未连接本地 Git 服务，请使用 npm run local 启动');
  const data = (await response.json()) as {
    records: Revision[];
    token?: string;
    error?: string;
    commit?: string;
  };
  if (!response.ok) throw Error(data.error || '本地 Git 服务连接失败');
  if (data.token) token = data.token;
  return { ...data, records: mergeRevisions(data.records) };
}
export const gitState = () => call('state');
export const gitSave = (records: Revision[]) => call('save', records);
export const gitSync = () => call('sync');
