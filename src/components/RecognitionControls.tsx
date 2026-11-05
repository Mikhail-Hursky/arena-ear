import { useEffect, useState } from 'react';
import type { GridCell, GridDetection, ItemSizeEvidence } from '../types';

export function RecognitionControls({ grid, cell, confirmed, autoAssociate, onAutoAssociate, onConfirm, onClear }: {
  grid: GridDetection | null; cell?: GridCell; confirmed?: ItemSizeEvidence;
  autoAssociate: boolean;
  onAutoAssociate: (value: boolean) => void; onConfirm: (size: ItemSizeEvidence) => void; onClear: () => void;
}) {
  const [width, setWidth] = useState(''), [height, setHeight] = useState('');
  useEffect(() => {
    setWidth(confirmed ? String(confirmed.width) : cell && grid?.source === 'detected' ? String(cell.width) : '');
    setHeight(confirmed ? String(confirmed.height) : cell && grid?.source === 'detected' ? String(cell.height) : '');
  }, [cell?.id, cell?.width, cell?.height, grid?.source, confirmed?.width, confirmed?.height]);
  const valid = [width, height].every(value => value !== '' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 20);
  return <section className="recognition-controls" aria-label="Распознавание по звуку и размеру">
    <div className="recognition-options">
      <label><input type="checkbox" checked={autoAssociate} onChange={e => onAutoAssociate(e.target.checked)} /> Автовыбор по изменению кадра</label>
    </div>
    <p>Звук + ширина × высота. Ориентация в магазине фиксирована. {cell ? `Выбрана ${cell.id}.` : 'Выберите груз в сетке или на превью для проверки размера.'}</p>
    {cell && <>
      <div className="item-size-inputs">
        <label>Ширина<input aria-label="Ширина предмета" type="number" min="1" max="20" value={width} onChange={e => setWidth(e.target.value)} /></label>
        <span>×</span>
        <label>Высота<input aria-label="Высота предмета" type="number" min="1" max="20" value={height} onChange={e => setHeight(e.target.value)} /></label>
        <button className="secondary" disabled={!valid} onClick={() => onConfirm({ width:Number(width), height:Number(height), source:'manual' })}>Подтвердить размер</button>
        {confirmed && <button className="text-button" onClick={onClear}>Размер из сетки</button>}
      </div>
      <p className="muted">{confirmed ? 'Размер подтверждён вручную.' : grid?.source === 'detected'
        ? `Размер по кадру: ${cell.width} × ${cell.height}. ${grid.confidence < .75 ? 'Границы неуверенные — подтвердите размер.' : 'Проверьте, что рамка охватывает весь груз.'}`
        : 'Ручная сетка — только выбор позиции. Укажите настоящий размер груза.'}</p>
    </>}
  </section>;
}
