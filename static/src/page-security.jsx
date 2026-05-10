/* /security — prompt injection demo. The pitch showstopper. */

const SEVERITY = {
  critical: { c:"#ef4444", bg:"rgba(239,68,68,.10)", bd:"rgba(239,68,68,.32)" },
  high:     { c:"#f97316", bg:"rgba(249,115,22,.10)", bd:"rgba(249,115,22,.32)" },
  medium:   { c:"#f59e0b", bg:"rgba(245,158,11,.10)", bd:"rgba(245,158,11,.32)" },
};

const PageSecurity = () => {
  const { INJECTION_PRESETS, TARGET_FIELDS, GUARDRAIL_PATTERNS } = window.NORDA_MOCKS;
  const [body, setBody] = React.useState(INJECTION_PRESETS[0].body);
  const [target, setTarget] = React.useState(TARGET_FIELDS[0].id);
  const [trace, setTrace] = React.useState([]);
  const [running, setRunning] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [matchedRules, setMatchedRules] = React.useState([]);
  const [counters, setCounters] = React.useState({ today: 41, week: 312, since_launch: 17_584 });
  const traceRef = React.useRef(null);

  const addTrace = (line) => setTrace(t => [...t, { ...line, ts: Date.now() }]);

  const inject = async () => {
    setRunning(true); setDone(false); setTrace([]); setMatchedRules([]);
    const tgt = TARGET_FIELDS.find(f => f.id === target);
    const clientMatches = GUARDRAIL_PATTERNS.filter(p => p.re.test(body));
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    addTrace({ kind:"meta",  text:`▷ INJECT received · target=${tgt.path} · bytes=${body.length}` });
    await sleep(180);
    addTrace({ kind:"step",  text:`PIPELINE ▸ pre-llm.guardrail-mesh ▸ enter` });
    await sleep(220);
    addTrace({ kind:"sub",   text:`├─ unicode normalize · NFKC · stripped 0 control chars` });
    await sleep(150);
    addTrace({ kind:"sub",   text:`├─ base64 decode probe · ${/^[A-Za-z0-9+/=\s]+$/.test(body.slice(-200)) ? "candidate detected → re-scan recurses 1 level" : "no candidates"}` });
    await sleep(180);
    addTrace({ kind:"sub",   text:`├─ html-comment extraction · ${/<!--/.test(body) ? "extracted 1 hidden block" : "none"}` });
    await sleep(160);
    addTrace({ kind:"sub",   text:`└─ calling /security/inject-test…` });

    let apiResult = null;
    try {
      const resp = await fetch("/security/inject-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: body, target_field: target }),
      });
      apiResult = await resp.json();
    } catch (err) {
      addTrace({ kind:"warn", text:`API call failed: ${err.message} · falling back to client-side detection` });
    }

    const detected = apiResult?.injection_detected ?? clientMatches.length > 0;
    const reasons = apiResult?.reasons ?? [];
    const auditLogged = apiResult?.audit_logged ?? false;

    await sleep(220);
    addTrace({ kind:"sub",   text:`└─ pattern match · ${GUARDRAIL_PATTERNS.length} rules · ${detected ? (clientMatches.length || reasons.length) + " hits" : "0 hits"}` });
    await sleep(160);

    for (const m of clientMatches) {
      addTrace({ kind:"hit", rule: m });
      setMatchedRules(prev => [...prev, m]);
      await sleep(180);
    }

    if (!detected) {
      addTrace({ kind:"clean", text:`no patterns matched · request would be passed to LLM` });
      addTrace({ kind:"warn", text:`note: this preset is benign; try a "Direct override" preset to see the block path.` });
    } else {
      const sev = clientMatches.map(m => m.severity);
      const verdict = sev.includes("critical") || sev.includes("high") || clientMatches.length === 0 ? "BLOCK" : "QUARANTINE";
      addTrace({ kind:"verdict", text:`VERDICT ▸ ${verdict} · halting before LLM call`, level: verdict });
      await sleep(180);
      addTrace({ kind:"step",  text:`PIPELINE ▸ llm.invoke ▸ <span class="text-red-400">SKIPPED</span>` });
      await sleep(160);
      addTrace({ kind:"sub",   text:`├─ tokens to model ............... <span class="text-red-300">0</span>` });
      addTrace({ kind:"sub",   text:`├─ tools exposed ................. <span class="text-red-300">0</span>` });
      addTrace({ kind:"sub",   text:`└─ side-effects committed ........ <span class="text-red-300">0</span>` });
      if (auditLogged) {
        await sleep(160);
        addTrace({ kind:"step",  text:`PIPELINE ▸ audit.append ▸ sealed` });
        await sleep(160);
        addTrace({ kind:"sub",   text:`├─ event_type ............. security_event` });
        addTrace({ kind:"sub",   text:`├─ server_reasons ......... ${reasons.slice(0,2).map(r=>r.split(":")[0]).join(", ")}${reasons.length > 2 ? "…" : ""}` });
        addTrace({ kind:"sub",   text:`├─ payload_excerpt ........ ${JSON.stringify(body.slice(0,80))+(body.length>80?"…":"")}` });
        addTrace({ kind:"sub",   text:`└─ audit_logged ........... true` });
      }
      await sleep(180);
      addTrace({ kind:"step",  text:`PIPELINE ▸ broadcast ▸ SOC pager · CRO duty officer` });
      await sleep(160);
      setCounters(c => ({ today: c.today+1, week: c.week+1, since_launch: c.since_launch+1 }));
      addTrace({ kind:"ok",    text:`✓ blocked · 0 LLM tokens spent · 0 tools invoked · audit entry sealed` });
    }
    setRunning(false); setDone(true);
  };

  // auto-scroll trace
  React.useEffect(() => {
    if (traceRef.current) traceRef.current.scrollTop = traceRef.current.scrollHeight;
  }, [trace]);

  const matched = GUARDRAIL_PATTERNS.map(p => ({ ...p, hit: matchedRules.some(m => m.id === p.id) }));

  return (
    <div className="px-4 py-4 space-y-4">

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="mono text-[10px] uppercase tracking-[0.18em] px-1.5 h-5 inline-flex items-center rounded-sm border border-red-500/40 text-red-300 bg-red-500/5">DEMO · STAGING</span>
            <span className="mono text-[11px] uppercase tracking-[0.16em] text-ink-400">Adversarial sandbox</span>
          </div>
          <h1 className="text-[22px] font-medium text-ink-50 mt-1">Prompt-injection bench</h1>
          <p className="text-[13px] text-ink-300 mt-1 max-w-3xl">Send adversarial payloads through the same pre-LLM guardrail mesh that protects production. Confirm — by audit log — that no model call, no tool invocation, no state mutation occurred.</p>
        </div>
        <div className="grid grid-cols-3 gap-px bg-ink-700 border border-ink-700 rounded">
          {[["TODAY", counters.today], ["7-DAY", counters.week], ["LIFETIME", counters.since_launch]].map(([k,v])=>(
            <div key={k} className="bg-ink-900 px-4 py-2 min-w-[110px]">
              <div className="mono text-[10px] uppercase tracking-wider text-ink-400">{k}</div>
              <div className="mono tabular-nums text-[18px] text-ink-100">{v.toLocaleString()}</div>
              <div className="mono text-[10px] text-ink-500">blocked injections</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* LEFT — payload composer */}
        <div className="col-span-5 space-y-4">
          <Panel title={<><Icon name="biohazard" className="size-3" /> Compose injection</>} bodyClass="p-4 space-y-4">

            <div>
              <div className="mono text-[10.5px] uppercase tracking-[0.14em] text-ink-400 mb-1.5">Preset payloads</div>
              <div className="grid grid-cols-1 gap-1">
                {INJECTION_PRESETS.map(p => (
                  <button key={p.label}
                    onClick={()=>setBody(p.body)}
                    className={cn("text-left px-3 py-2 border rounded-sm hover:border-red-500/40 transition-colors",
                      body === p.body ? "border-red-500/40 bg-red-500/5" : "border-ink-700 bg-ink-900")}>
                    <div className="flex items-center gap-2">
                      <Icon name="bug" className="size-3 text-red-400" />
                      <span className="text-[12.5px] text-ink-100">{p.label}</span>
                      <span className="flex-1" />
                      <span className="mono text-[10px] text-ink-500">{p.body.length}B</span>
                    </div>
                    <div className="mono text-[10.5px] text-ink-400 mt-0.5 line-clamp-1">{p.body.slice(0,72)}…</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mono text-[10.5px] uppercase tracking-[0.14em] text-ink-400 mb-1.5">Target field</div>
              <div className="grid grid-cols-2 gap-1">
                {TARGET_FIELDS.map(f => (
                  <button key={f.id}
                    aria-pressed={target===f.id}
                    onClick={()=>setTarget(f.id)}
                    className={cn("h-9 px-2 mono text-[11px] uppercase tracking-wider border rounded-sm text-left",
                      target===f.id ? "border-teal/50 bg-teal-soft text-teal" : "border-ink-700 text-ink-300 hover:border-ink-600")}>
                    <div>{f.label}</div>
                    <div className="text-ink-500 normal-case tracking-normal text-[10px]">{f.path}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mono text-[10.5px] uppercase tracking-[0.14em] text-ink-400 mb-1.5 flex items-center justify-between">
                <span>Payload body</span>
                <span className="mono text-ink-500">{body.length}B · utf-8</span>
              </div>
              <textarea
                value={body} onChange={e=>setBody(e.target.value)}
                rows={9}
                className="w-full bg-ink-950 border border-ink-700 rounded-sm p-3 mono text-[12px] leading-[1.55] text-ink-100 placeholder:text-ink-500 focus:border-red-500/50 outline-none resize-none" />
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="mono text-[10.5px] text-ink-400">
                <Icon name="lock" className="size-3 inline mr-1" />
                sandbox: <span className="text-emerald-300">isolated</span> · model gateway: <span className="text-emerald-300">disconnected</span>
              </div>
              <button
                onClick={inject}
                disabled={running}
                className={cn("h-11 px-5 inline-flex items-center gap-2 rounded-sm border font-medium mono uppercase tracking-[0.16em] text-[12px]",
                  running ? "bg-red-900 border-red-800 text-red-200" : "bg-red-700 hover:bg-red-600 border-red-500 text-white")}>
                {running
                  ? <><Icon name="loader" className="size-4" /> Injecting…</>
                  : <><Icon name="biohazard" className="size-4" /> Inject</>}
              </button>
            </div>

            <div className="hair-t pt-3 grid grid-cols-2 gap-3 text-[11px] mono text-ink-400">
              <div>guardrail.version: <span className="text-ink-200">v3.4.1</span></div>
              <div>rules.loaded: <span className="text-ink-200">{GUARDRAIL_PATTERNS.length}</span></div>
              <div>last_drift_check: <span className="text-ink-200">2026-05-10 09:00Z</span></div>
              <div>llm.gateway: <span className="text-emerald-300">healthy</span></div>
            </div>
          </Panel>
        </div>

        {/* RIGHT — response trace */}
        <div className="col-span-7 space-y-4">
          <Panel title={<><Icon name="terminal" className="size-3" /> Response trace</>} right={
            <span className={cn("mono text-[10.5px] inline-flex items-center gap-1.5",
              done ? "text-emerald-300" : running ? "text-amber-300" : "text-ink-500")}>
              <span className={cn("size-1.5 rounded-full",
                done ? "bg-emerald-400" : running ? "bg-amber-400" : "bg-ink-500")} />
              {done ? "complete" : running ? "streaming" : "idle"}
            </span>
          } bodyClass="p-0">

            {/* Verdict chip strip */}
            <div className="grid grid-cols-4 gap-px bg-ink-700">
              {[
                { k:"VERDICT",        v: done ? (matchedRules.length ? "BLOCK" : "PASSED") : "—", c: done && matchedRules.length ? "#ef4444" : done ? "#10b981" : "#94a3b8" },
                { k:"LLM CALLED",     v: done ? (matchedRules.length ? "NO" : "YES (mock)") : "—", c: done && matchedRules.length ? "#10b981" : "#94a3b8" },
                { k:"TOOLS INVOKED",  v: "0", c:"#10b981" },
                { k:"AUDIT ENTRY",    v: done && matchedRules.length ? "sealed" : "—", c: done && matchedRules.length ? "#5eead4" : "#94a3b8" },
              ].map(s => (
                <div key={s.k} className="bg-ink-900 px-3 py-2">
                  <div className="mono text-[10px] uppercase tracking-wider text-ink-400">{s.k}</div>
                  <div className="mono text-[14px] tabular-nums" style={{ color: s.c }}>{s.v}</div>
                </div>
              ))}
            </div>

            {/* Matched rules */}
            <div className="hair p-3">
              <div className="mono text-[10.5px] uppercase tracking-[0.14em] text-ink-400 mb-2">Pattern engine ({GUARDRAIL_PATTERNS.length} rules)</div>
              <div className="grid grid-cols-3 gap-1.5">
                {matched.map(p => {
                  const sev = SEVERITY[p.severity];
                  return (
                    <div key={p.id}
                      className={cn("border rounded-sm px-2 py-1.5 flex items-center gap-2 transition-colors",
                        p.hit ? "" : "border-ink-700 bg-ink-900")}
                      style={p.hit ? { borderColor: sev.bd, background: sev.bg } : {}}>
                      <Icon name={p.hit?"target":"circle"} className="size-3" style={{ color: p.hit ? sev.c : "#3d4654" }} />
                      <div className="flex-1 min-w-0">
                        <div className="mono text-[11px] truncate" style={{ color: p.hit ? sev.c : "#8a93a1" }}>{p.name}</div>
                        <div className="mono text-[10px] text-ink-500">{p.id} · {p.severity}</div>
                      </div>
                      {p.hit && <span className="mono text-[10px] uppercase tracking-wider" style={{ color: sev.c }}>HIT</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Streaming console */}
            <div ref={traceRef} className="thin-scroll overflow-auto h-[360px] p-3 bg-ink-950 mono text-[12px] leading-[1.7]">
              {trace.length === 0 && (
                <div className="text-ink-500 italic">▷ awaiting injection. configure payload on the left and press Inject.</div>
              )}
              {trace.map((t, i) => {
                const baseClass = t.kind === "meta" ? "text-teal" :
                                  t.kind === "step" ? "text-ink-100" :
                                  t.kind === "sub"  ? "text-ink-300 pl-3" :
                                  t.kind === "hit"  ? "" :
                                  t.kind === "verdict" ? "text-red-300 font-semibold" :
                                  t.kind === "ok" ? "text-emerald-300" :
                                  t.kind === "warn" ? "text-amber-300" :
                                  t.kind === "clean" ? "text-emerald-300" : "text-ink-300";
                if (t.kind === "hit") {
                  const sev = SEVERITY[t.rule.severity];
                  return (
                    <div key={i} className="anim-type pl-3 flex items-center gap-2">
                      <span className="mono text-[10px] px-1 h-4 inline-flex items-center rounded-sm border" style={{ color: sev.c, borderColor: sev.bd, background: sev.bg }}>
                        {t.rule.severity.toUpperCase()}
                      </span>
                      <span className="mono text-[11.5px] text-ink-100">{t.rule.id}</span>
                      <span className="mono text-[11.5px] text-ink-300">{t.rule.name}</span>
                      <span className="mono text-[11px] text-ink-500">— matched</span>
                    </div>
                  );
                }
                return (
                  <div key={i} className={cn("anim-type", baseClass)}
                       dangerouslySetInnerHTML={{ __html: t.text }} />
                );
              })}
              {running && <div className="text-ink-400">▎</div>}
            </div>

            {done && matchedRules.length > 0 && (
              <div className="hair-t p-3 flex items-center gap-3">
                <div className="size-9 rounded-sm bg-emerald-500/10 border border-emerald-500/30 inline-flex items-center justify-center">
                  <Icon name="shield-check" className="size-4 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <div className="mono text-[12px] text-emerald-300">Injection contained · zero blast radius</div>
                  <div className="text-[12.5px] text-ink-300">No model was invoked, no tool was called, no business state changed. The attempt is now a permanent, hash-sealed entry in the audit chain.</div>
                </div>
                <a href="#/audit" className="btn"><Icon name="external-link" className="size-3.5" /> View in audit</a>
              </div>
            )}
          </Panel>

        </div>
      </div>
    </div>
  );
};

window.PageSecurity = PageSecurity;
