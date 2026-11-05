import type { GridDetection, GridRegion } from '../types';
import { detectGrid } from './grid';
import { GridActivityTracker } from './grid-activity';

export function supportsCapture(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

export async function requestCapture(): Promise<MediaStream> {
  if (!supportsCapture()) throw new Error('Захват экрана недоступен. Откройте приложение в Chrome или Edge через HTTPS либо localhost.');
  const options: DisplayMediaStreamOptions & { systemAudio: string; windowAudio: string } = {
    video: { frameRate: { ideal: 10, max: 15 } }, audio: true,
    systemAudio: 'include', windowAudio: 'window',
  };
  return navigator.mediaDevices.getDisplayMedia(options);
}

export function describeCaptureError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Доступ к захвату не предоставлен. Нажмите «Подключить» и выберите окно игры.';
  if (name === 'NotFoundError') return 'Нет доступного окна для захвата.';
  if (name === 'NotReadableError') return 'Система не разрешила прочитать окно. Проверьте разрешение записи экрана для браузера.';
  if (name === 'InvalidStateError') return 'Начните захват кнопкой в активной вкладке.';
  return error instanceof Error ? error.message : 'Не удалось подключить захват экрана.';
}

export class GridScanner {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private region?: GridRegion;
  private enabled = true;
  private generation = 0;
  private activity = new GridActivityTracker();
  private detection?: GridDetection;
  private detectedAt = -Infinity;
  constructor(private options: { onDetection: (d: GridDetection) => void; onFrame?: (canvas: HTMLCanvasElement) => void; onViewChange?: (reason: 'changed' | 'lost') => void; onCellsChanged?: (ids: string[]) => void; onError?: (error: unknown) => void }) {}
  hasFreshDetection(): boolean { return this.enabled && !!this.detection && performance.now() - this.detectedAt <= 1000; }
  private observe(image: ImageData): void {
    if (!this.detection) return;
    const activity = this.activity.update(image, this.detection, performance.now());
    if (activity.changedView) this.options.onViewChange?.('changed');
    else if (activity.changedCells?.length) this.options.onCellsChanged?.(activity.changedCells);
  }
  /** Sample the actual video at audio onset, rather than trusting an old timer frame. */
  eventTarget(): string | undefined {
    if (!this.video || !this.canvas || this.video.readyState < 2) return;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    try {
      ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      this.observe(ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
      return this.activity.target(performance.now());
    } catch { this.activity.reset(); return; }
  }
  async start(stream: MediaStream, region?: GridRegion): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.region = region ? { ...region } : undefined;
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    this.video = video;
    this.canvas = document.createElement('canvas');
    try {
      await video.play();
    } catch (error) {
      // A cancelled old start must never dispose a newer session.
      if (generation !== this.generation) return;
      this.stop();
      throw error;
    }
    if (generation !== this.generation) return;
    let lastDetection = -Infinity;
    const tick = () => {
      if (generation !== this.generation || !this.canvas) return;
      try {
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        const canvas = this.canvas;
        const scale = Math.min(1, 960 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          this.options.onFrame?.(canvas);
          if (generation !== this.generation) return;
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          if (this.enabled && performance.now() - lastDetection >= 650) {
            lastDetection = performance.now();
            const detection = detectGrid(image, this.region);
            if (detection) { this.detection = detection; this.detectedAt = performance.now(); this.options.onDetection(detection); }
            else if (this.detection) { this.detection = undefined; this.activity.reset(); this.options.onViewChange?.('lost'); }
          }
          this.observe(image);
        }
      }
      } catch (error) {
        if (generation === this.generation) {
          this.stop();
          // An error consumer must not create an unhandled timer exception either.
          try { this.options.onError?.(error); } catch { /* scanner is already stopped */ }
        }
        return;
      }
      if (generation === this.generation) this.timer = setTimeout(tick, 120);
    };
    tick();
  }
  stop(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.video = null; this.canvas = null;
    this.detection = undefined; this.detectedAt = -Infinity; this.activity.reset();
  }
  setRegion(region: GridRegion): void {
    if (JSON.stringify(region) !== JSON.stringify(this.region)) { this.activity.reset(); this.detection = undefined; }
    this.region = { ...region };
  }
  setEnabled(enabled: boolean): void {
    if (this.enabled !== enabled) { this.activity.reset(); this.detection = undefined; }
    this.enabled = enabled;
  }
}
