/* Trade Calculator popup. Depends on calculator.js globals. */
(function () {
  const $ = (id) => document.getElementById(id);
  // Safe setters — never throw if an id is missing from popup.html
  // (prevents "Cannot set properties of null" killing the storage callback).
  const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  const fmtRs = (n) => '₹ ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n) => Number(n || 0).toFixed(2) + '%';
  const fmtSignedPlain = (n) => (n >= 0 ? '+' : '') + fmtRs(n);

  const state = { side: 'long', exchange: 'NSE', segment: 'intraday', targetMode: 'price', slMode: 'price', settings: null, levPref: { intraday: null, delivery: null } };
  let saveTimer = null, calcTimer = null;

  function setSegUI(id, val) {
    const el = $(id); if (!el) return;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.val.toLowerCase() === String(val).toLowerCase()));
  }

  function segWire(id, key, onChange) {
    const el = $(id); if (!el) return;
    el.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        el.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        const raw = b.dataset.val;
        state[key] = (raw === 'NSE' || raw === 'BSE') ? raw.toUpperCase() : raw.toLowerCase();
        if (onChange) onChange();
        refreshPositionStrip(); syncSegSwitch();
        persistFormSoon(); liveCalcSoon();
      });
    });
  }

  function syncSegSwitch() {
    const el = $('segSwitch'); if (!el) return;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.val.toLowerCase() === String(state.segment).toLowerCase()));
  }

  function refreshPositionStrip() {
    const sideEl = $('posSide');
    if (sideEl) {
      const isShort = String(state.side).toLowerCase() === 'short';
      sideEl.textContent = isShort ? '▼ Short' : '▲ Long';
      sideEl.className = 'badge ' + (isShort ? 'short' : 'long');
    }
    const exEl = $('posExch');
    if (exEl) exEl.textContent = (state.exchange || 'NSE').toUpperCase();
    syncSegSwitch();
  }

  function applyLeverageRule() {
    // Default: leverage ON for Intraday, OFF for Delivery — but never override
    // the user's own manual choice for that segment (recorded on checkbox toggle).
    const pref = state.levPref ? state.levPref[state.segment] : null;
    if (pref === true || pref === false) $('levOn').checked = pref;
    else $('levOn').checked = state.segment !== 'delivery';
    if (typeof autoSizeQtyFromCapital === 'function') autoSizeQtyFromCapital();
    persistFormSoon();
  }

  segWire('sideSeg', 'side');
  segWire('exchSeg', 'exchange');
  segWire('segSeg', 'segment', applyLeverageRule);

  // Visible Intraday/Delivery switch (MTF removed from calc view). Mirrors hidden segSeg.
  (function wireSegSwitch() {
    const el = $('segSwitch'); if (!el) return;
    el.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        state.segment = b.dataset.val.toLowerCase();
        setSegUI('segSeg', state.segment);
        syncSegSwitch();
        applyLeverageRule();
        persistFormSoon(); liveCalcSoon();
      });
    });
  })();

  // 3-dot menu open/close
  (function wireMenu() {
    const btn = $('menuBtn'), menu = $('mainMenu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('click', (e) => {
      if (menu.classList.contains('open') && !menu.contains(e.target) && e.target !== btn) menu.classList.remove('open');
    });
  })();

  function modeWire(btnId, labelId, key) {
    $(btnId).addEventListener('click', () => {
      state[key] = state[key] === 'price' ? 'pct' : 'price';
      const sym = state[key] === 'price' ? '₹' : '%';
      $(btnId).textContent = sym; $(labelId).textContent = sym;
      persistFormSoon(); liveCalcSoon();
    });
  }
  modeWire('targetMode', 'targetModeLabel', 'targetMode');
  modeWire('slMode', 'slModeLabel', 'slMode');

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.tabpage').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      $('tab-' + t.dataset.tab).classList.add('active');
      const menu = $('mainMenu'); if (menu) menu.classList.remove('open');
      if (t.dataset.tab === 'history') renderHistory();
    });
  });

  function getSettings() { return state.settings || DEFAULT_SETTINGS; }

  function collectForm() {
    return {
      side: state.side, exchange: state.exchange, segment: state.segment,
      targetMode: state.targetMode, slMode: state.slMode,
      entry: $('entry').value, qty: $('qty').value,
      targetVal: $('targetVal').value, slVal: $('slVal').value,
      levOn: $('levOn').checked, levMult: $('levMult').value,
      capOn: $('capOn') ? $('capOn').checked : false,
      levPref: state.levPref ? { intraday: state.levPref.intraday ?? null, delivery: state.levPref.delivery ?? null } : null
    };
  }

  function restoreForm(f) {
    if (!f) return;
    state.side = f.side || 'long'; state.exchange = f.exchange || 'NSE';
    state.segment = f.segment || 'intraday';
    if (String(state.segment).toLowerCase() === 'mtf') state.segment = 'intraday'; // MTF removed from calc view
    state.targetMode = f.targetMode || 'price'; state.slMode = f.slMode || 'price';
    setSegUI('sideSeg', state.side); setSegUI('exchSeg', state.exchange); setSegUI('segSeg', state.segment);
    const ts = state.targetMode === 'price' ? '₹' : '%';
    const ss = state.slMode === 'price' ? '₹' : '%';
    $('targetMode').textContent = ts; $('targetModeLabel').textContent = ts;
    $('slMode').textContent = ss; $('slModeLabel').textContent = ss;
    $('entry').value = f.entry ?? ''; $('qty').value = f.qty ?? '';
    $('targetVal').value = f.targetVal ?? ''; $('slVal').value = f.slVal ?? '';
    if (typeof f.levOn === 'boolean') $('levOn').checked = f.levOn;
    else $('levOn').checked = state.segment !== 'delivery';
    if (f.levPref) state.levPref = { intraday: f.levPref.intraday ?? null, delivery: f.levPref.delivery ?? null };
    $('levMult').value = f.levMult || getSettings().leverageMultiplier || 5;
    if ($('capOn')) $('capOn').checked = f.capOn !== false;
    refreshCapitalUI();
    refreshPositionStrip();
  }

  function getCapital() {
    const c = parseFloat(getSettings().capital);
    return Number.isFinite(c) && c > 0 ? c : 10000;
  }

  function refreshCapitalUI() {
    const pill = $('capPill');
    if (pill) pill.textContent = '₹ ' + Number(getCapital()).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    updateCapHint();
  }

  function computeAutoQty() {
    const entry = parseFloat($('entry').value);
    if (!(entry > 0)) return 0;
    const levOn = $('levOn').checked;
    const levMult = parseFloat($('levMult').value) || 5;
    const fn = (typeof calcQuantityFromCapital === 'function') ? calcQuantityFromCapital : null;
    if (fn) return fn(getCapital(), entry, levOn, levMult);
    const mult = levOn ? Math.max(1, levMult) : 1;
    return Math.floor((getCapital() * mult) / entry);
  }

  function updateCapHint() {
    const hint = $('capHint');
    if (!hint) return;
    if (!($('capOn') && $('capOn').checked)) { hint.textContent = 'auto qty'; return; }
    const q = computeAutoQty();
    hint.textContent = q > 0 ? ('≈ ' + q + ' qty') : 'enter entry price';
  }

  // Auto-size qty from capital when enabled. Manual edits to qty are respected:
  // we only overwrite qty on entry/leverage/capital/toggle changes, never on qty typing.
  function autoSizeQtyFromCapital() {
    if (!($('capOn') && $('capOn').checked)) { updateCapHint(); return; }
    const q = computeAutoQty();
    if (q > 0) $('qty').value = q;
    updateCapHint();
  }

  function persistFormSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.local.set({ form: collectForm() }), 250);
  }

  ['qty', 'targetVal', 'slVal'].forEach((id) => {
    $(id).addEventListener('input', () => { persistFormSoon(); liveCalcSoon(); });
  });
  $('entry').addEventListener('input', () => { autoSizeQtyFromCapital(); persistFormSoon(); liveCalcSoon(); });
  $('levMult').addEventListener('input', () => { autoSizeQtyFromCapital(); persistFormSoon(); liveCalcSoon(); });
  ['levOn'].forEach((id) => $(id).addEventListener('change', persistFormSoon));
  if ($('levOn')) $('levOn').addEventListener('change', () => {
    // Remember the user's manual choice for this segment so switching
    // Intraday <-> Delivery and back doesn't force it back on/off.
    if (!state.levPref) state.levPref = { intraday: null, delivery: null };
    state.levPref[state.segment] = $('levOn').checked;
    autoSizeQtyFromCapital(); liveCalcSoon();
  });
  if ($('capOn')) $('capOn').addEventListener('change', () => { autoSizeQtyFromCapital(); persistFormSoon(); liveCalcSoon(); });

  // Auto-select current value on focus so typing replaces it (e.g. 44.34 -> type -> new value).
  document.querySelectorAll('input[type="number"], input[type="text"]').forEach((el) => {
    el.addEventListener('focus', () => { try { el.select(); } catch (e) { /* noop */ } });
  });

  function liveCalcSoon() {
    clearTimeout(calcTimer);
    calcTimer = setTimeout(() => tryCalculate(false), 400);
  }

  function loadAll() {
    chrome.storage.local.get(['settings', 'form'], (res) => {
      state.settings = Object.assign({}, DEFAULT_SETTINGS, res.settings || {});
      if (!Number.isFinite(parseFloat(state.settings.capital))) state.settings.capital = 10000;
      if (!state.settings.side) state.settings.side = 'long';
      if (!state.settings.exchange) state.settings.exchange = 'NSE';
      fillSettingsForm();
      refreshCapitalUI();
      if (res.form) restoreForm(res.form);
      else {
        state.side = (state.settings.side || 'long').toLowerCase();
        state.exchange = (state.settings.exchange || 'NSE').toUpperCase();
        state.segment = 'intraday';
        setSegUI('sideSeg', state.side); setSegUI('exchSeg', state.exchange); setSegUI('segSeg', state.segment);
        $('levOn').checked = true; $('levMult').value = state.settings.leverageMultiplier; if ($('capOn')) $('capOn').checked = true; refreshCapitalUI();
        refreshPositionStrip();
      }
      // live-restore last result if inputs valid
      tryCalculate(false);
    });
  }

  const MAP = [
    ['s_capital', 'capital'], ['s_levMult', 'leverageMultiplier'], ['s_intraPct', 'intradayBrokeragePct'],
    ['s_intraFlat', 'intradayBrokerageFlat'], ['s_delPct', 'deliveryBrokeragePct'],
    ['s_delFlat', 'deliveryBrokerageFlat'], ['s_mtfPct', 'mtfBrokeragePct'],
    ['s_mtfFlat', 'mtfBrokerageFlat'], ['s_nseIntra', 'exchNseIntraday'],
    ['s_nseDel', 'exchNseDelivery'], ['s_nseMtf', 'exchNseMtf'],
    ['s_bseIntra', 'exchBseIntraday'], ['s_bseDel', 'exchBseDelivery'],
    ['s_bseMtf', 'exchBseMtf'], ['s_sttIntra', 'sttIntradaySellPct'],
    ['s_sttDel', 'sttDeliveryPct'], ['s_sttMtf', 'sttMtfPct'],
    ['s_stampIntra', 'stampIntradayPct'], ['s_stampDel', 'stampDeliveryPct'],
    ['s_stampMtf', 'stampMtfPct'], ['s_sebi', 'sebiPct'], ['s_ipft', 'ipftPct'],
    ['s_gst', 'gstPct'], ['s_dp', 'dpCharge']
  ];
  function fillSettingsForm() {
    MAP.forEach(([id, k]) => { const el = $(id); if (el) el.value = state.settings[k]; });
    const levDef = $('s_levOn'); if (levDef) levDef.checked = !!state.settings.leverageEnabled;
    const sideSel = $('s_side'); if (sideSel) sideSel.value = (state.settings.side || 'long').toLowerCase();
    const exchSel = $('s_exchange'); if (exchSel) exchSel.value = (state.settings.exchange || 'NSE').toUpperCase();
  }
  $('saveSettings').addEventListener('click', () => {
    const s = Object.assign({}, state.settings);
    MAP.forEach(([id, k]) => { const v = parseFloat($(id).value); if (Number.isFinite(v)) s[k] = v; });
    if (!(s.capital > 0)) s.capital = 10000;
    s.leverageEnabled = $('s_levOn').checked;
    const sideSel = $('s_side'); if (sideSel) s.side = sideSel.value.toLowerCase() === 'short' ? 'short' : 'long';
    const exchSel = $('s_exchange'); if (exchSel) s.exchange = String(exchSel.value).toUpperCase() === 'BSE' ? 'BSE' : 'NSE';
    state.settings = s;
    state.side = s.side || state.side; state.exchange = s.exchange || state.exchange;
    setSegUI('sideSeg', state.side); setSegUI('exchSeg', state.exchange);
    refreshPositionStrip();
    chrome.storage.local.set({ settings: s }, () => { $('settingsMsg').textContent = 'Saved ✓'; setTimeout(() => $('settingsMsg').textContent = '', 1500); });
    refreshCapitalUI();
    autoSizeQtyFromCapital();
    persistFormSoon(); liveCalcSoon();
  });
  $('resetSettings').addEventListener('click', () => {
    state.settings = Object.assign({}, DEFAULT_SETTINGS);
    state.settings.side = 'long'; state.settings.exchange = 'NSE';
    state.side = 'long'; state.exchange = 'NSE';
    setSegUI('sideSeg', state.side); setSegUI('exchSeg', state.exchange);
    refreshPositionStrip();
    chrome.storage.local.set({ settings: state.settings }, () => { fillSettingsForm(); refreshCapitalUI(); });
  });

  function breakupHtml(r) {
    const rows = [
      ['Brokerage', r.brokerage], ['Exchange txn', r.exchangeCharges],
      ['STT', r.stt], ['SEBI', r.sebi], ['IPFT', r.ipft],
      ['Stamp duty', r.stamp], ['GST', r.gst], ['DP charges', r.dp]
    ];
    return rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${fmtRs(v)}</dd></div>`).join('') +
      `<div class="tot"><dt>Total</dt><dd>${fmtRs(r.totalCharges)}</dd></div>`;
  }

  function hasInputs(entry, qty, tv, sv) {
    return entry > 0 && qty > 0 && (Number.isFinite(tv) || Number.isFinite(sv));
  }

  function tryCalculate(save) {
    const entry = parseFloat($('entry').value);
    const qty = parseInt($('qty').value, 10);
    const tvRaw = $('targetVal').value.trim(), slRaw = $('slVal').value.trim();
    const tv = tvRaw === '' ? NaN : parseFloat(tvRaw);
    const sv = slRaw === '' ? NaN : parseFloat(slRaw);
    if (!hasInputs(entry, qty, tv, sv)) {
      const rEl = $('results'); if (rEl) rEl.classList.add('hidden');
      const eEl = $('emptyState'); if (eEl) eEl.classList.remove('hidden');
      return null;
    }
    const input = {
      entry, qty,
      targetValue: Number.isFinite(tv) ? tv : (state.side === 'short' ? entry : entry),
      targetMode: state.targetMode,
      slValue: Number.isFinite(sv) ? sv : (state.side === 'short' ? entry : entry),
      slMode: state.slMode,
      segment: state.segment, exchange: state.exchange, side: state.side,
      leverageOn: $('levOn').checked, leverageMultiplier: parseFloat($('levMult').value) || 5,
      settings: getSettings()
    };
    // If one leg is blank, hide that column gracefully (still compute with entry=exit => ~ -charges)
    let out;
    try { out = calculateScenario(input); } catch (e) { return null; }
    renderResult(input, out, { showTarget: Number.isFinite(tv), showSL: Number.isFinite(sv) });
    if (save) saveHistory({ input, targetNet: out.target.net, slNet: out.sl.net, ts: Date.now() });
    chrome.storage.local.set({ lastResult: { input, ts: Date.now() } });
    return { input, out };
  }

  function renderResult(input, out, vis) {
    const resultsEl = $('results'); if (resultsEl) resultsEl.classList.remove('hidden');
    const emptyEl = $('emptyState'); if (emptyEl) emptyEl.classList.add('hidden');
    const t = out.target, s = out.sl;
    const dash = '—';
    setText('tExit', vis.showTarget ? fmtRs(out.targetPrice) : dash);
    setText('sExit', vis.showSL ? fmtRs(out.slPrice) : dash);
    setText('tNet', vis.showTarget ? fmtSignedPlain(t.net) : dash);
    setText('sNet', vis.showSL ? fmtSignedPlain(s.net) : dash);
    setText('tNetPct', vis.showTarget ? `${fmtPct(t.netPct)} net · ${fmtPct(t.returnOnMarginPct)} on margin` : dash);
    setText('sNetPct', vis.showSL ? `${fmtPct(s.netPct)} net · ${fmtPct(s.returnOnMarginPct)} on margin` : dash);
    setText('tGross', vis.showTarget ? `${fmtSignedPlain(t.gross)} (${fmtPct(t.grossPct)})` : dash);
    setText('sGross', vis.showSL ? `${fmtSignedPlain(s.gross)} (${fmtPct(s.grossPct)})` : dash);
    setText('tSell', fmtRs(t.sellValue)); setText('sSell', fmtRs(s.sellValue));
    setText('tBuy', fmtRs(t.buyValue)); setText('sBuy', fmtRs(s.buyValue));
    setText('tTurn', fmtRs(t.turnover)); setText('sTurn', fmtRs(s.turnover));
    setText('tChg', fmtRs(t.totalCharges)); setText('sChg', fmtRs(s.totalCharges));
    setText('tBrok', fmtRs(t.brokerage)); setText('sBrok', fmtRs(s.brokerage));
    setText('tOther', fmtRs(t.otherCharges)); setText('sOther', fmtRs(s.otherCharges));

    const tNetEl = $('tNet'); if (tNetEl) tNetEl.className = 'cell big ' + (t.net >= 0 ? 'g' : 'r');
    const sNetEl = $('sNet'); if (sNetEl) sNetEl.className = 'cell big ' + (s.net >= 0 ? 'g' : 'r');

    // Risk : Reward + verdict
    const risk = Math.abs(s.net), reward = Math.max(0, t.net);
    setText('rRR', (vis.showTarget && vis.showSL && risk > 0) ? ('1 : ' + (reward / risk).toFixed(2)) : dash);
    setText('rMargin', fmtRs(t.marginRequired) + (t.leverageOn ? ` (${t.leverageMultiplier}x)` : ''));
    setText('rMarginPct', vis.showTarget ? fmtPct(t.returnOnMarginPct) : dash);
    setText('rBreakeven', fmtRs(t.breakeven));

    // Win / Lose tiles — each green when positive, red when negative.
    // (Risk : Reward lives in its own stat tile, so it's not repeated here.)
    (function renderVerdictTiles() {
      const tiles = [['vWinTile', 'vWin', t.net, vis.showTarget], ['vLoseTile', 'vLose', s.net, vis.showSL]];
      tiles.forEach(([tileId, valId, val, show]) => {
        const tile = $(tileId); if (!tile) return;
        setText(valId, show ? fmtSignedPlain(val) : dash);
        tile.className = 'vtile ' + (!show ? 'neut' : (val >= 0 ? 'good' : 'bad'));
      });
    })();

    setHTML('breakT', breakupHtml(t)); setHTML('breakS', breakupHtml(s));
  }

  $('calcBtn').addEventListener('click', () => tryCalculate(true));
  $('clearBtn').addEventListener('click', () => {
    // Reset entry, quantity, target & stop-loss to empty
    ['entry', 'qty', 'targetVal', 'slVal'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
    updateCapHint();
    const rEl = $('results'); if (rEl) rEl.classList.add('hidden');
    const eEl = $('emptyState'); if (eEl) eEl.classList.remove('hidden');
    chrome.storage.local.remove(['form', 'lastResult']);
  });

  function saveHistory(rec) {
    chrome.storage.local.get(['history'], (res) => {
      const h = res.history || []; h.unshift(rec); while (h.length > 100) h.pop();
      chrome.storage.local.set({ history: h });
    });
  }
  function renderHistory() {
    chrome.storage.local.get(['history'], (res) => {
      const h = res.history || []; const box = $('histList'); box.innerHTML = '';
      if (!h.length) { box.innerHTML = '<p class="hint">No tracked trades yet. Hit “Save” to track the current calculation.</p>'; return; }
      h.forEach((r, i) => {
        const d = document.createElement('div'); d.className = 'hist';
        const dt = new Date(r.ts).toLocaleString();
        const inp = r.input || {};
        d.innerHTML = `<button class="x" data-i="${i}">✕</button>
          <div><b>${inp.side || ''} · ${inp.segment || ''} · ${inp.exchange || ''}</b> <span class="hdt">${dt}</span></div>
          <div>Entry ₹${inp.entry} × ${inp.qty} → Tgt ${inp.targetValue}${inp.targetMode === 'pct' ? '%' : ''} / SL ${inp.slValue}${inp.slMode === 'pct' ? '%' : ''}${inp.leverageOn ? ` · ${inp.leverageMultiplier}x` : ''}</div>
          <div class="hrow"><span>Target <b class="${r.targetNet >= 0 ? 'g' : 'r'}">${fmtSignedPlain(r.targetNet)}</b></span><span>SL <b class="${r.slNet >= 0 ? 'g' : 'r'}">${fmtSignedPlain(r.slNet)}</b></span><button class="ghost sm" data-r="${i}">Reload</button></div>`;
        box.appendChild(d);
      });
      box.querySelectorAll('.x').forEach((b) => b.addEventListener('click', () => {
        chrome.storage.local.get(['history'], (res2) => {
          const h2 = res2.history || []; h2.splice(parseInt(b.dataset.i, 10), 1);
          chrome.storage.local.set({ history: h2 }, renderHistory);
        });
      }));
      box.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
        chrome.storage.local.get(['history'], (res2) => {
          const rec = (res2.history || [])[parseInt(b.dataset.r, 10)];
          if (!rec) return;
          const inp = rec.input || {};
          $('entry').value = inp.entry ?? ''; $('qty').value = inp.qty ?? '';
          $('targetVal').value = inp.targetValue ?? ''; $('slVal').value = inp.slValue ?? '';
          state.side = inp.side || 'long'; state.exchange = inp.exchange || 'NSE'; state.segment = inp.segment || 'intraday';
          if (String(state.segment).toLowerCase() === 'mtf') state.segment = 'intraday';
          state.targetMode = inp.targetMode || 'price'; state.slMode = inp.slMode || 'price';
          setSegUI('sideSeg', state.side); setSegUI('exchSeg', state.exchange); setSegUI('segSeg', state.segment);
          refreshPositionStrip();
          $('targetMode').textContent = state.targetMode === 'price' ? '₹' : '%';
          $('targetModeLabel').textContent = $('targetMode').textContent;
          $('slMode').textContent = state.slMode === 'price' ? '₹' : '%';
          $('slModeLabel').textContent = $('slMode').textContent;
          $('levOn').checked = !!inp.leverageOn; $('levMult').value = inp.leverageMultiplier || 5;
          if (!state.levPref) state.levPref = { intraday: null, delivery: null };
          state.levPref[state.segment] = !!inp.leverageOn;
          persistFormSoon(); tryCalculate(false);
          document.querySelector('.tab[data-tab="calc"]').click();
        });
      }));
    });
  }
  $('refreshHist').addEventListener('click', renderHistory);
  $('clearHist').addEventListener('click', () => { chrome.storage.local.set({ history: [] }, renderHistory); });

  loadAll();
})();
