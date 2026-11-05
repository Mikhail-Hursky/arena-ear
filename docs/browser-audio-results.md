# Browser audio verification

2026-10-23, existing installed Google Chrome in isolated headless process, localhost Vite server. Existing bundled Playwright was used; no dependency installation or permission changes. Shared MCP browser could not be acquired because its profile was in use; it was left untouched.

Reproduction: `PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser-audio.mjs`. The dev server must already run at http://127.0.0.1:5173. `tests/browser-audio-qa.js` additionally contains a callable async(page) function for execution through a browser runner on that origin.

Passed actual browser checks:

- Decode labeled 440 Hz and 1000 Hz WAV reference files; identify 440 Hz file as its rare label (similarity 1).
- Decode silence and return unknown with similarity 0.
- Start an AudioWorklet receiving a real MediaStreamAudioDestinationNode connected to a 440 Hz OscillatorNode.
- Receive 30 level callbacks, a nonzero level, one automatic onset result and one clip callback.
- Record 500 ms of stream PCM into a 48,044-byte WAV; decode and identify it as 440 Hz (similarity approximately 0.9991).
- Automatic onset window identifies 440 Hz (similarity approximately 0.9998).
- Stop rejects a pending recording, stops further callbacks, and leaves caller-owned stream tracks alive.
- Reject start with an empty MediaStream.
- Explicitly disconnect/stop test sources, close contexts and close the isolated browser.

These checks verify actual browser decoding, audio graph processing, matching and lifecycle on synthetic signals. They do not verify operating-system screen/audio capture permissions, supported sharing sources, or Arena game-item recognition accuracy. Similarities are descriptor scores, not probabilities. No proprietary game samples or model were available.
