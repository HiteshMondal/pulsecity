import { useState, useEffect } from 'react';
import { api, setToken } from './api.js';
import { Ctx } from './ctx.js';
import { Login, Dashboard, Report, Incidents, Detail, Reports, Users, Board } from './pages.jsx';

const useHash = () => {
  const [h, setH] = useState(location.hash.slice(1) || '/dashboard');
  useEffect(() => { const f = () => setH(location.hash.slice(1) || '/dashboard'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
};
const NAV = [
  ['/dashboard', 'Dashboard', ['resident', 'staff', 'supervisor', 'admin']],
  ['/report', 'Report an issue', ['resident', 'supervisor', 'admin']],
  ['/incidents', 'Incidents', ['resident', 'staff', 'supervisor', 'admin']],
  ['/reports', 'Reports', ['supervisor', 'admin']],
  ['/users', 'Team members', ['admin']],
  ['/board', 'Public board', ['resident', 'staff', 'supervisor', 'admin']],
];
export default function App() {
  const [user, setUser] = useState(null), [meta, setMeta] = useState(null), [ready, setReady] = useState(false);
  const [path, qs = ''] = useHash().split('?');
  useEffect(() => {
    api('/meta').then(setMeta).catch(() => {});
    api('/auth/me').then(d => setUser(d.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  if (!ready || !meta) return <div className="boot"><span className="pulse" /> Loading PulseCity…</div>;
  const logout = () => { setToken(null); setUser(null); location.hash = '/dashboard'; };
  const ctx = { user, meta, logout };
  if (path === '/board' && !user) return <Ctx.Provider value={ctx}><div className="public"><Board /></div></Ctx.Provider>;
  if (!user) return <Ctx.Provider value={ctx}><Login onAuth={setUser} /></Ctx.Provider>;
  const [, p1, id] = path.split('/');
  let page;
  if (p1 === 'incidents' && id) page = <Detail id={id} key={id} />;
  else page = { dashboard: <Dashboard />, report: <Report />, incidents: <Incidents qs={qs} key={qs} />, reports: <Reports />, users: <Users />, board: <Board /> }[p1] || <Dashboard />;
  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <aside>
          <a className="brand" href="#/dashboard"><svg width="28" height="28" viewBox="0 0 32 32" aria-hidden><path d="M3 17h7l3-8 5 15 3-7h8" fill="none" stroke="#ff7a2f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>PulseCity</a>
          <nav aria-label="Main">{NAV.filter(n => n[2].includes(user.role)).map(([to, label]) =>
            <a key={to} href={'#' + to} aria-current={path.startsWith(to) ? 'page' : undefined}>{label}</a>)}</nav>
          <div className="me"><b>{user.name}</b><span>{user.role}{user.teamId ? ` · ${meta.teams.find(t => t.id === user.teamId)?.name}` : ''}</span><button className="link" onClick={logout}>Sign out</button></div>
        </aside>
        <main>{page}</main>
      </div>
    </Ctx.Provider>
  );
}
