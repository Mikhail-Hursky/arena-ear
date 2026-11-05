# Local audio engine

All processing stays in the browser. This is a reference matcher, not a trained Arena Breakout item model. It includes 76 merchant recordings grouped into 38 sound families with 189 candidate items, available synchronously as `BUILTIN_REFERENCES` from the bundled descriptor manifest; `loadBuiltinReferences()` remains a Promise-compatible accessor without fetch or decoding. A group match returns `groupId`, `action` and `candidates`, with no group-level rarity or red-item probability. Personal references retain their user-assigned rarity. Similarity is a descriptor score, not confidence or probability.

## API

`AudioEngine({onEventStart?, onLevel?, onResult?, onClip?})`: `start(stream)` requires a live enabled audio track and rejects with a helpful error otherwise. `onEventStart()` fires synchronously once when a new onset burst initializes, before adding the triggering chunk, and never during an existing burst or cooldown; callers can snapshot the selected cell there. `onResult()` arrives after the sound and its quiet tail (at most 1.7 seconds). `stop()` disconnects the processing graph, closes its AudioContext and rejects outstanding recordings. It leaves supplied stream tracks owned by the caller. `setReferences(SoundReference[])`, `setSensitivity(0..100)`, and `setThreshold(0..1)` update live detection. `captureSample(durationMs = 1000)` records actual future PCM from the connected source and returns a mono PCM16 WAV (100 ms to 10 seconds). Recording times out if audio delivery stops.

`createReference(blob, name, rarity)` decodes a browser-supported recording, extracts serializable features and returns a reference. Files over 20 MiB or decoded durations over 15 seconds, empty names, names over 120 characters, invalid rarity values, silence and clips shorter than 25 ms are rejected. Browser decoding occurs before the duration check, so compressed files still consume browser decoder resources. `analyzeFile(blob, references, threshold = 0.88)` runs the same pipeline on a supplied recording. Decoding errors propagate to the UI.

Exported pure helpers: `rms`, `extractFeatures`, `featureSimilarity`, `classifyFeatures`, `encodeWav`. Exported schema constants: `FEATURE_LENGTH = 56`, `FEATURE_VERSION = 1`. Similarity validates descriptor bounds and independently normalizes each group; zero, negative, nonfinite and out-of-range imported descriptors are rejected.

## Detection

An AudioWorklet collects mono audio, with output muted to prevent feedback. Energy onset detection uses an adaptive noise floor, adjustable minimum level, an approximately 80 ms pre-roll, a minimum 150 ms event window, a 180 ms quiet tail and a 1.7 second maximum event window. After completion it requires a quiet tail and a minimum 120 ms cooldown before rearming. At sensitivity 50 the minimum onset RMS is 0.0035; an adaptive noise floor can raise that threshold. Sustained sounds are not repeatedly classified. Continuous music or loud speech may hide or trigger onsets. A user can analyze an isolated file regardless of onset detection.

Version 1 descriptors average source samples into 8 kHz audio, trim quiet margins, extract 40 logarithmic FFT bands and a 16-step energy envelope, and normalize each feature group. Similarity weights spectrum 90% and envelope 10%. Different above-threshold groups or personal labels with scores within 0.025 are retained as alternatives; audio alone remains unknown, and `resolveItemMatch()` can use trusted item dimensions to remove incompatible groups; pickup/drop variants of the same group do not compete with one another. No references, silence and low similarity also return unknown.

References should contain isolated merchant drag sounds with consistent clip lengths, recorded using the same audio settings as live use. Multiple examples of each item can help cover variation. Mixing background music, effects, speech or several items reduces reliability. The simple averaging resampler has limited alias rejection; the descriptor loses phase and fine temporal detail. Similar-sounding items can remain indistinguishable. Synthetic tone tests establish pipeline behavior, not recognition accuracy on game recordings.

Browser use requires secure context (HTTPS or localhost), AudioWorklet, Web Audio decoding support and permission to capture shared audio. Screen capture audio availability depends on browser, operating system and source selection. The caller must handle ended stream tracks and communicate absent audio. There is no server upload or proprietary model dependency.

## Sound + item dimensions

See [recognition.md](recognition.md) for exact size filtering, rotation, catalog ambiguity, synchronous built-ins, onset snapshots and visual cell association. No audio similarity score is converted to an item probability.
