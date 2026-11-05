async (page) => {
  await page.goto('http://127.0.0.1:5173');
  return await page.evaluate(async () => {
    const { GridScanner } = await import('/src/lib/capture.ts');
    const { detectGrid } = await import('/src/lib/grid.ts');
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    const context = canvas.getContext('2d');
    assert(context, 'Canvas 2D context is available');
    const paint = (merged = false) => {
      context.fillStyle = '#141414';
      context.fillRect(0, 0, 300, 300);
      context.strokeStyle = '#c8c8c8';
      context.lineWidth = 2;
      context.beginPath();
      for (let i = 0; i <= 4; i++) {
        const coordinate = 30 + i * 60;
        context.moveTo(coordinate, 30); context.lineTo(coordinate, 270);
        context.moveTo(30, coordinate); context.lineTo(270, coordinate);
      }
      context.stroke();
      if (merged) {
        // Remove the separator between the first two slots, retaining outer borders.
        context.fillStyle = '#141414';
        context.fillRect(87, 34, 6, 52);
      }
    };
    const waitUntil = async (predicate, label, timeout = 6000) => {
      const deadline = performance.now() + timeout;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error(`Timeout: ${label}`);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    };
    let stream;
    let scanner;
    let startTimeout;
    let frameCount = 0;
    const detections = [];
    const errors = [];
    try {
      paint();
      const direct = detectGrid(context.getImageData(0, 0, 300, 300));
      assert(direct?.columns === 4 && direct?.rows === 4 && direct.cells.length === 16,
        'Real browser ImageData regular grid must be 4×4');
      paint(true);
      const irregular = detectGrid(context.getImageData(0, 0, 300, 300));
      assert(irregular?.cells.length === 15 && irregular.cells.some(cell => cell.row === 0 && cell.col === 0 && cell.width === 2 && cell.height === 1),
        'Real browser ImageData merged rectangle must occupy two unit slots');
      stream = canvas.captureStream(10);
      assert(stream.getVideoTracks().length === 1, 'Canvas captureStream provides a real video track');
      scanner = new GridScanner({
        onFrame: frame => {
          assert(frame instanceof HTMLCanvasElement && frame.width === 300 && frame.height === 300,
            'Scanner emits the actual video canvas');
          frameCount++;
        },
        onDetection: detection => detections.push(detection),
        onError: error => errors.push(String(error)),
      });
      const pendingStart = scanner.start(stream);
      // Canvas capture is change-driven in some browsers. Repaint to guarantee frames
      // while the detached scanner video is waiting for its first frame.
      const repaint = setInterval(() => paint(true), 80);
      try {
        await Promise.race([
          pendingStart,
          new Promise((_, reject) => { startTimeout = setTimeout(() => reject(new Error('Scanner start timed out')), 6000); }),
        ]);
        clearTimeout(startTimeout);
        await waitUntil(() => detections.some(d => d.cells.length === 15), 'real video merged-grid detection');
        assert(errors.length === 0, `Scanner reported errors: ${errors.join(', ')}`);
        scanner.setEnabled(false);
        const pausedDetectionCount = detections.length;
        const pausedFrameCount = frameCount;
        await waitUntil(() => frameCount > pausedFrameCount, 'preview continues while auto detection disabled');
        assert(detections.length === pausedDetectionCount, 'setEnabled(false) prevents new detections');
        scanner.setEnabled(true);
        scanner.setRegion({ x: .05, y: .05, width: .9, height: .9 });
        await waitUntil(() => detections.length > pausedDetectionCount, 'detection resumes with a cropped region');
        scanner.stop();
        const stoppedFrames = frameCount;
        const stoppedDetections = detections.length;
        await new Promise(resolve => setTimeout(resolve, 850));
        assert(frameCount === stoppedFrames && detections.length === stoppedDetections,
          'stop() prevents all further callbacks');
        assert(stream.getVideoTracks()[0].readyState === 'live', 'Scanner stop preserves caller-owned stream');
      } finally {
        clearInterval(repaint);
      }
      return {
        passed: true,
        realImageData: true,
        realCanvasVideoStream: true,
        regularCells: direct.cells.length,
        mergedCells: irregular.cells.length,
        scannerDetections: detections.length,
        scannerFrames: frameCount,
        disabledDetectionPausesWhilePreviewContinues: true,
        stoppedCallbacks: true,
        callerOwnsTracks: true,
        errors,
      };
    } finally {
      clearTimeout(startTimeout);
      scanner?.stop();
      stream?.getTracks().forEach(track => track.stop());
      canvas.remove();
    }
  });
}
