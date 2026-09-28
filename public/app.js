const view = document.getElementById('view');
const banner = document.getElementById('banner');

const ROUTE_LABEL = { LHR_RAIL: 'Heathrow + train', MAN: 'Into Manchester' };
// Fixed series order: color follows the entity, never its rank.
const SERIES = [
  { key: 'LHR_RAIL|1', label: '{pref} · Heathrow + train', color: '--series-1', dash: [] },
  { key: 'MAN|1', label: '{pref} · into Manchester', color: '--series-2', dash: [] },
  { key: 'LHR_RAIL|0', label: 'Other airlines · Heathrow + train', color: '--series-3', dash: [6, 4] },
  { key: 'MAN|0', label: 'Other airlines · into Manchester', color: '--series-4', dash: [6, 4] },
];

let appConfig = null;
let chart = null;
let pollTimer = null;

const AIRLINES = { UA: 'United', BA: 'British Airways', AA: 'American', DL: 'Delta', VS: 'Virgin Atlantic', EI: 'Aer Lingus' };
const airline = (code) => AIRLINES[code] || code || 'any airline';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const utc = (sqlTime) => new Date(`${sqlTime.replace(' ', 'T')}Z`);
const fmtDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtTime = (local) => (local ? local.slice(11, 16) : '?');
const fmtDateTime = (local) => (local ? `${fmtDate(local.slice(0, 10))} ${fmtTime(local)}` : 'time not provided');

function timeAgo(sqlTime) {
  if (!sqlTime) return 'not checked yet';
  const mins = Math.round((Date.now() - utc(sqlTime)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function clearTimers() {
  clearTimeout(pollTimer);
  if (chart) { chart.destroy(); chart = null; }
}

// ---------- Trip list ----------

async function renderList() {
  const trips = await api('/trips');
  if (!trips.length) {
    view.innerHTML = `
      <section class="card empty">
        <h1>No trips yet</h1>
        <p>Pick a match and a date window. The tracker compares United to Heathrow plus the train
        with flying into Manchester, and keeps checking so you can book when prices dip.</p>
        <a href="#/new" class="btn primary">+ Track your first trip</a>
      </section>`;
    return;
  }
  view.innerHTML = `<div class="trip-list">${trips.map(tripCard).join('')}</div>`;
}

function tripCard(t) {
  const hitTarget = t.target_price_usd && t.latest_preferred_usd && t.latest_preferred_usd <= t.target_price_usd;
  return `
    <a class="card trip-card" href="#/trip/${t.id}">
      <div class="detail-head">
        <h2>${esc(t.name)}</h2>
        ${t.active ? (hitTarget ? '<span class="pill good">✓ Under target</span>' : '') : '<span class="pill paused">Paused</span>'}
      </div>
      <div class="meta">${t.match_date ? `Match ${esc(fmtDate(t.match_date))} · ` : ''}Out ${esc(fmtDate(t.depart_from))}${t.depart_to !== t.depart_from ? `–${esc(fmtDate(t.depart_to))}` : ''} · Back ${esc(fmtDate(t.return_from))}${t.return_to !== t.return_from ? `–${esc(fmtDate(t.return_to))}` : ''}</div>
      <div class="price-row">
        <div><div class="price">${usd(t.latest_preferred_usd)}</div><div class="price-label">Best ${esc(airline(t.preferred_airline))} trip now</div></div>
        <div><div class="price">${usd(t.lowest_preferred_usd)}</div><div class="price-label">Lowest seen</div></div>
        <div><div class="price">${usd(t.latest_any_usd)}</div><div class="price-label">Any airline</div></div>
      </div>
      <div class="meta" style="margin-top:8px">Checked ${esc(timeAgo(t.last_checked_at))}${t.target_price_usd ? ` · Alert under ${usd(t.target_price_usd)}` : ''}</div>
    </a>`;
}

// ---------- New trip form ----------

async function renderForm() {
  view.innerHTML = '';
  view.append(document.getElementById('trip-form-tpl').content.cloneNode(true));
  const form = document.getElementById('trip-form');
  const hint = document.getElementById('combo-hint');

  const updateHint = () => {
    const f = Object.fromEntries(new FormData(form));
    if (!f.depart_from || !f.return_from) { hint.textContent = ''; return; }
    const days = (a, b) => Math.round((Date.parse(b || a) - Date.parse(a)) / 86400000) + 1;
    const combos = Math.max(0, days(f.depart_from, f.depart_to)) * Math.max(0, days(f.return_from, f.return_to));
    hint.textContent = `${combos} date combination${combos === 1 ? '' : 's'} (max ${appConfig.maxDateCombos}). Each one is searched separately.`;
  };
  form.addEventListener('input', updateHint);
  // Keep the "to" date sensible when the "from" date is picked
  for (const [from, to] of [['depart_from', 'depart_to'], ['return_from', 'return_to']]) {
    form[from].addEventListener('change', () => {
      if (!form[to].value || form[to].value < form[from].value) form[to].value = form[from].value;
      updateHint();
    });
  }

  if (appConfig.fixturesEnabled) loadFixtures(form, updateHint);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('form-error');
    err.hidden = true;
    const f = Object.fromEntries(new FormData(form));
    const body = {
      ...f,
      include_lhr_rail: form.include_lhr_rail.checked,
      include_man: form.include_man.checked,
      adults: Number(f.adults),
      max_stops: Number(f.max_stops),
      target_price_usd: f.target_price_usd || null,
    };
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const trip = await api('/trips', { method: 'POST', body });
      location.hash = `#/trip/${trip.id}`;
    } catch (error) {
      err.textContent = error.message;
      err.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

async function loadFixtures(form, onChange) {
  const picker = document.getElementById('fixture-picker');
  const select = document.getElementById('fixture');
  const showAway = document.getElementById('show-away');
  picker.hidden = false;
  let fixtures = [];
  try {
    fixtures = await api('/fixtures');
  } catch (error) {
    select.innerHTML = `<option value="">Couldn't load fixtures: ${esc(error.message)}</option>`;
    return;
  }
  const fill = () => {
    const list = fixtures.filter((m) => m.home || showAway.checked);
    select.innerHTML = `<option value="">Choose a match…</option>${list
      .map((m) => `<option value="${m.id}">${esc(fmtDate(m.matchDate))}: ${esc(m.label)}</option>`)
      .join('')}`;
  };
  fill();
  showAway.addEventListener('change', fill);
  select.addEventListener('change', () => {
    const m = fixtures.find((x) => String(x.id) === select.value);
    if (!m) return;
    form.name.value = m.label.replace(/ \(.*\)$/, '');
    form.depart_from.value = m.departFrom;
    form.depart_to.value = m.departTo;
    form.return_from.value = m.returnFrom;
    form.return_to.value = m.returnTo;
    form.match_date.value = m.matchDate;
    form.match_label.value = m.label;
    onChange();
  });
}

// ---------- Trip detail ----------

async function renderTrip(id) {
  const { trip, latestRun, history } = await api(`/trips/${id}`);
  const options = latestRun?.options || [];
  const best = (route, preferred) => options.find((o) => o.route === route && o.is_preferred === preferred);
  const cheapestAny = options[0];
  const tiles = [
    trip.include_lhr_rail && { title: `${airline(trip.preferred_airline)} to Heathrow + train`, o: best('LHR_RAIL', true) },
    trip.include_man && { title: `${airline(trip.preferred_airline)} into Manchester`, o: best('MAN', true) },
    { title: 'Cheapest on any airline', o: cheapestAny },
  ].filter(Boolean);
  const bestPreferredTotal = Math.min(...options.filter((o) => o.is_preferred).map((o) => o.total_usd));

  view.innerHTML = `
    <section class="card">
      <div class="detail-head">
        <div>
          <h1 style="margin-bottom:4px">${esc(trip.name)}</h1>
          <div class="meta">
            ${trip.match_label ? `${esc(trip.match_label)} · ${esc(fmtDate(trip.match_date))}<br>` : ''}
            ${esc(trip.origin)} out ${esc(fmtDate(trip.depart_from))}–${esc(fmtDate(trip.depart_to))},
            home ${esc(fmtDate(trip.return_from))}–${esc(fmtDate(trip.return_to))} ·
            ${trip.adults} traveller${trip.adults > 1 ? 's' : ''} · ${esc(trip.cabin.replace('_', ' '))}
          </div>
          <div class="meta">Last checked ${esc(timeAgo(latestRun?.checked_at))}${latestRun ? ` via ${esc(latestRun.flight_provider)}` : ''}${trip.active ? '' : ' · <strong>paused</strong>'}</div>
        </div>
        <div class="toolbar">
          <button class="btn primary" id="check-now">Check prices now</button>
          <button class="btn" id="toggle-active">${trip.active ? 'Pause' : 'Resume'}</button>
          <button class="btn" id="set-target">${trip.target_price_usd ? `Alert under ${usd(trip.target_price_usd)}` : 'Set price alert'}</button>
          <button class="btn danger" id="delete">Delete</button>
        </div>
      </div>
      ${latestRun?.error ? `<p class="error" style="white-space:pre-line;margin:12px 0 0">${esc(latestRun.error)}</p>` : ''}
    </section>

    ${latestRun ? '' : '<section class="card empty"><p>Checking prices… this page will update on its own.</p></section>'}

    ${options.length ? `
    <div class="tiles">
      ${tiles.map(({ title, o }) => `
        <div class="tile ${o && o.is_preferred && o.total_usd === bestPreferredTotal ? 'best' : ''}">
          <div class="price-label">${esc(title)}</div>
          <div class="price">${usd(o?.total_usd)}</div>
          <div class="meta">${o ? `${esc(o.carrier)} · ${esc(fmtDate(o.depart_date))} → ${esc(fmtDate(o.return_date))}` : 'No options found'}</div>
        </div>`).join('')}
    </div>` : ''}

    ${history.length ? `
    <section class="card">
      <h2>Price history (cheapest total per check)</h2>
      <div class="chart-wrap"><canvas id="history-chart" aria-label="Price history chart; the same numbers are in the table below"></canvas></div>
      <p class="hint" id="chart-fallback" hidden>Chart library didn't load, so here are the numbers instead.</p>
    </section>` : ''}

    ${options.length ? `
    <section class="card">
      <h2>All options from the latest check</h2>
      <p class="hint" style="margin-top:-6px">Totals include flights, trains, and airport transfers for every traveller. Tap a row for times and booking links.</p>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>Dates</th><th>Route</th><th>Airline</th>
            <th class="num hide-sm">Flights</th><th class="num hide-sm">Trains</th><th class="num hide-sm">Transfers</th><th class="num">Total</th>
          </tr></thead>
          <tbody>${options.map(optionRows).join('')}</tbody>
        </table>
      </div>
    </section>` : ''}
  `;

  document.getElementById('check-now').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Checking…';
    try {
      await api(`/trips/${id}/check`, { method: 'POST' });
    } catch (error) {
      alert(error.message);
    }
    route();
  };
  document.getElementById('toggle-active').onclick = async () => {
    await api(`/trips/${id}`, { method: 'PATCH', body: { active: !trip.active } });
    route();
  };
  document.getElementById('set-target').onclick = async () => {
    const value = prompt('Alert me when the best total trip price is under (USD). Leave blank to turn alerts off.', trip.target_price_usd ?? '');
    if (value === null) return;
    try {
      await api(`/trips/${id}`, { method: 'PATCH', body: { target_price_usd: value.trim() || null } });
    } catch (error) {
      alert(error.message);
    }
    route();
  };
  document.getElementById('delete').onclick = async () => {
    if (!confirm(`Stop tracking "${trip.name}" and delete its price history?`)) return;
    await api(`/trips/${id}`, { method: 'DELETE' });
    location.hash = '#/';
  };
  view.querySelectorAll('tr.option-row').forEach((row) => {
    row.addEventListener('click', () => {
      const details = row.nextElementSibling;
      details.hidden = !details.hidden;
      row.setAttribute('aria-expanded', String(!details.hidden));
    });
  });

  if (history.length) drawChart(history, airline(trip.preferred_airline));
  if (!latestRun) pollTimer = setTimeout(() => renderTrip(id).catch(showError), 2000);
}

function optionRows(o) {
  const d = o.details || {};
  const f = d.flight || {};
  const seg = (s) => `${esc(s.flightNumber || s.carrier)} ${esc(s.from)}→${esc(s.to)}`;
  const slice = (label, sl) => sl ? `
    <div class="leg">
      <h3>${label}</h3>
      <p>${sl.segments.map(seg).join(', ')}</p>
      <p class="meta">Departs ${esc(fmtDateTime(sl.departAt))} · arrives ${esc(fmtDateTime(sl.arriveAt))} · ${sl.stops === 0 ? 'nonstop' : `${sl.stops} stop${sl.stops > 1 ? 's' : ''}`}</p>
    </div>` : `<div class="leg"><h3>${label}</h3><p class="meta">Details not provided by this price source</p></div>`;
  const train = (label, t) => t ? `
    <div class="leg">
      <h3>${label}</h3>
      <p>${esc(t.operator)} ${esc(fmtTime(t.departAt))} → ${esc(fmtTime(t.arriveAt))} on ${esc(fmtDate(t.departAt.slice(0, 10)))}</p>
      <p class="meta">${esc(t.fareType)} · £${esc(t.price)} · <a href="${esc(t.bookingUrl)}" target="_blank" rel="noopener">Check live fare</a></p>
    </div>` : '';
  return `
    <tr class="option-row" aria-expanded="false" tabindex="0">
      <td>${esc(fmtDate(o.depart_date))} → ${esc(fmtDate(o.return_date))}</td>
      <td>${esc(ROUTE_LABEL[o.route])}</td>
      <td>${esc(o.carrier)}${o.is_preferred ? ' ★' : ''}</td>
      <td class="num hide-sm">${usd(o.flight_usd)}</td>
      <td class="num hide-sm">${o.rail_usd ? usd(o.rail_usd) : '—'}</td>
      <td class="num hide-sm">${usd(o.transfer_usd)}</td>
      <td class="num"><strong>${usd(o.total_usd)}</strong></td>
    </tr>
    <tr class="details-row" hidden>
      <td colspan="7">
        <div class="legs">
          ${slice('Flight out', f.outbound)}
          ${train('Train London Euston → Manchester Piccadilly', d.trainOut)}
          ${train('Train Manchester Piccadilly → London Euston', d.trainBack)}
          ${slice('Flight home', f.inbound)}
        </div>
        ${d.notes?.length ? `<ul class="notes">${d.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        <p style="margin:8px 0 0"><a class="btn" href="${esc(f.bookingUrl)}" target="_blank" rel="noopener">See these flights ↗</a></p>
      </td>
    </tr>`;
}

function drawChart(history, preferredName) {
  const canvas = document.getElementById('history-chart');
  if (!window.Chart) {
    document.getElementById('chart-fallback').hidden = false;
    canvas.parentElement.hidden = true;
    return;
  }
  const runs = [...new Map(history.map((h) => [h.run_id, h.checked_at])).entries()];
  const labels = runs.map(([, t]) => utc(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' }));
  const datasets = SERIES.map((s) => {
    const data = runs.map(([runId]) => {
      const point = history.find((h) => h.run_id === runId && `${h.route}|${h.is_preferred ? 1 : 0}` === s.key);
      return point ? point.total_usd : null;
    });
    const color = cssVar(s.color);
    return {
      label: s.label.replace('{pref}', preferredName), data, borderColor: color, backgroundColor: color, borderDash: s.dash,
      borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: cssVar('--surface'), pointBorderWidth: 2,
      spanGaps: true, tension: 0.2,
    };
  }).filter((d) => d.data.some((v) => v != null));

  const text2 = cssVar('--text-2');
  const grid = cssVar('--grid');
  chart = new window.Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: text2, usePointStyle: true, boxHeight: 6 } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${usd(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: text2, maxRotation: 0, autoSkip: true }, grid: { display: false } },
        y: { ticks: { color: text2, callback: (v) => usd(v) }, grid: { color: grid }, border: { display: false } },
      },
    },
  });
}

// ---------- Router ----------

function showError(error) {
  view.innerHTML = `<section class="card"><p class="error">${esc(error.message)}</p><a href="#/" class="btn">Back to trips</a></section>`;
}

async function route() {
  clearTimers();
  const hash = location.hash || '#/';
  try {
    if (hash === '#/new') await renderForm();
    else if (hash.startsWith('#/trip/')) await renderTrip(hash.split('/')[2]);
    else await renderList();
  } catch (error) {
    showError(error);
  }
}

async function init() {
  appConfig = await api('/config');
  const notes = [];
  if (appConfig.flightProvider === 'mock') notes.push('<strong>Demo mode:</strong> flight prices are sample data. Add a Duffel or SerpApi key (see README) for real fares.');
  if (appConfig.trainProvider === 'estimate') notes.push('Train fares are estimates of Avanti Advance fares. Each train links to National Rail for the live price.');
  if (notes.length) {
    banner.innerHTML = notes.join('<br>');
    banner.hidden = false;
  }
  window.addEventListener('hashchange', route);
  route();
}

init().catch(showError);
