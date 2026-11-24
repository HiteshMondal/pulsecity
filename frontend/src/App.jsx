import { useState, useEffect } from 'react';
import { api, setToken } from './api.js';
import { Ctx } from './ctx.js';
import { Login, Dashboard, Report, Incidents, Detail, Reports, Users, Board, Account } from './pages.jsx';

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
  ['/account', 'My account', ['resident', 'staff', 'supervisor', 'admin']],
];
export default function App() {
  const [user, setUser] = useState(null), [meta, setMeta] = useState(null), [ready, setReady] = useState(false);
  const [path, qs = ''] = useHash().split('?');
  const [bootError, setBootError] = useState('');
  useEffect(() => {
    api('/meta')
      .then(setMeta)
      .catch(x => setBootError(x.message || 'Unable to load application settings'));

    api('/auth/me')
      .then(d => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="boot">
        <span className="city-loader" aria-hidden="true" />
        Loading PulseCity…
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="boot" role="alert">
        <div>
          <p>{bootError || 'Unable to load application settings.'}</p>
          <button onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  const logout = () => { setToken(null); setUser(null); location.hash = '/dashboard'; };
  const ctx = { user, meta, logout };
  if (path === '/board' && !user) return <Ctx.Provider value={ctx}><div className="public"><Board /></div></Ctx.Provider>;
  if (!user) return <Ctx.Provider value={ctx}><Login onAuth={setUser} /></Ctx.Provider>;
  const [, p1, id] = path.split('/');
  let page;
  if (p1 === 'incidents' && id) page = <Detail id={id} key={id} />;
  else page = { dashboard: <Dashboard />, report: <Report />, incidents: <Incidents qs={qs} key={qs} />, reports: <Reports />, users: <Users />, board: <Board />, account: <Account /> }[p1] || <Dashboard />;
  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <aside>
          <a className="brand" href="#/dashboard"><svg width="30" height="30" viewBox="0 0 32 32" aria-hidden><path d="M3 27V14l7-4v17M10 27V5l8-3v25M18 27V13l11-5v19" fill="none" stroke="#ff9b59" strokeWidth="2.3" strokeLinejoin="round" /><path d="M6 17h2m-2 4h2m5-11h2m-2 4h2m-2 4h2m-2 4h2m6-6h2m-2 4h2" stroke="#e7f7f2" strokeWidth="1.5" strokeLinecap="round" /></svg>PulseCity</a>
          <nav aria-label="Main">{NAV.filter(n => n[2].includes(user.role)).map(([to, label]) =>
            <a key={to} href={'#' + to} aria-current={path.startsWith(to) ? 'page' : undefined}>{label}</a>)}</nav>
          <div className="me"><b>{user.name}</b><span>{user.role}{user.teamId ? ` · ${meta.teams.find(t => t.id === user.teamId)?.name}` : ''}</span><button className="link" onClick={logout}>Sign out</button></div>
        </aside>
        <main>{page}</main>
      </div>
    </Ctx.Provider>
  );
}
