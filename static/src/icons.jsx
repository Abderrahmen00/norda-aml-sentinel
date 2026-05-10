/* Tiny icon wrapper around lucide. Usage: <Icon name="shield-check" className="size-4" /> */
const kebabToPascal = (s) => s.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('');
const ICON_ALIASES = {
  // graceful fallbacks if a name isn't in this lucide version
  'biohazard': 'AlertOctagon',
  'log-in': 'LogIn',
  'inbox': 'Inbox',
  'hand': 'Hand',
};

const Icon = ({ name, className = "size-4", strokeWidth = 1.6, style }) => {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';
    const lib = window.lucide && window.lucide.icons;
    if (!lib) return;
    const candidates = [
      kebabToPascal(name),
      ICON_ALIASES[name] || null,
      'Circle',
    ].filter(Boolean);
    let node = null;
    for (const k of candidates) {
      if (lib[k]) { node = window.lucide.createElement(lib[k]); break; }
    }
    if (!node) return;
    node.setAttribute('stroke-width', strokeWidth);
    node.setAttribute('width', '100%');
    node.setAttribute('height', '100%');
    ref.current.appendChild(node);
  }, [name, strokeWidth]);
  return <span ref={ref} className={`inline-flex shrink-0 items-center justify-center ${className}`} style={style} aria-hidden="true" />;
};

window.Icon = Icon;
