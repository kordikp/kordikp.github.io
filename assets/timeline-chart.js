/* Research timeline chart. One brick per paper or supervised thesis, stacked by year and coloured by topic.
   Zoom: click an era or a year, or drag across years. Wide columns turn the bricks into labelled rows.
   Usage: TimelineChart.mount(element, data, { mini, state, onChange, onSelect, onNavigate }). */
(function () {
  'use strict';

  // Categorical slots s1-s7, validated on #ffffff; the order follows the theme order in the data.
  const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
  const KIND_ORDER = { paper: 0, PhD: 1, MSc: 2, BSc: 3 };
  const KIND_LABEL = { PhD: 'Ph.D. thesis', MSc: "Master's thesis", BSc: "Bachelor's thesis" };
  const SUB_LABEL = {
    conference: 'Conference paper', journal: 'Journal article', workshop: 'Workshop paper', preprint: 'Preprint',
    chapter: 'Book chapter', software: 'Software', article: 'Article', thesis: 'Own Ph.D. thesis'
  };
  const TAG = { paper: 'Paper', PhD: 'PhD', MSc: 'MSc', BSc: 'BSc' };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fold = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function mix(hex, a) {
    const n = parseInt(hex.slice(1), 16), m = v => Math.round(v * a + 255 * (1 - a));
    return `rgb(${m(n >> 16)},${m((n >> 8) & 255)},${m(n & 255)})`;
  }

  function prepare(data) {
    const themes = data.themes.map((t, i) => {
      const c = COLORS[i % COLORS.length];
      return { ...t, idx: i, color: c, tint: mix(c, .26), tintP: mix(c, .3), tintT: mix(c, .1) };
    });
    const byId = Object.fromEntries(themes.map(t => [t.id, t]));
    const items = data.items.filter(i => i.type !== 'milestone').map(i => {
      const th = (i.themes || []).filter(t => byId[t]);
      return {
        ...i, kind: i.type === 'paper' ? 'paper' : i.sub, themes: th.length ? th : [themes[0].id],
        id: (i.type === 'paper' ? 'p' : 't') + hash(i.y + '|' + i.title),
        hay: fold([i.title, i.title_cs, i.authors, i.student, i.venue].join(' '))
      };
    });
    items.forEach(i => { i.t0 = byId[i.themes[0]].idx; });
    items.sort((a, b) => a.y - b.y || a.t0 - b.t0 || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title));
    const milestones = data.items.filter(i => i.type === 'milestone');
    const ys = data.items.map(i => i.y).concat(data.eras.map(e => e.from), data.eras.map(e => e.to));
    return {
      themes, byId, items, milestones, eras: data.eras, generated: data.generated,
      minY: Math.min(...ys), maxY: Math.max(...ys), byKey: Object.fromEntries(items.map(i => [i.id, i]))
    };
  }

  function kindLabel(it) {
    if (it.type === 'paper') return SUB_LABEL[it.sub] || 'Paper';
    return KIND_LABEL[it.kind] + (it.role === 'co-supervisor' ? ', co-supervised' : '');
  }

  function mount(root, data, opts) {
    opts = opts || {};
    const D = data.byKey ? data : prepare(data);
    const mini = !!opts.mini;
    const st = Object.assign({ from: D.minY, to: D.maxY, theme: null, show: { paper: true, thesis: true }, q: '', sel: null }, opts.state || {});
    st.show = Object.assign({ paper: true, thesis: true }, st.show);

    root.classList.add('tlc');
    if (mini) root.classList.add('tlc-mini');
    root.innerHTML =
      '<div class="tlc-legend" role="group" aria-label="Topics"></div>' +
      '<div class="tlc-stage"><div class="tlc-clip"><div class="tlc-bands"></div><div class="tlc-grids"></div>' +
      '<div class="tlc-flags"></div><div class="tlc-bricks"></div><div class="tlc-brush"></div></div>' +
      '<div class="tlc-gls" aria-hidden="true"></div><div class="tlc-axis"></div>' +
      (mini ? '' : '<div class="tlc-mm" title="Drag to pick years"><div class="tlc-mmbars"></div><div class="tlc-mmw"></div>' +
        '<div class="tlc-hint"><i class="bi bi-zoom-in"></i><span class="long">Click an era or a year to zoom in, drag across the chart to pick years, click a brick for details</span><span class="short">Tap an era or a year to zoom in, tap a brick for details</span></div></div>') +
      '</div><div class="tlc-tip" role="tooltip"></div>';
    const q$ = s => root.querySelector(s);
    const legend = q$('.tlc-legend'), stage = q$('.tlc-stage'), clip = q$('.tlc-clip'), brushEl = q$('.tlc-brush');
    const glsEl = q$('.tlc-gls'), axisEl = q$('.tlc-axis'), mmEl = q$('.tlc-mm'), tip = q$('.tlc-tip');

    // Legend
    const chips = D.themes.map(t => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tlc-chip'; b.style.setProperty('--c', t.color); b.dataset.theme = t.id;
      b.title = t.label;
      b.innerHTML = `<i></i>${esc(t.short)} <b></b>`;
      legend.appendChild(b);
      return b;
    });
    const types = document.createElement('span');
    types.className = 'tlc-types';
    types.innerHTML = '<span><i></i>paper</span><span><i class="th"></i>supervised thesis</span>';
    legend.appendChild(types);

    // Era bands
    const bandEls = D.eras.map((e, i) => {
      const el = document.createElement('div');
      el.className = 'tlc-band' + (i % 2 ? '' : ' alt');
      el.innerHTML = `<button type="button" class="tlc-era" data-era="${i}" title="Zoom to ${e.from}–${e.to}"><b>${esc(e.title)}</b><span>${e.from}–${e.to}</span></button>`;
      q$('.tlc-bands').appendChild(el);
      return el;
    });

    // Grid lines
    const gridEls = [], glEls = [];
    for (let i = 0; i < 14; i++) {
      const g = document.createElement('div'); g.className = 'tlc-grid'; q$('.tlc-grids').appendChild(g); gridEls.push(g);
      const l = document.createElement('div'); l.className = 'tlc-gl'; glsEl.appendChild(l); glEls.push(l);
    }

    // Milestone flags, one per year
    const msByYear = {};
    D.milestones.forEach(m => { (msByYear[m.y] = msByYear[m.y] || []).push(m); });
    const flags = Object.keys(msByYear).map(Number).map(y => {
      const el = document.createElement('div');
      const ms = msByYear[y];
      el.className = 'tlc-flag'; el.dataset.year = y;
      el.innerHTML = `<i class="bi bi-flag-fill"></i><em>${esc(ms[0].title)}</em>${ms.length > 1 ? `<b>${mini ? ms.length : '+' + (ms.length - 1)}</b>` : ''}`;
      q$('.tlc-flags').appendChild(el);
      return { y, el, ms };
    });

    // Bricks
    const frag = document.createDocumentFragment();
    D.items.forEach(it => {
      const el = document.createElement('div');
      el.className = 'tlc-b' + (it.type === 'thesis' ? ' th' : '') + (it.kind === 'PhD' ? ' phd' : '');
      el.dataset.id = it.id;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${it.y}, ${kindLabel(it)}: ${it.title}`);
      const who = it.type === 'paper' ? it.authors : it.student;
      const l2 = it.type === 'paper' ? it.venue : kindLabel(it) + (it.student ? ' · ' + it.student : '');
      el.innerHTML = `<span class="l1"><span class="tag">${TAG[it.kind] || ''}</span>${esc(it.title)}${who ? `<span class="who"> — ${esc(who)}</span>` : ''}</span><span class="l2">${esc(l2)}</span>`;
      it.el = el;
      frag.appendChild(el);
    });
    q$('.tlc-bricks').appendChild(frag);

    // Axis and minimap
    const yrEls = [], mmBars = [];
    for (let y = D.minY; y <= D.maxY; y++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tlc-yr'; b.dataset.year = y; b.textContent = y; b.title = 'Zoom to ' + y;
      axisEl.appendChild(b); yrEls.push(b);
      if (mmEl) { const m = document.createElement('div'); m.className = 'tlc-mmb'; q$('.tlc-mmbars').appendChild(m); mmBars.push(m); }
    }

    const visible = it => st.show[it.type] && (!st.theme || it.themes.includes(st.theme));
    const eraOf = (a, b) => D.eras.find(e => a >= e.from && b <= e.to) || null;
    let G = null;

    function geom() {
      const W = stage.clientWidth, H = stage.clientHeight;
      const gut = 28, right = 2, axisH = 22, mmH = mini ? 0 : 30;
      const eraH = W < 600 ? 38 : 50, flagH = 22;
      const clipW = W - gut - right, clipH = H - axisH - mmH;
      return { W, H, gut, axisH, mmH, eraH, flagH, clipW, clipH, top: eraH + flagH + 6, plotH: clipH - eraH - flagH - 6 };
    }

    function render(anim, collapsed) {
      const g = geom();
      if (g.clipW < 40 || g.plotH < 40) return;
      root.classList.toggle('noanim', anim === false);
      Object.assign(clip.style, { left: g.gut + 'px', top: 0, width: g.clipW + 'px', height: g.clipH + 'px' });
      Object.assign(glsEl.style, { width: g.gut + 'px', height: g.clipH + 'px' });
      Object.assign(axisEl.style, { left: g.gut + 'px', top: g.clipH + 'px', width: g.clipW + 'px', height: g.axisH + 'px' });
      if (mmEl) Object.assign(mmEl.style, { left: g.gut + 'px', top: (g.clipH + g.axisH + 2) + 'px', width: g.clipW + 'px', height: (g.mmH - 4) + 'px' });

      const n = st.to - st.from + 1, colW = g.clipW / n;
      const gapX = n > 12 ? Math.max(2, colW * .16) : n > 3 ? Math.max(6, colW * .07) : Math.max(10, colW * .03);
      const barW = Math.max(2, colW - gapX);
      const stacks = {};
      D.items.forEach(it => { if (visible(it)) (stacks[it.y] = stacks[it.y] || []).push(it); });
      let maxC = 4;
      for (let y = st.from; y <= st.to; y++) maxC = Math.max(maxC, (stacks[y] || []).length);
      const wide = barW >= 128;
      const unitH = Math.min(g.plotH / maxC, wide ? 64 : 46);
      const gapY = unitH >= 10 ? 2 : 1;
      // Labelled rows: one line; two lines (title wrapped, or title + venue on wide columns) when rows are tall.
      const lbl = wide && unitH >= 15, lbl2 = lbl && unitH >= 34 && barW >= 300, wrap = lbl && !lbl2 && unitH >= 32;
      root.classList.toggle('lbl', lbl);
      root.classList.toggle('lbl2', lbl2);
      root.classList.toggle('wrap', wrap);
      root.classList.toggle('tight', colW < 24);
      const base = g.clipH, xOf = y => (y - st.from) * colW + gapX / 2;
      G = Object.assign(g, { n, colW, barW, unitH, base });

      const pos = {};
      Object.values(stacks).forEach(arr => arr.forEach((it, k) => { pos[it.id] = k; }));
      const q = fold(st.q.trim());
      D.items.forEach(it => {
        const el = it.el, vis = visible(it);
        let y = base, h = 0;
        if (vis && !collapsed) { y = base - (pos[it.id] + 1) * unitH; h = Math.max(1, unitH - gapY); }
        el.style.transform = `translate(${xOf(it.y).toFixed(1)}px,${y.toFixed(1)}px)`;
        el.style.width = barW.toFixed(1) + 'px';
        el.style.height = h.toFixed(1) + 'px';
        el.classList.toggle('out', !vis);
        el.classList.toggle('dim', vis && !!q && !it.hay.includes(q));
        el.classList.toggle('sel', st.sel === it.id);
        const t = st.theme ? D.byId[st.theme] : D.themes[it.t0];
        el.style.setProperty('--c', t.color); el.style.setProperty('--t1', t.tint);
        el.style.setProperty('--tp', t.tintP); el.style.setProperty('--tt', t.tintT);
      });

      const cur = eraOf(st.from, st.to);
      D.eras.forEach((e, i) => {
        const el = bandEls[i], x0 = (e.from - st.from) * colW, w = (e.to - e.from + 1) * colW;
        el.style.transform = `translateX(${x0.toFixed(1)}px)`;
        el.style.width = w.toFixed(1) + 'px';
        const visW = Math.min(x0 + w, g.clipW) - Math.max(x0, 0);
        const lab = el.firstChild;
        lab.style.transform = `translateX(${Math.max(0, -x0).toFixed(1)}px)`;
        lab.style.width = Math.max(0, visW - 4).toFixed(1) + 'px';
        lab.style.maxHeight = (g.eraH - 4) + 'px';
        el.classList.toggle('narrow', visW < 58);
        el.classList.toggle('slim', visW < 110);
        el.classList.toggle('cur', cur === e && n < D.maxY - D.minY + 1);
      });

      const step = [1, 2, 5, 10, 20, 50].find(s => s * unitH >= 30 && maxC / s <= gridEls.length) || 50;
      gridEls.forEach((el, i) => {
        const v = (i + 1) * step, y = base - v * unitH, on = v <= maxC && y >= g.top;
        el.style.transform = `translateY(${y.toFixed(1)}px)`; el.style.opacity = on ? 1 : 0;
        glEls[i].textContent = v;
        glEls[i].style.transform = `translateY(${(y - 7).toFixed(1)}px)`; glEls[i].style.opacity = on ? 1 : 0;
      });

      flags.forEach(f => {
        f.el.style.transform = `translate(${xOf(f.y).toFixed(1)}px,${g.eraH + 2}px)`;
        f.el.style.maxWidth = Math.max(barW, 22).toFixed(1) + 'px';
        f.el.style.opacity = f.y >= st.from && f.y <= st.to ? 1 : 0;
      });

      const every = colW >= 34 ? 1 : colW >= 17 ? 2 : 5;
      yrEls.forEach((el, k) => {
        const y = D.minY + k;
        el.style.transform = `translateX(${((y - st.from) * colW).toFixed(1)}px)`;
        el.style.width = colW.toFixed(1) + 'px';
        el.classList.toggle('hide', y % every !== 0);
        el.classList.toggle('cur', n === 1 && y === st.from);
      });

      if (mmEl) {
        const N = D.maxY - D.minY + 1, mw = g.clipW / N, tot = [];
        for (let y = D.minY; y <= D.maxY; y++) tot.push((stacks[y] || []).length);
        const mx = Math.max(1, ...tot);
        mmBars.forEach((el, k) => {
          Object.assign(el.style, { left: (k * mw + 1).toFixed(1) + 'px', width: Math.max(1, mw - 2).toFixed(1) + 'px', height: (tot[k] / mx * (g.mmH - 10)).toFixed(1) + 'px' });
        });
        const w = q$('.tlc-mmw');
        w.style.transform = `translateX(${((st.from - D.minY) * mw).toFixed(1)}px)`;
        w.style.width = (n * mw).toFixed(1) + 'px';
        mmEl.classList.toggle('zoomed', n < N);
        G.mw = mw;
      }

      chips.forEach((c, i) => {
        const id = D.themes[i].id;
        const cnt = D.items.filter(it => it.y >= st.from && it.y <= st.to && st.show[it.type] && it.themes.includes(id)).length;
        c.querySelector('b').textContent = cnt;
        c.setAttribute('aria-pressed', st.theme === id ? 'true' : 'false');
        c.classList.toggle('off', (!!st.theme && st.theme !== id) || !cnt);
      });
      if (anim === false) { void root.offsetWidth; root.classList.remove('noanim'); }
    }

    function set(patch, anim) {
      Object.assign(st, patch || {});
      st.from = Math.max(D.minY, Math.min(st.from, D.maxY));
      st.to = Math.max(D.minY, Math.min(st.to, D.maxY));
      if (st.from > st.to) { const t = st.from; st.from = st.to; st.to = t; }
      if (st.sel) {
        const it = D.byKey[st.sel];
        if (!it || !visible(it) || it.y < st.from || it.y > st.to) st.sel = null;
      }
      render(anim !== false);
      if (opts.onChange) opts.onChange(api.state);
    }

    function zoomOut() {
      if (st.from === D.minY && st.to === D.maxY) return false;
      const e = eraOf(st.from, st.to);
      if (e && !(e.from === st.from && e.to === st.to)) set({ from: e.from, to: e.to });
      else set({ from: D.minY, to: D.maxY });
      return true;
    }

    function intro(stagger) {
      stagger = stagger == null ? 40 : stagger;
      render(false, true);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        D.items.forEach(it => { it.el.style.transitionDelay = Math.max(0, (it.y - st.from) * stagger) + 'ms'; });
        render(true);
        setTimeout(() => D.items.forEach(it => { it.el.style.transitionDelay = ''; }), 900 + (st.to - st.from + 1) * stagger);
      }));
    }

    const navigate = p => { if (opts.onNavigate) opts.onNavigate(p); };

    // Tooltip
    function tipItem(it) {
      const th = it.themes.map(t => `<span><i style="background:${D.byId[t].color}"></i>${esc(D.byId[t].short)}</span>`).join('');
      const who = it.type === 'paper' ? it.authors : it.student;
      return `<div class="tt-k">${it.y} · ${esc(kindLabel(it))}</div><div class="tt-t">${esc(it.title)}</div>` +
        (who ? `<div class="tt-w">${esc(who)}</div>` : '') +
        (it.type === 'paper' && it.venue ? `<div class="tt-v">${esc(it.venue)}</div>` : '') +
        `<div class="tt-ths">${th}</div>` + (mini ? '<div class="tt-hint">Click to open on the timeline</div>' : '');
    }
    function tipFlag(f) {
      return `<div class="tt-k">${f.y} · milestone${f.ms.length > 1 ? 's' : ''}</div><ul>${f.ms.map(m => `<li><b>${esc(m.title)}</b>${m.text ? ' — ' + esc(m.text) : ''}</li>`).join('')}</ul>`;
    }
    function showTip(html, e) { tip.innerHTML = html; tip.classList.add('on'); moveTip(e); }
    function moveTip(e) {
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 16;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > innerHeight - 8) y = e.clientY - h - 12;
      tip.style.transform = `translate(${Math.max(8, x)}px,${Math.max(8, y)}px)`;
    }
    const hideTip = () => tip.classList.remove('on');
    clip.addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse' || drag) return;
      const b = e.target.closest('.tlc-b'), f = e.target.closest('.tlc-flag');
      if (b) showTip(tipItem(D.byKey[b.dataset.id]), e);
      else if (f) showTip(tipFlag(flags.find(x => x.y === +f.dataset.year)), e);
    });
    clip.addEventListener('pointermove', e => { if (tip.classList.contains('on')) moveTip(e); });
    clip.addEventListener('pointerout', e => { if (!e.relatedTarget || !clip.contains(e.relatedTarget) || !e.relatedTarget.closest('.tlc-b,.tlc-flag')) hideTip(); });
    clip.addEventListener('pointerleave', hideTip);

    // Clicks
    let suppress = false;
    root.addEventListener('click', e => {
      if (suppress) return;
      const chip = e.target.closest('.tlc-chip');
      if (chip) {
        const id = chip.dataset.theme;
        if (mini) navigate({ theme: id }); else set({ theme: st.theme === id ? null : id });
        return;
      }
      const era = e.target.closest('.tlc-era');
      if (era) {
        const x = D.eras[+era.dataset.era];
        if (mini) navigate({ from: x.from, to: x.to }); else set({ from: x.from, to: x.to });
        return;
      }
      const yr = e.target.closest('.tlc-yr, .tlc-flag');
      if (yr) {
        const y = +yr.dataset.year;
        if (mini) navigate({ from: y, to: y }); else set({ from: y, to: y });
        return;
      }
      const b = e.target.closest('.tlc-b');
      if (b) {
        hideTip();
        if (mini) navigate({ item: b.dataset.id });
        else { set({ sel: st.sel === b.dataset.id ? null : b.dataset.id }); if (opts.onSelect) opts.onSelect(st.sel); }
      }
    });
    if (!mini) clip.addEventListener('dblclick', e => { if (!e.target.closest('.tlc-b,.tlc-era,.tlc-flag')) zoomOut(); });

    // Drag to zoom, on the chart and on the minimap
    let drag = null;
    function yearsAt(d, x) {
      const y = d.mm ? D.minY + Math.floor(x / G.mw) : st.from + Math.floor(x / G.colW);
      return Math.max(d.mm ? D.minY : st.from, Math.min(d.mm ? D.maxY : st.to, y));
    }
    function startDrag(e, mm) {
      if (mini || e.button !== 0 || e.target.closest('.tlc-era,.tlc-flag')) return;
      const r = (mm ? mmEl : clip).getBoundingClientRect();
      drag = { mm, r, x0: e.clientX - r.left, x1: e.clientX - r.left, on: !!mm && e.pointerType === 'mouse', type: e.pointerType };
    }
    clip.addEventListener('pointerdown', e => startDrag(e, false));
    if (mmEl) mmEl.addEventListener('pointerdown', e => startDrag(e, true));
    window.addEventListener('pointermove', e => {
      if (!drag) return;
      drag.x1 = e.clientX - drag.r.left;
      if (!drag.on && drag.type === 'mouse' && Math.abs(drag.x1 - drag.x0) > 8) { drag.on = true; hideTip(); }
      if (!drag.on || drag.mm) return;
      const a = yearsAt(drag, Math.min(drag.x0, drag.x1)), b = yearsAt(drag, Math.max(drag.x0, drag.x1));
      Object.assign(brushEl.style, { display: 'block', left: ((a - st.from) * G.colW) + 'px', width: ((b - a + 1) * G.colW) + 'px' });
    });
    window.addEventListener('pointerup', () => {
      if (!drag) return;
      const d = drag; drag = null; brushEl.style.display = 'none';
      if (d.mm) {
        const a = yearsAt(d, Math.min(d.x0, d.x1)), b = yearsAt(d, Math.max(d.x0, d.x1));
        if (Math.abs(d.x1 - d.x0) > 8) set({ from: a, to: b });
        else { const e = eraOf(a, a); set(st.to - st.from + 1 === D.maxY - D.minY + 1 && e ? { from: e.from, to: e.to } : { from: a, to: a }); }
        return;
      }
      if (d.on) {
        suppress = true; setTimeout(() => { suppress = false; }, 0);
        set({ from: yearsAt(d, Math.min(d.x0, d.x1)), to: yearsAt(d, Math.max(d.x0, d.x1)) });
      }
    });

    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => render(false)); }).observe(stage);

    const api = {
      data: D, set, zoomOut, intro, eraOf, render: () => render(false),
      get state() { return Object.assign({}, st, { show: Object.assign({}, st.show) }); },
      visibleItems() { return D.items.filter(it => visible(it) && it.y >= st.from && it.y <= st.to); }
    };
    if (opts.intro) intro(); else render(false);
    return api;
  }

  window.TimelineChart = { mount, prepare, kindLabel, fold, esc };
})();
