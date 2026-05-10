/* Shared UI atoms */

const cn = (...xs) => xs.filter(Boolean).join(' ');

/* ------------- StatusPill ------------- */
const STATUS_CFG = {
  open:             { label: "Open",             dot: "bg-ink-300",   text: "text-ink-100", bg: "bg-ink-800/70", border: "border-ink-700" },
  pending_approval: { label: "Pending approval", dot: "bg-amber-400", text: "text-amber-200", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  closed:           { label: "Closed",           dot: "bg-emerald-400", text: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/25" },
};
const StatusPill = ({ status }) => {
  const c = STATUS_CFG[status] || STATUS_CFG.open;
  return (
    <span className={cn("inline-flex items-center gap-1.5 h-6 px-2 text-[11px] mono uppercase tracking-wider border rounded-sm", c.bg, c.border, c.text)}>
      <span className={cn("size-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
};

/* ------------- RiskScore ------------- */
const riskBand = (score) =>
  score >= 80 ? { label: "CRITICAL", color: "#ef4444", bg: "rgba(239,68,68,.10)", border: "rgba(239,68,68,.32)" } :
  score >= 60 ? { label: "HIGH",     color: "#f59e0b", bg: "rgba(245,158,11,.10)", border: "rgba(245,158,11,.32)" } :
  score >= 35 ? { label: "MEDIUM",   color: "#eab308", bg: "rgba(234,179,8,.08)",  border: "rgba(234,179,8,.25)" } :
                { label: "LOW",      color: "#10b981", bg: "rgba(16,185,129,.08)", border: "rgba(16,185,129,.25)" };

const RiskCell = ({ score, compact }) => {
  const b = riskBand(score);
  return (
    <div className={cn("inline-flex items-center gap-2", compact && "text-[12px]")}>
      <div className="relative h-1.5 w-16 rounded-sm bg-ink-800 overflow-hidden">
        <div className="absolute inset-y-0 left-0 meter-track" style={{ width: `${score}%`, opacity: .9 }} />
      </div>
      <span className="mono tabular-nums" style={{ color: b.color, minWidth: 22, textAlign: "right" }}>{score}</span>
      <span className="mono text-[10px] uppercase tracking-wider px-1.5 py-px rounded-sm border"
            style={{ color: b.color, background: b.bg, borderColor: b.border }}>{b.label}</span>
    </div>
  );
};

/* ------------- FlagChip ------------- */
const FlagChip = ({ code }) => {
  const f = window.NORDA_MOCKS.FLAGS.find(x => x.code === code) || { code, label: code };
  return (
    <span className="inline-flex items-center gap-1 h-5 px-1.5 mono text-[10px] uppercase tracking-wider rounded-sm bg-ink-800/70 text-ink-200 border border-ink-700">
      <span className="size-1 rounded-full bg-risk-mid"></span>
      {f.label}
    </span>
  );
};

/* ------------- Button ------------- */
const Button = ({ as = "button", variant = "default", className, children, ...rest }) => {
  const Comp = as;
  const base = "btn";
  const v = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : variant === "ghost" ? "btn-ghost" : "";
  return <Comp className={cn(base, v, className)} {...rest}>{children}</Comp>;
};

/* ------------- Card / Panel ------------- */
const Panel = ({ title, right, children, className, bodyClass = "p-4" }) => (
  <div className={cn("bg-ink-900 border border-ink-700 rounded-md", className)}>
    {(title || right) && (
      <div className="flex items-center justify-between h-9 px-3 hair">
        <div className="flex items-center gap-2 mono text-[11px] uppercase tracking-[0.14em] text-ink-300">{title}</div>
        <div>{right}</div>
      </div>
    )}
    <div className={bodyClass}>{children}</div>
  </div>
);

/* ------------- Modal ------------- */
const Modal = ({ open, onClose, title, children, footer, width = 520 }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e)=>e.stopPropagation()} className="bg-ink-900 border border-ink-700 rounded-md shadow-2xl" style={{ width }}>
        <div className="h-10 px-4 flex items-center justify-between hair">
          <div className="mono text-[11px] uppercase tracking-[0.14em] text-ink-200">{title}</div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100"><Icon name="x" className="size-4" /></button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="h-12 px-3 flex items-center justify-end gap-2 hair-t">{footer}</div>}
      </div>
    </div>
  );
};

/* ------------- KV row ------------- */
const KV = ({ k, children, mono: m, copyable }) => (
  <div className="flex items-baseline gap-3 py-1.5 hair">
    <div className="w-32 shrink-0 text-[11px] uppercase tracking-[0.12em] text-ink-400 mono">{k}</div>
    <div className={cn("text-[13px] text-ink-100 break-all", m && "mono")}>{children}</div>
  </div>
);

/* ------------- Hash truncator ------------- */
const Hash = ({ value, head = 8, tail = 6, className }) => (
  <span className={cn("mono text-[12px] text-ink-200", className)} title={value}>
    {value.slice(0, head)}<span className="text-ink-500">…</span>{value.slice(-tail)}
  </span>
);

/* ------------- Format helpers ------------- */
const fmtAmount = (a, c="EUR") => new Intl.NumberFormat('en-DE', { style:'currency', currency:c, minimumFractionDigits:2 }).format(a);
const fmtTimeShort = (iso) => {
  const d = new Date(iso); const now = new Date("2026-05-10T11:42:00Z");
  const diffMin = Math.round((now - d)/60000);
  if (diffMin < 1)  return "just now";
  if (diffMin < 60) return diffMin + "m ago";
  const h = Math.round(diffMin/60);
  if (h < 24) return h + "h ago";
  return Math.round(h/24) + "d ago";
};
const fmtTimeAbs = (iso) => new Date(iso).toISOString().replace('T',' ').replace('Z','Z').slice(0, 19) + "Z";

Object.assign(window, {
  cn, StatusPill, RiskCell, FlagChip, Button, Panel, Modal, KV, Hash,
  riskBand, fmtAmount, fmtTimeShort, fmtTimeAbs,
});
