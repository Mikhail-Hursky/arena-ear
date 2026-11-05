import { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AudioLines,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Download,
  History,
  LayoutGrid,
  Maximize2,
  Mic,
  Play,
  Plus,
  Radio,
  Search,
  Settings2,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  AudioMatch,
  GridDetection,
  HistoryEntry,
  Rarity,
  Settings,
  SoundReference,
} from "./types";
import { AudioEngine, analyzeFile, createReference } from "./lib/audio";
import {
  requestCapture,
  describeCaptureError,
  GridScanner,
} from "./lib/capture";
import { createManualGrid } from "./lib/grid";
import { openOverlay } from "./lib/overlay";
import {
  loadSettings,
  sanitizeSettings,
  saveSettings,
  loadReferences,
  saveReferences,
  loadHistory,
  saveHistory,
  parseReferenceLibrary,
  downloadJson,
} from "./lib/storage";
import { MAPS, RARITY_LABELS, DEMO_GRID, createDemoResult } from "./lib/demo";
import "./styles.css";
import SoundDemo from "./components/SoundDemo";
import { BUILTIN_GROUPS, loadBuiltinReferences } from "./lib/builtin-sounds";
import { CapturePreview } from "./components/CapturePreview";

type Page = "analyzer" | "library" | "history" | "settings" | "sound-demo";
function pageFromHash(): Page {
  const value = location.hash.replace(/^#\/?/, "");
  return value === "demo"
    ? "sound-demo"
    : ["analyzer", "library", "history", "settings"].includes(value)
      ? (value as Page)
      : "analyzer";
}
function groupDescription(r: AudioMatch) {
  return r.groupId !== undefined
    ? `Группа ${r.groupId}${r.action ? ` · ${r.action === "pickup" ? "Поднять" : "Положить"}` : ""}`
    : r.rarity
      ? r.rarity
        ? RARITY_LABELS[r.rarity]
        : "Без метки"
      : "";
}
function CandidateList({ result }: { result: AudioMatch }) {
  if (!result.candidates?.length) return null;
  return (
    <div className="candidate-section">
      <p className="shared-sound-note">
        Общий звук группы. По звуку нельзя определить один предмет.
      </p>
      <ul
        className="candidate-list"
        aria-label="Возможные предметы"
        tabIndex={0}
      >
        {result.candidates.map((c) => (
          <li key={c.id}>
            <span>
              {c.name}
              <small>{c.size.join(" × ")} яч.</small>
            </span>
            <span className={`candidate-rarity ${c.rarity}`}>
              {RARITY_LABELS[c.rarity]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const pages = [
  { id: "analyzer", label: "Анализ груза", icon: LayoutGrid },
  { id: "sound-demo", label: "Демо звуков", icon: Play },
  { id: "library", label: "Библиотека звуков", icon: AudioLines },
  { id: "history", label: "История", icon: History },
  { id: "settings", label: "Настройки", icon: Settings2 },
] as const;
function MerchantGrid({
  mini = false,
  grid,
  selected,
  onChoose,
}: {
  mini?: boolean;
  grid: GridDetection | null;
  selected: string;
  onChoose: (id: string) => void;
}) {
  return (
    <div
      className={`merchant-grid ${mini ? "mini-grid" : ""}`}
      style={{ gridTemplateColumns: `repeat(${grid?.columns || 8},1fr)` }}
    >
      {grid
        ? grid.cells.map((c) => (
            <button
              key={c.id}
              title={`Ячейка ${c.id}${c.result ? ": " + c.result.name : ""}`}
              aria-label={`Выбрать ячейку ${c.id}`}
              onClick={() => onChoose(c.id)}
              className={`slot ${selected === c.id ? "selected" : ""} ${c.result?.rarity || ""}`}
              style={{
                gridColumn: `${c.col + 1} / span ${c.width}`,
                gridRow: `${c.row + 1} / span ${c.height}`,
              }}
            >
              <span className="slot-id">{c.id}</span>
              {c.result ? (
                <>
                  <AudioLines size={mini ? 13 : 23} />
                  <span className="slot-result">
                    {c.result.status === "match"
                      ? c.result.groupId !== undefined
                        ? `Группа ${c.result.groupId}`
                        : c.result.rarity
                          ? RARITY_LABELS[c.result.rarity]
                          : "Совпадение"
                      : "Неизвестно"}
                  </span>
                </>
              ) : (
                <span className="slot-cross">+</span>
              )}
            </button>
          ))
        : Array.from({ length: 48 }, (_, i) => (
            <div className="slot idle-slot" key={i}>
              <span className="slot-cross">+</span>
            </div>
          ))}
    </div>
  );
}

export default function App() {
  const [page, rawSetPage] = useState<Page>(pageFromHash),
    [settings, rawSetSettings] = useState<Settings>(loadSettings),
    [refs, setRefs] = useState<SoundReference[]>(loadReferences),
    [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [map, setMap] = useState(() => {
      try {
        const stored = localStorage.getItem("arena.map");
        return MAPS.some((m) => m.id === stored) ? stored! : MAPS[0].id;
      } catch {
        return MAPS[0].id;
      }
    }),
    [grid, setGrid] = useState<GridDetection | null>(null),
    [selected, setSelected] = useState(""),
    [result, setResult] = useState<AudioMatch | null>(null),
    [live, setLive] = useState(false),
    [demo, setDemo] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [level, setLevel] = useState(0),
    [spectrum, setSpectrum] = useState<number[]>([]),
    [guide, setGuide] = useState(false),
    [preview, setPreview] = useState(false),
    [overlay, setOverlay] = useState<{
      window: Window;
      close: () => void;
    } | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [sampleName, setSampleName] = useState(""),
    [rarity, setRarity] = useState<Rarity>("red"),
    [recording, setRecording] = useState(false);
  const [builtinRefs, setBuiltinRefs] = useState<SoundReference[]>([]),
    [builtinStatus, setBuiltinStatus] = useState<"loading" | "ready" | "error">(
      "loading",
    ),
    [builtinProgress, setBuiltinProgress] = useState(0),
    [builtinError, setBuiltinError] = useState(""),
    [builtinAttempt, setBuiltinAttempt] = useState(0);
  const combinedReferences = useMemo(
    () => [...builtinRefs, ...refs],
    [builtinRefs, refs],
  );
  const referenceReady = builtinStatus === "ready";
  function setPage(next: Page) {
    if (next === "sound-demo") stop();
    location.hash = next === "sound-demo" ? "/demo" : `/${next}`;
    rawSetPage(next);
  }
  useEffect(() => {
    const change = () => rawSetPage(pageFromHash());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (page === "sound-demo") stop();
  }, [page]);
  useEffect(() => {
    let active = true;
    setBuiltinStatus("loading");
    setBuiltinError("");
    loadBuiltinReferences((loaded) => {
      if (active) setBuiltinProgress(loaded);
    })
      .then((loaded) => {
        if (active) {
          setBuiltinRefs(loaded);
          setBuiltinStatus("ready");
        }
      })
      .catch((e) => {
        if (active) {
          setBuiltinStatus("error");
          setBuiltinError(String(e));
        }
      });
    return () => {
      active = false;
    };
  }, [builtinAttempt]);
  const stream = useRef<MediaStream | null>(null),
    engine = useRef<AudioEngine | null>(null),
    scanner = useRef<GridScanner | null>(null),
    latest = useRef({ selected, map, settings, refs: combinedReferences }),
    mounted = useRef(true),
    overlayRef = useRef<typeof overlay>(null),
    gridRef = useRef<GridDetection | null>(null),
    captureGeneration = useRef(0),
    gridEpoch = useRef(0),
    pendingBurst = useRef<{
      cell: string;
      map: string;
      generation: number;
      epoch: number;
    } | null>(null);
  function invalidatePending() {
    gridEpoch.current++;
    pendingBurst.current = null;
  }
  function disarm(cell: string) {
    if (latest.current.selected === cell) {
      latest.current.selected = "";
      setSelected("");
    }
  }
  function setSettings(next: Settings | ((current: Settings) => Settings)) {
    rawSetSettings((current) =>
      sanitizeSettings(typeof next === "function" ? next(current) : next),
    );
  }
  gridRef.current = grid;
  overlayRef.current = overlay;
  latest.current = { selected, map, settings, refs: combinedReferences };
  useEffect(() => {
    saveSettings(settings);
    engine.current?.setSensitivity(settings.sensitivity);
    engine.current?.setThreshold(settings.matchThreshold);
    scanner.current?.setRegion(settings.region);
    scanner.current?.setEnabled(settings.autoScan);
  }, [settings]);
  useEffect(() => {
    saveReferences(refs);
  }, [refs]);
  useEffect(() => {
    engine.current?.setReferences(combinedReferences);
  }, [combinedReferences]);
  useEffect(() => saveHistory(history), [history]);
  useEffect(() => {
    try {
      localStorage.setItem("arena.map", map);
    } catch {
      /* In-memory map selection still works when storage is disabled. */
    }
  }, [map]);
  function stop() {
    invalidatePending();
    captureGeneration.current++;
    setBusy(false);
    setDemo(false);
    setGrid(null);
    setSelected("");
    latest.current.selected = "";
    setResult(null);
    engine.current?.stop();
    scanner.current?.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    engine.current = null;
    scanner.current = null;
    setLive(false);
    setLevel(0);
    setSpectrum([]);
    overlayRef.current?.close();
    setOverlay(null);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      captureGeneration.current++;
      overlayRef.current?.close();
      engine.current?.stop();
      scanner.current?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    const storageError = (e: Event) =>
      setError((e as CustomEvent<string>).detail);
    window.addEventListener("arena-storage-error", storageError);
    return () =>
      window.removeEventListener("arena-storage-error", storageError);
  }, []);
  useEffect(() => {
    const cb = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGuide(false);
    };
    window.addEventListener("keydown", cb);
    return () => window.removeEventListener("keydown", cb);
  }, []);
  function accept(
    r: AudioMatch,
    isDemo = false,
    cell = latest.current.selected,
    capturedMap = latest.current.map,
  ) {
    if (!cell && !isDemo) return;
    if (isDemo || latest.current.selected === cell) setResult(r);
    if (!cell) return;
    setGrid((g) =>
      g
        ? {
            ...g,
            cells: g.cells.map((c) =>
              c.id === cell ? { ...c, result: r, rarity: r.rarity } : c,
            ),
          }
        : g,
    );
    setHistory((h) =>
      [
        {
          ...r,
          id: crypto.randomUUID(),
          cellId: cell,
          map: capturedMap,
          demo: isDemo,
        },
        ...h,
      ].slice(0, 500),
    );
  }
  async function start() {
    if (!referenceReady) {
      setError("Дождитесь загрузки встроенных звуков или повторите загрузку.");
      return;
    }
    stop();
    const generation = ++captureGeneration.current;
    const current = () =>
      mounted.current && generation === captureGeneration.current;
    let ownedStream: MediaStream | null = null;
    let ownedEngine: AudioEngine | null = null;
    let ownedScanner: GridScanner | null = null;
    const cleanup = () => {
      ownedEngine?.stop();
      ownedScanner?.stop();
      ownedStream?.getTracks().forEach((t) => t.stop());
    };
    setBusy(true);
    setError("");
    try {
      const s = await requestCapture();
      ownedStream = s;
      if (!current()) {
        cleanup();
        return;
      }
      stream.current = s;
      const ended = () => {
        if (current()) {
          stop();
          setError("Захват завершён. Подключите игру снова, чтобы продолжить.");
        }
      };
      s.getTracks().forEach((track) =>
        track.addEventListener("ended", ended, { once: true }),
      );
      if (s.getTracks().some((track) => track.readyState === "ended")) {
        ended();
        cleanup();
        return;
      }
      const a = new AudioEngine({
        onLevel: (l, sp) => {
          if (current()) {
            setLevel(l);
            setSpectrum(sp);
          }
        },
        onEventStart: () => {
          pendingBurst.current =
            current() && latest.current.selected
              ? {
                  cell: latest.current.selected,
                  map: latest.current.map,
                  generation,
                  epoch: gridEpoch.current,
                }
              : null;
        },
        onResult: (r) => {
          const armed = pendingBurst.current;
          pendingBurst.current = null;
          if (
            !current() ||
            !armed ||
            armed.generation !== captureGeneration.current ||
            armed.epoch !== gridEpoch.current ||
            armed.map !== latest.current.map ||
            !gridRef.current?.cells.some((c) => c.id === armed.cell)
          )
            return;
          accept(r, false, armed.cell, armed.map);
          disarm(armed.cell);
        },
      });
      ownedEngine = a;
      engine.current = a;
      a.setReferences(latest.current.refs);
      a.setSensitivity(latest.current.settings.sensitivity);
      a.setThreshold(latest.current.settings.matchThreshold);
      await a.start(s);
      if (!current()) {
        cleanup();
        return;
      }
      const sc = new GridScanner({
        onDetection: (d) => {
          if (!current()) return;
          const g = gridRef.current;
          const signature = (v: GridDetection) =>
            JSON.stringify([
              v.columns,
              v.rows,
              v.cells.map((c) => [c.id, c.row, c.col, c.width, c.height]),
            ]);
          if (g && signature(g) === signature(d))
            setGrid({
              ...d,
              cells: d.cells.map((c) => ({
                ...c,
                result: g.cells.find((old) => old.id === c.id)?.result,
              })),
            });
          else {
            setGrid(d);
            setSelected("");
            latest.current.selected = "";
            setResult(null);
          }
        },
        onError: (message) => {
          if (current()) setError(String(message));
        },
      });
      ownedScanner = sc;
      scanner.current = sc;
      sc.setEnabled(latest.current.settings.autoScan);
      await sc.start(s, latest.current.settings.region);
      if (!current()) {
        cleanup();
        return;
      }
      setGrid(
        createManualGrid(
          latest.current.settings.gridColumns,
          latest.current.settings.gridRows,
        ),
      );
      setLive(true);
    } catch (e) {
      cleanup();
      if (current()) {
        stream.current = null;
        engine.current = null;
        scanner.current = null;
        setLive(false);
        setLevel(0);
        setSpectrum([]);
        setError(describeCaptureError(e));
      }
    } finally {
      if (current()) setBusy(false);
    }
  }
  function clearGrid() {
    invalidatePending();
    setGrid((g) =>
      g
        ? {
            ...g,
            cells: g.cells.map(
              ({ result: _result, rarity: _rarity, ...cell }) => cell,
            ),
          }
        : g,
    );
    setSelected("");
    latest.current.selected = "";
    setResult(null);
  }
  function manualGrid() {
    invalidatePending();
    if (!live) stop();
    scanner.current?.setEnabled(false);
    setSettings((s) => ({ ...s, autoScan: false }));
    setGrid(createManualGrid(settings.gridColumns, settings.gridRows));
    setDemo(false);
    setSelected("");
    latest.current.selected = "";
    setResult(null);
  }
  useEffect(() => {
    clearGrid();
  }, [map]);
  function demoStart() {
    stop();
    setDemo(true);
    setGrid(structuredClone(DEMO_GRID));
    setSelected("");
    setResult(null);
    setError("");
  }
  function choose(id: string) {
    latest.current.selected = id;
    setSelected(id);
    const c = grid?.cells.find((c) => c.id === id);
    setResult(c?.result || null);
    if (demo) accept(createDemoResult(id), true, id);
  }
  async function addFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const r = await createReference(
        file,
        sampleName.trim() || file.name.replace(/\.[^.]+$/, ""),
        rarity,
      );
      setRefs((v) => [r, ...v].slice(0, 500));
      setSampleName("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function record() {
    if (!engine.current) {
      setError("Сначала включите захват игры на странице анализа.");
      return;
    }
    setRecording(true);
    try {
      const clip = await engine.current.captureSample(2000);
      const r = await createReference(
        clip,
        sampleName.trim() || "Запись " + new Date().toLocaleTimeString("ru"),
        rarity,
      );
      setRefs((v) => [r, ...v].slice(0, 500));
      setSampleName("");
    } catch (e) {
      setError(String(e));
    } finally {
      setRecording(false);
    }
  }
  async function fileAnalysis(file: File) {
    if (!referenceReady) {
      setError("Встроенная библиотека ещё не готова. Дождитесь загрузки.");
      return;
    }
    if (demo) {
      setError(
        "Для анализа файла выйдите из демо: нажмите «Ручная сетка» или «Слушать игру».",
      );
      return;
    }
    const armed = {
      cell: latest.current.selected,
      map: latest.current.map,
      generation: captureGeneration.current,
      epoch: gridEpoch.current,
    };
    setBusy(true);
    setError("");
    try {
      const matched = await analyzeFile(
        file,
        combinedReferences,
        settings.matchThreshold,
      );
      if (!mounted.current) return;
      const valid =
        armed.generation === captureGeneration.current &&
        armed.epoch === gridEpoch.current &&
        armed.map === latest.current.map;
      if (
        valid &&
        armed.cell &&
        gridRef.current?.cells.some((c) => c.id === armed.cell)
      ) {
        accept(matched, false, armed.cell, armed.map);
        disarm(armed.cell);
      } else if (valid) {
        setResult(matched);
        setHistory((h) =>
          [
            {
              ...matched,
              id: crypto.randomUUID(),
              cellId: "Аудиофайл",
              map: armed.map,
              demo: false,
            },
            ...h,
          ].slice(0, 500),
        );
      } else
        setError(
          `Аудиофайл: ${matched.name}. Ячейка не назначена, поскольку режим, карта или сетка изменились.`,
        );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!guide) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(".guide-modal");
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button, input, select, a[href], [tabindex="0"]',
        ) || [],
      );
    focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0],
        last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [guide]);
  const visibleHistory = history.filter(
    (h) =>
      (filter === "all" ||
        (filter === "demo" && h.demo) ||
        (filter === "red" && h.rarity === "red") ||
        (filter === "unknown" && h.status === "unknown")) &&
      `${h.name} ${h.cellId}`.toLowerCase().includes(query.toLowerCase()),
  );
  const mapLabel = MAPS.find((m) => m.id === map)
    ? `${MAPS.find((m) => m.id === map)?.name} · ${MAPS.find((m) => m.id === map)?.subtitle}`
    : map;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#" className="brand" onClick={(e) => e.preventDefault()}>
          <span className="brand-icon">
            <AudioLines size={24} />
          </span>
          <span>
            ARENA<span className="brand-slash"> / </span>EAR
            <small>АУДИОРАЗВЕДКА</small>
          </span>
        </a>
        <div className="nav-caption">РАБОЧАЯ СТАНЦИЯ</div>
        <nav>
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => setPage(p.id)}
              className={page === p.id ? "nav-item active" : "nav-item"}
            >
              <p.icon size={19} />
              {p.label}
              {p.id === "library" && (
                <span className="nav-count">
                  {refs.length.toString().padStart(2, "0")}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="online-dot" />
            Обработка на устройстве<small>Звук остаётся в вашем браузере</small>
          </div>
          <button className="guide-link" onClick={() => setGuide(true)}>
            <CircleHelp size={18} /> Как это работает <span>↗</span>
          </button>
          <div className="build">
            INDEPENDENT TOOL <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Рабочая станция <span>/</span>{" "}
            <b>{pages.find((p) => p.id === page)?.label}</b>
          </div>
          <div className={`session-status ${live ? "live" : ""}`}>
            <span className="online-dot" />
            {live
              ? "ЗАХВАТ АКТИВЕН"
              : demo
                ? "ДЕМО ИНТЕРФЕЙСА"
                : "СИСТЕМА ГОТОВА"}
          </div>
          <button
            className="icon-button"
            aria-label="Открыть инструкцию"
            onClick={() => setGuide(true)}
          >
            <CircleHelp size={19} />
          </button>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                ARENA BREAKOUT: INFINITE <span> / </span> PC UTILITY
              </div>
              <h1>{pages.find((p) => p.id === page)?.label}</h1>
              <p>
                {page === "analyzer"
                  ? "Слушайте детали. Находите больше."
                  : page === "sound-demo"
                    ? "Перетаскивайте предметы и слушайте настоящие игровые звуки."
                    : page === "library"
                      ? "Ваши звуковые образцы для точного сопоставления."
                      : page === "history"
                        ? "Все результаты текущей разведки в одном месте."
                        : "Настройте захват и распознавание под свою игру."}
              </p>
            </div>
            {page === "analyzer" && (
              <div className="heading-tools">
                <label className="map-select">
                  <span>ЛОКАЦИЯ</span>
                  <select
                    aria-label="Локация"
                    value={map}
                    onChange={(e) => {
                      invalidatePending();
                      latest.current.map = e.target.value;
                      setMap(e.target.value);
                    }}
                  >
                    {MAPS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {m.subtitle}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={15} />
                </label>
              </div>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button aria-label="Закрыть ошибку" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {page === "sound-demo" && <SoundDemo />}
          {builtinStatus !== "ready" &&
            page !== "library" &&
            page !== "sound-demo" && (
              <div className="builtin-loading-banner" role="status">
                {builtinStatus === "loading"
                  ? `Подготавливаем игровые звуки: ${builtinProgress} / 76`
                  : "Не удалось загрузить встроенные звуки."}
                {builtinStatus === "error" && (
                  <button onClick={() => setBuiltinAttempt((v) => v + 1)}>
                    Повторить загрузку
                  </button>
                )}
              </div>
            )}
          {page === "analyzer" && (
            <>
              <div className="workspace">
                <section className="grid-panel">
                  <div className="panel-top">
                    <div>
                      <span className="panel-label">01 / СЕТКА ТОРГОВЦА</span>
                      <h2>
                        {mapLabel}{" "}
                        <span className="tag">
                          {demo
                            ? "ДЕМО"
                            : grid?.source === "detected"
                              ? "ОБНАРУЖЕНА"
                              : live
                                ? "РУЧНАЯ СЕТКА"
                                : "ОЖИДАНИЕ"}
                        </span>
                      </h2>
                    </div>
                    <button
                      className="icon-button"
                      title="Открыть мини-виджет"
                      aria-label="Открыть мини-виджет"
                      onClick={async () => {
                        try {
                          const o = await openOverlay();
                          setOverlay(o);
                          o.window.addEventListener(
                            "pagehide",
                            () => setOverlay(null),
                            { once: true },
                          );
                        } catch (e) {
                          setError(String(e));
                        }
                      }}
                    >
                      <Maximize2 size={18} />
                    </button>
                  </div>
                  <div className="grid-meta">
                    <span>
                      <i />{" "}
                      {grid
                        ? `${grid.columns} × ${grid.rows} ячеек`
                        : "Нет активного источника"}
                    </span>
                    <span>
                      {demo
                        ? "Иллюстративные данные"
                        : live
                          ? "Выберите ячейку перед звуком"
                          : "Готов к подключению"}
                    </span>
                  </div>
                  <div className={`grid-stage ${!grid ? "empty-stage" : ""}`}>
                    <MerchantGrid
                      grid={grid}
                      selected={selected}
                      onChoose={choose}
                    />
                    {!grid && (
                      <div className="empty-overlay">
                        <div className="empty-icon">
                          <Radio size={30} />
                        </div>
                        <h3>Начните аудиоразведку</h3>
                        <p>
                          Подключите окно игры со звуком,
                          <br />
                          чтобы анализировать ячейки торговца.
                        </p>
                        <button
                          className="primary"
                          disabled={busy || !referenceReady}
                          onClick={start}
                        >
                          <Play size={16} fill="currentColor" />
                          {busy ? "Подключение…" : "Слушать игру"}
                        </button>
                        <button className="text-button" onClick={demoStart}>
                          Демо интерфейса <span>↗</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="grid-footer">
                    <span>
                      <span className="legend-dot red" />
                      Красный предмет
                    </span>
                    <span>
                      <span className="legend-dot epic" />
                      Эпический
                    </span>
                    <span>
                      <span className="legend-dot" />
                      Без результата
                    </span>
                    <span className="grid-hint">
                      Нажмите на ячейку для выбора
                    </span>
                  </div>
                </section>
                <aside className="analysis-panel">
                  <div className="panel-label">02 / АНАЛИЗ СИГНАЛА</div>
                  <div className="signal-title">
                    <span className={`online-dot ${live ? "" : "inactive"}`} />
                    {live
                      ? "Слушаю игровой звук"
                      : demo
                        ? "Демонстрация сигнала"
                        : "Источник не подключён"}
                  </div>
                  <div className="waveform">
                    {Array.from({ length: 52 }, (_, i) => (
                      <i
                        key={i}
                        style={{
                          height: `${live ? Math.max(3, (spectrum[i % spectrum.length] || level || 0) * 70) : demo ? 7 + Math.abs(Math.sin(i * 1.71)) * 25 : 3}px`,
                        }}
                      />
                    ))}
                    <span className="wave-baseline" />
                  </div>
                  <div className="signal-scale">
                    <span>ВХОДЯЩИЙ СИГНАЛ</span>
                    <span>{live ? `${Math.round(level * 100)}%` : "—"}</span>
                  </div>
                  <div
                    className="result-block"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    <div className="section-label">
                      ВЫБРАННАЯ ЯЧЕЙКА <b>{selected || "—"}</b>
                    </div>
                    {result ? (
                      <>
                        <div className={`result-symbol ${result.rarity || ""}`}>
                          <AudioLines size={30} />
                        </div>
                        <h3 className={result.rarity || ""}>{result.name}</h3>
                        <p>
                          {result.status === "match"
                            ? `${groupDescription(result)} • сходство ${(result.similarity * 100).toFixed(1)}%`
                            : result.reason ||
                              "Нет достаточно близкого образца"}
                        </p>
                        <CandidateList result={result} />
                        {demo && (
                          <span className="tag demo-tag">
                            ДЕМО · ИЛЛЮСТРАЦИЯ
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="result-symbol">
                          <Search size={27} />
                        </div>
                        <h3>
                          {selected ? "Ожидание звука" : "Выберите ячейку"}
                        </h3>
                        <p>
                          {selected
                            ? "Перетяните эту ячейку в игре. После одного сигнала выберите ячейку снова."
                            : "Результат появится здесь после анализа игрового звука."}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="reference-note">
                    <BookOpen size={17} />
                    <span>
                      {builtinStatus === "loading"
                        ? `Загрузка звуков: ${builtinProgress}/76`
                        : builtinStatus === "error"
                          ? "Встроенные звуки не загружены"
                          : `76 встроенных + ${refs.length} личных образцов`}
                      <button onClick={() => setPage("library")}>
                        Библиотека и состояние загрузки ↗
                      </button>
                    </span>
                  </div>
                  <div className="analysis-controls">
                    {live ? (
                      <button className="stop-button" onClick={stop}>
                        <Square size={14} fill="currentColor" /> Остановить
                        захват
                      </button>
                    ) : (
                      <button
                        className="primary"
                        disabled={busy || !referenceReady}
                        onClick={start}
                      >
                        <Play size={15} fill="currentColor" />
                        {busy ? "Подключение…" : "Слушать игру"}
                      </button>
                    )}
                    <label className="secondary file-button">
                      <Upload size={15} />
                      Анализ аудиофайла
                      <input
                        type="file"
                        accept="audio/*"
                        disabled={busy || !referenceReady}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void fileAnalysis(f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button className="text-button" onClick={demoStart}>
                      Демо интерфейса
                    </button>
                  </div>
                </aside>
              </div>
              <div className="capture-bottom">
                <span>
                  <Activity size={15} />{" "}
                  {live
                    ? "Системный звук подключён"
                    : "Захват экрана и системного звука"}
                </span>
                <button onClick={() => setPreview((v) => !v)}>
                  {preview ? "Скрыть" : "Показать"} превью захвата
                </button>
                <button onClick={manualGrid}>Ручная сетка</button>
                <button onClick={clearGrid} disabled={!grid}>
                  Очистить сетку
                </button>
              </div>
              {grid && (
                <p className="scroll-warning">
                  После прокрутки торговца очистите сетку. Выбирайте ячейку
                  перед каждым звуком и дождитесь результата.
                </p>
              )}
              {preview && (
                <div className="video-preview">
                  {live ? (
                    <CapturePreview
                      stream={stream.current!}
                      region={settings.region}
                      onRegionChange={(region) => {
                        clearGrid();
                        setSettings((s) => ({ ...s, region }));
                      }}
                    />
                  ) : (
                    <p>Подключите окно игры, чтобы увидеть превью.</p>
                  )}
                </div>
              )}
              <section className="recent-panel">
                <div className="recent-header">
                  <h2>
                    Последние сигналы{" "}
                    <span>{history.length.toString().padStart(2, "0")}</span>
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => setPage("history")}
                  >
                    Вся история ↗
                  </button>
                </div>
                {history.length ? (
                  <div className="recent-items">
                    {history.slice(0, 4).map((h) => (
                      <div className="recent-item" key={h.id}>
                        <span className={`item-mark ${h.rarity || ""}`}>
                          <AudioLines size={18} />
                        </span>
                        <span>
                          <b>{h.name}</b>
                          <small>
                            {h.demo ? "ДЕМО · " : ""}Ячейка {h.cellId}
                          </small>
                        </span>
                        <time>
                          {new Date(h.timestamp).toLocaleTimeString("ru", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="history-empty">
                    <span>—</span> Пока нет сигналов{" "}
                    <small>Результаты анализа будут сохраняться здесь</small>
                  </div>
                )}
              </section>
            </>
          )}
          {page === "library" && (
            <>
              <section className="content-panel builtin-card">
                <div className="panel-label">ВСТРОЕННАЯ БИБЛИОТЕКА</div>
                <h2>38 групп / 76 игровых звуков</h2>
                <p className="muted">
                  Звуки поднятия и размещения предметов. Группа может включать
                  несколько предметов разной редкости.
                </p>
                <div className="builtin-status" role="status">
                  {builtinStatus === "loading"
                    ? `Подготавливаем встроенные образцы: ${builtinProgress} / 76`
                    : builtinStatus === "ready"
                      ? `Готово: ${BUILTIN_GROUPS.length} групп · ${builtinRefs.length} звуков`
                      : `Ошибка: ${builtinError}`}
                </div>
                {builtinStatus === "loading" && (
                  <progress
                    max={76}
                    value={builtinProgress}
                    aria-label="Загрузка встроенных звуков"
                  />
                )}
                <div className="builtin-actions">
                  {builtinStatus === "error" && (
                    <button
                      className="secondary"
                      onClick={() => setBuiltinAttempt((v) => v + 1)}
                    >
                      Повторить загрузку
                    </button>
                  )}
                  <button
                    className="primary"
                    onClick={() => setPage("sound-demo")}
                  >
                    <Play size={15} />
                    Открыть демо звуков
                  </button>
                  <span>
                    Встроенные образцы не занимают место в личной библиотеке.
                  </span>
                </div>
              </section>
              <section className="content-panel">
                <div className="panel-label">НОВЫЙ ЭТАЛОН</div>
                <h2>Добавить звуковой образец</h2>
                <p className="muted">
                  Запишите отдельный звук известного предмета. Чистые и
                  одинаковые по условиям записи улучшают сопоставление.
                </p>
                <div className="form-row">
                  <label>
                    Название
                    <input
                      value={sampleName}
                      maxLength={120}
                      placeholder="Например, красный предмет — образец 1"
                      onChange={(e) => setSampleName(e.target.value)}
                    />
                  </label>
                  <label>
                    Редкость
                    <select
                      value={rarity}
                      onChange={(e) => setRarity(e.target.value as Rarity)}
                    >
                      {Object.entries(RARITY_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="primary file-button">
                    <Upload size={16} />
                    Загрузить аудио
                    <input
                      type="file"
                      accept="audio/*"
                      disabled={busy}
                      onChange={(e) => {
                        if (e.target.files?.[0])
                          void addFile(e.target.files[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    className="secondary"
                    disabled={recording || !live}
                    onClick={record}
                  >
                    <Mic size={16} />
                    {recording ? "Запись 2 сек…" : "Записать 2 сек"}
                  </button>
                </div>
              </section>
              <div className="section-toolbar">
                <h2>
                  Мои образцы <span className="tag">{refs.length}</span>
                </h2>
                <div>
                  <label className="secondary file-button">
                    <Upload size={15} />
                    Импорт JSON
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={async (e) => {
                        try {
                          const file = e.target.files?.[0];
                          if (file) {
                            const imported = parseReferenceLibrary(
                              await file.text(),
                            );
                            setRefs((v) =>
                              Array.from(
                                new Map(
                                  [...v, ...imported].map((r) => [r.id, r]),
                                ).values(),
                              ).slice(0, 500),
                            );
                          }
                        } catch (err) {
                          setError(String(err));
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    className="secondary"
                    onClick={() => downloadJson("arena-sounds.json", refs)}
                  >
                    <Download size={15} />
                    Экспорт
                  </button>
                </div>
              </div>
              <section className="content-panel library-list">
                {refs.length ? (
                  refs.map((r) => (
                    <div className="library-row" key={r.id}>
                      <span className={`item-mark ${r.rarity}`}>
                        <AudioLines size={22} />
                      </span>
                      <div>
                        <b>{r.name}</b>
                        <small>
                          {r.rarity ? RARITY_LABELS[r.rarity] : "Без метки"} ·{" "}
                          {r.duration.toFixed(2)} сек · {r.sampleRate} Hz
                        </small>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Удалить ${r.name}`}
                        onClick={() =>
                          setRefs((v) => v.filter((x) => x.id !== r.id))
                        }
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="large-empty">
                    <AudioLines size={35} />
                    <h3>Начните с первого образца</h3>
                    <p>
                      Загрузите короткую запись игрового звука
                      <br />
                      или запишите её из активного захвата.
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
          {page === "history" && (
            <>
              <div className="section-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Поиск по истории"
                    placeholder="Поиск по предмету или ячейке"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div>
                  <select
                    aria-label="Фильтр истории"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">Все результаты</option>
                    <option value="red">Красные предметы</option>
                    <option value="unknown">Неизвестные</option>
                    <option value="demo">Демонстрация</option>
                  </select>
                  <button
                    className="secondary"
                    onClick={() => downloadJson("arena-history.json", history)}
                  >
                    <Download size={15} />
                    Экспорт
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Очистить историю"
                    onClick={() => {
                      if (confirm("Очистить всю историю анализа?"))
                        setHistory([]);
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
              <section className="content-panel table-panel">
                <table>
                  <thead>
                    <tr>
                      <th>Время</th>
                      <th>Результат</th>
                      <th>Ячейка</th>
                      <th>Локация</th>
                      <th>Сходство</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHistory.map((h) => (
                      <tr key={h.id}>
                        <td>{new Date(h.timestamp).toLocaleString("ru")}</td>
                        <td>
                          <b className={h.rarity || ""}>{h.name}</b>
                          {h.groupId !== undefined && (
                            <small className="history-group">
                              {groupDescription(h)} ·{" "}
                              {h.candidates
                                ?.map(
                                  (c) =>
                                    `${c.name} (${RARITY_LABELS[c.rarity]}, ${c.size.join("×")})`,
                                )
                                .join("; ")}
                            </small>
                          )}
                          {h.demo && <span className="tag">ДЕМО</span>}
                        </td>
                        <td>{h.cellId}</td>
                        <td>
                          {(() => {
                            const location = MAPS.find((m) => m.id === h.map);
                            return location
                              ? `${location.name} · ${location.subtitle}`
                              : h.map;
                          })()}
                        </td>
                        <td>
                          {h.status === "match"
                            ? `${(h.similarity * 100).toFixed(1)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visibleHistory.length && (
                  <div className="large-empty">
                    <History size={32} />
                    <h3>Здесь пока тихо</h3>
                    <p>Нет результатов, соответствующих фильтру.</p>
                  </div>
                )}
              </section>
            </>
          )}
          {page === "settings" && (
            <div className="settings-layout">
              <section className="content-panel">
                <div className="panel-label">АУДИО</div>
                <h2>Параметры распознавания</h2>
                <label className="range-label">
                  Чувствительность <b>{settings.sensitivity}%</b>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={settings.sensitivity}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        sensitivity: +e.target.value,
                      }))
                    }
                  />
                </label>
                <p className="muted">
                  Определяет чувствительность к началу короткого звукового
                  события.
                </p>
                <label className="range-label">
                  Порог сходства{" "}
                  <b>{Math.round(settings.matchThreshold * 100)}%</b>
                  <input
                    type="range"
                    min="50"
                    max="99"
                    value={Math.round(settings.matchThreshold * 100)}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        matchThreshold: +e.target.value / 100,
                      }))
                    }
                  />
                </label>
                <p className="muted">
                  Результаты ниже порога помечаются как неизвестные. Сходство не
                  является вероятностью редкости.
                </p>
              </section>
              <section className="content-panel">
                <div className="panel-label">ИЗОБРАЖЕНИЕ</div>
                <h2>Область торговца</h2>
                <label className="toggle-row">
                  Автоматически искать сетку
                  <input
                    type="checkbox"
                    checked={settings.autoScan}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, autoScan: e.target.checked }))
                    }
                  />
                </label>
                <p className="muted">
                  Укажите область в долях размера захваченного окна (от 0 до 1).
                </p>
                <div className="region-inputs">
                  {(["x", "y", "width", "height"] as const).map((k) => (
                    <label key={k}>
                      {{ x: "X", y: "Y", width: "Ширина", height: "Высота" }[k]}
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={settings.region[k]}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            region: {
                              ...s.region,
                              [k]: Math.max(
                                0,
                                Math.min(1, Number(e.target.value)),
                              ),
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="region-inputs">
                  {(["gridColumns", "gridRows"] as const).map((k) => (
                    <label key={k}>
                      {k === "gridColumns" ? "Столбцы" : "Строки"}
                      <input
                        type="number"
                        min="2"
                        max="20"
                        value={settings[k]}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            [k]: Math.max(2, Math.min(20, +e.target.value)),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <button
                  className="secondary"
                  onClick={() => {
                    manualGrid();
                    setPage("analyzer");
                  }}
                >
                  Применить ручную сетку
                </button>
              </section>
            </div>
          )}
          <footer className="main-footer">
            <span>
              <span className="online-dot" /> ЛОКАЛЬНЫЙ АНАЛИЗ · БЕЗ ОТПРАВКИ
              АУДИО
            </span>
            <span>Слышим больше, чем кажется.</span>
          </footer>
        </main>
      </div>
      {guide && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGuide(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            className="guide-modal"
          >
            <button
              className="modal-close icon-button"
              aria-label="Закрыть инструкцию"
              onClick={() => setGuide(false)}
            >
              <X />
            </button>
            <div className="eyebrow">БЫСТРЫЙ СТАРТ</div>
            <h2 id="guide-title">Сначала звук. Затем результат.</h2>
            <ol>
              <li>
                Дождитесь загрузки 76 встроенных образцов. При желании добавьте
                личные записи.
              </li>
              <li>Откройте игру и торговца. Выберите локацию в интерфейсе.</li>
              <li>
                Нажмите «Слушать игру» и разрешите захват окна или экрана со
                звуком.
              </li>
              <li>
                Проверьте превью и область торговца в настройках. При
                необходимости задайте сетку вручную.
              </li>
              <li>
                Выберите ячейку в этой панели, затем перетяните соответствующую
                ячейку в игре, чтобы получить звук.
              </li>
              <li>
                Смотрите результат сопоставления и сходство. Откройте
                мини-виджет для компактного просмотра.
              </li>
            </ol>
            <div className="guide-caveat">
              <b>Что важно знать</b>
              <p>
                Это независимый инструмент сопоставления с 76 встроенными
                игровыми звуками и вашими образцами. Общий звук определяет
                группу возможных предметов, а не единственный предмет или его
                редкость. Курсор игры автоматически не отслеживается. Поддержка
                системного звука зависит от браузера и ОС; выбирайте источник с
                доступным аудио. Режим демо всегда помечен.
              </p>
            </div>
            <button className="primary" onClick={() => setGuide(false)}>
              Понятно, начать <Play size={15} />
            </button>
          </section>
        </div>
      )}
      {overlay &&
        !overlay.window.closed &&
        createPortal(
          <div
            style={{
              background: "#111311",
              color: "#e9ece5",
              minHeight: "100vh",
              padding: 14,
              fontFamily: "system-ui",
            }}
          >
            <h3 style={{ margin: "0 0 12px" }}>
              ARENA / EAR {demo ? "· ДЕМО" : ""}
            </h3>
            <style>{`.merchant-grid{display:grid;gap:4px;grid-auto-rows:35px}.slot{background:#20241f;color:#cbd1c6;border:1px solid #3c4438;border-radius:4px;position:relative;display:flex;align-items:center;justify-content:center;gap:3px;flex-direction:column;cursor:pointer}.slot-id{position:absolute;left:3px;top:2px;font-size:8px}.slot-result{font-size:8px}.slot.selected{outline:2px solid #e2ee78}.slot.red{background:#512b2b;color:#ff9d8e}.slot.epic{background:#38304b;color:#c4a5ec}.slot-cross{color:#555}.mini-grid{margin-bottom:12px}`}</style>
            <MerchantGrid
              mini
              grid={grid}
              selected={selected}
              onChoose={choose}
            />
            <div>
              {selected ? `Ячейка ${selected} · ` : ""}
              {result?.name || "Ожидание сигнала"}
              {result?.groupId !== undefined && (
                <small style={{ display: "block", marginTop: 8 }}>
                  {groupDescription(result)} ·{" "}
                  {result.candidates?.map((c) => c.name).join(", ")}
                </small>
              )}
            </div>
          </div>,
          overlay.window.document.body,
        )}
    </div>
  );
}
