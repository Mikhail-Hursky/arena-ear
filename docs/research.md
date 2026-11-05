# Public reference research

Reference inspected: https://abiear.ru/ (Merchant Ear). Research used public pages, publicly linked assets, public Telegram posts, and the public instruction video. Protected application pages were not accessed, and no access key was obtained.

## Verified behavior

- Landing page is an RU/EN access-key gate. Keys have PAID-XXXX-XXXX-XXXX format and are remembered by browser session; invalid, rate-limit, and occupied-device states are supported.
- Public access links: a three-hour trial through https://t.me/abiear_bot?start=site and purchase through https://funpay.com/lots/offer?id=79629825 . No purchase or bot interaction was performed.
- The FunPay description identifies Arena Breakout: Infinite on PC. The user approaches the merchant, starts the browser utility, and drags a merchant cell to trigger its sound. The utility analyzes system audio and displays a prediction in a widget. Seller describes access until season end and browser-bound keys. These are seller claims, not independently validated recognition results.
- https://t.me/s/abiear publicly describes visual merchant-grid recognition, support for stretched 4:3 resolutions, audio classification, noise reduction, a compact widget, and later prediction improvements. No public training dataset or validated accuracy benchmark was found.
- Public video: https://abiear.ru/video/instruction-ru.mp4 (66 seconds). Demonstrated sequence: choose map/mode → share game window and system audio → enable compact widget → merchant cell detection over scrolling → hover/drag a cell in game → classification and highlighted result. TV Station yellow/red modes are visible. Root agent inspected sampled frames throughout the video; exact step timestamps were not retained.
- Public assets: https://abiear.ru/js/gate.js , https://abiear.ru/js/guide.js , https://abiear.ru/js/i18n.js , https://abiear.ru/css/style.css . Guide video loads on demand and pauses when dismissed. Language preference persists locally.

## Independent implementation scope

ARENA / EAR recreates the workflow using browser capture, explicit cell selection, user-provided audio references, similarity scoring, manual/visual grid detection, optional compact overlay, local history, and explicit demo data. It does not contain the original proprietary recognition database. Recognition accuracy and game-cursor tracking are not represented as established capabilities. All audio processing stays on the device. No reference key, payment, Telegram or original backend integration is implemented.
