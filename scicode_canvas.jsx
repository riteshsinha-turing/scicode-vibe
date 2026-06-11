import { useState, useCallback, useRef, useEffect } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS = [
  { id: "claude-opus-4-20250514",    label: "Claude Opus 4",    short: "Opus 4"    },
  { id: "claude-sonnet-4-20250514",  label: "Claude Sonnet 4",  short: "Sonnet 4"  },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", short: "Haiku 4.5" },
];

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY ?? "";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }
function makeTest(n) { return { id: uid(), name: `test_${n}`, code: "", result: null }; }
function makeSubproblem(n) {
  return { id: uid(), label: `Sub-problem ${n}`, functionSignature: "", prompt: "", goldenSolution: "", unitTests: [makeTest(1)] };
}
const EMPTY_PROBLEM = {
  id: uid(), title: "", description: "", paperRef: "",
  subproblems: [makeSubproblem(1), makeSubproblem(2), makeSubproblem(3)],
};

// ─── Tokens ───────────────────────────────────────────────────────────────────

const C = {
  bg0: "#0D1117", bg1: "#161B22", bg2: "#1C2128",
  border: "#21262D", border2: "#30363D",
  text: "#C9D1D9", muted: "#8B949E", dim: "#484F58",
  blue: "#58A6FF", green: "#3FB950", yellow: "#E3B341", red: "#F85149",
  blueBg: "#1F6FEB", greenBg: "#238636",
};

// ─── Design system ────────────────────────────────────────────────────────────

const S = {
  app: {
    display: "flex", flexDirection: "column", height: "100vh", width: "100%",
    background: C.bg0, color: C.text,
    fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, overflow: "hidden",
  },
  topbar: {
    display: "flex", alignItems: "center", gap: 12, padding: "0 20px",
    height: 44, borderBottom: `1px solid ${C.border}`, background: C.bg1, flexShrink: 0,
  },
  logo: { fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15, color: C.blue },
  badge: (color = C.muted) => ({
    background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: 4,
    padding: "2px 8px", fontSize: 11, color, whiteSpace: "nowrap",
  }),
  tabBar: {
    display: "flex", borderBottom: `1px solid ${C.border}`, background: C.bg1, flexShrink: 0,
    padding: "0 20px",
  },
  tab: (active) => ({
    padding: "10px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer",
    color: active ? C.text : C.muted,
    borderBottom: `2px solid ${active ? C.blue : "transparent"}`,
    background: "transparent", border: "none", outline: "none",
    display: "flex", alignItems: "center", gap: 8,
  }),
  page: { flex: 1, overflow: "auto", padding: "24px 32px" },
  // Cards
  card: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 16 },
  cardHeader: {
    padding: "10px 16px", borderBottom: `1px solid ${C.border}`,
    display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between",
  },
  cardTitle: { fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8 },
  cardBody: { padding: 16 },
  // Form
  label: { display: "block", fontSize: 11, fontWeight: 500, color: C.muted, marginBottom: 5 },
  fieldGroup: { marginBottom: 14 },
  row: { display: "flex", gap: 14 },
  input: {
    width: "100%", background: C.bg0, border: `1px solid ${C.border2}`, borderRadius: 6,
    color: C.text, padding: "8px 10px", fontSize: 13, outline: "none",
    fontFamily: "inherit", resize: "none", boxSizing: "border-box",
  },
  monoInput: {
    width: "100%", background: C.bg0, border: `1px solid ${C.border2}`, borderRadius: 6,
    color: C.text, padding: "8px 12px", fontSize: 12, outline: "none",
    fontFamily: "'JetBrains Mono', monospace", resize: "none", boxSizing: "border-box",
  },
  code: {
    width: "100%", background: C.bg0, border: `1px solid ${C.border2}`, borderRadius: 6,
    color: C.text, padding: "10px 12px", fontSize: 12, outline: "none",
    fontFamily: "'JetBrains Mono', monospace", resize: "vertical",
    boxSizing: "border-box", lineHeight: 1.6,
  },
  // Buttons
  btn: (variant = "default", size = "md") => {
    const pad = size === "sm" ? "4px 10px" : size === "xs" ? "2px 7px" : "7px 14px";
    const fs  = size === "xs" ? 10 : 12;
    const bg  = variant === "primary" ? C.greenBg : variant === "blue" ? C.blueBg
              : variant === "danger" ? "#DA3633" : variant === "ghost" ? "transparent" : "#21262D";
    const bdr = variant === "primary" ? "#2EA043" : variant === "blue" ? "#388BFD"
              : variant === "danger" ? C.red : C.border2;
    return { padding: pad, borderRadius: 6, fontSize: fs, fontWeight: 500,
      cursor: "pointer", outline: "none", background: bg,
      color: variant === "ghost" ? C.muted : "#fff", border: `1px solid ${bdr}` };
  },
  // Tags
  tag: (color) => ({
    display: "inline-flex", alignItems: "center", padding: "2px 6px", borderRadius: 3,
    fontSize: 10, fontWeight: 600, background: color + "20", color, border: `1px solid ${color}40`,
  }),
  passCell: (rate) => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 44, height: 22, borderRadius: 4, fontSize: 11, fontWeight: 600,
    background: rate === null ? "#21262D" : rate < 0.4 ? "#3D1A1A" : rate < 0.7 ? "#2D2510" : "#0D2818",
    color: rate === null ? C.muted : rate < 0.4 ? C.red : rate < 0.7 ? C.yellow : C.green,
    border: `1px solid ${rate === null ? C.border2 : rate < 0.4 ? C.red + "40" : rate < 0.7 ? C.yellow + "40" : C.green + "40"}`,
  }),
  spinner: {
    display: "inline-block", width: 12, height: 12,
    border: `2px solid ${C.border2}`, borderTopColor: C.blue,
    borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0,
  },
};

// ─── Pyodide ──────────────────────────────────────────────────────────────────

function usePyodide() {
  const pyRef = useRef(null);
  const [pyStatus, setPyStatus] = useState("loading");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!window.loadPyodide) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js";
            s.onload = res; s.onerror = rej; document.head.appendChild(s);
          });
        }
        const py = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/" });
        if (!cancelled) { pyRef.current = py; setPyStatus("ready"); }
      } catch { if (!cancelled) setPyStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, []);

  const runPython = useCallback(async (code) => {
    if (!pyRef.current) return { stdout: "", stderr: "", error: "Pyodide not ready", passed: false };
    const py = pyRef.current;
    py.runPython(`import sys,io\nsys.stdout=io.StringIO()\nsys.stderr=io.StringIO()`);
    try {
      py.runPython(code);
      return { stdout: py.runPython("sys.stdout.getvalue()"), stderr: py.runPython("sys.stderr.getvalue()"), error: null, passed: true };
    } catch (e) {
      return { stdout: py.runPython("sys.stdout.getvalue()") || "", stderr: py.runPython("sys.stderr.getvalue()") || "", error: e.message || String(e), passed: false };
    } finally {
      py.runPython("sys.stdout=sys.__stdout__;sys.stderr=sys.__stderr__");
    }
  }, []);

  return { pyStatus, runPython };
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function generateCodeWithModel(modelId, systemPrompt, userPrompt) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: modelId, max_tokens: 2048, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  const raw = data.content?.find(b => b.type === "text")?.text ?? "";
  return raw.replace(/^```python\s*/m, "").replace(/^```\s*/m, "").replace(/```$/m, "").trim();
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function Spinner() { return <span style={S.spinner} />; }

function TextInput({ value, onChange, placeholder, multiline, rows = 3, style = {} }) {
  if (multiline)
    return <textarea style={{ ...S.input, resize: "vertical", ...style }} value={value}
      onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} />;
  return <input style={{ ...S.input, ...style }} value={value}
    onChange={e => onChange(e.target.value)} placeholder={placeholder} />;
}

function CodeArea({ value, onChange, placeholder, rows = 8, style = {} }) {
  return <textarea style={{ ...S.code, ...style }} value={value}
    onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} spellCheck={false} />;
}

// ─── Model dropdown ───────────────────────────────────────────────────────────

function ModelDropdown({ selectedModels, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = id => onChange(selectedModels.includes(id) ? selectedModels.filter(x => x !== id) : [...selectedModels, id]);
  const label = selectedModels.length === 0 ? "None"
    : selectedModels.length === MODELS.length ? "All models"
    : selectedModels.map(id => MODELS.find(m => m.id === id)?.short).join(", ");

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 180 }}>
      <button style={{ ...S.btn(), width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 12px" }}
        onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 12, color: selectedModels.length ? C.text : C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ color: C.muted, fontSize: 10, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
          background: C.bg1, border: `1px solid ${C.border2}`, borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)", overflow: "hidden" }}>
          {MODELS.map(m => (
            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
              cursor: "pointer", borderBottom: `1px solid ${C.border}`,
              background: selectedModels.includes(m.id) ? "#1F2937" : "transparent" }}>
              <input type="checkbox" checked={selectedModels.includes(m.id)} onChange={() => toggle(m.id)}
                style={{ accentColor: C.blue, cursor: "pointer" }} />
              <div>
                <div style={{ fontSize: 12, color: C.text }}>{m.label}</div>
                <div style={{ fontSize: 10, color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}>{m.id}</div>
              </div>
            </label>
          ))}
          <div style={{ display: "flex", gap: 6, padding: "8px 12px" }}>
            <button style={{ ...S.btn("ghost", "xs"), flex: 1 }} onClick={() => onChange(MODELS.map(m => m.id))}>All</button>
            <button style={{ ...S.btn("ghost", "xs"), flex: 1 }} onClick={() => onChange([])}>None</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── pass@n picker ────────────────────────────────────────────────────────────

const PASS_N_PRESETS = [1, 3, 5, 10];
function PassNPicker({ value, onChange }) {
  const [custom, setCustom] = useState(PASS_N_PRESETS.includes(value) ? "" : String(value));
  const handleCustom = raw => {
    setCustom(raw);
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1 && n <= 100) onChange(n);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {PASS_N_PRESETS.map(n => (
        <button key={n} style={{ ...S.btn(value === n ? "blue" : "default", "sm"), minWidth: 32, textAlign: "center" }}
          onClick={() => { onChange(n); setCustom(""); }}>
          {n}
        </button>
      ))}
      <input type="number" min={1} max={100} value={custom} onChange={e => handleCustom(e.target.value)}
        placeholder="N" style={{ ...S.input, width: 52, padding: "4px 8px", fontSize: 12, textAlign: "center" }}
        title="Custom N (1–100)" />
    </div>
  );
}

// ─── Unit test editor (tabbed) ────────────────────────────────────────────────

function UnitTestsEditor({ tests, goldenSolution, onUpdateTests, runPython, pyStatus }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [runningIdx, setRunningIdx] = useState(null);
  const [runningAll, setRunningAll] = useState(false);
  const safeIdx = Math.min(activeIdx, tests.length - 1);

  const updateTest = (idx, patch) => onUpdateTests(tests.map((t, i) => i === idx ? { ...t, ...patch } : t));
  const addTest = () => { const n = [...tests, makeTest(tests.length + 1)]; onUpdateTests(n); setActiveIdx(n.length - 1); };
  const removeTest = idx => { if (tests.length <= 1) return; onUpdateTests(tests.filter((_, i) => i !== idx)); setActiveIdx(Math.max(0, idx - 1)); };

  const runOne = async idx => {
    if (pyStatus !== "ready") return;
    setRunningIdx(idx);
    const r = await runPython(`${goldenSolution}\n\n${tests[idx].code}`);
    updateTest(idx, { result: r });
    setRunningIdx(null);
  };
  const runAll = async () => {
    if (pyStatus !== "ready") return;
    setRunningAll(true);
    const updated = [...tests];
    for (let i = 0; i < updated.length; i++) {
      const r = await runPython(`${goldenSolution}\n\n${updated[i].code}`);
      updated[i] = { ...updated[i], result: r };
      onUpdateTests([...updated]);
    }
    setRunningAll(false);
  };

  const passed = tests.filter(t => t.result?.passed).length;
  const ran = tests.filter(t => t.result !== null).length;
  const active = tests[safeIdx];

  return (
    <div style={S.fieldGroup}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <label style={{ ...S.label, marginBottom: 0 }}>Unit Tests</label>
        <div style={{ flex: 1 }} />
        {ran > 0 && <span style={S.tag(passed === ran ? C.green : passed > 0 ? C.yellow : C.red)}>{passed}/{ran} passed</span>}
        {pyStatus === "loading" && <span style={{ ...S.badge(), display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}><Spinner />Python</span>}
        {pyStatus === "error" && <span style={S.tag(C.red)}>Python unavailable</span>}
      </div>
      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "stretch", overflowX: "auto", borderBottom: `1px solid ${C.border}` }}>
        {tests.map((t, i) => {
          const color = t.result === null ? null : t.result.passed ? C.green : C.red;
          const isActive = i === safeIdx;
          return (
            <button key={t.id} onClick={() => setActiveIdx(i)} style={{
              background: isActive ? C.bg0 : "transparent", border: "none",
              borderBottom: `2px solid ${isActive ? C.blue : "transparent"}`,
              borderRight: `1px solid ${C.border}`, padding: "6px 12px", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 5, fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace", color: isActive ? C.text : C.muted,
              whiteSpace: "nowrap", outline: "none", flexShrink: 0,
            }}>
              {color && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />}
              {t.name || `test_${i + 1}`}
            </button>
          );
        })}
        <button onClick={addTest} style={{ background: "transparent", border: "none", borderBottom: "2px solid transparent",
          padding: "6px 10px", cursor: "pointer", color: C.muted, fontSize: 14, outline: "none", flexShrink: 0 }}>+</button>
        <div style={{ flex: 1 }} />
      </div>
      {active && (
        <div style={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 8px 8px", background: C.bg0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${C.border}`, background: C.bg1 }}>
            <button style={S.btn("blue", "sm")} onClick={() => runOne(safeIdx)}
              disabled={runningIdx === safeIdx || runningAll || pyStatus !== "ready" || !goldenSolution.trim()}>
              {runningIdx === safeIdx ? <Spinner /> : "▶ Run"}
            </button>
            <input style={{ ...S.monoInput, flex: 1, padding: "4px 8px", fontSize: 11, border: "1px solid transparent", background: "transparent" }}
              value={active.name} onChange={e => updateTest(safeIdx, { name: e.target.value, result: null })}
              placeholder="test_name" spellCheck={false}
              onFocus={e => e.target.style.border = `1px solid ${C.border2}`}
              onBlur={e => e.target.style.border = "1px solid transparent"} />
            {active.result !== null && <span style={S.tag(active.result.passed ? C.green : C.red)}>{active.result.passed ? "✓ PASS" : "✗ FAIL"}</span>}
            {tests.length > 1 && <button style={S.btn("ghost", "xs")} onClick={() => removeTest(safeIdx)}>✕</button>}
          </div>
          <CodeArea key={active.id} value={active.code} onChange={v => updateTest(safeIdx, { code: v, result: null })}
            placeholder={"# Assert against the function defined in Golden Solution\n# e.g.\n#   result = my_function(1.0, 2.0)\n#   assert abs(result - 3.0) < 1e-6"}
            rows={10} style={{ border: "none", borderRadius: 0 }} />
          {active.result !== null && (
            <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 12px", fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6,
              background: active.result.passed ? "#0D2818" : "#1A0D0D",
              color: active.result.passed ? C.green : C.red,
              whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 140, overflow: "auto" }}>
              {active.result.passed
                ? `✓ passed${active.result.stdout ? `\n${active.result.stdout}` : ""}`
                : [active.result.error, active.result.stdout && `stdout:\n${active.result.stdout}`, active.result.stderr && `stderr:\n${active.result.stderr}`].filter(Boolean).join("\n\n")}
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button style={S.btn("primary", "sm")} onClick={runAll}
          disabled={runningAll || runningIdx !== null || pyStatus !== "ready" || !goldenSolution.trim()}>
          {runningAll ? <><Spinner /> Running…</> : "▶▶ Run All"}
        </button>
        {ran > 0 && <button style={S.btn("ghost", "sm")} onClick={() => onUpdateTests(tests.map(t => ({ ...t, result: null })))}>Clear</button>}
      </div>
    </div>
  );
}

// ─── Golden solution panel ────────────────────────────────────────────────────

function GoldenSolutionPanel({ value, onChange, onRun, pyStatus, runResult }) {
  return (
    <div style={S.fieldGroup}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <label style={{ ...S.label, marginBottom: 0 }}>Golden Solution</label>
        <div style={{ flex: 1 }} />
        {runResult !== null && <span style={S.tag(runResult.passed ? C.green : C.red)}>{runResult.passed ? "✓ runs" : "✗ error"}</span>}
        <button style={S.btn("ghost", "sm")} onClick={onRun} disabled={pyStatus !== "ready" || !value.trim()}>
          {pyStatus === "loading" ? <><Spinner />Loading</> : "▶ Run"}
        </button>
      </div>
      <CodeArea value={value} onChange={onChange}
        placeholder={"# Reference implementation\ndef solve(x, y):\n    ..."} rows={14}
        style={runResult !== null ? { borderRadius: "6px 6px 0 0" } : {}} />
      {runResult !== null && (
        <div style={{ padding: "8px 12px", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6,
          border: `1px solid ${runResult.passed ? C.green + "40" : C.red + "40"}`, borderTop: "none", borderRadius: "0 0 6px 6px",
          background: runResult.passed ? "#0D2818" : "#1A0D0D", color: runResult.passed ? C.green : C.red,
          whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 120, overflow: "auto" }}>
          {runResult.passed ? `✓ no errors${runResult.stdout ? `\n${runResult.stdout}` : ""}` : [runResult.error, runResult.stderr].filter(Boolean).join("\n")}
        </div>
      )}
    </div>
  );
}

// ─── Sub-problem editor ────────────────────────────────────────────────────────

function SubproblemEditor({ sub, onUpdate, runPython, pyStatus }) {
  const [goldenResult, setGoldenResult] = useState(null);
  return (
    <>
      <div style={S.fieldGroup}>
        <label style={S.label}>Function Signature</label>
        <input style={S.monoInput} value={sub.functionSignature}
          onChange={e => onUpdate("functionSignature", e.target.value)}
          placeholder="def compute_energy(psi: np.ndarray, dx: float) -> float:" spellCheck={false} />
      </div>
      <div style={S.fieldGroup}>
        <label style={S.label}>Prompt (sent to models)</label>
        <TextInput multiline rows={4} value={sub.prompt} onChange={v => onUpdate("prompt", v)}
          placeholder="Write the prompt that will be sent to models..." />
      </div>
      <div style={S.row}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GoldenSolutionPanel value={sub.goldenSolution}
            onChange={v => { onUpdate("goldenSolution", v); setGoldenResult(null); }}
            onRun={async () => setGoldenResult(await runPython(sub.goldenSolution))}
            pyStatus={pyStatus} runResult={goldenResult} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <UnitTestsEditor tests={sub.unitTests} goldenSolution={sub.goldenSolution}
            onUpdateTests={v => onUpdate("unitTests", v)} runPython={runPython} pyStatus={pyStatus} />
        </div>
      </div>
    </>
  );
}

// ─── Problem editor tab ────────────────────────────────────────────────────────

function ProblemEditorTab({ problem, setProblem, activeSubIdx, setActiveSubIdx, runPython, pyStatus }) {
  const sub = problem.subproblems[activeSubIdx];
  const updateSub = (field, val) => setProblem(p => ({
    ...p, subproblems: p.subproblems.map((s, i) => i === activeSubIdx ? { ...s, [field]: val } : s),
  }));
  const addSub = () => {
    if (problem.subproblems.length >= 4) return;
    setProblem(p => ({ ...p, subproblems: [...p.subproblems, makeSubproblem(p.subproblems.length + 1)] }));
  };
  const removeSub = idx => {
    if (problem.subproblems.length <= 1) return;
    setProblem(p => ({ ...p, subproblems: p.subproblems.filter((_, i) => i !== idx) }));
    setActiveSubIdx(i => Math.max(0, Math.min(i, problem.subproblems.length - 2)));
  };

  return (
    <div>
      {/* Problem metadata */}
      <div style={S.card}>
        <div style={S.cardHeader}><span style={S.cardTitle}>Scientific Problem</span></div>
        <div style={S.cardBody}>
          <div style={S.row}>
            <div style={{ ...S.fieldGroup, flex: 2 }}>
              <label style={S.label}>Problem Title</label>
              <TextInput value={problem.title} onChange={v => setProblem(p => ({ ...p, title: v }))}
                placeholder="e.g. Numerical integration of Schrödinger equation" />
            </div>
            <div style={{ ...S.fieldGroup, flex: 1 }}>
              <label style={S.label}>Paper Reference</label>
              <TextInput value={problem.paperRef} onChange={v => setProblem(p => ({ ...p, paperRef: v }))}
                placeholder="arXiv:xxxx.xxxxx or DOI" />
            </div>
          </div>
          <div style={S.fieldGroup}>
            <label style={S.label}>Problem Description</label>
            <TextInput multiline rows={3} value={problem.description}
              onChange={v => setProblem(p => ({ ...p, description: v }))}
              placeholder="Describe the scientific problem from the paper..." />
          </div>
        </div>
      </div>

      {/* Sub-problem selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {problem.subproblems.map((s, i) => {
          const tp = s.unitTests?.filter(t => t.result?.passed).length ?? 0;
          const tt = s.unitTests?.length ?? 0;
          const allPass = tt > 0 && tp === tt;
          return (
            <button key={s.id}
              style={{ ...S.btn(i === activeSubIdx ? "blue" : "default"), display: "flex", alignItems: "center", gap: 6 }}
              onClick={() => setActiveSubIdx(i)}>
              {s.label || `Sub-${i + 1}`}
              {tt > 0 && <span style={{ ...S.tag(allPass ? C.green : tp > 0 ? C.yellow : C.muted), fontSize: 9 }}>{tp}/{tt}</span>}
              {problem.subproblems.length > 1 && (
                <span style={{ color: "#ffffff60", fontSize: 10 }}
                  onClick={e => { e.stopPropagation(); removeSub(i); }}>✕</span>
              )}
            </button>
          );
        })}
        {problem.subproblems.length < 4 && (
          <button style={S.btn("ghost")} onClick={addSub}>+ Add Sub-problem</button>
        )}
      </div>

      {/* Active sub-problem */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>{sub.label}</span>
          <input style={{ ...S.input, width: 200, padding: "4px 8px", fontSize: 11 }}
            value={sub.label} onChange={e => updateSub("label", e.target.value)}
            placeholder="Sub-problem label" />
        </div>
        <div style={S.cardBody}>
          <SubproblemEditor key={sub.id} sub={sub} onUpdate={updateSub} runPython={runPython} pyStatus={pyStatus} />
        </div>
      </div>
    </div>
  );
}

// ─── Evaluation tab components ─────────────────────────────────────────────────

function TestResultRow({ name, passed, error }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", cursor: error ? "pointer" : "default" }}
        onClick={() => error && setExpanded(e => !e)}>
        <span style={{ fontSize: 13, color: passed ? C.green : C.red, flexShrink: 0, lineHeight: 1 }}>{passed ? "✓" : "✗"}</span>
        <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: passed ? C.text : C.red,
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {error && <span style={{ fontSize: 9, color: C.dim, flexShrink: 0 }}>{expanded ? "▲" : "▼"}</span>}
      </div>
      {expanded && error && (
        <div style={{ fontSize: 10, color: C.red, fontFamily: "'JetBrains Mono', monospace", background: "#1A0D0D",
          padding: "4px 8px", borderRadius: 4, marginBottom: 4, whiteSpace: "pre-wrap", wordBreak: "break-all",
          maxHeight: 120, overflow: "auto" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function ComparisonColumn({ title, subtitle, isGolden, code, testResults, onRunTests, isRunning, pyStatus }) {
  const passedCount = testResults ? testResults.filter(t => t.passed).length : null;
  const total = testResults ? testResults.length : null;
  const scoreColor = passedCount === null ? C.muted : passedCount === total ? C.green : passedCount === 0 ? C.red : C.yellow;

  return (
    <div style={{ minWidth: 280, flex: 1, border: `1px solid ${isGolden ? C.green + "40" : C.border}`,
      borderRadius: 8, display: "flex", flexDirection: "column", overflow: "hidden", background: C.bg1 }}>
      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`,
        background: isGolden ? "#0D2818" : C.bg2, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: subtitle ? 4 : 0 }}>
          {isGolden && <span style={S.tag(C.green)}>Reference</span>}
          <span style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{title}</span>
          {passedCount !== null && (
            <span style={{ ...S.tag(scoreColor), marginLeft: "auto" }}>{passedCount}/{total} tests</span>
          )}
        </div>
        {subtitle && <div style={{ fontSize: 10, color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}>{subtitle}</div>}
      </div>

      {/* Code */}
      <div style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.6,
        background: C.bg0, borderBottom: `1px solid ${C.border}`, height: 240, overflow: "auto", flexShrink: 0 }}>
        {code
          ? <span style={{ color: C.text, whiteSpace: "pre" }}>{code}</span>
          : <span style={{ color: C.dim }}>{isGolden ? "Add golden solution in Problem Editor." : "No output yet — run evaluation first."}</span>}
      </div>

      {/* Tests */}
      <div style={{ padding: "10px 14px", flex: 1, overflow: "auto" }}>
        {testResults ? (
          testResults.map((t, i) => <TestResultRow key={i} name={t.name} passed={t.passed} error={t.error} />)
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
            <span style={{ fontSize: 11, color: C.muted }}>
              {isGolden ? "Run tests against the golden solution to verify." : "Run evaluation to see test results."}
            </span>
            {isGolden && onRunTests && (
              <button style={S.btn("primary", "sm")} onClick={onRunTests}
                disabled={isRunning || pyStatus !== "ready"}>
                {isRunning ? <><Spinner /> Running…</> : "▶ Run Tests"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IterationSelector({ current, total, onChange }) {
  if (total === 0) return null;
  const chips = total <= 10;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11, color: C.muted }}>Iteration</span>
      {chips ? (
        Array.from({ length: total }, (_, i) => (
          <button key={i} style={{ ...S.btn(i === current ? "blue" : "default", "xs"), minWidth: 28, textAlign: "center" }}
            onClick={() => onChange(i)}>{i + 1}</button>
        ))
      ) : (
        <>
          <button style={S.btn("ghost", "xs")} onClick={() => onChange(Math.max(0, current - 1))} disabled={current === 0}>◀</button>
          <span style={{ fontSize: 12, color: C.text, minWidth: 56, textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>
            {current + 1} / {total}
          </span>
          <button style={S.btn("ghost", "xs")} onClick={() => onChange(Math.min(total - 1, current + 1))} disabled={current === total - 1}>▶</button>
        </>
      )}
    </div>
  );
}

function EvaluationTab({ problem, setProblem, runState, onRun, running, runLog, activeSubIdx, setActiveSubIdx, runPython, pyStatus }) {
  const [iteration, setIteration]         = useState(0);
  const [runningGolden, setRunningGolden] = useState(false);
  const [selectedModels, setSelectedModels] = useState(MODELS.map(m => m.id));
  const [passN, setPassN]                 = useState(3);
  const [selectedSubs, setSelectedSubs]   = useState(() => problem.subproblems.map(s => s.id));

  useEffect(() => { setSelectedSubs(problem.subproblems.map(s => s.id)); }, [problem.subproblems.length]);
  useEffect(() => { setIteration(0); }, [activeSubIdx]);

  const sub = problem.subproblems[activeSubIdx];
  const maxIter = Math.max(0, ...MODELS.map(m => runState[m.id]?.[sub.id]?.iterations?.length ?? 0));
  const safeIter = Math.min(iteration, Math.max(0, maxIter - 1));

  const goldenTestResults = sub.unitTests.every(t => t.result !== null)
    ? sub.unitTests.map(t => ({ name: t.name, passed: t.result.passed, error: t.result.error, stdout: t.result.stdout }))
    : null;

  const runGoldenTests = async () => {
    setRunningGolden(true);
    const updated = [...sub.unitTests];
    for (let i = 0; i < updated.length; i++) {
      const r = await runPython(`${sub.goldenSolution}\n\n${updated[i].code}`);
      updated[i] = { ...updated[i], result: r };
    }
    setProblem(p => ({
      ...p,
      subproblems: p.subproblems.map((s, idx) => idx === activeSubIdx ? { ...s, unitTests: updated } : s),
    }));
    setRunningGolden(false);
  };

  const modelColumns = MODELS.filter(m => runState[m.id]?.[sub.id]?.iterations?.length > 0);

  const toggleSub = id => setSelectedSubs(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Run Configuration ────────────────────────────────────────── */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>Run Configuration</span>
          {running && <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.blue }}><Spinner />{runLog[runLog.length - 1]?.msg || "Running…"}</span>}
          {!API_KEY && <span style={S.tag(C.yellow)}>⚠ Set VITE_ANTHROPIC_API_KEY in .env</span>}
        </div>
        <div style={{ ...S.cardBody, display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* Models */}
          <div style={{ flex: "0 0 220px" }}>
            <label style={S.label}>Models</label>
            <ModelDropdown selectedModels={selectedModels} onChange={setSelectedModels} />
          </div>

          {/* Sub-problems */}
          <div style={{ flex: "0 0 auto" }}>
            <label style={S.label}>Sub-problems</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {problem.subproblems.map((s, i) => (
                <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                  padding: "5px 10px", border: `1px solid ${selectedSubs.includes(s.id) ? C.blue + "60" : C.border}`,
                  borderRadius: 6, background: selectedSubs.includes(s.id) ? "#1F2937" : C.bg0 }}>
                  <input type="checkbox" checked={selectedSubs.includes(s.id)} onChange={() => toggleSub(s.id)}
                    style={{ accentColor: C.blue, cursor: "pointer" }} />
                  <span style={{ fontSize: 12, color: C.text }}>{s.label || `Sub-${i + 1}`}</span>
                </label>
              ))}
            </div>
          </div>

          {/* pass@n */}
          <div style={{ flex: "0 0 auto" }}>
            <label style={S.label}>pass@n</label>
            <PassNPicker value={passN} onChange={setPassN} />
          </div>

          {/* Run button */}
          <div style={{ marginLeft: "auto", alignSelf: "flex-end" }}>
            <button
              style={{ ...S.btn("primary"), padding: "9px 24px", fontSize: 13 }}
              onClick={() => onRun(selectedModels, selectedSubs, passN)}
              disabled={running || selectedModels.length === 0 || selectedSubs.length === 0}>
              {running
                ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Spinner />Running…</span>
                : "▶  Run Evaluation"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Comparison controls ──────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {/* Sub-problem picker */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: C.muted }}>Sub-problem</span>
          {problem.subproblems.map((s, i) => (
            <button key={s.id} style={S.btn(i === activeSubIdx ? "blue" : "default", "sm")} onClick={() => setActiveSubIdx(i)}>
              {s.label || `Sub-${i + 1}`}
            </button>
          ))}
        </div>
        {maxIter > 0 && (
          <>
            <div style={{ width: 1, height: 20, background: C.border }} />
            <IterationSelector current={safeIter} total={maxIter} onChange={setIteration} />
            <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
              {modelColumns.map(m => {
                const rate = runState[m.id][sub.id].passRate;
                return (
                  <span key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted }}>
                    {m.short} <span style={S.passCell(rate)}>{(rate * 100).toFixed(0)}%</span>
                  </span>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Comparison table ─────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
        {/* Golden */}
        <ComparisonColumn
          title="Golden Solution"
          subtitle={sub.functionSignature || undefined}
          isGolden
          code={sub.goldenSolution}
          testResults={goldenTestResults}
          onRunTests={runGoldenTests}
          isRunning={runningGolden}
          pyStatus={pyStatus}
        />
        {/* Model columns */}
        {modelColumns.length === 0 ? (
          <div style={{ flex: 1, minWidth: 280, display: "flex", alignItems: "center", justifyContent: "center",
            color: C.muted, fontSize: 12, border: `1px dashed ${C.border2}`, borderRadius: 8, padding: 40 }}>
            No model runs yet — click Run Evaluation above.
          </div>
        ) : (
          modelColumns.map(m => {
            const iter = runState[m.id][sub.id].iterations[safeIter];
            return (
              <ComparisonColumn
                key={m.id}
                title={m.label}
                subtitle={`Iteration ${safeIter + 1}  ·  pass@${maxIter}: ${(runState[m.id][sub.id].passRate * 100).toFixed(0)}%`}
                isGolden={false}
                code={iter?.code}
                testResults={iter?.testResults}
                pyStatus={pyStatus}
              />
            );
          })
        )}
      </div>

      {/* ── Run log ──────────────────────────────────────────────────── */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>Run Log</span>
          {runLog.length > 0 && <span style={S.badge()}>{runLog.length} entries</span>}
        </div>
        <div style={{ padding: "8px 16px", maxHeight: 160, overflow: "auto" }}>
          {runLog.length === 0
            ? <span style={{ fontSize: 11, color: C.dim }}>No runs yet.</span>
            : runLog.map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: C.muted, marginBottom: 3, lineHeight: 1.5, display: "flex", gap: 10 }}>
                  <span style={{ color: C.dim, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{e.time}</span>
                  <span>{e.msg}</span>
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}

// ─── Export tab ────────────────────────────────────────────────────────────────

function ExportTab({ problem, runState }) {
  const dl = (content, filename, type) =>
    Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([content], { type })), download: filename,
    }).click();

  const exportJSON = () => dl(
    JSON.stringify({ problem, evaluations: runState, exportedAt: new Date().toISOString() }, null, 2),
    `scicode_dataset_${Date.now()}.json`, "application/json"
  );
  const exportMarkdown = () => {
    let md = `# ${problem.title || "Untitled"}\n\n`;
    if (problem.paperRef) md += `**Reference:** ${problem.paperRef}\n\n`;
    if (problem.description) md += `${problem.description}\n\n`;
    for (const [i, s] of problem.subproblems.entries()) {
      md += `## ${s.label || `Sub-problem ${i + 1}`}\n\n`;
      if (s.functionSignature) md += `**Signature:** \`${s.functionSignature}\`\n\n`;
      if (s.prompt) md += `**Prompt:**\n${s.prompt}\n\n`;
      if (s.goldenSolution) md += `**Golden Solution:**\n\`\`\`python\n${s.goldenSolution}\n\`\`\`\n\n`;
      if (s.unitTests?.length) {
        md += `**Unit Tests:**\n`;
        for (const t of s.unitTests) md += `\`\`\`python\n# ${t.name}\n${t.code}\n\`\`\`\n\n`;
      }
    }
    dl(md, `scicode_problem_${Date.now()}.md`, "text/markdown");
  };

  let totalIter = 0, passedIter = 0, flagged = 0;
  for (const md of Object.values(runState ?? {}))
    for (const sd of Object.values(md)) {
      for (const iter of sd.iterations ?? []) { totalIter++; if (iter.passed) passedIter++; }
      if (sd.passRate != null && sd.passRate >= 0.1 && sd.passRate < 0.6) flagged++;
    }

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Summary */}
      <div style={S.card}>
        <div style={S.cardHeader}><span style={S.cardTitle}>Dataset Summary</span></div>
        <div style={{ ...S.cardBody, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          {[
            ["Sub-problems", problem.subproblems.length],
            ["Total iterations", totalIter],
            ["Overall pass rate", totalIter ? `${((passedIter / totalIter) * 100).toFixed(1)}%` : "—"],
            ["Flagged (10–60%)", flagged],
          ].map(([l, v]) => (
            <div key={l} style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 }}>{l}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-model summary */}
      {Object.keys(runState).length > 0 && (
        <div style={S.card}>
          <div style={S.cardHeader}><span style={S.cardTitle}>Model Scores</span></div>
          <div style={S.cardBody}>
            {MODELS.filter(m => runState[m.id]).map(m => {
              const rates = problem.subproblems.map(s => runState[m.id]?.[s.id]?.passRate ?? null).filter(r => r !== null);
              const avg = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                  borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{m.label}</span>
                  {problem.subproblems.map(s => {
                    const r = runState[m.id]?.[s.id]?.passRate ?? null;
                    return (
                      <div key={s.id} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>{s.label}</div>
                        <span style={S.passCell(r)}>{r !== null ? `${(r * 100).toFixed(0)}%` : "—"}</span>
                      </div>
                    );
                  })}
                  {avg !== null && (
                    <div style={{ textAlign: "center", marginLeft: 4 }}>
                      <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>Avg</div>
                      <span style={S.passCell(avg)}>{(avg * 100).toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Download */}
      <div style={{ display: "flex", gap: 12 }}>
        <button style={{ ...S.btn("blue"), padding: "10px 20px", fontSize: 13 }} onClick={exportJSON}>
          ⬇  Export Dataset JSON
        </button>
        <button style={{ ...S.btn("default"), padding: "10px 20px", fontSize: 13 }} onClick={exportMarkdown}>
          ⬇  Export Problem Markdown
        </button>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function SciCodeCanvas() {
  const [problem, setProblem]           = useState(EMPTY_PROBLEM);
  const [activeSubIdx, setActiveSubIdx] = useState(0);
  const [tab, setTab]                   = useState("editor");
  const [runState, setRunState]         = useState({});
  const [running, setRunning]           = useState(false);
  const [runLog, setRunLog]             = useState([]);

  const { pyStatus, runPython } = usePyodide();

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
      * { box-sizing: border-box; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: #0D1117; }
      ::-webkit-scrollbar-thumb { background: #30363D; border-radius: 3px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      textarea:focus, input:focus { border-color: #388BFD !important; outline: none; }
      button:hover:not(:disabled) { opacity: 0.85; }
      button:disabled { opacity: 0.45; cursor: not-allowed; }
    `;
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);

  const log = msg => setRunLog(prev => [...prev.slice(-100), { time: new Date().toLocaleTimeString(), msg }]);

  const handleRun = async (selectedModelIds, selectedSubIds, passN) => {
    setRunning(true);
    setRunLog([]);
    const newState = { ...runState };

    for (const modelId of selectedModelIds) {
      const model = MODELS.find(m => m.id === modelId);
      if (!newState[modelId]) newState[modelId] = {};

      for (const subId of selectedSubIds) {
        const sub = problem.subproblems.find(s => s.id === subId);
        if (!sub) continue;
        log(`Running ${model.short} on "${sub.label}"…`);

        const iterations = [];
        for (let i = 0; i < passN; i++) {
          try {
            log(`  → Generating ${i + 1}/${passN}…`);
            const code = await generateCodeWithModel(
              modelId,
              `You are a scientific computing assistant. Write clean Python code.\nContext: ${problem.description}\nFunction signature: ${sub.functionSignature || "(see prompt)"}\nReturn ONLY Python code, no markdown, no explanation.`,
              sub.prompt || `Implement: ${sub.functionSignature || sub.label}`
            );
            log(`  → Testing output ${i + 1} against ${sub.unitTests.length} test${sub.unitTests.length !== 1 ? "s" : ""}…`);
            const testResults = [];
            for (const t of sub.unitTests) {
              const r = await runPython(`${code}\n\n${t.code}`);
              testResults.push({ name: t.name, passed: r.passed, error: r.error, stdout: r.stdout });
            }
            iterations.push({ code, testResults, passed: testResults.every(r => r.passed) });
          } catch (err) {
            iterations.push({
              code: "",
              testResults: sub.unitTests.map(t => ({ name: t.name, passed: false, error: err.message, stdout: "" })),
              passed: false,
            });
          }
        }

        const passRate = iterations.filter(i => i.passed).length / iterations.length;
        newState[modelId][subId] = { iterations, passRate };
        setRunState({ ...newState });
        log(`  ✓ ${model.short} / ${sub.label}: ${(passRate * 100).toFixed(0)}% pass@${passN}`);
      }
    }

    setRunning(false);
    setTab("evaluation");
    log("✓ Evaluation complete.");
  };

  const evalBadge = Object.keys(runState).length;

  return (
    <div style={S.app}>
      {/* Topbar */}
      <div style={S.topbar}>
        <span style={S.logo}>⚗ SciCode</span>
        <span style={S.badge()}>Dataset Builder</span>
        <div style={{ flex: 1 }} />
        {running && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.blue }}>
            <Spinner />{runLog[runLog.length - 1]?.msg || "Running…"}
          </div>
        )}
        <span style={S.badge(pyStatus === "ready" ? C.green : pyStatus === "error" ? C.red : C.yellow)}>
          Python {pyStatus === "loading" ? "loading…" : pyStatus}
        </span>
      </div>

      {/* Tab bar */}
      <div style={S.tabBar}>
        <button style={S.tab(tab === "editor")} onClick={() => setTab("editor")}>Problem Editor</button>
        <button style={S.tab(tab === "evaluation")} onClick={() => setTab("evaluation")}>
          Evaluation
          {evalBadge > 0 && (
            <span style={{ ...S.badge(C.blue), padding: "1px 6px", fontSize: 10 }}>
              {evalBadge} model{evalBadge !== 1 ? "s" : ""}
            </span>
          )}
        </button>
        <button style={S.tab(tab === "export")} onClick={() => setTab("export")}>Export</button>
      </div>

      {/* Content */}
      <div style={S.page}>
        {tab === "editor" && (
          <ProblemEditorTab problem={problem} setProblem={setProblem}
            activeSubIdx={activeSubIdx} setActiveSubIdx={setActiveSubIdx}
            runPython={runPython} pyStatus={pyStatus} />
        )}
        {tab === "evaluation" && (
          <EvaluationTab problem={problem} setProblem={setProblem}
            runState={runState} onRun={handleRun} running={running} runLog={runLog}
            activeSubIdx={activeSubIdx} setActiveSubIdx={setActiveSubIdx}
            runPython={runPython} pyStatus={pyStatus} />
        )}
        {tab === "export" && (
          <ExportTab problem={problem} runState={runState} />
        )}
      </div>
    </div>
  );
}
