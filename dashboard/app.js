// Token Radar dashboard: board, live tokens, detail view. No network: all data comes
// from window.RADAR, written by main.ts as data.js beside this page.
(function () {
  var D = window.RADAR;
  if (!D) { document.getElementById('rows').innerHTML = '<tr><td colspan="7">No data: data.js is missing.</td></tr>'; return; }
  var watch = new Set(D.watchlist || []);
  var rows = D.rows, live = D.live;
  var $ = function (id) { return document.getElementById(id); };
  var fmt$ = function (n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  };
  var fmtPct = function (n) { return n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  $('meta').innerHTML = '<b>' + D.board_size + ' pre-token protocols</b> · watchlist ' + D.watchlist_size +
    ' + ' + D.early_size + ' early finds · ' + D.live_size + ' live tokens set aside · snapshot ' + esc(D.as_of) +
    ' · floor $' + (D.floor_usd / 1e6) + 'M';
  $('asof').textContent = D.as_of; $('asof2').textContent = D.as_of;

  // Filter option lists, from the data itself.
  var cats = {}, chains = {};
  rows.concat(live).forEach(function (r) { if (r.category) cats[r.category] = 1; (r.chains || []).forEach(function (c) { chains[c] = 1; }); });
  Object.keys(cats).sort().forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o); });
  Object.keys(chains).sort().forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o); });

  var tab = 'board';
  var params = new URLSearchParams(location.search);
  if (params.get('tab') === 'live') tab = 'live';
  if (params.get('tab') === 'about') tab = 'about';
  if (params.get('category')) $('cat').value = params.get('category');
  if (params.get('chain')) $('chain').value = params.get('chain');

  function setTab(t) {
    tab = t;
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    $('filters').style.display = t === 'about' ? 'none' : '';
    $('board').style.display = t === 'about' ? 'none' : '';
    $('about').hidden = t !== 'about';
    if (t === 'about') { $('detail').hidden = true; }
    render();
  }
  document.querySelectorAll('#tabs button').forEach(function (b) { b.addEventListener('click', function () { setTab(b.dataset.tab); }); });

  function current() {
    var list = tab === 'live' ? live.slice() : rows.slice();
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value, chain = $('chain').value, sort = $('sort').value;
    if (q) list = list.filter(function (r) { return r.name.toLowerCase().includes(q) || r.slug.includes(q); });
    if (cat) list = list.filter(function (r) { return r.category === cat; });
    if (chain) list = list.filter(function (r) { return (r.chains || []).includes(chain); });
    var val = function (r) { return tab === 'live' ? (r.mcap_usd || 0) : r.implied_value_usd; };
    if (sort === 'tvl') list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (sort === 'growth') list.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (sort === 'age') list.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else list.sort(function (a, b) { return val(b) - val(a); });
    return list;
  }

  function render() {
    if (tab === 'about') return;
    var list = current();
    $('count').textContent = list.length + ' shown';
    var html = list.map(function (r, i) {
      var value = tab === 'live' ? r.mcap_usd : r.implied_value_usd;
      var rank = tab === 'live' ? i + 1 : r.rank;
      var g = r.change_7d;
      var wl = tab === 'board' && D.watchlist && D.watchlist.indexOf(r.slug) >= 0 ? '<span class="wl">★ watchlist</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + wl + '<br><span style="color:var(--muted);font-size:12px">' + esc(r.slug) + '</span></td>' +
        '<td><span class="cat">' + esc(r.category || '—') + '</span></td>' +
        '<td>' + esc((r.chains || []).slice(0, 2).join(', ') || '—') + '</td>' +
        '<td class="num">' + fmt$(r.tvl_usd) + '</td>' +
        '<td class="num ' + (g === null ? '' : g >= 0 ? 'pos' : 'neg') + '">' + fmtPct(g) + '</td>' +
        '<td class="num val">' + fmt$(value) + '</td></tr>';
    }).join('');
    $('rows').innerHTML = html || '<tr><td colspan="7">Nothing matches the filter.</td></tr>';
    document.querySelectorAll('#rows tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.dataset.slug); });
    });
  }

  function showDetail(slug) {
    var r = rows.find(function (x) { return x.slug === slug; }) || live.find(function (x) { return x.slug === slug; });
    if (!r) return;
    document.querySelectorAll('#rows tr').forEach(function (tr) { tr.classList.toggle('sel', tr.dataset.slug === slug); });
    var isLive = live.indexOf(r) >= 0;
    var value = isLive ? r.mcap_usd : r.implied_value_usd;
    var label = isLive ? 'Market cap (live token)' : 'Implied value (pre-token)';
    var steps = (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var model = isLive ? '' :
      '<div class="grid"><div><span>Category weight</span><b>×' + r.category_weight + '</b></div>' +
      '<div><span>Growth mult</span><b>×' + r.growth_multiplier + '</b></div>' +
      '<div><span>Maturity mult</span><b>×' + r.maturity_multiplier + '</b></div>' +
      '<div><span>Age, no token</span><b>' + (r.age_days === null ? 'unknown' : r.age_days + ' days') + '</b></div></div>';
    $('detail-body').innerHTML =
      '<h2>' + esc(r.name) + '</h2><p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') +
      ' · ' + esc((r.chains || []).join(', ') || '—') + ' · listed ' + esc(r.listed_at || 'unknown') + '</p>' +
      '<div class="big">' + fmt$(value) + '</div><p class="sub">' + label + ' · TVL ' + fmt$(r.tvl_usd) +
      ' · 7d ' + fmtPct(r.change_7d) + '</p>' + model +
      (steps ? '<h3>Farm plan — what to do, what it costs, how long it takes</h3><ol>' + steps + '</ol>' : '') +
      '<p class="note">This protocol records no token in the snapshot. That is not proof it has none — a token may exist that DefiLlama does not carry. The implied value is this entry\'s own claim, not a prediction of a launch.</p>';
    $('detail').hidden = false;
  }
  $('close').addEventListener('click', function () { $('detail').hidden = true; });
  ['q', 'cat', 'chain', 'sort'].forEach(function (id) { $(id).addEventListener('input', render); $(id).addEventListener('change', render); });

  setTab(tab);
  if (params.get('slug')) showDetail(params.get('slug'));
})();
