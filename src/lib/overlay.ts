interface DocumentPiP { requestWindow(options: { width: number; height: number }): Promise<Window> }
export async function openOverlay(): Promise<{ window: Window; close: () => void }> {
  const api = (window as Window & { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;
  // Both paths must be invoked from a click to retain transient activation.
  const target = api
    ? await api.requestWindow({ width: 420, height: 620 })
    : window.open('', 'arena-ear-overlay', 'popup,width=420,height=620');
  if (!target) throw new Error('Браузер заблокировал окно. Разрешите всплывающие окна для этого сайта.');
  target.document.documentElement.lang = document.documentElement.lang;
  target.document.head.replaceChildren();
  target.document.title = 'Arena Ear — помощник';
  const base = target.document.createElement('base'); base.href = document.baseURI;
  target.document.head.append(base);
  for (const element of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    target.document.head.append(element.cloneNode(true));
  }
  target.document.body.replaceChildren();
  target.document.body.className = 'overlay-body';
  return { window: target, close: () => target.close() };
}
