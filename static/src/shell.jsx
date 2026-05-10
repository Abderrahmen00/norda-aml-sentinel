/* Top nav + global shell. Reads/writes global state via context. */

const AppCtx = React.createContext(null);
const useApp = () => React.useContext(AppCtx);

const NAV = [
{ href: "#/cases", label: "Cases", icon: "list-checks", count: () => window.NORDA_MOCKS.CASES.filter((c) => c.status === "pending_approval").length, kind: "approvals" },
{ href: "#/audit", label: "Audit", icon: "shield-check" },
{ href: "#/security", label: "Security", icon: "biohazard" }];


const TopNav = () => {
  const { route, killed, setKill, pendingCount } = useApp();
  const [confirmKill, setConfirmKill] = React.useState(false);
  const [confirmRelease, setConfirmRelease] = React.useState(false);

  const isActive = (h) => {
    const r = route || "#/cases";
    if (h === "#/cases") return r.startsWith("#/cases");
    return r.startsWith(h);
  };

  return (
    <>
    <header className="sticky top-0 z-30 bg-ink-950/95 backdrop-blur hair">
      <div className="h-12 px-4 flex items-center gap-6">
        {/* Logo */}
        <a href="#/cases" className="flex items-center gap-2 group">
          <span className="relative inline-flex size-5 items-center justify-center border border-teal/60 rounded-sm" style={{ background: "rgba(20,184,166,.08)" }}>
            <span className="size-1.5 bg-teal rounded-[1px]" />
          </span>
          <span className="mono text-[13px] tracking-[0.18em] font-semibold text-ink-100">NORDA</span>
          <span className="mono text-[13px] tracking-[0.14em] text-ink-300">SENTINEL</span>
          <span className="mono text-[10px] text-ink-500 ml-1 hidden md:inline">/AML·v3.4</span>
        </a>

        <nav className="flex items-center gap-1">
          {NAV.map((n) =>
            <a key={n.href} href={n.href}
            className={cn("h-8 px-2.5 inline-flex items-center gap-2 rounded-sm text-[12.5px]",
            isActive(n.href) ? "bg-ink-800 text-ink-50 border border-ink-700" : "text-ink-300 hover:text-ink-100 border border-transparent")}>
              <Icon name={n.icon} className="size-3.5" />
              <span>{n.label}</span>
              {n.kind === "approvals" && pendingCount > 0 &&
              <span className="ml-1 mono text-[10px] px-1 h-4 inline-flex items-center rounded-sm bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {pendingCount}
                </span>
              }
            </a>
            )}
        </nav>

        <div className="flex-1" />

        {/* System status */}
        <div className="flex items-center gap-3 text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className={cn("relative size-2 rounded-full pulse-dot",
              killed ? "bg-red-500 text-red-500" : "bg-emerald-400 text-emerald-400")} />
            <span className="mono uppercase tracking-wider text-[11px] text-ink-300">
              Agents {killed ? "suspended" : "active"}
            </span>
          </div>
          <div className="hidden lg:flex items-center gap-1.5 text-ink-400">
            <Icon name="activity" className="size-3.5" />
            <span className="mono text-[11px]">p50 612ms · p95 1.4s</span>
          </div>
        </div>

        {/* Kill switch */}
        {!killed ?
          <button onClick={() => setConfirmKill(true)}
          className="h-8 px-2.5 inline-flex items-center gap-2 rounded-sm border border-red-500/40 text-red-300 bg-red-500/5 hover:bg-red-500/10 hover:text-red-200 text-[12px]">
            <Icon name="power-off" className="size-3.5" />
            <span className="mono uppercase tracking-wider text-[11px]">Kill switch</span>
          </button> :

          <button onClick={() => setConfirmRelease(true)}
          className="h-8 px-2.5 inline-flex items-center gap-2 rounded-sm border border-amber-500/40 text-amber-200 bg-amber-500/10 hover:bg-amber-500/15 text-[12px]">
            <Icon name="play" className="size-3.5" />
            <span className="mono uppercase tracking-wider text-[11px]">Release agents</span>
          </button>
          }

        {/* Operator */}
        <div className="flex items-center gap-2 pl-3 hair-l h-8">
          <span className="size-6 rounded-full bg-ink-800 border border-ink-700 inline-flex items-center justify-center mono text-[10px] text-ink-200">AJ</span>
          <div className="leading-tight">
            <div className="mono text-[11px] text-ink-100">{window.NORDA_MOCKS.MOCK_OPERATOR.id}</div>
            <div className="text-[10px] text-ink-400">{window.NORDA_MOCKS.MOCK_OPERATOR.role}</div>
          </div>
        </div>
      </div>

      {/* Suspended banner */}
      {killed &&
        <div className="banner-suspended hair-t">
          <div className="px-4 h-8 flex items-center gap-2 text-[12px]">
            <Icon name="alert-octagon" className="size-3.5 text-red-400" />
            <span className="mono uppercase tracking-[0.14em] text-red-200">Agents suspended</span>
            <span className="text-ink-300">— inbound cases queued, no autonomous decisions, all approvals require dual control.</span>
            <span className="flex-1" />
            <span className="mono text-[11px] text-ink-400">since {fmtTimeAbs(killed)}</span>
          </div>
        </div>
        }
    </header>

    {/* kill-switch confirm */}
    <Modal open={confirmKill} onClose={() => setConfirmKill(false)}
      title="Engage kill switch"
      footer={<>
        <Button variant="ghost" onClick={() => setConfirmKill(false)}>Cancel</Button>
        <Button variant="danger" onClick={() => {setKill(new Date().toISOString());setConfirmKill(false);}}>
          <Icon name="power-off" className="size-3.5" /> Engage now
        </Button>
      </>}>
      <div className="space-y-3 text-[13px]">
        <div className="flex items-start gap-3">
          <span className="size-8 rounded-full bg-red-500/15 border border-red-500/40 inline-flex items-center justify-center"><Icon name="alert-triangle" className="size-4 text-red-400" /></span>
          <div>
            <div className="text-ink-100">This will halt all autonomous agent decisions across the platform.</div>
            <div className="text-ink-400 mt-1">Cases will continue to be ingested and triaged for human review, but no agent may close, escalate or recommend without operator co-sign. Action is logged and broadcast to the SOC.</div>
          </div>
        </div>
        <div className="bg-ink-850 border border-ink-700 rounded p-3 mono text-[11px] text-ink-300">
          <div>scope:        global</div>
          <div>operator:     {window.NORDA_MOCKS.MOCK_OPERATOR.id}</div>
          <div>broadcast:    SOC, Compliance Director, CRO duty officer</div>
          <div>audit_event:  killswitch.engaged</div>
        </div>
      </div>
    </Modal>

    <Modal open={confirmRelease} onClose={() => setConfirmRelease(false)}
      title="Release agents"
      footer={<>
        <Button variant="ghost" onClick={() => setConfirmRelease(false)}>Cancel</Button>
        <Button variant="primary" onClick={() => {setKill(null);setConfirmRelease(false);}}>
          <Icon name="play" className="size-3.5" /> Resume
        </Button>
      </>}>
      <div className="text-[13px] text-ink-200">
        Resume autonomous agent operations. Triage and Investigator agents will start consuming the queued backlog.
        This event is logged.
      </div>
    </Modal>
    </>);

};

const Footer = () =>
<footer className="hair-t mt-12">
    <div className="px-4 h-9 flex items-center justify-between text-[11px] text-ink-500 mono">
      <div>© Norda Bank — Compliance Technology · Internal use only · Patent-pending guardrail mesh</div>
      <div className="flex items-center gap-4">
        <span>region: eu-north-1</span>
        <span>tenant: norda-prod</span>
        <span>build {window.NORDA_MOCKS.BUILD_HASH}</span>
      </div>
    </div>
  </footer>;


window.AppCtx = AppCtx;
window.useApp = useApp;
window.TopNav = TopNav;
window.Footer = Footer;