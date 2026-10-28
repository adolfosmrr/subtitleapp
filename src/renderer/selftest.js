export async function selfTest(cfg, ctx) {
  const { state, S, $, api, openFile, syncStyleUI, renderSegs, renderOverlay, renderTimeline, jumpTo, ensureMetrics, tick, burn, setUiLang, isDirty, snap, saveProject, newProject, loadProject, transcribe, sorted, resegmentAll, undo, translate, buildAss, fontRatio, BUILTIN_PRESETS } = ctx;
  const res = { ok: false, steps: [] }; const log = (k, v) => { res.steps.push({ k, v }); console.log('SELFTEST', k, JSON.stringify(v)); };
  if (cfg.compare) {
    try {
      await openFile(cfg.compare.input); state.settings.maxLines = 2;
      document.querySelector('.tab[data-tab="style"]').click();
      for (const vr of cfg.compare.variants) {
        state.style = { ...S.DEFAULT_STYLE, ...vr.style }; $('#st-fontFamily').value = state.style.fontFamily; syncStyleUI();
        state.segs = [{ id: 'a', start: 0, end: 30, text: cfg.compare.text }];
        renderSegs(); const v = $('#video'); v.currentTime = 5; await new Promise(r => setTimeout(r, 700));
        await ensureMetrics(state.style); tick(); await new Promise(r => setTimeout(r, 300));
        const ob = $('#overlay').getBoundingClientRect();
        $('#toast').hidden = true; await api.test.shot(cfg.compare.out + vr.name + '-ui.png');
        const r = await burn(cfg.compare.out + vr.name + '.mp4');
        log('variant', { name: vr.name, ok: r && r.ok, overlay: [ob.x, ob.y, ob.width, ob.height], dpr: devicePixelRatio, out: r && [r.out.width, r.out.height] });
      }
      const C = cfg.compare;
      if (C.uiShots) {
        state.segs = [{ id: 'a', start: 0, end: 30, text: C.text }, { id: 'b', start: 30, end: 33, text: 'Segundo subtítulo' }]; renderSegs();
        for (const [l, tab] of [['en', 'subs'], ['en', 'style'], ['en', 'export'], ['en', 'settings'], ['es', 'subs'], ['es', 'settings']]) {
          setUiLang(l); document.querySelector(`.tab[data-tab="${tab}"]`).click(); await new Promise(r => setTimeout(r, 500));
          $('#toast').hidden = true; await api.test.shot(C.out + `ui-${l}-${tab}.png`);
          log('uiLang', { l, tab, tabs: [...document.querySelectorAll('.tab')].map(b => b.textContent).join('|'), status: $('#statusTxt').textContent.slice(0, 60) });
        }
        await api.test.menu(C.out + 'menu-es.png'); setUiLang('en'); await api.test.menu(C.out + 'menu-en.png'); setUiLang('auto');
      }
      if (C.overlays) for (const m of ['alpha', 'green', 'black']) {
        const r = await burn(C.out + 'ovl-' + m + (m === 'alpha' ? '.mov' : '.mp4'), m);
        log('overlay', { m, ok: r && r.ok, out: r && r.out, in: r && [r.in.width, r.in.height, r.in.fps, r.in.duration] });
      }
      if (C.features) {
        const wait = (ms) => new Promise(r => setTimeout(r, ms)); const v = $('#video'); v.pause();
        setUiLang('es'); document.querySelector('.tab[data-tab="subs"]').click();
        state.segs = Array.from({ length: 14 }, (_, i) => ({ id: 'f' + i, start: i * 2.5, end: i * 2.5 + 2.2, text: `Subtítulo número ${i + 1} de prueba` }));
        state.undo = []; renderSegs(); renderOverlay(); renderTimeline(); await wait(400);
        const blk = (i) => document.querySelectorAll('#timeline .blk')[i];
        const at = (el, type, dx = 0) => { const b = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, clientX: b.x + b.width / 2 + dx, clientY: b.y + b.height / 2 }; el.dispatchEvent(type === 'pointerdown' ? new PointerEvent(type, o) : new MouseEvent(type, o)); };
        at(blk(11), 'pointerdown'); at(blk(11), 'click'); await wait(900);
        const segEl = document.querySelectorAll('.seg')[11]; const lr = $('#segList').getBoundingClientRect(); const sr = segEl.getBoundingClientRect();
        log('timelineJump', { time: +v.currentTime.toFixed(2), start: 27.5, sel: state.sel, listSel: segEl.classList.contains('sel'), blkSel: blk(11).classList.contains('sel'), inView: sr.top >= lr.top - 1 && sr.bottom <= lr.bottom + 1, focused: document.activeElement === segEl.querySelector('textarea') });
        $('#toast').hidden = true; await api.test.shot(C.shots + 'timeline-jump.png');
        const t0 = v.currentTime; at(blk(2), 'pointerdown'); at(blk(2), 'click', 30); await wait(200);
        log('dragNoJump', { sel: state.sel, timeUnchanged: v.currentTime === t0 });
        document.activeElement.blur(); document.querySelectorAll('.seg')[4].querySelector('.num').click(); await wait(100);
        log('listToTimeline', { sel: state.sel, blkSel: blk(4).classList.contains('sel') });
        v.currentTime = 5.1; await wait(500); tick(); v.play().catch(() => {}); await wait(300);
        const before = state.undo.length; const dirty0 = isDirty();
        at(document.querySelector('#overlay .sub'), 'dblclick'); await wait(300);
        const ed = document.querySelector('.inline-edit');
        log('editorOpen', { open: !!ed, paused: v.paused, value: ed && ed.value, hidden: document.querySelector('#overlay .sub.editing') !== null, rect: ed && [ed.offsetLeft, ed.offsetTop, ed.offsetWidth, ed.style.width, ed.style.left], pos: state.style.position, sub: [...document.querySelectorAll('#overlay .sub .ln')].map(x => { const r = x.getBoundingClientRect(); return [r.left, r.width]; }) });
        ed.value = 'Texto editado   en la pantalla\nsegunda línea'; ed.dispatchEvent(new Event('input')); await wait(600); log('editorRect', { r: [...Object.values(ed.getBoundingClientRect().toJSON())], n: document.querySelectorAll('textarea.inline-edit').length, at: (() => { const p = $('#player').getBoundingClientRect(); const x = document.elementFromPoint(p.left + 60, p.top + 30); return x && (x.className || x.tagName); })(), iw: innerWidth, dpr: devicePixelRatio, pl: [...Object.values($('#player').getBoundingClientRect().toJSON())] });
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        $('#toast').hidden = true; await api.test.shot(C.shots + 'inline-edit.png');
        ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await wait(300);
        const s2 = state.segs.find(x => x.id === 'f2');
        log('editSaved', { text: s2.text, list: document.querySelectorAll('.seg textarea')[2].value, blk: blk(2).textContent, overlay: document.querySelector('#overlay .sub').textContent, undo: state.undo.length - before, dirtyBefore: dirty0, dirty: isDirty(), editorGone: !document.querySelector('.inline-edit') });
        at(document.querySelector('#overlay .sub'), 'dblclick'); await wait(200);
        const e2 = document.querySelector('.inline-edit'); e2.value = 'NO'; e2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(200);
        log('escCancels', { text: s2.text, editorGone: !document.querySelector('.inline-edit') });
        at(document.querySelector('#overlay .sub'), 'dblclick'); await wait(200);
        const e3 = document.querySelector('.inline-edit'); e3.value = 'Guardado al hacer clic afuera'; document.querySelector('.timeline').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(200);
        log('outsideSaves', { text: s2.text });
        undo(); undo(); log('undo', { text: state.segs.find(x => x.id === 'f2').text });
        setUiLang('en'); log('i18n', { sub: document.querySelector('#overlay .sub')?.title, blk: blk(0).title });
        setUiLang('auto');
      }
      if (C.project) {
        state.segs = [{ id: 'a', start: 0.5, end: 3, text: 'Primera línea del proyecto' }, { id: 'b', start: 3.2, end: 6, text: C.text }];
        state.settings.maxWords = 5; state.settings.lang = 'es'; $('#ovlSel').value = 'green'; $('#codecSel').value = 'hevc';
        renderSegs(); renderOverlay();
        document.querySelector('.tab[data-tab="export"]').click(); await new Promise(r => setTimeout(r, 900));
        log('dirtyBeforeSave', { dirty: isDirty(), title: document.title, name: $('#projName').textContent, dot: !$('#projDot').hidden });
        $('#toast').hidden = true; await api.test.shot(C.out + 'ui-dirty.png');
        const before = snap(); await saveProject(false, C.project);
        log('savedClean', { dirty: isDirty() });
        await newProject(); log('afterNew', { segs: state.segs.length, file: state.file });
        await loadProject(C.project, { skipConfirm: true });
        log('roundtrip', { identical: snap() === before, dirty: isDirty(), segs: state.segs.length, file: state.file });
        await loadProject(C.projMoved, { skipConfirm: true }); log('relative', { file: state.file, segs: state.segs.length });
        await loadProject(C.projLost, { skipConfirm: true, relink: true, relinkPath: C.input }); log('relink', { file: state.file, dirty: isDirty(), polluted: ({}).polluted !== undefined || state.style.polluted !== undefined || state.settings.polluted !== undefined, model: state.settings.model, font: state.style.fontFamily, segId: state.segs[0] && state.segs[0].id, imgs: document.querySelectorAll('#segList img').length });
        await saveProject(false); await new Promise(r => setTimeout(r, 800));
        log('menu', await api.test.menu(C.out + 'menu.png'));
      }
      res.ok = true;
    } catch (e) { log('error', String(e.stack || e)); }
    return api.test.done(res);
  }
  try {
    for (const job of cfg.jobs) {
      await openFile(job.input); log('probe', state.info);
      if (job.model) { state.settings.model = job.model; }
      state.settings.device = cfg.device || 'auto'; if (job.maxWords != null) state.settings.maxWords = 0; $('#langSel').value = job.lang || 'auto';
      await transcribe(); log('transcribe', { ...state.lastTranscribe, segs: sorted().map(s => [s.start.toFixed(2), s.end.toFixed(2), s.text]) });
      if (!state.segs.length) throw new Error('sin segmentos');
      const stats = () => { const a = sorted(); const wc = a.map(x => x.text.split(/\s+/).filter(Boolean).length);
        return { cues: a.length, avgWords: +(wc.reduce((p, q) => p + q, 0) / a.length).toFixed(2), maxWords: Math.max(...wc), minDur: +Math.min(...a.map(x => x.end - x.start)).toFixed(2),
          overlaps: a.filter((x, i) => i && x.start < a[i - 1].end - 1e-6).length, monotonic: a.every((x, i) => x.end > x.start && (!i || x.start >= a[i - 1].start)),
          sample: a.slice(0, 6).map(x => `${x.start.toFixed(2)}-${x.end.toFixed(2)} ${x.text}`) }; };
      if (job.maxWords != null) {
        log('antes(auto)', stats());
        state.settings.maxWords = job.maxWords; $('#maxWordsSel').value = String(job.maxWords); resegmentAll(); log(`despues(${job.maxWords})`, stats());
        undo(); log('undo', { cues: state.segs.length }); resegmentAll();
      }
      await api.write(job.out + '.orig.srt', S.toSRT(sorted()));
      $('#trSel').value = 'auto'; await translate(); log('translate', sorted().map(s => s.text)); if (job.maxWords != null) log('traducido', stats());
      if (job.style) { state.style = { ...S.DEFAULT_STYLE, ...BUILTIN_PRESETS[job.style] || {}, ...(job.styleOverride || {}) }; $('#st-fontFamily').value = state.style.fontFamily; syncStyleUI(); }
      await api.write(job.out + '.srt', S.toSRT(sorted())); await api.write(job.out + '.ass', buildAss());
      const v = $('#video'); const s0 = sorted()[Math.min(1, state.segs.length - 1)]; v.currentTime = (s0.start + s0.end) / 2; await new Promise(r => setTimeout(r, 800)); tick();
      await ensureMetrics(state.style); renderOverlay();
      if (job.drag) {
        const el = document.querySelector('#overlay .sub'); const b = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: b.x + b.width / 2 + job.drag[0], clientY: b.y + b.height / 2 + job.drag[1] }));
        window.dispatchEvent(new MouseEvent('mouseup', {})); log('drag', { pos: state.style.position, x: state.style.customX, y: state.style.customY });
      }
      log('previewTime', { t: v.currentTime, vw: v.videoWidth, rs: v.readyState, err: v.error && v.error.message, ratio: fontRatio(state.style) });
      document.querySelector(`.tab[data-tab="${job.tab || 'subs'}"]`).click(); await new Promise(r => setTimeout(r, 300));
      $('#toast').hidden = true; await api.test.shot(job.shot || (job.out + '-ui.png'));
      $('#codecSel').value = job.codec || 'h264';
      const r = await burn(job.out + '.' + (job.codec === 'prores' ? 'mov' : 'mp4')); log('burn', { ok: r?.ok, seconds: r?.seconds, in: r && [r.in.width, r.in.height, r.in.fps], out: r && [r.out.width, r.out.height, r.out.fps], args: r?.args, error: r?.error });
      if (!r?.ok) throw new Error('burn falló');
    }
    res.ok = true;
  } catch (e) { log('error', String(e.stack || e)); }
  api.test.done(res);
}