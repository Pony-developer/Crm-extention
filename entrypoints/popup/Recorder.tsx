import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, ChevronLeft, Copy, Download, EyeOff, Plus, Square, Trash2, Undo2 } from 'lucide-react';
import type { Annotation, CrmContext, RecordedStep, ToolMessage } from '../../shared/types';

type Tool = Annotation['kind'];
const STORAGE_KEY = 'reproRecorderSteps';

export function Recorder({ context, onClose }: { context: CrmContext; onClose: () => void }) {
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [stepsLoaded, setStepsLoaded] = useState(false);
  const [selected, setSelected] = useState(0);
  const [tool, setTool] = useState<Tool>('arrow');
  const [notice, setNotice] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const draft = useRef<{ x: number; y: number } | undefined>(undefined);
  const step = steps[selected];

  useEffect(() => {
    void browser.storage.local.get(STORAGE_KEY).then(v => {
      setSteps((v[STORAGE_KEY] as RecordedStep[]) || []);
      setStepsLoaded(true);
    }).catch(error => setNotice(`Не удалось загрузить шаги: ${String(error)}`));
  }, []);
  useEffect(() => {
    if (!stepsLoaded) return;
    void browser.storage.local.set({ [STORAGE_KEY]: steps }).catch(error => setNotice(`Не удалось сохранить шаги: ${String(error)}`));
  }, [steps, stepsLoaded]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !step?.screenshot) return;
    let cancelled = false;
    void loadImage(step.screenshot).then(image => {
      if (cancelled) return;
      el.width = image.naturalWidth;
      el.height = image.naturalHeight;
      const context2d = el.getContext('2d');
      if (!context2d) throw new Error('Canvas 2D недоступен');
      context2d.drawImage(image, 0, 0);
      step.annotations.forEach(annotation => draw(context2d, annotation));
    }).catch(error => {
      if (!cancelled) setNotice(`Не удалось загрузить снимок: ${errorMessage(error)}`);
    });
    return () => { cancelled = true; };
  }, [step]);

  const add = async () => {
    const current = await browser.runtime.sendMessage({ type: 'GET_ACTIVE_CONTEXT' } satisfies ToolMessage).catch(() => context) as CrmContext || context;
    const next: RecordedStep = { id: crypto.randomUUID(), description: '', timestamp: new Date().toISOString(), context: { pageUrl: current.pageUrl, orgName: current.orgName, entityName: current.entityName, recordId: current.recordId, formName: current.formName }, annotations: [] };
    setSteps(old => [...old, next]); setSelected(steps.length);
  };
  const update = (change: Partial<RecordedStep>) => setSteps(old => old.map((item, i) => i === selected ? { ...item, ...change } : item));
  const capture = async () => { try { const screenshot = await browser.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' } satisfies ToolMessage); update({ screenshot }); } catch (e) { setNotice(`Не удалось сделать снимок: ${String(e)}`); } };
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => { const r = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX-r.left)*event.currentTarget.width/r.width, y: (event.clientY-r.top)*event.currentTarget.height/r.height }; };
  const endDraw = (event: React.PointerEvent<HTMLCanvasElement>) => { if (!draft.current || !step) return; const p=point(event); update({ annotations: [...step.annotations, { id: crypto.randomUUID(), kind: tool, x1:draft.current.x, y1:draft.current.y, x2:p.x, y2:p.y }] }); draft.current=undefined; };
  const move = (from:number, to:number) => { if(to<0||to>=steps.length)return; const copy=[...steps], item=copy[from];if(!item)return;copy.splice(from,1);copy.splice(to,0,item);setSteps(copy);setSelected(to); };
  const remove = () => { setSteps(old=>old.filter((_,i)=>i!==selected));setSelected(Math.max(0,selected-1)); };
  const text = () => steps.map((s,i)=>`${i+1}. ${s.description || '(без описания)'}\n${s.context.pageUrl || ''}\nОрганизация: ${s.context.orgName||'—'} · Сущность: ${s.context.entityName||'—'} · Запись: ${s.context.recordId||'—'} · Форма: ${s.context.formName||'—'}\n${new Date(s.timestamp).toLocaleString()}`).join('\n\n');
  const copy = async () => { await navigator.clipboard.writeText(text()); setNotice('Шаги скопированы в буфер обмена'); };
  const exportPackage = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setNotice('Подготавливаем изображения…');
    try {
      const exportedSteps = await Promise.all(steps.map(async (recordedStep, index) => {
        const { screenshot, ...stepData } = recordedStep;
        return {
          ...stepData,
          annotatedImage: screenshot ? await renderAnnotatedPng(screenshot, recordedStep.annotations) : undefined,
          number: index + 1,
        };
      }));
      const blob = new Blob([createHtmlReport(exportedSteps)], { type: 'text/html;charset=utf-8' });
      downloadBlob(blob, `repro-steps-${new Date().toISOString().slice(0, 10)}.html`);
      setNotice('HTML-отчёт подготовлен');
    } catch (error) {
      setNotice(`Не удалось экспортировать пакет: ${errorMessage(error)}`);
    } finally {
      setIsExporting(false);
    }
  };

  return <div className="recorder"><div className="recorder-head"><button className="back" onClick={onClose}><ChevronLeft/>Tools</button><div><b>Запись шагов</b><span>{steps.length} шагов</span></div><button className="primary" onClick={add} disabled={!stepsLoaded}><Plus/>Шаг</button></div>
    <div className="privacy"><EyeOff/><span><b>Перед отправкой проверьте персональные данные</b>Расширение не записывает ввод, пароли и содержимое полей. Описание добавляется только вами.</span></div>
    {!step ? <div className="recorder-empty"><Camera/><b>Начните запись воспроизведения</b><span>Добавьте шаг и при необходимости прикрепите снимок видимой части вкладки.</span><button className="primary" onClick={add} disabled={!stepsLoaded}><Plus/>Добавить первый шаг</button></div> : <>
      <div className="step-strip">{steps.map((s,i)=><button className={i===selected?'selected':''} onClick={()=>setSelected(i)} key={s.id}>{i+1}<span>{s.screenshot?'●':''}</span></button>)}</div>
      <textarea aria-label="Описание шага" placeholder="Опишите действие и ожидаемый результат…" value={step.description} onChange={e=>update({description:e.target.value})}/>
      <div className="step-meta"><span>{step.context.entityName||'Без сущности'} · {step.context.formName||'Без формы'}</span><time>{new Date(step.timestamp).toLocaleTimeString()}</time></div>
      {step.screenshot ? <><div className="annotate"><button className={tool==='arrow'?'on':''} onClick={()=>setTool('arrow')}>↗ Стрелка</button><button className={tool==='rectangle'?'on':''} onClick={()=>setTool('rectangle')}><Square/> Рамка</button><button className={tool==='redact'?'on':''} onClick={()=>setTool('redact')}><EyeOff/> Скрыть</button><button onClick={()=>update({annotations:step.annotations.slice(0,-1)})}><Undo2/></button></div><canvas ref={canvas} onPointerDown={e=>draft.current=point(e)} onPointerUp={endDraw}/></> : <button className="capture" onClick={capture}><Camera/>Прикрепить снимок видимой вкладки</button>}
      <div className="step-actions"><button onClick={()=>move(selected,selected-1)} disabled={!selected}><ArrowUp/></button><button onClick={()=>move(selected,selected+1)} disabled={selected===steps.length-1}><ArrowDown/></button><button className="danger" onClick={remove}><Trash2/>Удалить</button></div>
    </>}
    {!!steps.length&&<div className="export"><button onClick={copy}><Copy/>Копировать итог</button><button className="primary" onClick={exportPackage} disabled={isExporting}><Download/>{isExporting?'Подготовка…':'Экспорт для тикета'}</button></div>}{notice&&<div className="recorder-toast">{notice}</div>}
  </div>;
}

function draw(c: CanvasRenderingContext2D, a: Annotation) {
  c.save(); c.lineWidth=Math.max(4,c.canvas.width/300); c.strokeStyle='#ff3b5c'; c.fillStyle='#ff3b5c';
  if(a.kind==='redact'){c.fillStyle='#111827';c.fillRect(a.x1,a.y1,a.x2-a.x1,a.y2-a.y1)}
  else if(a.kind==='rectangle')c.strokeRect(a.x1,a.y1,a.x2-a.x1,a.y2-a.y1);
  else { c.beginPath();c.moveTo(a.x1,a.y1);c.lineTo(a.x2,a.y2);c.stroke();const angle=Math.atan2(a.y2-a.y1,a.x2-a.x1),size=22;c.beginPath();c.moveTo(a.x2,a.y2);c.lineTo(a.x2-size*Math.cos(angle-.5),a.y2-size*Math.sin(angle-.5));c.lineTo(a.x2-size*Math.cos(angle+.5),a.y2-size*Math.sin(angle+.5));c.closePath();c.fill(); } c.restore();
}

interface ExportedStep extends Omit<RecordedStep, 'screenshot'> {
  annotatedImage?: string;
  number: number;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('браузер не смог декодировать изображение'));
    image.src = source;
  });
}

async function renderAnnotatedPng(screenshot: string, annotations: Annotation[]): Promise<string> {
  const image = await loadImage(screenshot);
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = image.naturalWidth;
  exportCanvas.height = image.naturalHeight;
  const context = exportCanvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D недоступен');
  context.drawImage(image, 0, 0);
  annotations.forEach(annotation => draw(context, annotation));

  const blob = await new Promise<Blob>((resolve, reject) => {
    try {
      exportCanvas.toBlob(result => result ? resolve(result) : reject(new Error('canvas вернул пустой PNG')), 'image/png');
    } catch (error) {
      reject(error);
    }
  });
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('не удалось сериализовать PNG'));
    reader.onerror = () => reject(reader.error || new Error('не удалось прочитать PNG'));
    reader.readAsDataURL(blob);
  });
}

function createHtmlReport(steps: ExportedStep[]): string {
  const privacyNotice = 'Проверьте пакет на наличие персональных данных перед отправкой.';
  const metadata = JSON.stringify({
    version: 2,
    exportedAt: new Date().toISOString(),
    privacyNotice,
    steps: steps.map(({ annotatedImage: _annotatedImage, ...step }) => ({
      ...step,
      annotatedImage: _annotatedImage ? `step-${step.number}.png (embedded)` : undefined,
    })),
  }, null, 2).replaceAll('<', '\\u003c');
  const content = steps.map(step => `<article>
    <h2>Шаг ${step.number}</h2>
    <p>${escapeHtml(step.description || '(без описания)')}</p>
    <dl><dt>Страница</dt><dd>${escapeHtml(step.context.pageUrl || '—')}</dd><dt>Организация</dt><dd>${escapeHtml(step.context.orgName || '—')}</dd><dt>Сущность</dt><dd>${escapeHtml(step.context.entityName || '—')}</dd><dt>Запись</dt><dd>${escapeHtml(step.context.recordId || '—')}</dd><dt>Форма</dt><dd>${escapeHtml(step.context.formName || '—')}</dd><dt>Время</dt><dd>${escapeHtml(new Date(step.timestamp).toLocaleString())}</dd></dl>
    ${step.annotatedImage ? `<a href="${step.annotatedImage}" download="step-${step.number}.png"><img src="${step.annotatedImage}" alt="Аннотированный снимок шага ${step.number}"></a>` : '<p><i>Снимок не приложен.</i></p>'}
  </article>`).join('\n');

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Шаги воспроизведения</title><style>body{font:15px system-ui,sans-serif;max-width:1000px;margin:32px auto;padding:0 20px;color:#172033}header{border-bottom:2px solid #d9deea;margin-bottom:28px}.privacy{color:#9b2c2c}article{margin:0 0 40px;break-inside:avoid}dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 14px}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}img{display:block;max-width:100%;height:auto;margin-top:16px;border:1px solid #ccd3df}code{white-space:pre-wrap}</style></head><body><header><h1>Шаги воспроизведения</h1><p class="privacy">${escapeHtml(privacyNotice)}</p></header>${content}<details><summary>Структурированные данные для редактирования</summary><pre><code>${escapeHtml(metadata)}</code></pre></details><script type="application/json" id="repro-recorder-data">${metadata}</script></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
