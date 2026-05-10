/* /audit — hash-chain viewer with verify */

const EventBadge = ({ t }) => {
  const cfg = {
    "case.created":              { c:"#5eead4", icon:"plus-circle"   },
    "agent.triage.completed":    { c:"#7dd3fc", icon:"zap"           },
    "agent.investigator.completed":{c:"#a5b4fc", icon:"git-branch"   },
    "approval.requested":        { c:"#fbbf24", icon:"hand"          },
    "approval.decided":          { c:"#34d399", icon:"check"         },
    "case.closed":               { c:"#94a3b8", icon:"archive"       },
    "killswitch.engaged":        { c:"#f87171", icon:"power-off"     },
    "killswitch.released":       { c:"#fbbf24", icon:"play"          },
    "prompt_injection.blocked":  { c:"#f472b6", icon:"shield-alert"  },
    "operator.login":            { c:"#94a3b8", icon:"log-in"        },
    "sanctions.screen":          { c:"#fda4af", icon:"search"        },
    "config.updated":            { c:"#94a3b8", icon:"settings"      },
  }[t] || { c:"#94a3b8", icon:"circle" };
  return (
    <span className="inline-flex items-center gap-1.5 mono text-[11px]" style={{ color: cfg.c }}>
      <Icon name={cfg.icon} className="size-3" />
      {t}
    </span>
  );
};

const PageAudit = () => {
  const [entries, setEntries] = React.useState([]);
  const [loadState, setLoadState] = React.useState("loading");
  const [filter, setFilter] = React.useState("all");
  const [verify, setVerify] = React.useState({ status: "idle", at: 0, msg: "", broken: null });
  const [expanded, setExpanded] = React.useState(null);

  React.useEffect(() => {
    fetch("/audit/chain?from=0")
      .then(r => r.json())
      .then(data => { setEntries(Array.isArray(data) ? data : []); setLoadState("ok"); })
      .catch(() => setLoadState("error"));
  }, []);

  const types = ["all", ...Array.from(new Set(entries.map(a => a.event_type)))];
  const filtered = entries.filter(a => filter === "all" || a.event_type === filter);

  const runVerify = async () => {
    setVerify({ status: "running", at: 0, msg: "calling /audit/verify…", broken: null });
    try {
      const resp = await fetch("/audit/verify");
      const data = await resp.json();
      if (data.valid) {
        setVerify({ status: "ok", at: data.total_entries, msg: `${data.total_entries} entries verified · chain intact · HMAC valid`, broken: null });
      } else {
        setVerify({ status: "fail", at: data.broken_at ?? 0, msg: `Chain broken at seq ${data.broken_at}`, broken: data.broken_at });
      }
    } catch (err) {
      setVerify({ status: "fail", at: 0, msg: `Verify failed: ${err.message}`, broken: -1 });
    }
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.16em] text-ink-400">Tamper-evident ledger</div>
          <h1 className="text-[22px] font-medium text-ink-50 mt-0.5">Audit chain</h1>
        </div>
        <div className="flex items-center gap-2">
          <select value={filter} onChange={e=>setFilter(e.target.value)}
            className="h-8 px-2 bg-ink-900 border border-ink-700 rounded-sm mono text-[11.5px] text-ink-200 focus:border-teal/60 outline-none">
            {types.map(t => <option key={t} value={t}>{t === "all" ? "all event types" : t}</option>)}
          </select>
          <Button><Icon name="download" className="size-3.5" /> Export NDJSON</Button>
        </div>
      </div>

      {/* Verify card */}
      <div className="bg-ink-900 border border-ink-700 rounded-md overflow-hidden">
        <div className="grid grid-cols-12 gap-px bg-ink-700">
          <div className="col-span-8 bg-ink-900 p-4">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-sm bg-teal-soft border border-teal-line inline-flex items-center justify-center">
                <Icon name="shield-check" className="size-4 text-teal" />
              </div>
              <div className="flex-1">
                <div className="mono text-[11px] uppercase tracking-[0.14em] text-ink-300">Chain integrity</div>
                <div className="text-[14px] text-ink-100 mt-0.5">Every entry is HMAC-sealed against the prior hash. Verification recomputes the chain entry-by-entry.</div>
              </div>
              <Button variant="primary" onClick={runVerify} disabled={verify.status==="running"}>
                {verify.status === "running"
                  ? <><Icon name="loader" className="size-3.5" /> Verifying…</>
                  : <><Icon name="shield-check" className="size-3.5" /> Verify chain integrity</>}
              </Button>
            </div>
            <div className="mt-3 h-2 rounded-sm bg-ink-800 overflow-hidden">
              <div className={cn("h-full transition-[width]",
                verify.status === "ok" ? "bg-emerald-500" : verify.status === "fail" ? "bg-red-500" : "bg-teal")}
                style={{ width: `${(verify.at/Math.max(entries.length, 1))*100}%` }} />
            </div>
            <div className="mt-2 mono text-[11px] flex items-center gap-2">
              {verify.status === "idle"   && <span className="text-ink-500">idle · click to verify</span>}
              {verify.status === "running"&& <span className="text-ink-300">{verify.msg}</span>}
              {verify.status === "ok"     && <><Icon name="check-circle" className="size-3.5 text-emerald-400" /><span className="text-emerald-300">{verify.msg}</span></>}
              {verify.status === "fail"   && <><Icon name="x-circle" className="size-3.5 text-red-400" /><span className="text-red-300">{verify.msg}</span></>}
            </div>
          </div>
          <div className="col-span-4 bg-ink-900 p-4 grid grid-cols-2 gap-3">
            <div>
              <div className="mono text-[10px] uppercase tracking-wider text-ink-400">Entries</div>
              <div className="text-[18px] tabular-nums mono text-ink-100">{entries.length.toLocaleString()}</div>
            </div>
            <div>
              <div className="mono text-[10px] uppercase tracking-wider text-ink-400">Genesis</div>
              <div className="mono text-[11px] text-ink-200 truncate">{entries[0]?.timestamp?.slice(0,16)+"Z" || "—"}</div>
            </div>
            <div>
              <div className="mono text-[10px] uppercase tracking-wider text-ink-400">Tip hash</div>
              {entries.length > 0
                ? <Hash value={entries[entries.length-1].hash} className="text-[11px]" />
                : <span className="mono text-[11px] text-ink-500">—</span>}
            </div>
            <div>
              <div className="mono text-[10px] uppercase tracking-wider text-ink-400">HMAC key</div>
              <div className="mono text-[11px] text-ink-200">kid-2026-q2</div>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-ink-900 border border-ink-700 rounded-md overflow-hidden">
        <div className="hair flex items-center px-3 h-9">
          <span className="mono text-[11px] uppercase tracking-[0.14em] text-ink-300">Entries</span>
          <span className="mx-2 text-ink-500">·</span>
          <span className="mono text-[11px] text-ink-500">{filtered.length} of {entries.length}</span>
          <div className="flex-1" />
          {loadState === "loading" && <span className="mono text-[11px] text-ink-500">Loading…</span>}
          {loadState === "error"   && <span className="mono text-[11px] text-red-400">Failed to load</span>}
          {loadState === "ok"      && <span className="mono text-[11px] text-ink-500">view: prev → hash → hmac (truncated)</span>}
        </div>
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-[12.5px]">
            <thead className="bg-ink-850 hair">
              <tr className="text-left">
                {["seq","timestamp","event_type","ref","prev_hash","hash","hmac",""].map(h => (
                  <th key={h} className="h-8 px-3 mono text-[10.5px] uppercase tracking-[0.12em] text-ink-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const ref = e.payload?.case_id || e.payload?.transaction_id || e.payload?.approval_id || "—";
                return (
                <React.Fragment key={e.seq}>
                  <tr className="row hair">
                    <td className="px-3 py-2 mono tabular-nums text-ink-100">{String(e.seq).padStart(5,"0")}</td>
                    <td className="px-3 py-2 mono text-ink-200 whitespace-nowrap">{fmtTimeAbs(e.timestamp)}</td>
                    <td className="px-3 py-2"><EventBadge t={e.event_type} /></td>
                    <td className="px-3 py-2 mono text-ink-300 text-[11px]">{ref}</td>
                    <td className="px-3 py-2"><Hash value={e.prev_hash} /></td>
                    <td className="px-3 py-2"><Hash value={e.hash} /></td>
                    <td className="px-3 py-2"><Hash value={e.hmac} /></td>
                    <td className="px-3 py-2 text-right">
                      <button className="btn h-7" onClick={()=>setExpanded(expanded===e.seq?null:e.seq)}>
                        <Icon name={expanded===e.seq?"chevron-up":"chevron-down"} className="size-3" />
                        {expanded===e.seq?"Collapse":"Expand"}
                      </button>
                    </td>
                  </tr>
                  {expanded === e.seq && (
                    <tr className="hair bg-ink-950">
                      <td colSpan={8} className="p-4">
                        <div className="grid grid-cols-12 gap-4">
                          <div className="col-span-7">
                            <div className="mono text-[10.5px] uppercase tracking-[0.14em] text-ink-400 mb-2">Payload</div>
                            <pre className="thin-scroll overflow-auto max-h-72 mono text-[11.5px] leading-[1.55] p-3 bg-ink-900 border border-ink-700 rounded">
{JSON.stringify(e.payload, null, 2)}
                            </pre>
                          </div>
                          <div className="col-span-5 space-y-2">
                            <div>
                              <div className="mono text-[10.5px] uppercase tracking-wider text-ink-400">Full prev_hash</div>
                              <div className="mono text-[11px] text-ink-200 break-all">{e.prev_hash}</div>
                            </div>
                            <div>
                              <div className="mono text-[10.5px] uppercase tracking-wider text-ink-400">Full hash</div>
                              <div className="mono text-[11px] text-emerald-300 break-all">{e.hash}</div>
                            </div>
                            <div>
                              <div className="mono text-[10.5px] uppercase tracking-wider text-ink-400">Full hmac</div>
                              <div className="mono text-[11px] text-teal break-all">{e.hmac}</div>
                            </div>
                            <div className="hair-t pt-2 mono text-[11px] text-ink-400">
                              hash = SHA256(prev_hash || ts || event_type || canonical(payload))<br/>
                              hmac = HMAC-SHA256(kid-2026-q2, hash)
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

window.PageAudit = PageAudit;
