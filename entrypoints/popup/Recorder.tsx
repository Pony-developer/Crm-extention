import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, ChevronLeft, Copy, Download, EyeOff, Plus, Square, Trash2, Undo2 } from 'lucide-react';
import type { Annotation, CrmContext, RecordedStep, ToolMessage } from '../../shared/types';

type Tool = Annotation['kind'];
const STORAGE_KEY = 'reproRecorderSteps';

export function Recorder({ context, onClose }: { context: CrmContext; onClose: () => void }) {
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [selected, setSelected] = useState(0);
  const [tool, setTool] = useState<Tool>('arrow');
  const [notice, setNotice] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const draft = useRef<{ x: number; y: number } | undefined>(undefined);
  const step = steps[selected];

  useEffect(() => { browser.storage.local.get(STORAGE_KEY).then(v => setSteps((v[STORAGE_KEY] as RecordedStep[]) || [])); }, []);
  useEffect(() => { void browser.storage.local.set({ [STORAGE_KEY]: steps }); }, [steps]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !step?.screenshot) return;
    const image = new Image();
    image.onload = () => { el.width = image.width; el.height = image.height; const c = el.getContext('2d')!; c.drawImage(image, 0, 0); step.annotations.forEach(a => draw(c, a)); };
    image.src = step.screenshot;
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
  const exportPackage = () => { const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),privacyNotice:'Проверьте пакет на наличие персональных данных перед отправкой.',steps},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`repro-steps-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href); };

  return <div className="recorder"><div className="recorder-head"><button className="back" onClick={onClose}><ChevronLeft/>Tools</button><div><b>Запись шагов</b><span>{steps.length} шагов</span></div><button className="primary" onClick={add}><Plus/>Шаг</button></div>
    <div className="privacy"><EyeOff/><span><b>Перед отправкой проверьте персональные данные</b>Расширение не записывает ввод, пароли и содержимое полей. Описание добавляется только вами.</span></div>
    {!step ? <div className="recorder-empty"><Camera/><b>Начните запись воспроизведения</b><span>Добавьте шаг и при необходимости прикрепите снимок видимой части вкладки.</span><button className="primary" onClick={add}><Plus/>Добавить первый шаг</button></div> : <>
      <div className="step-strip">{steps.map((s,i)=><button className={i===selected?'selected':''} onClick={()=>setSelected(i)} key={s.id}>{i+1}<span>{s.screenshot?'●':''}</span></button>)}</div>
      <textarea aria-label="Описание шага" placeholder="Опишите действие и ожидаемый результат…" value={step.description} onChange={e=>update({description:e.target.value})}/>
      <div className="step-meta"><span>{step.context.entityName||'Без сущности'} · {step.context.formName||'Без формы'}</span><time>{new Date(step.timestamp).toLocaleTimeString()}</time></div>
      {step.screenshot ? <><div className="annotate"><button className={tool==='arrow'?'on':''} onClick={()=>setTool('arrow')}>↗ Стрелка</button><button className={tool==='rectangle'?'on':''} onClick={()=>setTool('rectangle')}><Square/> Рамка</button><button className={tool==='redact'?'on':''} onClick={()=>setTool('redact')}><EyeOff/> Скрыть</button><button onClick={()=>update({annotations:step.annotations.slice(0,-1)})}><Undo2/></button></div><canvas ref={canvas} onPointerDown={e=>draft.current=point(e)} onPointerUp={endDraw}/></> : <button className="capture" onClick={capture}><Camera/>Прикрепить снимок видимой вкладки</button>}
      <div className="step-actions"><button onClick={()=>move(selected,selected-1)} disabled={!selected}><ArrowUp/></button><button onClick={()=>move(selected,selected+1)} disabled={selected===steps.length-1}><ArrowDown/></button><button className="danger" onClick={remove}><Trash2/>Удалить</button></div>
    </>}
    {!!steps.length&&<div className="export"><button onClick={copy}><Copy/>Копировать итог</button><button className="primary" onClick={exportPackage}><Download/>Экспорт для тикета</button></div>}{notice&&<div className="recorder-toast">{notice}</div>}
  </div>;
}

function draw(c: CanvasRenderingContext2D, a: Annotation) {
  c.save(); c.lineWidth=Math.max(4,c.canvas.width/300); c.strokeStyle='#ff3b5c'; c.fillStyle='#ff3b5c';
  if(a.kind==='redact'){c.fillStyle='#111827';c.fillRect(a.x1,a.y1,a.x2-a.x1,a.y2-a.y1)}
  else if(a.kind==='rectangle')c.strokeRect(a.x1,a.y1,a.x2-a.x1,a.y2-a.y1);
  else { c.beginPath();c.moveTo(a.x1,a.y1);c.lineTo(a.x2,a.y2);c.stroke();const angle=Math.atan2(a.y2-a.y1,a.x2-a.x1),size=22;c.beginPath();c.moveTo(a.x2,a.y2);c.lineTo(a.x2-size*Math.cos(angle-.5),a.y2-size*Math.sin(angle-.5));c.lineTo(a.x2-size*Math.cos(angle+.5),a.y2-size*Math.sin(angle+.5));c.closePath();c.fill(); } c.restore();
}
