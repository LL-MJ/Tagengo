'use client';
import { useEffect, useRef, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  BookOpen,
  Cloud,
  Plus,
  Search,
  Upload,
  Download,
  RefreshCw,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  blank,
  heads,
  mergeRevisions,
  parseImport,
  importPayload,
  revise,
  type Entry,
  type Kind,
  type Revision,
} from '@/lib/records';
import { cache, readCache } from '@/lib/cache';
import { gitState, gitSave, gitSync } from '@/lib/git-client';
const labels = { words: '单词', sentences: '例句', grammar: '语法' };
const prompt = `请把本次学习内容整理为 JSON 数组，只输出 JSON。每个对象均包含以下全部字段：id（唯一英文编号，关联记录用同一编号）、kind（words/sentences/grammar）、title（日语表记或例句）、meaning（中文释义或翻译）、kana、romaji、part（词性）、forms（活用，每行“形式：内容”）、connection（接续）、conditions（使用条件）、wordIds（例句关联的词条 id 数组）、marks（例句语法高亮数组，每项含 grammarId、text（句中实际出现的连续文字）、occurrence（从0计数的第几次出现））、source（来源）、deleted（false）。不适用的字符串留空、数组留空。保留原形与例句实际活用的区别。不要编造不确定的读音或用法。`;
export default function Home() {
  const [tab, setTab] = useState<Kind>('words'),
    [records, setRecords] = useState<Revision[]>([]),
    [scope, setScope] = useState('draft'),
    [username, setUsername] = useState(''),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('正在读取本机草稿…'),
    [query, setQuery] = useState(''),
    [edit, setEdit] = useState<Entry | null>(null),
    [detail, setDetail] = useState<Entry | null>(null),
    [setup, setSetup] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [importText, setImportText] = useState(''),
    [importPreview, setImportPreview] = useState<Entry[] | null>(null),
    [remove, setRemove] = useState<Entry | null>(null);
  const recordsRef = useRef(records),
    scopeRef = useRef(scope),
    syncLock = useRef(false),
    editorParents = useRef<string[]>([]);
  recordsRef.current = records;
  scopeRef.current = scope;
  const allHeads = heads(records),
    conflicts = [...allHeads.values()].filter((h) => h.length > 1),
    entries = [...allHeads.values()]
      .filter((h) => h.length === 1 && !h[0].entry.deleted)
      .map((h) => h[0].entry),
    visible = entries.filter(
      (e) =>
        e.kind === tab &&
        [e.title, e.meaning, e.kana, e.romaji, e.forms]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const local = ['localhost', '127.0.0.1'].includes(location.hostname);
        let data: Revision[];
        if (local) {
          const state = await gitState();
          data = state.records;
          if (!active) return;
          setScope('git');
          scopeRef.current = 'git';
          setUsername('LL-MJ/Tagengo-data');
          setNotice('已读取本地数据文件 · 点击同步获取其他电脑的更新');
        } else {
          data = await readCache('draft');
          if (!active) return;
          setNotice('网页版仅保存本机草稿；Git 同步请打开电脑上的本地学习库');
        }
        recordsRef.current = data;
        setRecords(data);
        setReady(true);
        const params = new URLSearchParams(location.hash.slice(1));
        const captured = params.get('capture');
        if (captured) {
          const e = blank('sentences');
          e.title = captured.slice(0, 20000);
          e.source = params.get('source')?.slice(0, 20000) || '';
          setEdit(e);
          history.replaceState(null, '', location.pathname);
        }
      } catch (e) {
        if (active) setNotice(message(e));
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  function message(e: unknown) {
    return e instanceof Error ? e.message : '操作失败，请重试';
  }
  async function sync() {
    if (syncLock.current || scopeRef.current !== 'git') return;
    syncLock.current = true;
    setBusy(true);
    setNotice('正在拉取、合并并上传学习记录…');
    try {
      const result = await gitSync();
      const combined = mergeRevisions(recordsRef.current, result.records);
      recordsRef.current = combined;
      setRecords(combined);
      const pending = combined.length !== result.records.length;
      setNotice(
        pending
          ? '同步期间有新保存的记录，请再次同步'
          : '已同步到私有仓库 · ' + new Date().toLocaleTimeString(),
      );
    } catch (e) {
      setNotice(message(e));
    } finally {
      syncLock.current = false;
      setBusy(false);
    }
  }
  async function append(batch: Revision[]) {
    if (scopeRef.current === 'git') {
      const result = await gitSave(batch);
      const merged = mergeRevisions(recordsRef.current, result.records);
      recordsRef.current = merged;
      setRecords(merged);
      setNotice('已保存到本地文件 · 点击同步上传到私有仓库');
    } else {
      const merged = mergeRevisions(recordsRef.current, batch);
      await cache('draft', batch);
      recordsRef.current = merged;
      setRecords(merged);
      setNotice('已保存浏览器草稿 · 可导出后导入本地学习库');
    }
  }

  function start(e?: Entry) {
    editorParents.current = e
      ? (allHeads.get(e.id) || []).map((r) => r.id)
      : [];
    setEdit(e ? structuredClone(e) : blank(tab));
  }
  async function save() {
    if (!edit) return;
    try {
      await append([revise(edit, editorParents.current)]);
      setEdit(null);
    } catch (e) {
      setNotice(message(e));
    }
  }
  function download() {
    const text = JSON.stringify(
      { format: 'tagengo-export-v1', entries, revisions: records },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([text], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tagengo-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function applyImport() {
    if (!importPreview) return;
    try {
      const raw = importPayload(importText);
      const batch =
        raw.format === 'tagengo-export-v1' && Array.isArray(raw.revisions)
          ? mergeRevisions(raw.revisions)
          : importPreview.map((e) =>
              revise(
                e,
                (allHeads.get(e.id) || []).map((r) => r.id),
              ),
            );
      await append(batch);
      setImportOpen(false);
      setImportPreview(null);
    } catch (e) {
      setNotice(message(e));
    }
  }
  function field(key: keyof Entry, label: string, multiline = false) {
    if (!edit) return null;
    return (
      <label className="field">
        {label}
        {multiline ? (
          <textarea
            rows={3}
            value={String(edit[key])}
            onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
          />
        ) : (
          <input
            value={String(edit[key])}
            onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
          />
        )}
      </label>
    );
  }
  function sentence(e: Entry) {
    const spans = e.marks
      .map((m) => {
        let start = -1;
        for (let n = 0; n <= m.occurrence; n++)
          start = e.title.indexOf(m.text, start + 1);
        return { ...m, start, end: start + m.text.length };
      })
      .filter((s) => s.start >= 0);
    const boundaries = [
      ...new Set([
        0,
        e.title.length,
        ...spans.flatMap((s) => [s.start, s.end]),
      ]),
    ].sort((a, b) => a - b);
    return (
      <p className="japanese" lang="ja">
        {boundaries.slice(0, -1).map((start, i) => {
          const end = boundaries[i + 1],
            matches = spans.filter((s) => s.start <= start && s.end >= end),
            text = e.title.slice(start, end);
          return matches.length ? (
            <button
              key={start}
              className="highlight"
              onClick={() => {
                const g = entries.find((x) => x.id === matches[0].grammarId);
                if (g) setDetail(g);
                else setNotice('关联语法已删除或尚未导入');
              }}
              title="查看语法"
            >
              {text}
            </button>
          ) : (
            <span key={start}>{text}</span>
          );
        })}
      </p>
    );
  }
  function card(e: Entry, compact = false) {
    const linked = entries.filter(
      (s) =>
        s.kind === 'sentences' &&
        (e.kind === 'words'
          ? s.wordIds.includes(e.id)
          : s.marks.some((m) => m.grammarId === e.id)),
    );
    return (
      <article className={'entry ' + (compact ? 'compact' : '')} key={e.id}>
        <div className="entry-top">
          <span className="tag">{e.part || labels[e.kind]}</span>
          <div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={'编辑' + e.title}
              onClick={() => start(e)}
            >
              <Pencil size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={'删除' + e.title}
              onClick={() => setRemove(e)}
            >
              <Trash2 size={16} />
            </Button>
          </div>
        </div>
        {e.kind === 'sentences' ? sentence(e) : <h2 lang="ja">{e.title}</h2>}
        {e.kana && (
          <p className="reading" lang="ja">
            {e.kana} <span>{e.romaji}</span>
          </p>
        )}
        <p className="meaning">{e.meaning}</p>
        {e.forms && <p className="forms">{e.forms}</p>}
        {e.connection && (
          <p>
            <b>接续</b>　{e.connection}
          </p>
        )}
        {e.conditions && (
          <p>
            <b>使用条件</b>　{e.conditions}
          </p>
        )}
        {e.kind === 'sentences' && (
          <div className="links">
            {e.wordIds.map((id) => {
              const w = entries.find((x) => x.id === id);
              return w ? (
                <button key={id} onClick={() => setDetail(w)}>
                  {w.title} ↗
                </button>
              ) : null;
            })}
            {[...new Set(e.marks.map((m) => m.grammarId))].map((id) => {
              const g = entries.find((x) => x.id === id);
              return g ? (
                <button key={id} onClick={() => setDetail(g)}>
                  {g.title} ↗
                </button>
              ) : null;
            })}
          </div>
        )}
        {linked.length > 0 && (
          <div className="examples">
            <p className="muted">我的例句 · {linked.length}</p>
            {linked.map((s) => (
              <div key={s.id}>
                {sentence(s)}
                <p className="muted">{s.meaning}</p>
              </div>
            ))}
          </div>
        )}
        {e.source && <p className="source">来源：{e.source}</p>}
      </article>
    );
  }
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: { registerTool: (t: unknown, o: unknown) => unknown };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: 'stage_learning_import',
            description:
              '预览学习记录 JSON，等待用户在界面确认保存；不会直接写入。',
            inputSchema: {
              type: 'object',
              properties: { json: { type: 'string' } },
              required: ['json'],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute: (input: unknown) => {
              const j = (input as { json?: unknown })?.json;
              if (typeof j !== 'string') throw Error('json 必须为字符串');
              const parsed = parseImport(j);
              setImportText(j);
              setImportPreview(parsed);
              setImportOpen(true);
              return { status: 'staged', count: parsed.length };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  return (
    <main className="study">
      <header>
        <div className="brand">
          <BookOpen />
          <b>Tagengo</b>
          <span>日语学习库</span>
        </div>
        <div className="actions">
          {username && (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void sync()}
            >
              <RefreshCw size={16} />
              同步
            </Button>
          )}
          <Button variant="outline" onClick={() => setSetup(true)}>
            <Cloud />
            Git 数据仓库
          </Button>
        </div>
      </header>
      <section className="intro">
        <p>わたしの日本語ノート</p>
        <h1>把学过的日语，连起来。</h1>
      </section>
      <div role="status" className="status">
        {notice}
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)}>
        <div className="toolbar">
          <TabsList>
            {(Object.keys(labels) as Kind[]).map((k) => (
              <TabsTrigger key={k} value={k}>
                {labels[k]}库{' '}
                <span className="count">
                  {entries.filter((e) => e.kind === k).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="actions">
            <Button
              disabled={!ready}
              variant="ghost"
              onClick={() => {
                setImportText('');
                setImportPreview(null);
                setImportOpen(true);
              }}
            >
              <Upload />
              导入
            </Button>
            <Button disabled={!ready} variant="ghost" onClick={download}>
              <Download />
              导出
            </Button>
            <Button disabled={!ready} onClick={() => start()}>
              <Plus />
              新增{labels[tab]}
            </Button>
          </div>
        </div>
      </Tabs>
      <div className="search">
        <Search size={20} />
        <input
          aria-label="搜索学习记录"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索日语、假名、罗马音或中文…"
        />
      </div>
      {conflicts.map((h) => (
        <section className="conflict" key={h[0].entry.id}>
          <h2>这条记录有 {h.length} 个不同版本</h2>
          <p>查看内容，选择要保留的版本。其他版本会留在历史记录中。</p>
          {h.map((r) => (
            <div key={r.id}>
              <pre>{JSON.stringify(r.entry, null, 2)}</pre>
              <Button
                onClick={async () => {
                  try {
                    await append([
                      revise(
                        r.entry,
                        h.map((x) => x.id),
                      ),
                    ]);
                  } catch (e) {
                    setNotice(message(e));
                  }
                }}
              >
                保留这个版本
              </Button>
            </div>
          ))}
        </section>
      ))}
      {visible.length ? (
        <section className="entries">{visible.map((e) => card(e))}</section>
      ) : (
        <section className="empty-state">
          <BookOpen size={36} />
          <h2>{query ? '没有找到匹配记录' : '从今天学到的一句话开始'}</h2>
          <p>
            {query
              ? '换一个日语词或中文释义试试。'
              : '保存单词、例句和语法，让每次学习都有迹可循。'}
          </p>
          <p className="muted">
            {scope === 'draft'
              ? '当前是浏览器草稿；Git 同步需要打开本地学习库。'
              : '点击新增或导入，开始建立你的学习库。'}
          </p>
        </section>
      )}
      <Dialog
        open={!!edit}
        onOpenChange={(o) => {
          if (!o) setEdit(null);
        }}
      >
        <DialogContent className="editor">
          <DialogTitle>{edit ? labels[edit.kind] : ''}记录</DialogTitle>
          <DialogDescription>
            保存原形、释义和你实际学过的用法。
          </DialogDescription>
          {edit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              {field(
                'title',
                edit.kind === 'sentences' ? '日语例句' : '日语表记',
                edit.kind === 'sentences',
              )}
              {field(
                'meaning',
                edit.kind === 'sentences' ? '中文翻译' : '中文含义',
                true,
              )}
              {edit.kind === 'words' && (
                <>
                  {field('kana', '假名')}
                  {field('romaji', '罗马音')}
                  {field('part', '词性 / 动词类别')}
                  {field('forms', '活用（每行一项，例如：て形：食べて）', true)}
                </>
              )}
              {edit.kind === 'grammar' && (
                <>
                  {field('connection', '接续方式', true)}
                  {field('conditions', '使用条件与注意事项', true)}
                </>
              )}
              {edit.kind === 'sentences' && (
                <>
                  <p>
                    <b>关联单词</b>
                  </p>
                  {entries
                    .filter((e) => e.kind === 'words')
                    .map((w) => (
                      <label className="checkline" key={w.id}>
                        <Checkbox
                          checked={edit.wordIds.includes(w.id)}
                          onCheckedChange={(v) =>
                            setEdit({
                              ...edit,
                              wordIds: v
                                ? [...edit.wordIds, w.id]
                                : edit.wordIds.filter((id) => id !== w.id),
                            })
                          }
                        />
                        {w.title} · {w.meaning}
                      </label>
                    ))}
                  <p>
                    <b>语法高亮</b>
                  </p>
                  <p className="muted">
                    选择语法后填写句中实际出现的文字。重复文字用“出现序号”区分。
                  </p>
                  {entries
                    .filter((e) => e.kind === 'grammar')
                    .map((g) => (
                      <div className="mark-edit" key={g.id}>
                        <label className="checkline">
                          <Checkbox
                            checked={edit.marks.some(
                              (m) => m.grammarId === g.id,
                            )}
                            onCheckedChange={(v) =>
                              setEdit({
                                ...edit,
                                marks: v
                                  ? [
                                      ...edit.marks,
                                      {
                                        grammarId: g.id,
                                        text: '',
                                        occurrence: 0,
                                      },
                                    ]
                                  : edit.marks.filter(
                                      (m) => m.grammarId !== g.id,
                                    ),
                              })
                            }
                          />
                          {g.title}
                        </label>
                        {edit.marks.map((m, i) =>
                          m.grammarId === g.id ? (
                            <div className="mark-fields" key={i}>
                              <label>
                                高亮文字
                                <input
                                  value={m.text}
                                  onChange={(e) =>
                                    setEdit({
                                      ...edit,
                                      marks: edit.marks.map((x, j) =>
                                        j === i
                                          ? { ...x, text: e.target.value }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                              </label>
                              <label>
                                出现序号
                                <input
                                  type="number"
                                  min="1"
                                  value={m.occurrence + 1}
                                  onChange={(e) =>
                                    setEdit({
                                      ...edit,
                                      marks: edit.marks.map((x, j) =>
                                        j === i
                                          ? {
                                              ...x,
                                              occurrence:
                                                Number(e.target.value) - 1,
                                            }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                              </label>
                            </div>
                          ) : null,
                        )}
                      </div>
                    ))}
                </>
              )}
              {field('source', '来源 / 笔记', true)}
              <Button type="submit">
                保存{scope === 'draft' ? '本机草稿' : ''}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Sheet
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
      >
        <SheetContent className="detail">
          <SheetTitle>关联{detail ? labels[detail.kind] : ''}</SheetTitle>
          <SheetDescription>查看词语用法与关联例句。</SheetDescription>
          {detail &&
            card(entries.find((e) => e.id === detail.id) || detail, true)}
        </SheetContent>
      </Sheet>
      <Dialog open={setup} onOpenChange={setSetup}>
        <DialogContent className="editor">
          <DialogTitle>私有 Git 数据仓库</DialogTitle>
          <DialogDescription>
            两台电脑通过同一仓库同步学习记录，保存时先写入本机文件。
          </DialogDescription>
          <a
            href="https://github.com/LL-MJ/Tagengo-data"
            target="_blank"
            rel="noreferrer"
          >
            LL-MJ/Tagengo-data ↗
          </a>
          <p>
            每次学习前点击“同步”获取更新，结束后再同步一次。不同版本出现冲突时，可以在学习库中选择要保留的内容。
          </p>
          {username ? (
            <>
              <p className="muted">
                已连接本地服务。Git 使用本机已有的 GitHub
                登录，不需要在网页填写密码。
              </p>
              <Button disabled={busy} onClick={() => void sync()}>
                立即同步
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const drafts = await readCache('draft');
                    await append(drafts);
                  } catch (e) {
                    setNotice(message(e));
                  }
                }}
              >
                导入此浏览器的旧草稿
              </Button>
            </>
          ) : (
            <p>
              在电脑的项目目录运行 npm run local，再访问
              http://localhost:3000/。旧网页版的草稿可通过“导出”迁移。
            </p>
          )}
          <a href="/tagengo-extension.zip" download>
            下载 ChatGPT 网页收录扩展
          </a>
          <p className="muted">
            扩展的学习库网址设为 http://localhost:3000/。手机暂未接入这个本地
            Git 服务。
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="editor">
          <DialogTitle>导入学习记录</DialogTitle>
          <DialogDescription>
            粘贴 GPT 整理的 JSON
            或选择导出文件。导入前可预览；相同编号会更新已有记录。完整备份会合并全部历史版本，包括删除与冲突。
          </DialogDescription>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(prompt);
                setNotice('已复制整理指令，粘贴到 ChatGPT 即可');
              } catch {
                setImportText(prompt);
                setNotice('无法访问剪贴板，整理指令已显示在输入框中');
              }
            }}
          >
            复制给 GPT 的整理指令
          </Button>
          <input
            aria-label="选择 JSON 文件"
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 10000000) {
                setNotice('文件超过 10MB');
                return;
              }
              setImportText(await f.text());
              setImportPreview(null);
            }}
          />
          <textarea
            aria-label="JSON 内容"
            rows={9}
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportPreview(null);
            }}
          />
          {importPreview && (
            <div className="preview-list">
              {importPreview.map((e) => (
                <p key={e.id}>
                  {labels[e.kind]} · {e.title} — {e.meaning}
                  {allHeads.has(e.id) ? '（更新）' : ''}
                </p>
              ))}
            </div>
          )}
          <div className="actions">
            <Button
              variant="outline"
              onClick={() => {
                try {
                  setImportPreview(parseImport(importText));
                } catch (e) {
                  setNotice(message(e));
                }
              }}
            >
              预览
            </Button>
            <Button
              disabled={!importPreview}
              onClick={() => void applyImport()}
            >
              确认导入 {importPreview?.length || 0} 条
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!remove}
        onOpenChange={(o) => {
          if (!o) setRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>删除这条记录？</AlertDialogTitle>
          <AlertDialogDescription>
            {remove?.title}
            。删除标记会同步到其他设备，历史版本仍保留在导出文件中。
          </AlertDialogDescription>
          <Button
            variant="destructive"
            onClick={async () => {
              if (!remove) return;
              try {
                await append([
                  revise(
                    { ...remove, deleted: true },
                    (allHeads.get(remove.id) || []).map((r) => r.id),
                  ),
                ]);
                setRemove(null);
              } catch (e) {
                setNotice(message(e));
              }
            }}
          >
            确认删除
          </Button>
          <Button variant="outline" onClick={() => setRemove(null)}>
            取消
          </Button>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
