import { useEffect, useState } from 'react';
import { api, upload, setToken } from './api.js';
import { useApp } from './ctx.js';

const ago = d => { const m = (Date.now() - new Date(d)) / 6e4; return m < 60 ? `${Math.max(1, m | 0)}m ago` : m < 1440 ? `${(m / 60) | 0}h ago` : `${(m / 1440) | 0}d ago`; };
const when = d => new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const lbl = s => s.replace(/_/g, ' ');
const Pri = ({ p }) => <span className={`b p-${p}`}>{p === 'urgent' && <i className="dot" />}{p}</span>;
const St = ({ s }) => <span className={`b s-${s}`}>{lbl(s)}</span>;
const Err = ({ e }) => e ? <p className="err" role="alert">{e}</p> : null;
const Head = ({ title, sub, children }) => <header className="head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{children}</header>;
const useLoad = (path, deps = []) => {
  const [d, setD] = useState(null);
  const [e, setE] = useState('');

  useEffect(() => {
    let active = true;

    setD(null);
    setE('');

    api(path)
      .then(data => {
        if (active) setD(data);
      })
      .catch(error => {
        if (active) setE(error.message);
      });

    return () => {
      active = false;
    };
  }, [path, ...deps]);

  return [d, e];
};

function Table({ rows, cats }) {
  if (!rows.length) return <p className="empty">No incidents match. Try clearing a filter.</p>;
  return (
    <div className="scroll"><table>
      <thead><tr><th>Issue</th><th>Location</th><th>Priority</th><th>Status</th><th>Team</th><th>Reported</th></tr></thead>
      <tbody>{rows.map(i => (
        <tr key={i.id} className={i.overdue ? 'late' : ''}>
          <td><a href={`#/incidents/${i.id}`}>{cats[i.category]?.label}</a>{i.duplicateOf && <small className="dup"> possible duplicate</small>}</td>
          <td>{i.locationName}</td><td><Pri p={i.priority} /></td>
          <td><St s={i.status} />{i.overdue && <span className="b overdue">overdue</span>}</td>
          <td>{i.teamName || '—'}</td><td title={when(i.createdAt)}>{ago(i.createdAt)}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

export function Login({ onAuth }) {
  const { meta } = useApp();
  const [reg, setReg] = useState(false), [f, setF] = useState({ name: '', email: '', password: '' }), [e, setE] = useState(''), [busy, setBusy] = useState(false);
  const set = k => ev => setF({ ...f, [k]: ev.target.value });
  const go = async ev => {
    ev.preventDefault(); setBusy(true); setE('');
    try { const d = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body: f }); setToken(d.token); onAuth(d.user); }
    catch (x) { setE(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <section className="hero">
        <svg className="city-art" viewBox="0 0 960 520" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <defs>
            <linearGradient id="cityFar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#54b9a8" stopOpacity=".2" /><stop offset="1" stopColor="#0b3534" stopOpacity=".48" /></linearGradient>
            <linearGradient id="cityNear" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#278d80" stopOpacity=".9" /><stop offset="1" stopColor="#082b30" stopOpacity=".96" /></linearGradient>
          </defs>
          <circle className="city-sun" cx="760" cy="160" r="78" />
          <g className="city-far" fill="url(#cityFar)">
            <path d="M0 350V244h54v-42h48v148h46V229h42v-62h58v183h46V216h38v-48h42v182h43V220h70v130h38V185h65v165h42V235h55v115h45V200h44v150h65V238h52v112h65v170H0z" />
          </g>
          <g className="city-mid" fill="#145c59" opacity=".92">
            <path d="M48 390V276h82v114zm96 0V224h92v166zm106 0V270h65v120zm81 0V202h106v188zm120 0V251h86v139zm99 0V184h104v206zm119 0V260h80v130zm94 0V225h92v165z" />
          </g>
          <g className="city-near" fill="url(#cityNear)">
            <path d="M105 420V324h116v96zm132 0V278h108v142zm126 0V314h132v106zm150 0V248h113v172zm130 0V300h120v120zm139 0V274h98v146z" />
          </g>
          <g className="city-windows" fill="#b8eee0">
            <path d="M126 345h10v13h-10zm22 0h10v13h-10zm22 0h10v13h-10zm22 0h10v13h-10zM253 302h10v13h-10zm23 0h10v13h-10zm23 0h10v13h-10zm-46 27h10v13h-10zm23 0h10v13h-10zm23 0h10v13h-10zM382 339h11v14h-11zm24 0h11v14h-11zm24 0h11v14h-11zm-48 26h11v14h-11zm24 0h11v14h-11zm24 0h11v14h-11zM530 278h11v14h-11zm25 0h11v14h-11zm25 0h11v14h-11zm-50 28h11v14h-11zm25 0h11v14h-11zm25 0h11v14h-11zM666 326h11v14h-11zm25 0h11v14h-11zm25 0h11v14h-11zm-50 28h11v14h-11zm25 0h11v14h-11zm25 0h11v14h-11zM813 301h10v13h-10zm22 0h10v13h-10zm22 0h10v13h-10z" />
          </g>
          <path className="city-road-shadow" d="M-30 502C190 420 318 450 472 485s307 38 530-48" />
          <path className="city-road" d="M-30 502C190 420 318 450 472 485s307 38 530-48" />
          <path className="city-route" d="M30 484C200 426 325 457 474 485s280 34 448-25" />
          <g className="city-pin" transform="translate(265 420)"><path d="M0 0c-17 0-29 12-29 28 0 21 29 49 29 49s29-28 29-49C29 12 17 0 0 0z" fill="#ff9852" /><circle cy="27" r="9" fill="#fff4e9" /></g>
          <g className="city-pin city-pin-two" transform="translate(735 425)"><path d="M0 0c-14 0-24 10-24 24 0 18 24 42 24 42s24-24 24-42C24 10 14 0 0 0z" fill="#70d7bd" /><circle cy="23" r="7" fill="#eafff8" /></g>
        </svg>
        <h1>See it. Report it.<br />Watch it get fixed.</h1>
        <p>Blocked drains, potholes, dead streetlights: tell your city once, follow the repair from report to verified fix.</p>
        <a className="ghost" href="#/board">View the public board</a>
      </section>
      <form className="card auth" onSubmit={go}>
        <h2>{reg ? 'Create your account' : 'Sign in'}</h2>
        {reg && <label>Full name<input required minLength={2} value={f.name} onChange={set('name')} autoComplete="name" /></label>}
        <label>Email<input required type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
        <label>Password<input required type="password" minLength={reg ? 8 : 1} value={f.password} onChange={set('password')} autoComplete={reg ? 'new-password' : 'current-password'} />{reg && <small>At least 8 characters</small>}</label>
        <Err e={e} />
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : reg ? 'Create account' : 'Sign in'}</button>
        <button type="button" className="link" onClick={() => { setReg(!reg); setE(''); }}>{reg ? 'I already have an account' : 'New here? Create a resident account'}</button>
      </form>
    </div>
  );
}

export function Dashboard() {
  const { user, meta } = useApp();
  const [d, e] = useLoad('/dashboard');
  if (e) return <Err e={e} />; if (!d) return <p>Loading…</p>;
  const c = d.counts;
  const cards = [['Total', c.total, '#/incidents'], ['Urgent', c.urgent, '#/incidents?priority=urgent', 'hot'], ['Pending', c.pending, '#/incidents?status=new'], ['Overdue', c.overdue, '#/incidents?overdue=1', c.overdue ? 'hot' : ''], ['Resolved', c.resolved, '#/incidents?status=closed', 'ok']];
  return (<>
    <Head title={`Hello, ${user.name.split(' ')[0]}`} sub={user.role === 'resident' ? 'Your reports and where they stand.' : 'What needs attention across the city.'}>
      {user.role !== 'staff' && <a className="primary btn" href="#/report">Report an issue</a>}
    </Head>
    {c.overdue > 0 && user.role !== 'resident' && <div className="alert" role="status"><b>{c.overdue} incident{c.overdue > 1 ? 's are' : ' is'} past the deadline.</b> <a href="#/incidents?overdue=1">Review overdue incidents</a></div>}
    <div className="stats">{cards.map(([k, v, href, tone]) => <a key={k} href={href} className={`stat ${tone || ''}`}><b>{v}</b><span>{k}</span></a>)}</div>
    <h2>{user.role === 'resident' ? 'Your open reports' : 'Highest priority open incidents'}</h2>
    <div className="card flush"><Table rows={d.recent} cats={meta.categories} /></div>
  </>);
}

export function Report() {
  const { meta } = useApp();
  const [f, setF] = useState({ category: '', locationId: '', landmark: '', description: '' }), [file, setFile] = useState(null), [e, setE] = useState(''), [busy, setBusy] = useState(false);
  const set = k => ev => setF({ ...f, [k]: ev.target.value });
  const pick = ev => { const x = ev.target.files[0]; if (x && !['image/jpeg', 'image/png', 'image/webp'].includes(x.type)) { setE('Choose a JPEG, PNG or WebP photo'); return; } setE(''); setFile(x || null); };
  const go = async ev => {
    ev.preventDefault(); setBusy(true); setE('');
    try {
      const photoKey = file ? await upload(file) : undefined;
      const d = await api('/incidents', { method: 'POST', body: { ...f, photoKey } });
      location.hash = `/incidents/${d.id}`;
    } catch (x) { setE(x.message); setBusy(false); }
  };
  return (<>
    <Head title="Report an issue" sub="Tell us what is wrong and where. We prioritise it and route it to the right team." />
    <form className="card form" onSubmit={go}>
      <label>What is the problem?<select required value={f.category} onChange={set('category')}><option value="">Choose a category</option>{Object.entries(meta.categories).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
      <label>Where is it?<select required value={f.locationId} onChange={set('locationId')}><option value="">Choose an area</option>{meta.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label>Nearest landmark or street <small>optional</small><input maxLength={120} value={f.landmark} onChange={set('landmark')} placeholder="e.g. outside the bus stop on Station Road" /></label>
      <label>Describe it<textarea required minLength={10} maxLength={1000} rows={4} value={f.description} onChange={set('description')} placeholder="What do you see? Is anyone at risk?" /><small>{f.description.length}/1000</small></label>
      <label>Photo <small>optional · JPEG, PNG or WebP, up to 5 MB</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} /></label>
      {file && <img className="preview" alt="Selected photo preview" src={URL.createObjectURL(file)} />}
      <Err e={e} />
      <button className="primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit report'}</button>
    </form>
  </>);
}

export function Incidents({ qs }) {
  const { meta } = useApp();
  const [f, setF] = useState(Object.fromEntries(new URLSearchParams(qs)));
  const query = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const [d, e] = useLoad('/incidents?' + query, [query]);
  const set = k => ev => setF({ ...f, [k]: ev.target.type === 'checkbox' ? (ev.target.checked ? '1' : '') : ev.target.value });
  return (<>
    <Head title="Incidents" sub={d ? `${d.total} found` : ' '} />
    <div className="filters card">
      <input type="search" placeholder="Search description or area" value={f.q || ''} onChange={set('q')} aria-label="Search" />
      <select value={f.status || ''} onChange={set('status')} aria-label="Status"><option value="">Any status</option>{meta.statuses.map(s => <option key={s} value={s}>{lbl(s)}</option>)}</select>
      <select value={f.priority || ''} onChange={set('priority')} aria-label="Priority"><option value="">Any priority</option>{['urgent', 'high', 'medium', 'low'].map(s => <option key={s}>{s}</option>)}</select>
      <select value={f.category || ''} onChange={set('category')} aria-label="Category"><option value="">Any category</option>{Object.entries(meta.categories).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
      <label className="chk"><input type="checkbox" checked={f.overdue === '1'} onChange={set('overdue')} />Overdue only</label>
    </div>
    <Err e={e} />
    <div className="card flush">{d ? <Table rows={d.incidents} cats={meta.categories} /> : <p className="empty">Loading…</p>}</div>
  </>);
}

export function Detail({ id }) {
  const { user, meta } = useApp(); const mgr = ['supervisor', 'admin'].includes(user.role);
  const [d, setD] = useState(null), [e, setE] = useState(''), [busy, setBusy] = useState(false);
  const [note, setNote] = useState(''), [file, setFile] = useState(null), [team, setTeam] = useState(''), [who, setWho] = useState(''), [staff, setStaff] = useState([]);
  const load = () => api(`/incidents/${id}`).then(x => { setD(x); setTeam(t => t || x.incident.teamId || meta.categories[x.incident.category]?.team || ''); }).catch(x => setE(x.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  useEffect(() => { if (mgr && team) api(`/users?teamId=${team}`).then(r => setStaff(r.users)).catch(() => {}); }, [team]); // eslint-disable-line
  const act = async (path, body, withFile) => {
    setBusy(true); setE('');
    try { if (withFile && file) body.evidenceKey = await upload(file); await api(`/incidents/${id}/${path}`, { method: 'POST', body }); setNote(''); setFile(null); await load(); }
    catch (x) { setE(x.message); } finally { setBusy(false); }
  };
  if (!d) return e ? <><Err e={e} /><a href="#/incidents">Back to incidents</a></> : <p>Loading…</p>;
  const { incident: i, history } = d, canWork = (user.role === 'staff' || mgr) && ['assigned', 'in_progress'].includes(i.status);
  const next = { assigned: 'in_progress', in_progress: 'awaiting_verification' }[i.status];
  return (<>
    <a href="#/incidents" className="back">← All incidents</a>
    <Head title={meta.categories[i.category]?.label} sub={`${i.locationName}${i.landmark ? ' · ' + i.landmark : ''}`}><div className="tags"><Pri p={i.priority} /><St s={i.status} />{i.overdue && <span className="b overdue">overdue</span>}</div></Head>
    <Err e={e} />
    <div className="grid2">
      <section className="card">
        <p className="desc">{i.description}</p>
        {i.photoUrl && <img className="photo" src={i.photoUrl} alt="Photo submitted with the report" />}
        <dl>
          <dt>Priority score</dt><dd>{i.priorityScore}</dd><dt>Due by</dt><dd>{when(i.dueAt)}</dd><dt>Team</dt><dd>{i.teamName ? `${i.teamName}${i.assigneeName ? ' · ' + i.assigneeName : ''}` : 'Not assigned yet'}</dd>
          {i.reporterName && <><dt>Reported by</dt><dd>{i.reporterName}</dd></>}{i.duplicateOf && <><dt>Note</dt><dd>Similar open report nearby{user.role !== 'resident' && <> · <a href={`#/incidents/${i.duplicateOf}`}>view</a></>}</dd></>}
        </dl>
      </section>
      <section className="card">
        <h2>Status history</h2>
        <ol className="timeline">{[...history].reverse().map((h, n) => (
          <li key={n}><b>{h.type === 'reported' ? 'Reported' : h.type === 'escalated' ? 'Escalated' : h.type === 'rework' ? 'Sent back for rework' : lbl(h.to)}</b>
            <small>{h.actorName} · {when(h.ts)}</small>{h.note && <p>{h.note}</p>}{h.evidenceUrl && <a href={h.evidenceUrl} target="_blank" rel="noreferrer"><img className="evidence" src={h.evidenceUrl} alt="Work evidence" /></a>}</li>))}</ol>
      </section>
    </div>
    {mgr && ['new', 'assigned'].includes(i.status) && <section className="card form"><h2>{i.status === 'new' ? 'Assign to a team' : 'Reassign'}</h2>
      <label>Team<select value={team} onChange={ev => { setTeam(ev.target.value); setWho(''); }}>{meta.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Crew member <small>optional</small><select value={who} onChange={ev => setWho(ev.target.value)}><option value="">Whole team</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <button className="primary" disabled={busy} onClick={() => act('assign', { teamId: team, assigneeId: who || undefined })}>Assign and notify team</button></section>}
    {canWork && <section className="card form"><h2>{i.status === 'assigned' ? 'Start work' : 'Submit for verification'}</h2>
      <label>Work note<textarea rows={3} value={note} onChange={ev => setNote(ev.target.value)} placeholder="What was done or found?" /></label>
      <label>Evidence photo <small>optional</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={ev => setFile(ev.target.files[0] || null)} /></label>
      <button className="primary" disabled={busy || note.trim().length < 5} onClick={() => act('status', { status: next, note }, true)}>{i.status === 'assigned' ? 'Mark in progress' : 'Mark repair complete'}</button></section>}
    {mgr && i.status === 'awaiting_verification' && <section className="card form"><h2>Verify the repair</h2>
      <label>Verification note<textarea rows={2} value={note} onChange={ev => setNote(ev.target.value)} placeholder="Required if sending back" /></label>
      <div className="row"><button className="primary" disabled={busy} onClick={() => act('verify', { approved: true, note })}>Verify and close</button>
        <button className="danger" disabled={busy || note.trim().length < 5} onClick={() => act('verify', { approved: false, note })}>Send back for rework</button></div></section>}
  </>);
}

const Bars = ({ rows, label }) => { const max = Math.max(1, ...rows.map(r => r.count)); return <div className="bars">{rows.map(r => <div key={r.key}><span>{label ? label(r.key) : r.key}</span><i style={{ width: `${(r.count / max) * 100}%` }} /><b>{r.count}</b></div>)}{!rows.length && <p className="empty">No data yet.</p>}</div>; };

export function Reports() {
  const { meta } = useApp(); const [d, e] = useLoad('/reports');
  if (e) return <Err e={e} />; if (!d) return <p>Loading…</p>;
  const max = Math.max(1, ...d.trend.flatMap(t => [t.reported, t.closed]));
  return (<>
    <Head title="Reports and analytics" sub="Trends, workload and deadlines across the city." />
    <div className="stats">
      <div className="stat"><b>{d.counts.total}</b><span>Total incidents</span></div>
      <div className="stat"><b>{d.avgResolutionHours}h</b><span>Avg time to close</span></div>
      <div className="stat ok"><b>{d.slaCompliance === null ? '—' : d.slaCompliance + '%'}</b><span>Closed within deadline</span></div>
      <div className={`stat ${d.counts.overdue ? 'hot' : ''}`}><b>{d.counts.overdue}</b><span>Overdue now</span></div>
    </div>
    <div className="grid2">
      <section className="card"><h2>Last 14 days</h2><div className="trend" role="img" aria-label="Reported versus closed per day">{d.trend.map(t => <div key={t.day} title={`${t.day}: ${t.reported} reported, ${t.closed} closed`}><i className="r" style={{ height: `${(t.reported / max) * 100}%` }} /><i className="c" style={{ height: `${(t.closed / max) * 100}%` }} /></div>)}</div><p className="legend"><i className="r" /> Reported <i className="c" /> Closed</p></section>
      <section className="card"><h2>By category</h2><Bars rows={d.byCategory} /></section>
      <section className="card"><h2>By area</h2><Bars rows={d.byArea} /></section>
      <section className="card"><h2>By status</h2><Bars rows={d.byStatus} label={lbl} /></section>
    </div>
    <h2>Overdue incidents</h2><div className="card flush"><Table rows={d.overdue} cats={meta.categories} /></div>
  </>);
}

export function Users() {
  const { meta, user } = useApp(); const [f, setF] = useState({ name: '', email: '', password: '', role: 'staff', teamId: meta.teams[0].id }), [e, setE] = useState(''), [ok, setOk] = useState(''), [n, setN] = useState(0);
  const [d] = useLoad('/users', [n]); const set = k => ev => setF({ ...f, [k]: ev.target.value });
  const del = async u => {
    if (!confirm(`Delete ${u.name}?`)) return; setE(''); setOk('');
    try { await api(`/users/${u.id}`, { method: 'DELETE' }); setOk(`${u.name} was deleted.`); setN(n + 1); } catch (x) { setE(x.message); }
  };
  const go = async ev => { ev.preventDefault(); setE(''); setOk(''); try { await api('/users', { method: 'POST', body: f }); setOk(`${f.name} can now sign in.`); setF({ ...f, name: '', email: '', password: '' }); setN(n + 1); } catch (x) { setE(x.message); } };
  return (<>
    <Head title="Team members" sub="Create accounts for crews, supervisors and administrators." />
    <div className="grid2">
      <form className="card form" onSubmit={go}>
        <label>Full name<input required value={f.name} onChange={set('name')} /></label>
        <label>Email<input required type="email" value={f.email} onChange={set('email')} /></label>
        <label>Temporary password<input required type="password" minLength={8} value={f.password} onChange={set('password')} autoComplete="new-password" /></label>
        <label>Role<select value={f.role} onChange={set('role')}><option value="staff">Maintenance staff</option><option value="supervisor">Supervisor</option><option value="admin">Administrator</option></select></label>
        {f.role === 'staff' && <label>Team<select value={f.teamId} onChange={set('teamId')}>{meta.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        <Err e={e} />{ok && <p className="okmsg" role="status">{ok}</p>}
        <button className="primary">Create account</button>
      </form>
      <section className="card flush"><div className="scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Team</th><th></th></tr></thead><tbody>{(d?.users || []).map(u => <tr key={u.id}><td>{u.name}<small className="dup"> {u.email}</small></td><td>{u.role}</td><td>{meta.teams.find(t => t.id === u.teamId)?.name || '—'}</td><td>{u.id !== user.id && <button className="link" onClick={() => del(u)}>Delete</button>}</td></tr>)}</tbody></table></div></section>
    </div>
  </>);
}

export function Board() {
  const { meta, user } = useApp(); const [d, e] = useLoad('/public/incidents');
  return (<>
    <Head title="Public incident board" sub="Open and resolved issues across the city. Reporter details and descriptions are never shown here.">{!user && <a className="primary btn" href="#/dashboard">Sign in to report</a>}</Head>
    <Err e={e} />
    {d && <><div className="stats three"><div className="stat"><b>{d.stats.total}</b><span>Reported</span></div><div className="stat hot"><b>{d.stats.open}</b><span>Open</span></div><div className="stat ok"><b>{d.stats.resolved}</b><span>Resolved</span></div></div>
      <div className="card flush"><div className="scroll"><table><thead><tr><th>Issue</th><th>Area</th><th>Priority</th><th>Status</th><th>Reported</th></tr></thead><tbody>{d.incidents.map((i, n) => <tr key={n}><td>{meta.categories[i.category]?.label}</td><td>{i.locationName}</td><td><Pri p={i.priority} /></td><td><St s={i.status} /></td><td>{ago(i.createdAt)}</td></tr>)}</tbody></table></div></div></>}
  </>);
}

export function Account() {
  const { user, logout } = useApp();
  const [pw, setPw] = useState(''), [e, setE] = useState(''), [busy, setBusy] = useState(false);
  const go = async ev => {
    ev.preventDefault();
    if (!confirm('Delete your account permanently? This cannot be undone.')) return;
    setBusy(true); setE('');
    try { await api('/auth/me', { method: 'DELETE', body: { password: pw } }); logout(); }
    catch (x) { setE(x.message); setBusy(false); }
  };
  return (<>
    <Head title="My account" sub={`${user.name} · ${user.email}`} />
    <form className="card form" onSubmit={go}>
      <h2>Delete my account</h2>
      <p>Your sign-in is removed permanently. Reports you filed stay on record without your name.</p>
      <label>Confirm your password<input type="password" required value={pw} onChange={ev => setPw(ev.target.value)} autoComplete="current-password" /></label>
      <Err e={e} />
      <button className="danger" disabled={busy}>Delete my account</button>
    </form>
  </>);
}
