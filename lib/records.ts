export type Kind = 'words'|'sentences'|'grammar';
export type Mark = {grammarId:string;text:string;occurrence:number};
export type Entry = {id:string;kind:Kind;title:string;meaning:string;kana:string;romaji:string;part:string;forms:string;connection:string;conditions:string;wordIds:string[];marks:Mark[];source:string;deleted:boolean};
export type Revision = {version:1;id:string;parents:string[];at:string;entry:Entry};
export const blank=(kind:Kind):Entry=>({id:crypto.randomUUID(),kind,title:'',meaning:'',kana:'',romaji:'',part:'',forms:'',connection:'',conditions:'',wordIds:[],marks:[],source:'',deleted:false});
const idPattern=/^[a-zA-Z0-9_-]{1,100}$/;
export function validateEntry(raw:unknown):Entry {
 if(!raw||typeof raw!=='object')throw Error('记录必须是对象');
 const e=raw as Entry;
 if(!idPattern.test(e.id)||!['words','sentences','grammar'].includes(e.kind))throw Error('记录编号或类型无效');
 for(const k of ['title','meaning','kana','romaji','part','forms','connection','conditions','source'] as const)if(typeof e[k]!=='string'||e[k].length>20000)throw Error('记录字段缺失或过长：'+k);
 if(!e.title.trim())throw Error('请填写日语内容');
 if(typeof e.deleted!=='boolean'||!Array.isArray(e.wordIds)||e.wordIds.some(v=>typeof v!=='string'||!idPattern.test(v)))throw Error('单词关联无效');
 if(!Array.isArray(e.marks)||e.marks.some(m=>!m||!idPattern.test(m.grammarId)||typeof m.text!=='string'||!m.text||!Number.isInteger(m.occurrence)||m.occurrence<0||e.title.split(m.text).length-1<=m.occurrence))throw Error('语法高亮文字必须存在于例句中，出现序号从 1 开始');
 return structuredClone(e);
}
export function validateRevision(raw:unknown):Revision {
 const r=raw as Revision;
 if(!r||r.version!==1||!idPattern.test(r.id)||!Array.isArray(r.parents)||r.parents.some(p=>!idPattern.test(p)||p===r.id)||typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at)))throw Error('学习库版本文件无效');
 return {...r,entry:validateEntry(r.entry)};
}
export function heads(revisions:Revision[]):Map<string,Revision[]> {
 const consumed=new Set(revisions.flatMap(r=>r.parents));
 const map=new Map<string,Revision[]>();
 for(const r of revisions)if(!consumed.has(r.id)){const h=map.get(r.entry.id)||[];h.push(r);map.set(r.entry.id,h)}
 return map;
}
export function mergeRevisions(...groups:Revision[][]):Revision[]{
 const map=new Map<string,Revision>();
 for(const group of groups)for(const value of group){const r=validateRevision(value);const existing=map.get(r.id);if(existing&&JSON.stringify(existing)!==JSON.stringify(r))throw Error('同一版本编号出现不同内容，已停止同步');map.set(r.id,r)}
 return [...map.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function revise(entry:Entry,parents:string[]):Revision{return {version:1,id:crypto.randomUUID(),at:new Date().toISOString(),parents,entry:validateEntry(entry)}}
export function importPayload(text:string){return JSON.parse(text.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''))}
export function parseImport(text:string):Entry[]{
 const raw=importPayload(text);
 const values=Array.isArray(raw)?raw:raw.entries;
 if(!Array.isArray(values)||values.length>1000)throw Error('请导入记录数组，最多 1000 条');
 const entries=values.map(validateEntry);if(new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('导入文件包含重复编号');return entries;
}
