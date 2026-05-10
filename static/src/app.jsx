/* App root: routing + global state. */

const MOCK_MODE = false;
const API_BASE = "";  // same origin — served by FastAPI

const useHashRoute = () => {
  const [route, setRoute] = React.useState(window.location.hash || "#/cases");
  React.useEffect(() => {
    const onHash = () => setRoute(window.location.hash || "#/cases");
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash || window.location.hash === "#/" || window.location.hash === "#") {
      window.location.hash = "#/cases";
    }
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
};

const App = () => {
  const route = useHashRoute();
  const [cases, setCases] = React.useState(MOCK_MODE ? window.NORDA_MOCKS.CASES : []);
  const [killed, setKillState] = React.useState(null);
  const [loading, setLoading] = React.useState(!MOCK_MODE);

  const refreshCases = React.useCallback(() => {
    if (MOCK_MODE) return;
    fetch(API_BASE + "/api/cases")
      .then(r => r.json())
      .then(data => { setCases(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const refreshKillSwitch = React.useCallback(() => {
    if (MOCK_MODE) return;
    fetch(API_BASE + "/system/kill-switch")
      .then(r => r.json())
      .then(data => setKillState(data.active ? (data.tripped_at || new Date().toISOString()) : null))
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    refreshCases();
    refreshKillSwitch();
  }, []);

  // auto-refresh cases every 5 s so new triage results appear live
  React.useEffect(() => {
    if (MOCK_MODE) return;
    const id = setInterval(refreshCases, 5000);
    return () => clearInterval(id);
  }, [refreshCases]);

  const setKill = React.useCallback((val) => {
    if (MOCK_MODE) { setKillState(val); return; }
    if (val) {
      fetch(API_BASE + "/system/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Engaged via UI" }),
      }).then(() => refreshKillSwitch());
    } else {
      fetch(API_BASE + "/system/kill-switch", { method: "DELETE" })
        .then(() => refreshKillSwitch());
    }
  }, [refreshKillSwitch]);

  const pendingCount = cases.filter(c => c.status === "pending_approval").length;

  let body;
  if (route.startsWith("#/cases/")) {
    const id = decodeURIComponent(route.replace("#/cases/", ""));
    body = <PageCase id={id} />;
  } else if (route.startsWith("#/cases")) {
    body = loading
      ? <div className="p-8 text-ink-400 mono text-[13px]">Loading cases…</div>
      : <PageCases />;
  } else if (route.startsWith("#/audit")) {
    body = <PageAudit />;
  } else if (route.startsWith("#/security")) {
    body = <PageSecurity />;
  } else {
    body = <PageCases />;
  }

  return (
    <AppCtx.Provider value={{ route, cases, setCases, killed, setKill, pendingCount, MOCK_MODE, refreshCases }}>
      <div className="min-h-screen flex flex-col">
        <TopNav />
        <main className="flex-1 max-w-[1480px] w-full mx-auto">
          {body}
        </main>
        <Footer />
      </div>
    </AppCtx.Provider>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
