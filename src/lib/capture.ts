import type { GridDetection, GridRegion } from '../types';
import { detectGrid } from './grid';

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
  constructor(private options: { onDetection: (d: GridDetection) => void; onFrame?: (canvas: HTMLCanvasElement) => void; onError?: (error: unknown) => void }) {}
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
          if (this.enabled) {
            const detection = detectGrid(ctx.getImageData(0, 0, canvas.width, canvas.height), this.region);
            if (detection) this.options.onDetection(detection);
          }
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
      if (generation === this.generation) this.timer = setTimeout(tick, 700);
    };
    tick();
  }
  stop(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.video = null; this.canvas = null;
  }
  setRegion(region: GridRegion): void { this.region = { ...region }; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; }
}
