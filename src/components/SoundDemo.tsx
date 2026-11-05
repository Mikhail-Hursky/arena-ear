import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Backpack, Box, CircleStop, Grip, Headphones, MousePointer2, RotateCcw, Search, Volume2, VolumeX, X } from 'lucide-react';
import { BUILTIN_GROUPS, BUILTIN_ITEMS } from '../lib/builtin-sounds';
import type { SoundAction } from '../types';
import './SoundDemo.css';

type Item = typeof BUILTIN_ITEMS[number];
type Place = 'merchant' | 'bag';
type Entry = { uid: number; itemId: number; place: Place; slot: number };
type Drag = { uid: number; pointerId?: number; x: number; y: number };
const groupById = new Map(BUILTIN_GROUPS.map(group => [group.id, group]));
const itemById = new Map(BUILTIN_ITEMS.map(item => [item.id, item]));
const SHOWCASE_GROUPS = [28, 32, 30, 33, 14, 36, 6, 18, 22, 10, 1, 2];
const initialEntries = (): Entry[] => SHOWCASE_GROUPS.flatMap((id, slot) => {
  const group = groupById.get(id);
  const item = group?.candidates.find(candidate => candidate.rarity === 'red') ?? group?.candidates[0];
  return item ? [{ uid: slot + 1, itemId: item.id, place: 'merchant' as Place, slot }] : [];
});
const rarityName = { common: 'Обычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный', red: 'Красный' };

export default function SoundDemo() {
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [activeId, setActiveId] = useState<number>(() => initialEntries()[0]?.itemId ?? BUILTIN_ITEMS[0]?.id);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const uid = useRef(100);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [volume, setVolume] = useState(.75);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState('Выберите предмет и послушайте его настоящий звук.');
  const [playing, setPlaying] = useState<{ itemId: number; action: SoundAction } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackId = useRef(0);
  const captureRef = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  const activeItem = itemById.get(activeId) ?? BUILTIN_ITEMS[0];
  const activeGroup = groupById.get(activeItem.groupId)!;
  const draggedEntry = drag ? entries.find(entry => entry.uid === drag.uid) : undefined;
  const draggedItem = draggedEntry ? itemById.get(draggedEntry.itemId) : undefined;
  const filteredItems = BUILTIN_ITEMS.filter(item => (groupFilter === 'all' || item.groupId === Number(groupFilter)) && item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  function stopAudio(update = true) {
    playbackId.current++;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      audioRef.current = null;
    }
    if (update) { setPlaying(null); setLoading(false); }
  }
  function play(item: Item, action: SoundAction) {
    setActiveId(item.id);
    stopAudio(); setError('');
    const group = groupById.get(item.groupId);
    if (!group) return;
    const audio = new Audio(action === 'pickup' ? group.pickupUrl : group.dropUrl);
    audio.preload = 'auto'; audio.volume = volume; audio.muted = muted;
    audioRef.current = audio;
    const id = playbackId.current;
    const current = () => mounted.current && playbackId.current === id;
    setPlaying({ itemId: item.id, action }); setLoading(true);
    setStatus(`${item.name} · группа ${item.groupId} · ${action === 'pickup' ? 'поднять' : 'положить'}`);
    audio.onplaying = () => { if (current()) setLoading(false); };
    audio.onended = () => { if (current()) { setPlaying(null); setLoading(false); } };
    const fail = () => {
      if (!current()) return;
      setError('Не удалось воспроизвести запись. Попробуйте ещё раз: браузеру может потребоваться разрешение на звук.');
      setPlaying(null); setLoading(false);
    };
    audio.onerror = fail;
    void audio.play().catch(fail);
  }
  useEffect(() => {
    if (audioRef.current) { audioRef.current.volume = volume; audioRef.current.muted = muted; }
  }, [volume, muted]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; const held = dragRef.current; if (held?.pointerId !== undefined && captureRef.current?.hasPointerCapture(held.pointerId)) captureRef.current.releasePointerCapture(held.pointerId); playbackId.current++; const audio = audioRef.current; if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } };
  }, []);
  function clearDrag() {
    const old = dragRef.current;
    dragRef.current = null; setDrag(null); setHoverTarget(null);
    if (old?.pointerId !== undefined && captureRef.current?.hasPointerCapture(old.pointerId)) captureRef.current.releasePointerCapture(old.pointerId);
    captureRef.current = null;
  }
  function cancelDrag() {
    if (!dragRef.current) return;
    clearDrag(); setStatus('Перенос отменён. Предмет остался на своём месте.');
  }
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && dragRef.current) { event.preventDefault(); cancelDrag(); } };
    const blur = () => cancelDrag();
    window.addEventListener('keydown', escape); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('blur', blur); };
  }, []);
  function drop(place: Place, slot: number) {
    const current = dragRef.current;
    if (!current) return;
    const moving = entries.find(entry => entry.uid === current.uid);
    if (!moving) { clearDrag(); return; }
    const item = itemById.get(moving.itemId)!;
    setEntries(previous => {
      const occupied = previous.find(entry => entry.place === place && entry.slot === slot && entry.uid !== moving.uid);
      return previous.map(entry => entry.uid === moving.uid ? { ...entry, place, slot }
        : entry.uid === occupied?.uid ? { ...entry, place: moving.place, slot: moving.slot } : entry);
    });
    clearDrag(); play(item, 'drop');
  }
  function beginPointer(event: PointerEvent<HTMLButtonElement>, entry: Entry) {
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    const next = { uid: entry.uid, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    dragRef.current = next; setDrag(next);
    captureRef.current = event.currentTarget;
    event.currentTarget.setPointerCapture(event.pointerId);
    play(itemById.get(entry.itemId)!, 'pickup');
  }
  function movePointer(event: PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const next = { ...dragRef.current, x: event.clientX, y: event.clientY };
    dragRef.current = next; setDrag(next);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-demo-target]');
    setHoverTarget(target ? `${target.dataset.demoPlace}-${target.dataset.demoSlot}` : null);
  }
  function endPointer(event: PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-demo-target]');
    if (target) drop(target.dataset.demoPlace as Place, Number(target.dataset.demoSlot));
    else cancelDrag();
  }
  function keyTile(event: KeyboardEvent<HTMLButtonElement>, entry: Entry) {
    if (event.key === ' ' && !dragRef.current) {
      event.preventDefault(); const next = { uid: entry.uid, x: 0, y: 0 };
      dragRef.current = next; setDrag(next); play(itemById.get(entry.itemId)!, 'pickup');
    } else if (event.key === 'Enter' && dragRef.current?.pointerId === undefined && dragRef.current) {
      event.preventDefault(); drop(entry.place, entry.slot);
    }
  }
  function addItem(item: Item) {
    cancelDrag(); setActiveId(item.id);
    const existing = entries.find(entry => entry.itemId === item.id);
    if (existing) { setStatus(`${item.name} уже на поле · ${existing.place === 'bag' ? 'рюкзак' : 'торговец'}, ячейка ${existing.slot + 1}.`); return; }
    const free = Array.from({ length: 18 }, (_, i) => i).find(slot => !entries.some(entry => entry.place === 'merchant' && entry.slot === slot));
    if (free === undefined) { setStatus('Поле заполнено. Уберите предмет кнопкой × или перенесите его в рюкзак.'); return; }
    setEntries(previous => [...previous, { uid: ++uid.current, itemId: item.id, place: 'merchant', slot: free }]);
    setStatus(`${item.name} добавлен на поле. Перенесите его, чтобы послушать.`);
  }
  function renderSlot(place: Place, slot: number) {
    const entry = entries.find(candidate => candidate.place === place && candidate.slot === slot);
    const item = entry ? itemById.get(entry.itemId) : undefined;
    return <div key={slot} data-demo-target data-demo-place={place} data-demo-slot={slot}
      className={`sound-demo-slot ${drag ? 'can-drop' : ''} ${entry?.uid === drag?.uid ? 'is-moving' : ''} ${item?.id === activeId ? 'is-active' : ''} ${hoverTarget === `${place}-${slot}` ? 'is-drop-target' : ''}`}>
      {entry && item ? <article className={`sound-demo-item rarity-${item.rarity}`}>
        <button className="sound-demo-grab" aria-label={`${item.name}, ${item.size.join(' × ')}, группа ${item.groupId}. Пробел — поднять, Enter — положить.`}
          aria-pressed={entry.uid === drag?.uid} onFocus={() => setActiveId(item.id)}
          onPointerDown={event => beginPointer(event, entry)} onPointerMove={movePointer} onPointerUp={endPointer}
          onPointerCancel={cancelDrag} onLostPointerCapture={() => { if (dragRef.current?.uid === entry.uid) cancelDrag(); }} onKeyDown={event => keyTile(event, entry)}>
          <span className="sound-demo-slot-number">{String(slot + 1).padStart(2, '0')}</span><Grip size={12} className="sound-demo-grip" />
          <Box className="sound-demo-item-icon" size={27} strokeWidth={1.3} /><strong>{item.name}</strong>
          <span className="sound-demo-item-meta">{item.size.join('×')} <span>G{String(item.groupId).padStart(2, '0')}</span></span>
        </button>
        <div className="sound-demo-tile-actions">
          <button aria-label={`Поднять ${item.name}`} title="Послушать: поднять" onClick={() => play(item, 'pickup')}><ArrowUpFromLine size={12} /></button>
          <button aria-label={`Положить ${item.name}`} title="Послушать: положить" onClick={() => play(item, 'drop')}><ArrowDownToLine size={12} /></button>
          <button aria-label={`Убрать ${item.name} с поля`} title="Убрать с поля" onClick={() => { if (dragRef.current?.uid === entry.uid) cancelDrag(); setEntries(previous => previous.filter(candidate => candidate.uid !== entry.uid)); }}><X size={12} /></button>
        </div>
      </article> : <button className="sound-demo-empty" aria-label={`${place === 'bag' ? 'Рюкзак' : 'Торговец'}, пустая ячейка ${slot + 1}${drag ? ', Enter — положить' : ''}`}
        onClick={() => { if (dragRef.current && dragRef.current.pointerId === undefined) drop(place, slot); }}>
        <span>{String(slot + 1).padStart(2, '0')}</span><span>{drag ? 'Положить сюда' : 'Свободно'}</span>
      </button>}
    </div>;
  }

  return <div className="sound-demo">
    <header className="sound-demo-heading"><div><span className="sound-demo-eyebrow"><Headphones size={14} /> ИНТЕРАКТИВНОЕ ДЕМО</span><h1>Звуковая песочница</h1><p>Поднимайте и перекладывайте предметы. Слушайте реальные записи торговца.</p></div>
      <span className="sound-demo-recordings">{BUILTIN_GROUPS.length * 2} OGG <span>оригинальные записи</span></span></header>
    <div className="sound-demo-toolbar"><p><MousePointer2 size={16} /><span>Зажмите предмет → перенесите → отпустите в ячейке. Занятые ячейки меняются местами.</span></p><button onClick={() => { cancelDrag(); stopAudio(); setEntries(initialEntries()); setStatus('Поле восстановлено.'); }}><RotateCcw size={14} /> Сбросить поле</button></div>
    <div className="sound-demo-layout"><section className="sound-demo-playground" aria-label="Игровое поле для прослушивания">
      <div className="sound-demo-panel-heading"><div><span className="sound-demo-dot" /><h2>Сетка торговца</h2></div><span>{entries.filter(entry => entry.place === 'merchant').length} / 18</span></div>
      <div className="sound-demo-board">{Array.from({ length: 18 }, (_, slot) => renderSlot('merchant', slot))}</div>
      <div className="sound-demo-panel-heading sound-demo-backpack-title"><div><Backpack size={16} /><h2>Ваш рюкзак</h2></div><span>{entries.filter(entry => entry.place === 'bag').length} / 6</span></div>
      <div className="sound-demo-bag">{Array.from({ length: 6 }, (_, slot) => renderSlot('bag', slot))}</div>
      <p className="sound-demo-keyboard">Клавиатура: Пробел — поднять · Tab — выбрать ячейку · Enter — положить · Esc — отменить</p>
    </section>
    <aside className="sound-demo-inspector" aria-label="Текущий предмет и звук"><span className="sound-demo-eyebrow">В ФОКУСЕ</span><div className={`sound-demo-focus-icon rarity-${activeItem.rarity}`}><Box size={48} strokeWidth={1} /></div>
      <h2>{activeItem.name}</h2><div className="sound-demo-focus-meta"><span className={`rarity-${activeItem.rarity}`}>{rarityName[activeItem.rarity]}</span><span>{activeItem.size.join(' × ')} яч.</span></div>
      <div className="sound-demo-audition"><button onClick={() => play(activeItem, 'pickup')}><ArrowUpFromLine size={16} /> Поднять</button><button onClick={() => play(activeItem, 'drop')}><ArrowDownToLine size={16} /> Положить</button></div>
      <div className="sound-demo-volume"><button aria-label={muted ? 'Включить звук' : 'Выключить звук'} aria-pressed={muted} onClick={() => setMuted(value => !value)}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><input aria-label="Громкость записей" type="range" min="0" max="1" step=".01" value={volume} onChange={event => setVolume(Number(event.target.value))} /><span>{muted ? 'MUTE' : `${Math.round(volume * 100)}%`}</span><button aria-label="Остановить воспроизведение" onClick={() => { stopAudio(); setStatus('Воспроизведение остановлено.'); }}><CircleStop size={18} /></button></div>
      <div className="sound-demo-play-status" role="status" aria-live="polite"><span className={playing ? 'sound-demo-dot playing' : 'sound-demo-dot'} />{loading ? 'Загружаем запись…' : playing ? `${playing.action === 'pickup' ? 'Поднять' : 'Положить'} · воспроизведение` : 'Готово к прослушиванию'}</div>
      {error && <p className="sound-demo-error" role="alert">{error}</p>}
      <div className="sound-demo-candidates"><h3>Один звук · группа {activeGroup.id}</h3><p>Эти предметы звучат одинаково. Звук определяет группу, а не точный предмет.</p><ul>{activeGroup.candidates.map(item => <li key={item.id}><span className={`sound-demo-rarity-dot rarity-${item.rarity}`} /><button onClick={() => setActiveId(item.id)}>{item.name}</button><span>{item.size.join('×')}</span></li>)}</ul></div>
    </aside></div>
    <p className="sound-demo-announcement" role="status" aria-live="polite">{status}</p>
    <section className="sound-demo-library" aria-label="Каталог предметов"><div className="sound-demo-library-top"><div><span className="sound-demo-eyebrow">РАСШИРЬТЕ ПОЛЕ</span><h2>Все предметы <span>{BUILTIN_ITEMS.length}</span></h2></div><div className="sound-demo-filters"><label className="sound-demo-search"><Search size={16} /><input aria-label="Поиск предмета" placeholder="Найти предмет…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Звуковая группа" value={groupFilter} onChange={event => setGroupFilter(event.target.value)}><option value="all">Все {BUILTIN_GROUPS.length} групп</option>{BUILTIN_GROUPS.map(group => <option key={group.id} value={group.id}>Группа {group.id} · {group.candidates[0]?.name}</option>)}</select></div></div>
      <div className="sound-demo-catalog">{filteredItems.map(item => <button key={`${item.groupId}-${item.id}`} onClick={() => addItem(item)} className={`sound-demo-catalog-item ${activeId === item.id ? 'selected' : ''}`}><span className={`sound-demo-rarity-dot rarity-${item.rarity}`} /><span><strong>{item.name}</strong><small>Группа {item.groupId} · {item.size.join('×')}</small></span><span className="sound-demo-add">{entries.some(entry => entry.itemId === item.id) ? 'На поле' : '+ На поле'}</span></button>)}</div>
      {!filteredItems.length && <p className="sound-demo-no-results">Предметы не найдены. Измените запрос или группу.</p>}
    </section>
    <footer className="sound-demo-footer">Записи проигрываются локально в браузере. Это прослушивание библиотеки, а не результат распознавания.</footer>
    {draggedItem && drag?.pointerId !== undefined && <div className={`sound-demo-ghost rarity-${draggedItem.rarity}`} style={{ left: Math.max(6, Math.min(drag.x + 14, window.innerWidth - 230)), top: Math.max(6, Math.min(drag.y + 14, window.innerHeight - 60)) }}><Box size={25} /><strong>{draggedItem.name}</strong><span>G{draggedItem.groupId} · {draggedItem.size.join('×')}</span></div>}
  </div>;
}
