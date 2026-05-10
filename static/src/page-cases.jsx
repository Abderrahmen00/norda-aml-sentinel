/* /cases — list view with sortable table, filters, density of metadata. */

const SORTS = {
  risk:   (a,b) => b.risk_score - a.risk_score,
  amount: (a,b) => b.amount - a.amount,
  time:   (a,b) => new Date(b.created_at) - new Date(a.created_at),
  status: (a,b) => a.status.localeCompare(b.status),
};

const SCENARIOS = [
  {
    label: "Structuring — below threshold",
    tag: "STRUCTURING", tagColor: "#f59e0b",
    fields: { amount_eur: "9450.00", currency: "EUR", receiver_account: "CY17002001280000001200527600", receiver_country: "CY", memo: "Invoice 88421 — consulting services Q2", channel: "sepa" },
  },
  {
    label: "Sanctions proximity — energy corridor",
    tag: "HIGH_RISK_GEO", tagColor: "#ef4444",
    fields: { amount_eur: "912000.00", currency: "EUR", receiver_account: "AZ21NABZ00000000137010001944", receiver_country: "AZ", memo: "Energy commodity prepayment — contract AZ-2026-04", channel: "swift" },
  },
  {
    label: "Rapid passthrough — UAE shell",
    tag: "RAPID_PASSTHROUGH", tagColor: "#f97316",
    fields: { amount_eur: "187400.00", currency: "EUR", receiver_account: "AE070331234567890123456", receiver_country: "AE", memo: "Service contract fulfillment — ref SC-AE-9921", channel: "swift" },
  },
  {
    label: "Round-amount cluster — DK corridor",
    tag: "ROUND_AMOUNT", tagColor: "#a78bfa",
    fields: { amount_eur: "50000.00", currency: "EUR", receiver_account: "DK5000400440116243", receiver_country: "DK", memo: "Advance payment", channel: "sepa" },
  },
  {
    label: "Custom transaction",
    tag: "MANUAL", tagColor: "#94a3b8",
    fields: { amount_eur: "", currency: "EUR", receiver_account: "", receiver_country: "", memo: "", channel: "sepa" },
  },
];

const Field = ({ label, hint, children }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <label className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-400">{label}</label>
      {hint && <span className="mono text-[10px] text-ink-500">{hint}</span>}
    </div>
    {children}
  </div>
);

const inp = "w-full h-8 px-2.5 bg-ink-950 border border-ink-700 rounded-sm mono text-[12px] text-ink-100 placeholder:text-ink-600 focus:border-teal/50 outline-none";

const SimulateModal = ({ onClose, onIngested }) => {
  const [scenarioIdx, setScenarioIdx] = React.useState(0);
  const [form, setForm] = React.useState({ ...SCENARIOS[0].fields });
  const [status, setStatus] = React.useState("idle");

  const pickScenario = (i) => {
    setScenarioIdx(i);
    setForm({ ...SCENARIOS[i].fields });
    setStatus("idle");
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const valid = form.amount_eur && parseFloat(form.amount_eur) > 0
    && form.receiver_account.trim()
    && form.receiver_country.trim().length === 2
    && form.channel;

  const run = async () => {
    if (!valid) return;
    setStatus("loading");
    try {
      const resp = await fetch("/transactions/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: [{
            amount_eur: parseFloat(form.amount_eur),
            currency: form.currency || "EUR",
            sender_account: "NO9386011117002",
            receiver_account: form.receiver_account.trim(),
            receiver_country: form.receiver_country.trim().toUpperCase(),
            memo: form.memo.trim() || null,
            channel: form.channel,
            timestamp: new Date().toISOString(),
          }],
        }),
      });
      if (!resp.ok) throw new Error(resp.status);
      setStatus("success");
      setTimeout(() => { onIngested(); onClose(); }, 2000);
    } catch {
      setStatus("error");
    }
  };

  const sc = SCENARIOS[scenarioIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-ink-900 border border-ink-700 rounded-lg w-[780px] max-h-[90vh] overflow-y-auto shadow-2xl thin-scroll">

        {/* Header */}
        <div className="h-12 px-4 flex items-center justify-between hair sticky top-0 bg-ink-900 z-10">
          <div className="flex items-center gap-2">
            <Icon name="send" className="size-4 text-teal" />
            <span className="mono text-[12px] uppercase tracking-[0.14em] text-ink-100">Ingest transaction</span>
            <span className="mono text-[10px] text-ink-500 ml-1">· routed through triage agent</span>
          </div>
          <button onClick={onClose} className="size-7 flex items-center justify-center text-ink-400 hover:text-ink-100">
            <Icon name="x" className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-12 gap-px bg-ink-700">

          {/* LEFT — scenario picker */}
          <div className="col-span-4 bg-ink-900 p-4 space-y-2">
            <div className="mono text-[10px] uppercase tracking-[0.16em] text-ink-400 mb-3">Scenario templates</div>
            {SCENARIOS.map((s, i) => (
              <button key={i} onClick={() => pickScenario(i)}
                className={cn("w-full text-left px-3 py-2.5 rounded-sm border transition-colors",
                  scenarioIdx === i ? "border-teal/40 bg-teal/5" : "border-ink-700 hover:border-ink-600 bg-ink-900")}>
                <div className="flex items-center gap-2">
                  <span className="mono text-[9px] px-1 h-4 inline-flex items-center rounded-sm border"
                    style={{ color: s.tagColor, borderColor: s.tagColor + "55", background: s.tagColor + "12" }}>
                    {s.tag}
                  </span>
                  {scenarioIdx === i && <Icon name="chevron-right" className="size-3 text-teal ml-auto" />}
                </div>
                <div className="text-[12px] text-ink-200 mt-1 leading-tight">{s.label}</div>
              </button>
            ))}

            <div className="hair-t pt-3 mono text-[10px] text-ink-500 leading-relaxed">
              Templates pre-fill the form. Edit any field before submitting.
            </div>
          </div>

          {/* RIGHT — form */}
          <div className="col-span-8 bg-ink-900 p-4 space-y-3">
            <div className="mono text-[10px] uppercase tracking-[0.16em] text-ink-400 mb-1">Transaction fields</div>

            {/* Amount + currency */}
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Field label="Amount" hint="EUR">
                  <input value={form.amount_eur} onChange={set("amount_eur")} type="number" step="0.01" min="0.01"
                    placeholder="0.00" className={inp} />
                </Field>
              </div>
              <Field label="Currency">
                <select value={form.currency} onChange={set("currency")} className={inp + " cursor-pointer"}>
                  {["EUR","USD","GBP","NOK","CHF"].map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </div>

            {/* Sender */}
            <Field label="Sender IBAN" hint="originator account">
              <input value="NO9386011117002 — Norda Bank Corporate" disabled
                className={inp + " text-ink-500 cursor-not-allowed"} />
            </Field>

            {/* Receiver */}
            <Field label="Receiver IBAN / account" hint="counterparty">
              <input value={form.receiver_account} onChange={set("receiver_account")}
                placeholder="e.g. AE070331234567890123456"
                className={inp} />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Receiver country" hint="ISO 2-char">
                <input value={form.receiver_country} onChange={set("receiver_country")}
                  maxLength={2} placeholder="AE"
                  className={inp + " uppercase"} />
              </Field>
              <Field label="Channel">
                <select value={form.channel} onChange={set("channel")} className={inp + " cursor-pointer"}>
                  {["sepa","swift","crypto","internal","faster_payments"].map(c => (
                    <option key={c} value={c}>{c.toUpperCase()}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Memo / narration" hint="transaction description">
              <textarea value={form.memo} onChange={set("memo")} rows={2}
                placeholder="e.g. Invoice 88421 — consulting services Q2"
                className={inp + " h-auto resize-none py-2 leading-snug"} />
            </Field>

            {/* Preview strip */}
            {form.amount_eur && form.receiver_country && (
              <div className="bg-ink-950 border border-ink-700 rounded-sm px-3 py-2 mono text-[11px] flex items-center gap-4 text-ink-300">
                <span className="text-ink-100 tabular-nums font-medium">{fmtAmount(parseFloat(form.amount_eur)||0, form.currency)}</span>
                <Icon name="arrow-right" className="size-3 text-ink-600" />
                <span>{form.receiver_country.toUpperCase()}</span>
                <span className="text-ink-500">via {(form.channel||"").toUpperCase()}</span>
                <span className="flex-1 truncate text-right text-ink-500 italic">{form.memo || "(no memo)"}</span>
              </div>
            )}

            {/* Submit */}
            {status === "success" ? (
              <div className="h-11 rounded-sm bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center gap-2 mono text-[12px] text-emerald-300">
                <Icon name="check-circle" className="size-4" />
                Transaction ingested — triage agent running · case will appear in feed
              </div>
            ) : status === "error" ? (
              <div className="h-11 rounded-sm bg-red-500/10 border border-red-500/30 flex items-center justify-center gap-2 mono text-[12px] text-red-300">
                <Icon name="alert-circle" className="size-4" />
                Ingest failed — is the server running?
              </div>
            ) : (
              <button onClick={run} disabled={!valid || status === "loading"}
                className={cn("w-full h-11 rounded-sm font-medium mono uppercase tracking-[0.16em] text-[12px] inline-flex items-center justify-center gap-2 border transition-colors",
                  !valid ? "bg-ink-800 border-ink-700 text-ink-500 cursor-not-allowed"
                  : status === "loading" ? "bg-teal/10 border-teal/30 text-teal/60"
                  : "bg-teal hover:bg-teal/90 border-teal text-ink-950")}>
                {status === "loading"
                  ? <><Icon name="loader" className="size-4" /> Submitting to ingest pipeline…</>
                  : <><Icon name="send" className="size-4" /> Submit transaction</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const PageCases = () => {
  const { cases, refreshCases } = useApp();
  const [sort, setSort] = React.useState("risk");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [simOpen, setSimOpen] = React.useState(false);

  const filtered = React.useMemo(() => {
    return cases
      .filter(c => statusFilter === "all" || c.status === statusFilter)
      .filter(c => !query || (c.id+c.counterparty.name+c.memo).toLowerCase().includes(query.toLowerCase()))
      .sort(SORTS[sort]);
  }, [cases, sort, statusFilter, query]);

  const stats = React.useMemo(() => ({
    total: cases.length,
    pending: cases.filter(c=>c.status==="pending_approval").length,
    open: cases.filter(c=>c.status==="open").length,
    closed: cases.filter(c=>c.status==="closed").length,
    critical: cases.filter(c=>c.risk_score>=80).length,
    notional: cases.reduce((a,c)=>a+c.amount, 0),
  }), [cases]);

  const SortHead = ({ k, children, align="left" }) => (
    <th className={cn("h-9 px-3 mono text-[11px] uppercase tracking-[0.12em] text-ink-400 cursor-pointer select-none",
      align==="right" && "text-right")}
      onClick={()=>setSort(k)}>
      <span className="inline-flex items-center gap-1">
        {children}
        {sort===k && <Icon name="arrow-down" className="size-3 text-teal" />}
      </span>
    </th>
  );

  return (
    <div className="px-4 py-4 space-y-4">
      {simOpen && <SimulateModal onClose={() => setSimOpen(false)} onIngested={refreshCases} />}

      {/* Section header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.16em] text-ink-400">Live case feed</div>
          <h1 className="text-[22px] font-medium text-ink-50 mt-0.5">Cases</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="seg">
            <button aria-pressed={statusFilter==="all"}              onClick={()=>setStatusFilter("all")}>All <span className="mono text-ink-500 ml-1">{stats.total}</span></button>
            <button aria-pressed={statusFilter==="pending_approval"} onClick={()=>setStatusFilter("pending_approval")}>Pending <span className="mono text-amber-300 ml-1">{stats.pending}</span></button>
            <button aria-pressed={statusFilter==="open"}             onClick={()=>setStatusFilter("open")}>Open <span className="mono text-ink-500 ml-1">{stats.open}</span></button>
            <button aria-pressed={statusFilter==="closed"}           onClick={()=>setStatusFilter("closed")}>Closed <span className="mono text-ink-500 ml-1">{stats.closed}</span></button>
          </div>
          <div className="relative">
            <Icon name="search" className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-ink-500" />
            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search id, counterparty, memo…"
              className="h-8 pl-7 pr-3 w-72 bg-ink-900 border border-ink-700 rounded-sm text-[12px] placeholder:text-ink-500 focus:border-teal/60 outline-none" />
          </div>
          <button onClick={() => setSimOpen(true)}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-sm border border-teal/40 bg-teal/10 hover:bg-teal/20 mono text-[11.5px] text-teal transition-colors">
            <Icon name="zap" className="size-3.5" /> Simulate
          </button>
          <Button><Icon name="download" className="size-3.5" /> Export</Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-5 gap-px bg-ink-700 border border-ink-700 rounded-md overflow-hidden">
        {[
          { k:"OPEN",       v: stats.open,       sub:"queue",     tone:"text-ink-100" },
          { k:"PENDING",    v: stats.pending,    sub:"approval",  tone:"text-amber-300" },
          { k:"CRITICAL",   v: stats.critical,   sub:"≥80 risk",  tone:"text-red-400" },
          { k:"NOTIONAL",   v: fmtAmount(stats.notional), sub:"24h", tone:"text-ink-100" },
          { k:"SLA",        v: "00:14:32",       sub:"to oldest pending", tone:"text-ink-100" },
        ].map(s => (
          <div key={s.k} className="bg-ink-900 px-4 py-3">
            <div className="mono text-[10px] uppercase tracking-[0.16em] text-ink-400">{s.k}</div>
            <div className={cn("mt-1 text-[20px] font-medium tabular-nums", s.tone)}>{s.v}</div>
            <div className="mono text-[10px] text-ink-500 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-ink-900 border border-ink-700 rounded-md overflow-hidden">
        <div className="hair flex items-center px-3 h-9 gap-3">
          <Icon name="radio" className="size-3.5 text-teal" />
          <span className="mono text-[11px] uppercase tracking-[0.14em] text-ink-300">Live · streaming from triage queue</span>
          <span className="mono text-[11px] text-ink-500">{filtered.length} of {cases.length} cases</span>
          <div className="flex-1" />
          <span className="mono text-[11px] text-ink-500">Updated {fmtTimeAbs("2026-05-10T11:42:00Z")}</span>
        </div>
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-[13px]">
            <thead className="bg-ink-850 hair">
              <tr>
                <th className="h-9 px-3 mono text-[11px] uppercase tracking-[0.12em] text-ink-400 text-left">ID</th>
                <SortHead k="time">Time</SortHead>
                <th className="h-9 px-3 mono text-[11px] uppercase tracking-[0.12em] text-ink-400 text-left">Counterparty</th>
                <SortHead k="amount" align="right">Amount</SortHead>
                <SortHead k="risk">Risk</SortHead>
                <SortHead k="status">Status</SortHead>
                <th className="h-9 px-3 mono text-[11px] uppercase tracking-[0.12em] text-ink-400 text-left">Red flags</th>
                <th className="h-9 px-3 mono text-[11px] uppercase tracking-[0.12em] text-ink-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => (
                <tr key={c.id} className={cn("row hair", idx===0 && "")}>
                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex items-center gap-2">
                      <span className={cn("size-1.5 rounded-full",
                        c.risk_score>=80 ? "bg-risk-high" : c.risk_score>=60 ? "bg-risk-mid" : "bg-risk-low")} />
                      <a href={`#/cases/${c.id}`} className="mono text-[12.5px] text-ink-100 hover:text-teal">{c.id}</a>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                    <div className="mono text-[12px] text-ink-200">{fmtTimeShort(c.created_at)}</div>
                    <div className="mono text-[10px] text-ink-500">{fmtTimeAbs(c.created_at)}</div>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <div className="text-ink-100 leading-tight">{c.counterparty.name}</div>
                    <div className="mono text-[10.5px] text-ink-500">{c.counterparty.country} · {c.counterparty.iban}</div>
                  </td>
                  <td className="px-3 py-2.5 align-middle text-right tabular-nums mono text-ink-100">
                    {fmtAmount(c.amount, c.currency)}
                    <div className="mono text-[10px] text-ink-500">{c.direction}</div>
                  </td>
                  <td className="px-3 py-2.5 align-middle"><RiskCell score={c.risk_score} /></td>
                  <td className="px-3 py-2.5 align-middle"><StatusPill status={c.status} /></td>
                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex flex-wrap gap-1 max-w-[260px]">
                      {c.flags.slice(0,3).map(f => <FlagChip key={f} code={f} />)}
                      {c.flags.length > 3 && <span className="mono text-[10px] text-ink-400">+{c.flags.length-3}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-middle text-right">
                    <div className="inline-flex items-center gap-1">
                      <a href={`#/cases/${c.id}`} className="btn"><Icon name="arrow-right" className="size-3.5" /> Open</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-[11px] text-ink-500 mono">
        Showing {filtered.length} cases · Sort: {sort} · Filter: {statusFilter} · Source: <span className="text-teal">live</span>
      </div>
    </div>
  );
};

window.PageCases = PageCases;
