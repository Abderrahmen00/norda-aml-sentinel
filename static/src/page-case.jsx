/* /cases/[id] — full case view with sticky sides + center timeline */

const JsonViewer = ({ data, defaultOpen = false }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  const text = JSON.stringify(data, null, 2);
  return (
    <div className="border border-ink-700 rounded-sm bg-ink-950">
      <button onClick={()=>setOpen(o=>!o)}
        className="w-full h-8 px-2 flex items-center justify-between text-left">
        <span className="mono text-[11px] uppercase tracking-[0.12em] text-ink-300 inline-flex items-center gap-2">
          <Icon name={open?"chevron-down":"chevron-right"} className="size-3.5" />
          structured_output.json
        </span>
        <span className="mono text-[10px] text-ink-500">{Object.keys(data).length} keys · {text.length}B</span>
      </button>
      {open && (
        <pre className="thin-scroll overflow-auto max-h-72 px-3 pb-3 mono text-[11.5px] leading-[1.55] text-ink-200">{
          text.split("\n").map((line, i) => {
            const m = line.match(/^(\s*)"([^"]+)":\s*(.*)$/);
            if (m) return (
              <div key={i}><span>{m[1]}</span><span className="text-teal">"{m[2]}"</span><span className="text-ink-400">: </span><span className="text-ink-100">{m[3]}</span></div>
            );
            return <div key={i} className="text-ink-300">{line}</div>;
          })
        }</pre>
      )}
    </div>
  );
};

const TimelineNode = ({ step, last }) => {
  const isTriage = step.agent === "triage";
  return (
    <div className="relative pl-10">
      {/* dot + line */}
      <div className="absolute left-3 top-1.5 size-2.5 rounded-full" style={{ background: isTriage ? "#14b8a6" : "#f59e0b", boxShadow:"0 0 0 4px #0b0e14, 0 0 0 5px #1b212c" }} />
      {!last && <div className="absolute left-[15px] top-5 bottom-0 w-px bg-ink-700" />}
      <div className="bg-ink-900 border border-ink-700 rounded-md">
        <div className="h-9 px-3 flex items-center gap-3 hair">
          <span className="mono text-[11px] uppercase tracking-[0.14em]" style={{ color: isTriage ? "#5eead4" : "#fbbf24" }}>{step.agent_label}</span>
          <span className="mono text-[10.5px] text-ink-500">{step.version}</span>
          <span className="flex-1" />
          <span className="mono text-[11px] text-ink-300">{fmtTimeAbs(step.at)}</span>
          <span className="mono text-[11px] text-ink-500">· {step.duration_ms}ms</span>
        </div>
        <div className="p-3 space-y-3">
          <div>
            <div className="mono text-[10.5px] uppercase tracking-[0.14em] text-ink-400 mb-1.5">Reasoning trace</div>
            <ol className="space-y-1.5">
              {step.reasoning.map((r, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-ink-200">
                  <span className="mono text-[10.5px] text-ink-500 w-6 shrink-0 pt-0.5">{String(i+1).padStart(2,"0")}</span>
                  <span>{r}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="mono text-[10.5px] uppercase tracking-[0.14em] text-ink-400">Flags raised:</span>
            {step.flags.length === 0 && <span className="text-[12px] text-ink-500">none</span>}
            {step.flags.map(f => <FlagChip key={f} code={f} />)}
          </div>
          <div className="flex items-center gap-3">
            <span className="mono text-[10.5px] uppercase tracking-[0.14em] text-ink-400">Recommendation:</span>
            <span className="mono text-[12px] px-2 h-6 inline-flex items-center rounded-sm border"
              style={{
                color: step.recommendation==="CLEAR"?"#34d399":step.recommendation==="ESCALATE"?"#f59e0b":step.recommendation==="HOLD_FOR_APPROVAL"?"#fbbf24":step.recommendation==="FILE_SAR"?"#fb7185":"#94a3b8",
                background: "rgba(245,158,11,.06)",
                borderColor: "#1b212c",
              }}>
              {step.recommendation}
            </span>
          </div>
          <JsonViewer data={step.output} />
        </div>
      </div>
    </div>
  );
};

const ApprovalPanel = ({ c, onDecide }) => {
  const [decision, setDecision] = React.useState(null);
  const [note, setNote] = React.useState("");
  const valid = note.trim().length >= 12;

  if (c.status === "closed") {
    return (
      <Panel title="Approval — closed">
        <div className="text-[13px] text-ink-300">This case is closed. No further approval action is required.</div>
        {c.last_decision && (
          <div className="mt-3 mono text-[11px] text-ink-400">
            <div>decision: <span className={c.last_decision.decision==="approved"?"text-emerald-300":"text-red-300"}>{c.last_decision.decision}</span></div>
            <div>by: <span className="text-ink-200">{c.last_decision.by}</span></div>
            <div className="mt-1 text-ink-300 break-words">"{c.last_decision.note}"</div>
          </div>
        )}
      </Panel>
    );
  }
  const required = c.requires_approval;
  return (
    <Panel title={required ? "Approval required" : "Operator decision"} right={
      required ? (
        <span className="mono text-[10.5px] text-amber-300 inline-flex items-center gap-1">
          <Icon name="clock" className="size-3" /> SLA 14:32
        </span>
      ) : (
        <span className="mono text-[10.5px] text-ink-400 inline-flex items-center gap-1">
          <Icon name="info" className="size-3" /> optional
        </span>
      )
    } bodyClass="p-0">
      <div className="p-4 space-y-4">

        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <div className="bg-ink-850 border border-ink-700 rounded p-2">
            <div className="mono text-[10px] uppercase tracking-wider text-ink-400">Risk</div>
            <RiskCell score={c.risk_score} compact />
          </div>
          <div className="bg-ink-850 border border-ink-700 rounded p-2">
            <div className="mono text-[10px] uppercase tracking-wider text-ink-400">Recommendation</div>
            <div className={cn("mono text-[12px] mt-1", required ? "text-amber-300" : "text-ink-200")}>
              {required ? "HOLD_FOR_APPROVAL" : c.risk_score >= 60 ? "ESCALATE" : "MONITOR"}
            </div>
          </div>
        </div>

        <div>
          <label className="text-[12px] font-medium text-ink-100 flex items-center gap-1.5">
            <Icon name="edit-3" className="size-3.5 text-teal" />
            Operator note <span className="text-red-400">*</span>
            <span className="mono text-[10px] text-ink-500 ml-auto">type here ↓</span>
          </label>
          <textarea
            value={note} onChange={e=>setNote(e.target.value)}
            placeholder="Type your rationale here — what did you check, why approve / reject? (min 12 chars)"
            autoFocus
            className={cn("mt-1.5 w-full h-28 bg-ink-950 border-2 rounded-sm p-2.5 text-[12.5px] placeholder:text-ink-500 outline-none resize-none transition-colors",
              valid ? "border-emerald-500/40 focus:border-emerald-400" : "border-amber-500/40 focus:border-teal")} />
          <div className="mt-1 flex items-center justify-between mono text-[10.5px] text-ink-500">
            <span>{note.length}/2000</span>
            <span>{valid ? <span className="text-emerald-400">✓ ready to submit</span> : <span className="text-amber-300">{Math.max(0,12-note.trim().length)} more chars to unlock buttons</span>}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mono text-[11px] text-ink-300">
          <Icon name="user" className="size-3.5 text-ink-400" />
          <span>Acting as</span>
          <span className="text-ink-100">{window.NORDA_MOCKS.MOCK_OPERATOR.id}</span>
          <span className="text-ink-500">·</span>
          <span>{window.NORDA_MOCKS.MOCK_OPERATOR.role}</span>
        </div>

        {!valid && (
          <div className="bg-amber-500/5 border border-amber-500/30 rounded p-2 flex items-start gap-2 mono text-[11px] text-amber-200">
            <Icon name="alert-circle" className="size-3.5 mt-0.5 shrink-0" />
            <span>Buttons unlock once the operator note reaches 12 characters. Notes are mandatory and stored in the audit chain.</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={!valid}
            title={valid ? "" : "Enter at least 12 characters in the operator note above to enable"}
            onClick={()=>{ setDecision("approved"); onDecide("approve", note); }}
            className={cn("h-11 rounded-sm font-medium mono uppercase tracking-[0.14em] text-[12px] inline-flex items-center justify-center gap-2 border",
              valid ? "bg-emerald-600/90 hover:bg-emerald-500 border-emerald-400 text-white"
                    : "bg-ink-800 border-ink-700 text-ink-500 cursor-not-allowed")}>
            <Icon name="check" className="size-4" /> Approve
          </button>
          <button
            disabled={!valid}
            title={valid ? "" : "Enter at least 12 characters in the operator note above to enable"}
            onClick={()=>{ setDecision("rejected"); onDecide("reject", note); }}
            className={cn("h-11 rounded-sm font-medium mono uppercase tracking-[0.14em] text-[12px] inline-flex items-center justify-center gap-2 border",
              valid ? "bg-red-700/90 hover:bg-red-600 border-red-500 text-white"
                    : "bg-ink-800 border-ink-700 text-ink-500 cursor-not-allowed")}>
            <Icon name="x" className="size-4" /> Reject
          </button>
        </div>

        {decision && (
          <div className="bg-emerald-500/5 border border-emerald-500/30 rounded p-2 mono text-[11px] text-emerald-300 inline-flex items-center gap-2">
            <Icon name="check-circle" className="size-3.5" />
            Decision logged · audit_seq +1 · webhook → bookkeeping.dispatch
          </div>
        )}

        <div className="hair-t pt-3 mono text-[11px] text-ink-500 leading-relaxed">
          By submitting, you affirm that you have reviewed the agent reasoning trace, structured outputs and counterparty evidence in accordance with internal policy <span className="text-ink-300">CMP-AML-04 §7.2</span>. Decisions are HMAC-sealed against entry seq+1 in the audit chain.
        </div>
      </div>
    </Panel>
  );
};

const PageCase = ({ id }) => {
  const { setCases, refreshCases } = useApp();
  const [c, setC] = React.useState(null);
  const [loadErr, setLoadErr] = React.useState(false);
  const [investigating, setInvestigating] = React.useState(false);
  const [invResult, setInvResult] = React.useState(null);

  const load = React.useCallback(() => {
    fetch(API_BASE + "/api/cases/" + encodeURIComponent(id))
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(setC)
      .catch(() => setLoadErr(true));
  }, [id]);

  React.useEffect(() => { load(); }, [load]);

  if (loadErr) return (
    <div className="p-8">
      <div className="bg-ink-900 border border-ink-700 rounded-md p-6 text-center">
        <div className="mono text-[12px] text-ink-400 uppercase tracking-wider">404 · case not found</div>
        <div className="text-[14px] text-ink-200 mt-2">No case with id {id} exists.</div>
        <a href="#/cases" className="btn mt-4 inline-flex"><Icon name="arrow-left" className="size-3.5" /> Back to cases</a>
      </div>
    </div>
  );
  if (!c) return <div className="p-8 text-ink-400 mono text-[13px]">Loading case…</div>;

  // Build timeline from real agent decisions
  const timeline = (c.decisions || []).map(d => ({
    agent: d.agent_id,
    agent_label: d.agent_id === "triage" ? "Triage Agent" : "Investigator Agent",
    version: d.agent_version || "v1.0",
    at: d.created_at,
    duration_ms: 0,
    reasoning: [
      d.agent_id === "triage"
        ? `Risk score: ${d.output.risk_score}/100 · recommendation: ${d.output.recommendation}`
        : `Recommendation: ${d.output.recommendation}`,
      d.output.reasoning || "",
      ...(d.output.evidence || []),
    ].filter(Boolean),
    flags: (d.output.red_flags || []).map(f => f.toUpperCase()),
    recommendation: (d.output.recommendation || "").toUpperCase(),
    output: d.output,
  }));

  const approvalId = c.approval?.id || (c.decisions || []).find(d => d.approval_id)?.approval_id;

  const onDecide = (decision, note) => {
    if (!approvalId) return;
    fetch(API_BASE + "/approvals/" + approvalId + "/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, operator_id: "OP-A.JENDOUBI", note }),
    }).then(() => { load(); if (refreshCases) refreshCases(); });
  };

  const onInvestigate = () => {
    setInvestigating(true);
    fetch(API_BASE + "/cases/" + id + "/investigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triggered_by: "OP-A.JENDOUBI" }),
    })
      .then(r => r.json())
      .then(r => { setInvResult(r); setInvestigating(false); load(); if (refreshCases) refreshCases(); })
      .catch(() => setInvestigating(false));
  };

  // c0 shape for ApprovalPanel (needs status + requires_approval)
  const c0 = { ...c, last_decision: c.approval ? { decision: c.approval.status, note: "", by: c.approval.decided_by } : null };

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mono text-[11px] text-ink-400 mb-2">
        <a href="#/cases" className="hover:text-ink-200">Cases</a>
        <Icon name="chevron-right" className="size-3" />
        <span className="text-ink-200">{c.id.slice(0, 8)}…</span>
      </div>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <h1 className="mono text-[20px] text-ink-50">{c.id.slice(0, 8)}…</h1>
          <StatusPill status={c.status} />
          <RiskCell score={c.risk_score} />
        </div>
        <div className="flex items-center gap-2">
          {c.status === "open" && !investigating && (
            <Button variant="primary" onClick={onInvestigate}>
              <Icon name="search" className="size-3.5" /> Investigate
            </Button>
          )}
          {investigating && <span className="mono text-[12px] text-ink-400">Investigating…</span>}
          {invResult && <span className="mono text-[12px] text-teal">Done: {invResult.data?.recommendation}</span>}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* LEFT */}
        <aside className="col-span-3">
          <div className="sticky top-[64px] space-y-4">
            <Panel title={<><Icon name="file-bar-chart" className="size-3" /> Transaction</>}>
              <KV k="amount" m>{fmtAmount(c.amount, c.currency)}</KV>
              <KV k="direction" m>{c.direction}</KV>
              <KV k="channel" m>{c.channel}</KV>
              <KV k="memo" m>{c.memo || "—"}</KV>
              <KV k="created" m>{fmtTimeAbs(c.created_at)}</KV>
            </Panel>
            <Panel title={<><Icon name="building" className="size-3" /> Counterparty</>}>
              <KV k="account">{c.counterparty?.name || "—"}</KV>
              <KV k="country" m>{c.counterparty?.country || "—"}</KV>
            </Panel>
            <Panel title={<><Icon name="user" className="size-3" /> Originator</>}>
              <KV k="account">{c.originator?.iban || "—"}</KV>
            </Panel>
          </div>
        </aside>

        {/* CENTER */}
        <main className="col-span-6 space-y-4">
          <Panel title={<><Icon name="git-branch" className="size-3" /> Agent reasoning</>} right={
            <span className="mono text-[10.5px] text-ink-500">{timeline.length} agent{timeline.length !== 1 ? "s" : ""}</span>
          } bodyClass="p-4 space-y-4">
            {timeline.length === 0 && (
              <div className="text-[12.5px] text-ink-500 italic">No agent decisions recorded yet.</div>
            )}
            {timeline.map((s, i) => <TimelineNode key={s.agent + i} step={s} last={i===timeline.length-1} />)}
            <div className="relative pl-10">
              <div className="absolute left-[15px] top-0 bottom-0 w-px bg-ink-700" />
              <div className="absolute left-3 top-1.5 size-2.5 rounded-full bg-ink-700" />
              <div className="text-[12.5px] text-ink-400 italic pt-0.5">
                {c.status === "open" ? "awaiting investigation…" : c.status === "pending_approval" ? "awaiting operator decision…" : "case resolved."}
              </div>
            </div>
          </Panel>

          <Panel title={<><Icon name="flag" className="size-3" /> Red flags</>} bodyClass="p-4">
            {c.flags?.length === 0
              ? <span className="text-[12px] text-ink-500">No flags raised.</span>
              : <div className="flex flex-wrap gap-2">{(c.flags || []).map(f => <FlagChip key={f} code={f} />)}</div>
            }
          </Panel>
        </main>

        {/* RIGHT */}
        <aside className="col-span-3">
          <div className="sticky top-[64px] space-y-4">
            <ApprovalPanel c={c0} onDecide={onDecide} />
            <Panel title={<><Icon name="history" className="size-3" /> Activity</>}>
              <ul className="space-y-2 text-[12px]">
                {(c.decisions || []).map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-ink-200">
                    <Icon name={d.agent_id === "triage" ? "zap" : "search"} className="size-3.5 text-ink-400 mt-0.5" />
                    <span className="flex-1">{d.agent_id} · {d.output.recommendation}</span>
                    <span className="mono text-[10.5px] text-ink-500">{fmtTimeShort(d.created_at)}</span>
                  </li>
                ))}
                <li className="flex items-start gap-2 text-ink-200">
                  <Icon name="inbox" className="size-3.5 text-ink-400 mt-0.5" />
                  <span className="flex-1">Case created</span>
                  <span className="mono text-[10.5px] text-ink-500">{fmtTimeShort(c.created_at)}</span>
                </li>
              </ul>
            </Panel>
          </div>
        </aside>
      </div>
    </div>
  );
};

window.PageCase = PageCase;
