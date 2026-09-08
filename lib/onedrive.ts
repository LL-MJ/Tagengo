import {PublicClientApplication,InteractionRequiredAuthError} from '@azure/msal-browser';
import {mergeRevisions,validateRevision,type Revision} from './records';
const scopes=['Files.ReadWrite.AppFolder'];
let client:PublicClientApplication|undefined;
let initialized:Promise<PublicClientApplication>|undefined;
let currentClientId='';
export function auth(){
 const requested=localStorage.getItem('tagengo-client-id')||'';
 if(initialized&&requested===currentClientId)return initialized;
 currentClientId=requested;
 initialized=(async()=>{const clientId=localStorage.getItem('tagengo-client-id');if(!clientId)throw Error('请先填写微软应用 ID');client=new PublicClientApplication({auth:{clientId,authority:'https://login.microsoftonline.com/consumers',redirectUri:location.origin+'/'},cache:{cacheLocation:'sessionStorage'}});await client.initialize();const result=await client.handleRedirectPromise();if(result?.account)client.setActiveAccount(result.account);else if(client.getAllAccounts().length===1)client.setActiveAccount(client.getAllAccounts()[0]);return client})();
 initialized.catch(()=>{initialized=undefined});return initialized;
}
export async function login(){const c=await auth();await c.loginRedirect({scopes,prompt:'select_account'})}
export async function account(){const c=await auth();return c.getActiveAccount()}
export async function signOut(){const c=await auth();await c.logoutRedirect({postLogoutRedirectUri:location.origin+'/'})}
async function token(){const c=await auth();const a=c.getActiveAccount();if(!a)throw Error('请登录 OneDrive');try{return (await c.acquireTokenSilent({account:a,scopes})).accessToken}catch(e){if(e instanceof InteractionRequiredAuthError)throw Error('登录已过期，请重新连接 OneDrive');throw e}}
export async function synchronize(local:Revision[]):Promise<Revision[]>{
 const accessToken=await token();
 async function graph(path:string,init:RequestInit={}){const url=path.startsWith('https:')?path:'https://graph.microsoft.com/v1.0'+path;if(!url.startsWith('https://graph.microsoft.com/v1.0/'))throw Error('同步地址无效');const r=await fetch(url,{...init,headers:{Authorization:'Bearer '+accessToken,...init.headers}});if(!r.ok)throw Error('OneDrive 同步失败（'+r.status+'），本机内容已保留，请稍后重试');return await r.json() as {id:string;value:Array<{id:string;name:string;size:number;'@microsoft.graph.downloadUrl'?:string}>;'@odata.nextLink'?:string}}
 const root=await graph('/me/drive/special/approot');
 let next='/me/drive/items/'+encodeURIComponent(root.id)+'/children?$top=200';
 const remote:Revision[]=[];const found=new Set<string>();const known=new Map(local.map(r=>[r.id,r]));
 while(next){const page=await graph(next);for(const f of page.value){if(!/^tagengo-rev-[a-zA-Z0-9_-]+\.json$/.test(f.name))continue;const id=f.name.slice(12,-5);found.add(id);if(known.has(id)){remote.push(known.get(id)!);continue}if(f.size>2000000)throw Error('远端记录文件过大，已停止同步');const download=f['@microsoft.graph.downloadUrl'];if(typeof download!=='string'||!download.startsWith('https://'))throw Error('OneDrive 未返回下载地址');const r=await fetch(download);if(!r.ok)throw Error('下载学习记录失败');const rev=validateRevision(await r.json());if(rev.id!==id)throw Error('远端文件与版本编号不一致');remote.push(rev)}next=page['@odata.nextLink']||''}
 const merged=mergeRevisions(local,remote);
 for(const revision of local)if(!found.has(revision.id))await graph('/me/drive/items/'+encodeURIComponent(root.id)+':/tagengo-rev-'+revision.id+'.json:/content',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(revision)});
 return merged;
}

