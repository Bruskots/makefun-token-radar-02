// Token Launch Radar dashboard: renders window.RADAR (written by main.ts
// into data.js beside this page) as a sortable, filterable board with a
// detail view per protocol. No network: every byte it reads is local.
//
// Deep links, used by the screenshots and by readers: #detail=<slug> opens
// a protocol, #watch=1 shows the watchlist only, #q=<text> prefills the
// search, #cat=<category> prefills the category filter.

(function () {
  'use strict';
  var data = window.RADAR;
  if (!data) {
    document.getElementById('meta').textContent = 'Could not load the board data (data.js).';
    return;
  }
  var meta = data.meta;
  var rows = data.rows.slice();
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(c) {
    if (c === null || c === undefined) return '<span class="flat">—</span>';
    var cls = c > 0 ? 'up' : c < 0 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (c > 0 ? '+' : '') + c.toFixed(1) + '%</span>';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Header: what the snapshot is and what the board covers.
  document.getElementById('meta').textContent =
    'Snapshot ' + meta.as_of + ' · ' + meta.protocols_total + ' protocols at $5M+ TVL · ' +
    meta.watchlist_total + ' on the watchlist · benchmark ' +
    meta.benchmark_median_mcap_tvl.toFixed(3) + '× median mcap/TVL';

  var watchRows = rows.filter(function (r) { return r.watch; });
  var topValue = rows.length ? rows[0].value : 0;
  var stats = [
    [rows.length, 'pre-token protocols ranked'],
    [meta.watchlist_total, 'watchlist protocols covered'],
    [meta.token_bearing, 'record a token already'],
    [money(topValue), 'top implied value'],
    [meta.benchmark_median_mcap_tvl.toFixed(3) + '×', 'median mcap / TVL benchmark'],
  ];
  document.getElementById('stats').innerHTML = stats.map(function (s) {
    return '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>';
  }).join('');

  // Category filter options, most common first.
  var counts = {};
  rows.forEach(function (r) {
    var c = r.cat || 'Uncategorised';
    counts[c] = (counts[c] || 0) + 1;
  });
  var cats = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  var catSel = document.getElementById('cat');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c;
    o.textContent = c + ' (' + counts[c] + ')';
    catSel.appendChild(o);
  });

  var qEl = document.getElementById('q');
  var sortEl = document.getElementById('sort');
  var minEl = document.getElementById('minTvl');
  var watchEl = document.getElementById('watchOnly');
  var rowsEl = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var emptyEl = document.getElementById('empty');
  var sortKey = 'value';

  function visible() {
    var q = qEl.value.trim().toLowerCase();
    var cat = catSel.value;
    var min = Number(minEl.value);
    var list = rows.filter(function (r) {
      if (watchEl.checked && !r.watch) return false;
      if (cat && (r.cat || 'Uncategorised') !== cat) return false;
      if (r.tvl < min) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = sortKey;
    list.sort(function (a, b) {
      if (key === 'tvl') return b.tvl - a.tvl;
      if (key === 'growth') return (b.change7d || 0) - (a.change7d || 0);
      if (key === 'age') return b.days - a.days;
      if (key === 'rank') return a.rank - b.rank;
      return b.value - a.value;
    });
    return list;
  }

  function render() {
    var list = visible();
    countEl.textContent = list.length + ' of ' + rows.length + ' protocols';
    emptyEl.hidden = list.length > 0;
    rowsEl.innerHTML = list.map(function (r) {
      var badge = r.watch ? ' <span class="pill">WATCHLIST</span>' : ' <span class="pill pre">PRE-TOKEN</span>';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' + badge +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.cat || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl) + '</td>' +
        '<td class="num">' + pct(r.change7d) + '</td>' +
        '<td class="num">' + (r.listed || '—') + '<span class="slug">' + r.days + 'd</span></td>' +
        '<td class="num value">' + money(r.value) + '</td>' +
        '<td>' + r.steps.length + ' steps</td></tr>';
    }).join('');
  }

  function showDetail(slug) {
    var r = bySlug[slug];
    var panel = document.getElementById('detail');
    var body = document.getElementById('detailBody');
    if (!r) { panel.hidden = true; body.innerHTML = ''; return; }
    var factors = [
      [money(r.value), 'implied value'],
      ['×' + r.gf.toFixed(2), 'growth factor'],
      ['×' + r.af.toFixed(2), 'age factor'],
      ['×' + r.bf.toFixed(2), 'breadth factor'],
      ['×' + r.cf.toFixed(2), 'category factor'],
    ];
    body.innerHTML =
      '<h2>' + esc(r.name) + ' <span class="slug">#' + r.rank + ' · ' + esc(r.slug) + '</span></h2>' +
      '<p class="sub">' + esc(r.cat || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      ' · TVL ' + money(r.tvl) + ' · 7d ' + (r.change7d === null ? 'n/a' : (r.change7d > 0 ? '+' : '') + r.change7d.toFixed(1) + '%') +
      ' · listed ' + (r.listed || 'unknown') + ' (' + r.days + ' days) · ' +
      (r.watch ? 'on the watchlist' : 'below the watchlist floor — an early find') + ' · records no token</p>' +
      '<div class="factors">' + factors.map(function (f) {
        return '<div class="factor"><b>' + f[0] + '</b><span>' + f[1] + '</span></div>';
      }).join('') + '</div>' +
      '<p class="sub">Implied value = ' + money(r.tvl) + ' TVL × ' +
      meta.benchmark_median_mcap_tvl.toFixed(3) + '× benchmark × ' + r.gf.toFixed(2) + ' × ' +
      r.af.toFixed(2) + ' × ' + r.bf.toFixed(2) + ' × ' + r.cf.toFixed(2) + '.</p>' +
      '<h3>How to farm it</h3><ol class="steps">' +
      r.steps.map(function (s, i) {
        return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(s) + '</li>';
      }).join('') + '</ol>';
    panel.hidden = false;
    Array.prototype.forEach.call(rowsEl.querySelectorAll('tr'), function (tr) {
      tr.classList.toggle('open', tr.getAttribute('data-slug') === slug);
    });
  }

  rowsEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  document.getElementById('closeDetail').addEventListener('click', function () { showDetail(''); });
  [qEl, catSel, minEl, watchEl].forEach(function (el) {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  sortEl.addEventListener('change', function () { sortKey = sortEl.value; render(); });
  document.querySelectorAll('#board th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      sortKey = k === 'name' ? 'value' : k;
      sortEl.value = sortKey === 'rank' ? 'value' : sortKey;
      render();
    });
  });

  // Deep links from the URL hash.
  var hash = {};
  window.location.hash.slice(1).split('&').forEach(function (part) {
    var kv = part.split('=');
    if (kv[0]) hash[kv[0]] = decodeURIComponent(kv[1] || '');
  });
  if (hash.q) qEl.value = hash.q;
  if (hash.cat) catSel.value = hash.cat;
  if (hash.watch === '1') watchEl.checked = true;
  if (hash.sort) { sortKey = hash.sort; sortEl.value = hash.sort; }

  render();
  if (hash.detail) {
    showDetail(hash.detail);
    document.getElementById('detail').scrollIntoView();
  }
})();
