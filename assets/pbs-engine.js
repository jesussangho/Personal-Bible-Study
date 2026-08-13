/* ==========================================================================
   PBS Study Engine — renders a full interactive Bible-study chapter page
   from a plain data object. This is what keeps future chapters (14, 15,
   ... 40) from becoming N separate 2000-line clones: the engine holds all
   the machinery (quizzes w/ full explain-lists, step sequences, cinematic
   reveals, notes drawer, text drawer, glossary, kids-mode, effects,
   storage/badges/history), and each chapter supplies only its content.

   Usage (from a thin chapter HTML shell):
     <script src="assets/pbs-nav.js"></script>
     <script src="assets/pbs-glossary.js"></script>
     <script src="assets/pbs-effects.js"></script>
     <script src="assets/pbs-engine.js"></script>
     <script src="data/exodus-13.js"></script>   (defines window.EXODUS_13_DATA)
     <script>PBSStudy.init(EXODUS_13_DATA);</script>
   ========================================================================== */
(function(){
  'use strict';

  let CFG = null;
  let currentStage = 0;
  let difficulty = 'normal';
  let playerName = 'Player';
  let score = 0, combo = 0, bestCombo = 0;
  let sessionStart = Date.now();
  let firstTryCorrect = {};
  let sessionLogged = false;
  let seqState = {};      // per sequence-stage: {index, done}
  let matchState = null;
  let audioCtx = null, masterGain = null;
  let STORAGE_KEY, HISTORY_KEY, BADGES_KEY;
  let storageAvailable = true;
  let memoryProgress = null, memoryHistory = [], memoryBadges = [];

  /* ---------------------------------------------------------------------
     Small DOM helpers
     --------------------------------------------------------------------- */
  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }
  function el(html){ const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
  function esc(s){ return String(s==null?'':s); }

  /* ---------------------------------------------------------------------
     Storage
     --------------------------------------------------------------------- */
  function testStorage(){
    try{ const k='__t__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return true; }
    catch(e){ return false; }
  }
  function saveJSON(key, obj, kind){
    if(storageAvailable){ try{ localStorage.setItem(key, JSON.stringify(obj)); return; }catch(e){ storageAvailable=false; } }
    if(kind==='progress') memoryProgress = obj;
    if(kind==='history') memoryHistory = obj;
    if(kind==='badges') memoryBadges = obj;
  }
  function loadJSON(key, kind){
    if(storageAvailable){
      try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
      catch(e){ storageAvailable=false; }
    }
    if(kind==='progress') return memoryProgress;
    if(kind==='history') return (memoryHistory && memoryHistory.length) ? memoryHistory : null;
    if(kind==='badges') return (memoryBadges && memoryBadges.length) ? memoryBadges : null;
    return null;
  }
  function autosave(){ saveJSON(STORAGE_KEY, snapshotProgress(), 'progress'); }
  function snapshotProgress(){
    const notes = {};
    $all('.app-field textarea[data-note-id]').forEach(t=>{ notes[t.dataset.noteId] = t.value; });
    const reflections = {};
    $all('textarea[data-reflect-id]').forEach(t=>{ reflections[t.dataset.reflectId] = t.value; });
    return { stage: currentStage, seqState, firstTryCorrect, notes, reflections, startedAt: sessionStart, savedAt: Date.now() };
  }
  function formatDuration(sec){ const m=Math.floor(sec/60), s=sec%60; return m>0 ? `${m}분 ${s}초` : `${s}초`; }
  function formatDate(ts){ return new Date(ts).toLocaleString('ko-KR', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }

  /* ---------------------------------------------------------------------
     Audio: short correct/wrong tones (Web Audio API, no external assets)
     --------------------------------------------------------------------- */
  function ensureAudio(){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return false;
    if(!audioCtx){
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.8;
      masterGain.connect(audioCtx.destination);
    }
    if(audioCtx.state !== 'running'){ audioCtx.resume().catch(()=>{}); }
    return true;
  }
  function playTone(freq, startOffset, dur, type, vol){
    if(!ensureAudio()) return;
    const now = audioCtx.currentTime + startOffset;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(masterGain);
    o.start(now); o.stop(now + dur + 0.05);
    o.onended = ()=>{ try{ o.disconnect(); g.disconnect(); }catch(e){} };
  }
  function sfxCorrect(){ playTone(660,0,0.12,'sine',0.22); playTone(880,0.08,0.18,'sine',0.2); }
  function sfxWrong(){ playTone(170,0,0.22,'sine',0.18); }

  function fxSparkleAt(elm){
    const cv = document.getElementById('fxCanvas');
    if(!cv || !window.PBS_sparkleBurst || !elm) return;
    const r = elm.getBoundingClientRect();
    PBS_sparkleBurst(cv, r.left + r.width/2, r.top + r.height/2, { count: 22 });
  }

  /* ---------------------------------------------------------------------
     Score / combo
     --------------------------------------------------------------------- */
  function updateScoreHud(){
    const elm = document.getElementById('scoreHud');
    if(elm) elm.textContent = `⭐ ${score}점 · 🔥 ${combo}콤보`;
  }
  /* Debug-mode snapshot — a read-only view of engine state for the debug
     panel (assets/pbs-debug.js). Deliberately does NOT restructure how
     state is stored; it just reads the existing module-level variables
     so the working quiz/scoring logic below is untouched. */
  function debugSnapshot(){
    return {
      stage: currentStage,
      difficulty, playerName,
      score, combo, bestCombo,
      sessionLogged,
      firstTryCorrect,
      seqState,
      matchActive: !!matchState
    };
  }
  function registerAnswer(isCorrect, points){
    if(points===undefined) points = 10;
    if(isCorrect){ score += points + combo*2; combo++; if(combo>bestCombo) bestCombo=combo; sfxCorrect(); }
    else { combo = 0; sfxWrong(); }
    updateScoreHud();
    autosave();
    if(window.PBS_Debug){ PBS_Debug.log(`registerAnswer(${isCorrect}) → score=${score}, combo=${combo}`); PBS_Debug.update(debugSnapshot()); }
  }
  function recordFirstTry(key, isCorrect){ if(firstTryCorrect[key]===undefined) firstTryCorrect[key]=isCorrect; }
  function currentScoreTally(){ const vals=Object.values(firstTryCorrect); return {correct:vals.filter(Boolean).length, total:vals.length}; }

  function shuffleIndices(n){
    const arr = Array.from({length:n}, (_,i)=>i);
    for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
    return arr;
  }
  function pickRenderOrder(choices){
    let order = shuffleIndices(choices.length);
    if(difficulty==='easy'){
      const wrongPositions = order.filter(idx=>!choices[idx].correct);
      if(wrongPositions.length>1){
        const remove = wrongPositions[Math.floor(Math.random()*wrongPositions.length)];
        order = order.filter(idx=>idx!==remove);
      }
    }
    return order;
  }
  function meaningBlock(text){
    if(!text) return '';
    if(difficulty==='hard') return `<details class="meaning-details"><summary>💡 의미 더 보기</summary><div class="meaning-body">${text}</div></details>`;
    return `<span class="meaning"><b>💡 의미</b><br>${text}</span>`;
  }
  function renderExplainList(feedbackEl, choices, order, pickedPos, opts){
    opts = opts || {};
    const noJudge = !!opts.noJudge;
    let html = '<div class="explain-list">';
    order.forEach((origIdx, pos)=>{
      const c = choices[origIdx];
      const isPicked = pos === pickedPos;
      const cls = noJudge ? 'is-neutral' : (c.correct ? 'is-correct' : 'is-wrong');
      const mark = noJudge ? '🔹' : (c.correct ? '✅ 정답' : '❌ 오답');
      html += `<div class="explain-item ${cls}">
        <div class="ei-mark">${mark}</div>
        <div class="ei-body">
          <div class="ei-choice">${esc(c.t)}${isPicked ? '<span class="ei-picked">내 선택</span>' : ''}</div>
          ${c.fb ? `<div class="ei-why">${c.fb}</div>` : ''}
        </div>
      </div>`;
    });
    html += '</div>';
    if(opts.meaning) html += meaningBlock(opts.meaning);
    if(opts.kids) html += `<div class="kids-explain"><span class="ke-tag">🧒 쉬운 설명</span><br>${opts.kids}</div>`;
    feedbackEl.innerHTML = html;
    feedbackEl.classList.add('show');
    if(window.PBS_initGlossary) PBS_initGlossary(feedbackEl);
  }
  function renderChoices(box, choices, order, onPick){
    box.innerHTML = '';
    order.forEach((origIdx,pos)=>{
      const b = document.createElement('button');
      b.className='choice'; b.textContent = choices[origIdx].t;
      b.onclick = ()=>onPick(pos);
      box.appendChild(b);
    });
  }
  function markChoiceButtons(box, choices, order, pickedPos, opts){
    opts = opts || {};
    const buttons = $all('.choice', box);
    buttons.forEach((b,idx)=>{
      b.disabled = true;
      if(opts.noJudge){
        if(idx===pickedPos) b.classList.add('correct');
        return;
      }
      if(choices[order[idx]].correct){ b.classList.add('correct'); if(idx===pickedPos) fxSparkleAt(b); }
      else if(idx===pickedPos) b.classList.add('wrong');
    });
  }

  /* ---------------------------------------------------------------------
     Quiz units — several question "kinds" so a chapter can mix formats
     instead of always using plain multiple-choice. Every kind resolves
     by calling onResolved(isCorrect) exactly once; the caller (a beat in
     a quizChain, or a step in a sequence) handles scoring/progression.
     item.kind: 'choice' (default) | 'truefalse' | 'fillblank' | 'multiselect' | 'ordering'
     --------------------------------------------------------------------- */
  function renderQuizUnit(item, boxId, feedbackId, onResolved){
    const box = document.getElementById(boxId);
    const feedback = document.getElementById(feedbackId);
    const kind = item.kind || 'choice';
    if(kind==='truefalse') return renderTrueFalseUnit(item, box, feedback, onResolved);
    if(kind==='fillblank') return renderFillBlankUnit(item, box, feedback, onResolved);
    if(kind==='multiselect') return renderMultiSelectUnit(item, box, feedback, onResolved);
    if(kind==='ordering') return renderOrderingUnit(item, box, feedback, onResolved);
    return renderChoiceUnit(item, box, feedback, onResolved);
  }
  function closeFeedback(feedback, html){
    feedback.innerHTML = html; feedback.classList.add('show');
    if(window.PBS_initGlossary) PBS_initGlossary(feedback);
  }
  function renderChoiceUnit(item, box, feedback, onResolved){
    const order = pickRenderOrder(item.choices);
    item._order = order;
    renderChoices(box, item.choices, order, (pos)=>{
      const noJudge = !!item.openEnded;
      markChoiceButtons(box, item.choices, order, pos, { noJudge });
      const chosen = item.choices[order[pos]];
      renderExplainList(feedback, item.choices, order, pos, { meaning: item.meaning, kids: item.kids, noJudge });
      onResolved(noJudge ? true : chosen.correct);
    });
  }
  function renderTrueFalseUnit(item, box, feedback, onResolved){
    box.innerHTML = `
      <p class="lede" style="margin:0 0 12px;">${item.statement}</p>
      <div class="tf-row">
        <button class="tf-btn" data-v="true">⭕ 맞다 (참)</button>
        <button class="tf-btn" data-v="false">❌ 틀리다 (거짓)</button>
      </div>`;
    $all('.tf-btn', box).forEach(btn=>{
      btn.onclick = ()=>{
        const chosenVal = btn.dataset.v === 'true';
        const isCorrect = chosenVal === item.answer;
        $all('.tf-btn', box).forEach(b=>{
          b.disabled = true;
          const bVal = b.dataset.v === 'true';
          if(bVal === item.answer) b.classList.add('correct');
          else if(b===btn) b.classList.add('wrong');
        });
        if(isCorrect) fxSparkleAt(btn);
        let html = `<div class="explain-list"><div class="explain-item ${isCorrect?'is-correct':'is-wrong'}">
          <div class="ei-mark">${item.answer ? '⭕ 정답: 맞다(참)' : '❌ 정답: 틀리다(거짓)'}</div>
          <div class="ei-body"><div class="ei-why">${item.fb||''}</div></div>
        </div></div>`;
        if(item.meaning) html += meaningBlock(item.meaning);
        if(item.kids) html += `<div class="kids-explain"><span class="ke-tag">🧒 쉬운 설명</span><br>${item.kids}</div>`;
        closeFeedback(feedback, html);
        onResolved(isCorrect);
      };
    });
  }
  function renderFillBlankUnit(item, box, feedback, onResolved){
    const uid = box.id;
    box.innerHTML = `
      <div class="blank-prompt">${item.blankPromptHtml}</div>
      <div class="blank-row">
        <input type="text" class="quiz-input" id="${uid}-input" placeholder="정답을 입력하세요" autocomplete="off">
        <button class="btn btn-primary btn-small" id="${uid}-submit">확인</button>
      </div>
      ${item.hint ? `<button class="hint-btn" id="${uid}-hintBtn">💡 힌트 보기</button><div class="hint-line" id="${uid}-hintLine">${item.hint}</div>` : ''}
    `;
    const input = document.getElementById(`${uid}-input`);
    const submit = document.getElementById(`${uid}-submit`);
    if(item.hint){
      document.getElementById(`${uid}-hintBtn`).onclick = ()=> document.getElementById(`${uid}-hintLine`).classList.add('show');
    }
    function normalize(s){ return (s||'').trim().replace(/\s+/g,''); }
    function submitAnswer(){
      if(input.disabled) return;
      const val = normalize(input.value);
      const isCorrect = val.length>0 && item.accepted.some(a=>normalize(a)===val);
      input.disabled = true; submit.disabled = true;
      input.classList.add(isCorrect ? 'correct' : 'wrong');
      if(isCorrect) fxSparkleAt(input);
      let html = `<div class="explain-list"><div class="explain-item ${isCorrect?'is-correct':'is-wrong'}">
        <div class="ei-mark">${isCorrect?'✅ 정답':'❌ 오답'}</div>
        <div class="ei-body"><div class="ei-choice">정답: ${item.accepted[0]}</div><div class="ei-why">${item.fb||''}</div></div>
      </div></div>`;
      if(item.meaning) html += meaningBlock(item.meaning);
      if(item.kids) html += `<div class="kids-explain"><span class="ke-tag">🧒 쉬운 설명</span><br>${item.kids}</div>`;
      closeFeedback(feedback, html);
      onResolved(isCorrect);
    }
    submit.onclick = submitAnswer;
    input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); submitAnswer(); } });
  }
  function renderMultiSelectUnit(item, box, feedback, onResolved){
    const uid = box.id;
    box.innerHTML = item.options.map((o,i)=>`
      <label class="msel-option" id="${uid}-opt${i}">
        <input type="checkbox" value="${i}"><span>${o.t}</span>
      </label>`).join('') + `<div class="btn-row"><button class="btn btn-primary btn-small" id="${uid}-submit">제출하기</button></div>`;
    $all('input[type=checkbox]', box).forEach(cb=>{
      cb.addEventListener('change', ()=> cb.closest('.msel-option').classList.toggle('picked', cb.checked));
    });
    document.getElementById(`${uid}-submit`).onclick = ()=>{
      const boxes = $all('input[type=checkbox]', box);
      const checked = boxes.map(cb=>cb.checked);
      boxes.forEach(cb=>cb.disabled=true);
      document.getElementById(`${uid}-submit`).disabled = true;
      const isCorrect = item.options.every((o,i)=> !!o.correct === checked[i]);
      if(isCorrect) fxSparkleAt(box);
      let html = '<div class="explain-list">';
      item.options.forEach((o,i)=>{
        const picked = checked[i];
        const cls = o.correct ? 'is-correct' : (picked ? 'is-wrong' : 'is-neutral');
        const mark = o.correct ? '✅ 정답 항목' : (picked ? '❌ 선택했지만 아님' : '⬜ 해당 없음');
        html += `<div class="explain-item ${cls}"><div class="ei-mark">${mark}</div><div class="ei-body"><div class="ei-choice">${o.t}${picked?'<span class="ei-picked">내 선택</span>':''}</div></div></div>`;
      });
      html += '</div>';
      if(item.fb) html += `<p style="margin-top:10px; color:var(--parchment-dim);">${item.fb}</p>`;
      if(item.meaning) html += meaningBlock(item.meaning);
      if(item.kids) html += `<div class="kids-explain"><span class="ke-tag">🧒 쉬운 설명</span><br>${item.kids}</div>`;
      closeFeedback(feedback, html);
      onResolved(isCorrect);
    };
  }
  function renderOrderingUnit(item, box, feedback, onResolved){
    const order = shuffleIndices(item.items.length);
    const placed = [];
    function paint(){
      const poolHtml = order.filter(i=>!placed.includes(i)).map(i=>`<button class="order-chip" data-i="${i}">${item.items[i]}</button>`).join('');
      const listHtml = placed.map((i,pos)=>`<li><span class="order-num">${pos+1}</span>${item.items[i]}</li>`).join('');
      box.innerHTML = `<p class="hint" style="margin:0 0 10px;">아래 카드를 일어난 순서대로 눌러보세요.</p>
        <div class="order-pool">${poolHtml}</div>
        <ol class="order-list">${listHtml}</ol>`;
      $all('.order-chip', box).forEach(chip=>{
        chip.onclick = ()=>{
          placed.push(parseInt(chip.dataset.i,10));
          if(placed.length === item.items.length) finish(); else paint();
        };
      });
    }
    function finish(){
      const isCorrect = placed.every((i,pos)=> i===pos);
      const listHtml = placed.map((i,pos)=>{
        const rightPos = (i===pos);
        return `<li class="${rightPos?'order-correct':'order-wrong'}"><span class="order-num">${pos+1}</span>${item.items[i]}${!rightPos?`<span class="order-correct-note">원래 순서: ${i+1}번</span>`:''}</li>`;
      }).join('');
      box.innerHTML = `<ol class="order-list">${listHtml}</ol>`;
      if(isCorrect) fxSparkleAt(box);
      let html = `<p style="margin:0; color:${isCorrect?'var(--gold-soft)':'var(--parchment-dim)'};">${isCorrect ? '정확해요! 실제 일어난 순서를 그대로 맞혔습니다.' : '순서가 조금 달랐어요. 아래 이야기를 읽으며 실제 순서를 확인해보세요.'}</p>`;
      if(item.fb) html += `<p style="margin-top:8px; color:var(--parchment-dim);">${item.fb}</p>`;
      if(item.meaning) html += meaningBlock(item.meaning);
      if(item.kids) html += `<div class="kids-explain"><span class="ke-tag">🧒 쉬운 설명</span><br>${item.kids}</div>`;
      closeFeedback(feedback, html);
      onResolved(isCorrect);
    }
    paint();
  }
  function renderTakeawayHtml(cfg){
    if(!cfg.takeaway) return '';
    return `<div class="takeaway-box"><span class="tw-tag">🔑 핵심 한 줄 정리</span><div class="tw-text">${cfg.takeaway.text}</div>${cfg.takeaway.kids?`<div class="tw-kids">🧒 ${cfg.takeaway.kids}</div>`:''}</div>`;
  }

  /* ---------------------------------------------------------------------
     Badges (lightweight generic set)
     --------------------------------------------------------------------- */
  const BADGE_DEFS = [
    { id:'perfect_score', name:'만점 순례자', desc:'모든 질문을 한 번에 맞혔어요',
      check:(ftc)=>{ const v=Object.values(ftc); return v.length>0 && v.every(Boolean); } },
    { id:'fast_finish', name:'빠른 발걸음', desc:'10분 안에 전체 여정을 마쳤어요',
      check:(ftc,durationSec)=> durationSec < 600 },
    { id:'devoted', name:'말씀 지킴이', desc:'세 번 이상 완주했어요',
      check:(ftc,durationSec,histLenAfter)=> histLenAfter >= 3 }
  ];
  function logCompletion(){
    if(sessionLogged) return; sessionLogged = true;
    const {correct,total} = currentScoreTally();
    const durationSec = Math.max(0, Math.round((Date.now()-sessionStart)/1000));
    const hist = loadJSON(HISTORY_KEY,'history') || [];
    const newLen = hist.length+1;
    const earned = BADGE_DEFS.filter(b=>b.check(firstTryCorrect, durationSec, newLen)).map(b=>b.id);
    const entry = { completedAt: Date.now(), durationSec, correct, total, score, bestCombo, player: playerName, badges: earned };
    hist.push(entry); saveJSON(HISTORY_KEY, hist, 'history');
    const unlocked = loadJSON(BADGES_KEY,'badges') || [];
    earned.forEach(id=>{ if(!unlocked.includes(id)) unlocked.push(id); });
    saveJSON(BADGES_KEY, unlocked, 'badges');
    showCelebration(entry, earned);
  }
  function showCelebration(entry, earned){
    const stats = document.getElementById('celebrationStats');
    if(stats) stats.textContent = `점수 ${entry.score}점 · 정답 ${entry.correct}/${entry.total} · 소요 ${formatDuration(entry.durationSec)} · 최고 콤보 ${entry.bestCombo}`;
    const bBox = document.getElementById('celebrationBadges');
    if(bBox){
      bBox.innerHTML = earned.length
        ? '<p style="color:var(--gold-soft); margin:0 0 8px;">새 배지 획득!</p>' + earned.map(id=>{
            const def = BADGE_DEFS.find(b=>b.id===id);
            return `<div class="badge-chip">🏅 ${def?def.name:id}</div>`;
          }).join('')
        : '';
    }
    const cv = document.getElementById('fxCanvas');
    if(cv && window.PBS_burstConfetti) PBS_burstConfetti(cv, { count:90 });
    document.getElementById('celebrationOverlay').classList.add('show');
  }
  window.PBSStudyCloseCelebration = function(){
    document.getElementById('celebrationOverlay').classList.remove('show');
  };
  function renderHistory(){
    const hist = loadJSON(HISTORY_KEY,'history') || [];
    const box = document.getElementById('historyList');
    if(!box) return;
    if(hist.length===0){ box.innerHTML = `<p class="hint" style="margin:0;">아직 완료 기록이 없습니다. 마지막 막까지 진행하면 자동으로 기록됩니다.</p>`; return; }
    box.innerHTML = hist.slice().reverse().map(h=>{
      const pct = h.total ? Math.round(h.correct/h.total*100) : 0;
      const badgeLine = (h.badges&&h.badges.length) ? h.badges.map(id=>{ const d=BADGE_DEFS.find(b=>b.id===id); return `🏅 ${d?d.name:id}`; }).join(' · ') : '';
      return `<div class="history-item">
        <div class="history-date">${formatDate(h.completedAt)} — ${h.player||'Player'}</div>
        <div class="history-stats">⭐ ${h.score||0}점 · 정답 ${h.correct}/${h.total} (${pct}%) · 소요 ${formatDuration(h.durationSec)}</div>
        ${badgeLine ? `<div class="hint" style="margin-top:4px;">${badgeLine}</div>` : ''}
      </div>`;
    }).join('');
  }
  function renderBadgeGallery(){
    const unlocked = loadJSON(BADGES_KEY,'badges') || [];
    const box = document.getElementById('badgeGallery');
    if(!box) return;
    box.innerHTML = BADGE_DEFS.map(b=>{
      const got = unlocked.includes(b.id);
      return `<div class="badge-row ${got?'':'locked'}"><span class="badge-icon">${got?'🏅':'🔒'}</span>
        <div><div class="badge-name">${b.name}</div><div class="hint" style="margin:0;">${b.desc}</div></div></div>`;
    }).join('');
  }
  function switchHistTab(name){
    ['log','badges'].forEach(k=>{
      document.getElementById('htab-'+k).classList.toggle('active', k===name);
      document.getElementById('histpane-'+k).classList.toggle('active', k===name);
    });
    if(name==='log') renderHistory(); else renderBadgeGallery();
  }
  window.PBSStudyToggleHistory = function(){
    const ov = document.getElementById('historyOverlay');
    ov.classList.toggle('show');
    if(ov.classList.contains('show')) switchHistTab('log');
  };
  window.PBSStudyClearHistory = function(){ saveJSON(HISTORY_KEY, [], 'history'); renderHistory(); };

  /* ---------------------------------------------------------------------
     Navigation between stages
     --------------------------------------------------------------------- */
  function goTo(n){
    $all('.stage').forEach(s=>s.classList.remove('active'));
    document.getElementById('stage-'+n).classList.add('active');
    currentStage = n;
    window.scrollTo({top:0, behavior:'smooth'});
    const tag = document.getElementById('stageTag');
    if(tag) tag.textContent = CFG.stageTags[n];
    $all('.map-node').forEach(node=>{
      const nn = parseInt(node.dataset.n,10);
      node.classList.toggle('visited', nn<=n);
      node.classList.toggle('current', nn===n);
    });
    const stageCfg = n>0 ? CFG.stages[n-1] : null;
    if(stageCfg && stageCfg.type==='sequence' && !seqState[n]) initSequenceStage(n, stageCfg);
    if(stageCfg && stageCfg.type==='cinematic') initCinematicStage(n, stageCfg);
    autosave();
    if(window.PBS_Debug){ PBS_Debug.log(`goTo(${n}) — ${stageCfg ? stageCfg.type : 'title'}`); PBS_Debug.update(debugSnapshot()); }
  }
  window.PBSStudyGoTo = goTo;

  /* ---------------------------------------------------------------------
     Stage 0 — title / intro
     --------------------------------------------------------------------- */
  function renderStage0(cfg){
    return `
    <section class="stage active" id="stage-0">
      <div class="eyebrow">${esc(cfg.eyebrow)}</div>
      <h1 class="title">${cfg.titleHtml}</h1>
      <p class="lede">${cfg.ledeHtml}</p>
      <div class="panel">${cfg.overviewHtml}</div>
      ${cfg.footnoteHtml ? `<p style="font-size:13px; color:var(--muted);">${cfg.footnoteHtml}</p>` : ''}
      ${cfg.kidsIntroHtml ? `<div class="kids-explain"><span class="ke-tag">🧒 쉬운 설명</span><br>${cfg.kidsIntroHtml}</div>` : ''}
      <div class="panel">
        <p style="margin:0 0 10px; color:var(--parchment);">플레이어 이름 (선택 — 같은 기기에서 여러 명이 기록을 남길 때 구분됩니다)</p>
        <input type="text" id="playerNameInput" class="name-input" placeholder="이름을 입력하세요" maxlength="20">
        <p style="margin:0 0 10px; color:var(--parchment);">난이도</p>
        <div class="diff-row" id="diffRow">
          <button class="diff-btn" data-d="easy">쉬움 <span class="hint" style="margin:0;">· 선택지 힌트</span></button>
          <button class="diff-btn active" data-d="normal">보통</button>
          <button class="diff-btn" data-d="hard">어려움 <span class="hint" style="margin:0;">· 해설 접힘</span></button>
        </div>
      </div>
      <div class="panel continue-banner" id="continueBanner" style="display:none;">
        <p style="margin:0; color:var(--parchment);" id="continueText"></p>
        <div class="btn-row">
          <button class="btn btn-primary" id="restoreBtn">이어서 진행하기</button>
          <button class="btn" id="dismissBtn">새로 시작</button>
        </div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="startBtn">시작하기</button></div>
    </section>`;
  }

  /* ---------------------------------------------------------------------
     Stage type: quizChain
     --------------------------------------------------------------------- */
  function renderQuizChainStage(cfg, idx){
    const beatsHtml = cfg.beats.map((beat,bi)=>`
      <div class="chain-beat" id="s${idx}-beat${bi}" style="${bi===0?'':'display:none;'}">
        ${beat.preText ? `<p style="margin-top:16px;">${beat.preText}</p>` : ''}
        <div class="panel">
          <p class="lede" style="margin:0 0 4px;">${beat.prompt}</p>
          <div id="s${idx}-b${bi}-choices"></div>
          <div class="feedback" id="s${idx}-b${bi}-feedback"></div>
        </div>
      </div>`).join('');
    return `
    <section class="stage" id="stage-${idx}">
      <div class="eyebrow">${esc(cfg.tag)}</div>
      <h2 class="section-title">${esc(cfg.title)}</h2>
      <span class="verse-ref">${esc(cfg.verseRef)}</span>
      ${cfg.intro ? `<p style="margin-top:16px;">${cfg.intro}</p>` : ''}
      ${beatsHtml}
      <div id="s${idx}-takeaway" style="display:none;">${renderTakeawayHtml(cfg)}</div>
      <div class="btn-row" id="s${idx}-continue" style="display:none;">
        <button class="btn btn-primary" id="s${idx}-continue-btn">${esc(cfg.continueLabel||'다음 막으로')}</button>
      </div>
    </section>`;
  }
  function wireQuizChainStage(cfg, idx){
    cfg.beats.forEach((beat, bi)=>{
      renderQuizUnit(beat, `s${idx}-b${bi}-choices`, `s${idx}-b${bi}-feedback`, (isCorrect)=>{
        recordFirstTry(`s${idx}b${bi}`, isCorrect);
        registerAnswer(isCorrect);
        const next = document.getElementById(`s${idx}-beat${bi+1}`);
        if(next){ next.style.display = 'block'; }
        else {
          document.getElementById(`s${idx}-continue`).style.display = 'flex';
          const tw = document.getElementById(`s${idx}-takeaway`); if(tw) tw.style.display='block';
        }
      });
    });
    const btn = document.getElementById(`s${idx}-continue-btn`);
    if(btn) btn.onclick = ()=> goTo(idx+1);
  }

  /* ---------------------------------------------------------------------
     Stage type: sequence (step-by-step, progress bar, optional match game)
     --------------------------------------------------------------------- */
  function renderSequenceStage(cfg, idx){
    return `
    <section class="stage" id="stage-${idx}">
      <div class="eyebrow">${esc(cfg.tag)}</div>
      <h2 class="section-title">${esc(cfg.title)}</h2>
      <span class="verse-ref">${esc(cfg.verseRef)}</span>
      ${cfg.intro ? `<p style="margin-top:16px;">${cfg.intro}</p>` : ''}
      ${cfg.visualHtml || ''}
      <div class="progress-track"><div class="progress-fill" id="s${idx}-fill"></div></div>
      <div class="progress-label" id="s${idx}-label">준비 0/${cfg.steps.length}</div>
      <div class="step-dots" id="s${idx}-dots"></div>
      <div class="panel" id="s${idx}-panel"></div>
      <div class="panel" id="s${idx}-match" style="display:none;"></div>
      <div id="s${idx}-takeaway" style="display:none;">${renderTakeawayHtml(cfg)}</div>
      <div class="btn-row" id="s${idx}-continue" style="display:none;">
        <button class="btn btn-primary" id="s${idx}-continue-btn">${esc(cfg.continueLabel||'다음 막으로')}</button>
      </div>
    </section>`;
  }
  function initSequenceStage(idx, cfg){
    seqState[idx] = { index:0, done:0 };
    const dots = document.getElementById(`s${idx}-dots`);
    cfg.steps.forEach((_,i)=>{ const d=document.createElement('div'); d.className='dot'; d.id=`s${idx}-dot-${i}`; dots.appendChild(d); });
    document.getElementById(`s${idx}-continue-btn`).onclick = ()=> goTo(idx+1);
    renderSequenceStep(idx, cfg);
  }
  function renderSequenceStep(idx, cfg){
    const st = seqState[idx];
    $all(`#s${idx}-dots .dot`).forEach((d,i)=>{
      d.classList.remove('current','done');
      if(i<st.index) d.classList.add('done');
      if(i===st.index) d.classList.add('current');
    });
    const step = cfg.steps[st.index];
    const panel = document.getElementById(`s${idx}-panel`);
    panel.innerHTML = `
      <p class="verse-ref">${esc(step.ref)}</p>
      <h3 style="font-family:'Noto Serif KR',serif; margin:6px 0 12px; color:var(--parchment); font-size:19px;">${esc(step.title)}</h3>
      <p class="lede" style="margin:0 0 14px;">${step.q}</p>
      <div id="s${idx}-stepChoices"></div>
      <div class="feedback" id="s${idx}-stepFeedback"></div>`;
    renderQuizUnit(step, `s${idx}-stepChoices`, `s${idx}-stepFeedback`, (isCorrect)=> onSequenceStepResolved(idx, cfg, isCorrect));
    if(window.PBS_initGlossary) PBS_initGlossary(panel);
  }
  function onSequenceStepResolved(idx, cfg, isCorrect){
    const st = seqState[idx];
    st.done = Math.min(st.done+1, cfg.steps.length);
    document.getElementById(`s${idx}-fill`).style.width = (st.done/cfg.steps.length*100)+'%';
    document.getElementById(`s${idx}-label`).textContent = `준비 ${st.done}/${cfg.steps.length}`;
    if(cfg.onStepDone) cfg.onStepDone(st.index, document);

    const nextBtn = document.createElement('div'); nextBtn.className='btn-row';
    if(st.index < cfg.steps.length-1){
      nextBtn.innerHTML = `<button class="btn btn-primary">다음 단계</button>`;
      nextBtn.querySelector('button').onclick = ()=>{ st.index++; renderSequenceStep(idx, cfg); autosave(); };
    } else {
      nextBtn.innerHTML = `<p style="color:var(--gold-soft); font-family:'Noto Serif KR',serif; font-size:16px;">${esc(cfg.completeText||'이 단계를 모두 마쳤습니다.')}</p>`;
      document.getElementById(`s${idx}-continue`).style.display='flex';
      const tw = document.getElementById(`s${idx}-takeaway`); if(tw) tw.style.display='block';
      if(cfg.matchPairs && cfg.matchPairs.length){
        document.getElementById(`s${idx}-match`).style.display='block';
        renderMatchGame(idx, cfg.matchPairs);
      }
    }
    document.getElementById(`s${idx}-panel`).appendChild(nextBtn);
    recordFirstTry(`s${idx}step${st.index}`, isCorrect);
    registerAnswer(isCorrect);
  }
  function renderMatchGame(idx, pairs){
    matchState = { leftOrder: shuffleIndices(pairs.length), rightOrder: shuffleIndices(pairs.length), selectedLeft:null, selectedRight:null, matchedIds:new Set() };
    const box = document.getElementById(`s${idx}-match`);
    box.innerHTML = `
      <p class="lede" style="margin:0 0 6px;">보너스 — 짝맞추기</p>
      <p class="hint" style="margin:0 0 14px;">왼쪽 항목과 오른쪽 의미를 하나씩 눌러 짝을 맞춰보세요. 건너뛰어도 진행에는 지장이 없습니다.</p>
      <div class="match-grid"><div class="match-col" id="s${idx}-matchLeft"></div><div class="match-col" id="s${idx}-matchRight"></div></div>
      <div class="btn-row"><button class="btn" id="s${idx}-matchSkip">건너뛰기</button></div>`;
    document.getElementById(`s${idx}-matchSkip`).onclick = ()=>{ box.innerHTML=''; };
    paintMatchColumns(idx, pairs);
  }
  function paintMatchColumns(idx, pairs){
    const leftBox = document.getElementById(`s${idx}-matchLeft`), rightBox = document.getElementById(`s${idx}-matchRight`);
    if(!leftBox || !rightBox || !matchState) return;
    leftBox.innerHTML=''; rightBox.innerHTML='';
    matchState.leftOrder.forEach(i=>{
      const pair = pairs[i];
      const b = document.createElement('button'); b.className='match-card'; b.textContent = pair.left;
      if(matchState.matchedIds.has(pair.id)){ b.classList.add('matched'); b.disabled=true; }
      if(matchState.selectedLeft===pair.id) b.classList.add('selected');
      b.onclick = ()=>selectMatch(idx, pairs, 'left', pair.id);
      leftBox.appendChild(b);
    });
    matchState.rightOrder.forEach(i=>{
      const pair = pairs[i];
      const b = document.createElement('button'); b.className='match-card'; b.textContent = pair.right;
      if(matchState.matchedIds.has(pair.id)){ b.classList.add('matched'); b.disabled=true; }
      if(matchState.selectedRight===pair.id) b.classList.add('selected');
      b.onclick = ()=>selectMatch(idx, pairs, 'right', pair.id);
      rightBox.appendChild(b);
    });
  }
  function selectMatch(idx, pairs, side, id){
    if(!matchState || matchState.matchedIds.has(id)) return;
    if(side==='left') matchState.selectedLeft=id; else matchState.selectedRight=id;
    paintMatchColumns(idx, pairs);
    if(matchState.selectedLeft && matchState.selectedRight){
      if(matchState.selectedLeft === matchState.selectedRight){
        matchState.matchedIds.add(matchState.selectedLeft);
        score += 15; updateScoreHud(); sfxCorrect(); autosave();
        matchState.selectedLeft=null; matchState.selectedRight=null;
        paintMatchColumns(idx, pairs);
        if(matchState.matchedIds.size === pairs.length){
          const box = document.getElementById(`s${idx}-match`);
          box.innerHTML = `<p style="color:var(--gold-soft); font-family:'Noto Serif KR',serif; font-size:16px; margin:0;">보너스 완료! 모든 짝을 맞혔습니다. (+${pairs.length*15}점)</p>`;
        }
      } else {
        sfxWrong();
        const l=matchState.selectedLeft, r=matchState.selectedRight;
        setTimeout(()=>{
          if(matchState && matchState.selectedLeft===l && matchState.selectedRight===r){
            matchState.selectedLeft=null; matchState.selectedRight=null; paintMatchColumns(idx, pairs);
          }
        }, 500);
      }
    }
  }

  /* ---------------------------------------------------------------------
     Stage type: cinematic (timed line reveal + optional pillar effect +
     optional closing quiz + optional reflection)
     --------------------------------------------------------------------- */
  function renderCinematicStage(cfg, idx){
    const linesHtml = cfg.lines.map((line,i)=>`
      <div class="cine-line" data-d="${i}">${line.html}${line.ref ? `<span class="ref">${esc(line.ref)}</span>` : ''}</div>
    `).join('');
    const pillarHtml = cfg.pillar ? `
      <div class="pillar-wrap"><canvas class="pillar-canvas" id="s${idx}-pillar"></canvas></div>
      <div class="pillar-toggle-row">
        <button class="diff-btn" id="s${idx}-pillar-cloud">☁️ 낮 · 구름 기둥</button>
        <button class="diff-btn" id="s${idx}-pillar-fire">🔥 밤 · 불 기둥</button>
      </div>` : '';
    return `
    <section class="stage" id="stage-${idx}">
      <div class="eyebrow">${esc(cfg.tag)}</div>
      <h2 class="section-title">${esc(cfg.title)}</h2>
      <span class="verse-ref">${esc(cfg.verseRef)}</span>
      ${cfg.predictOrdering ? `
      <div class="panel" id="s${idx}-predict">
        <p class="lede" style="margin:0 0 4px;">${cfg.predictOrdering.prompt}</p>
        <div id="s${idx}-predict-choices"></div>
        <div class="feedback" id="s${idx}-predict-feedback"></div>
      </div>` : ''}
      ${pillarHtml}
      <div class="panel" style="margin-top:18px;">${linesHtml}</div>
      ${cfg.closingQuiz ? `
      <div class="panel" id="s${idx}-cineQpanel" style="display:none;">
        <p class="lede" style="margin:0 0 10px;">${cfg.closingQuiz.prompt}</p>
        <div id="s${idx}-cineQchoices"></div>
        <div class="feedback" id="s${idx}-cineQfeedback"></div>
      </div>` : ''}
      ${cfg.warnHtml ? `<div class="warn-box">${cfg.warnHtml}</div>` : ''}
      ${cfg.kidsWarnHtml ? `<div class="kids-explain"><span class="ke-tag">🧒 쉬운 설명</span><br>${cfg.kidsWarnHtml}</div>` : ''}
      ${cfg.reflectPlaceholder ? `<textarea data-reflect-id="s${idx}" placeholder="${esc(cfg.reflectPlaceholder)}"></textarea>` : ''}
      ${renderTakeawayHtml(cfg)}
      <div class="btn-row"><button class="btn btn-primary" id="s${idx}-continue-btn">${esc(cfg.continueLabel||'다음 막으로')}</button></div>
    </section>`;
  }
  let cineInitDone = {};
  function initCinematicStage(idx, cfg){
    if(cineInitDone[idx]) return; cineInitDone[idx] = true;
    document.getElementById(`s${idx}-continue-btn`).onclick = ()=> goTo(idx+1);
    if(cfg.predictOrdering){
      renderQuizUnit(
        Object.assign({kind:'ordering'}, cfg.predictOrdering),
        `s${idx}-predict-choices`, `s${idx}-predict-feedback`,
        (isCorrect)=>{ recordFirstTry(`s${idx}predict`, isCorrect); registerAnswer(isCorrect); }
      );
    }
    const lines = $all('.cine-line', document.getElementById('stage-'+idx));
    lines.forEach(line=>{
      const delay = parseFloat(line.dataset.d)*850;
      setTimeout(()=>line.classList.add('show'), delay);
    });
    if(cfg.pillar){
      const cv = document.getElementById(`s${idx}-pillar`);
      let handle = null;
      if(cv && window.PBS_startPillar){ handle = PBS_startPillar(cv, { mode: cfg.pillar.defaultMode||'cloud' }); }
      const cloudBtn = document.getElementById(`s${idx}-pillar-cloud`);
      const fireBtn = document.getElementById(`s${idx}-pillar-fire`);
      function setMode(mode, activeBtn, otherBtn){
        if(handle) handle.setMode(mode);
        activeBtn.classList.add('active'); otherBtn.classList.remove('active');
      }
      if(cloudBtn && fireBtn){
        (cfg.pillar.defaultMode==='fire' ? fireBtn : cloudBtn).classList.add('active');
        cloudBtn.onclick = ()=> setMode('cloud', cloudBtn, fireBtn);
        fireBtn.onclick = ()=> setMode('fire', fireBtn, cloudBtn);
      }
    }
    if(cfg.closingQuiz){
      setTimeout(()=>{
        document.getElementById(`s${idx}-cineQpanel`).style.display='block';
        renderQuizUnit(cfg.closingQuiz, `s${idx}-cineQchoices`, `s${idx}-cineQfeedback`, (isCorrect)=>{
          recordFirstTry(`s${idx}cineQ`, isCorrect);
          registerAnswer(isCorrect);
        });
      }, lines.length*850 + 500);
    }
  }

  /* ---------------------------------------------------------------------
     Stage type: legacy (closing reflection + next-chapter link)
     --------------------------------------------------------------------- */
  function renderLegacyStage(cfg, idx){
    return `
    <section class="stage" id="stage-${idx}">
      <div class="eyebrow">${esc(cfg.tag)}</div>
      <h2 class="section-title">${esc(cfg.title)}</h2>
      <span class="verse-ref">${esc(cfg.verseRef)}</span>
      ${cfg.recapQuiz ? `
      <div class="panel">
        <p class="lede" style="margin:0 0 4px;">떠나기 전에, 오늘 배운 것을 짧게 복습해볼까요?</p>
        ${cfg.recapQuiz.map((r,ri)=>`
          <div class="recap-item">
            <div id="s${idx}-recap${ri}-choices"></div>
            <div class="feedback" id="s${idx}-recap${ri}-feedback"></div>
          </div>`).join('')}
      </div>` : ''}
      ${cfg.intro ? `<p style="margin-top:16px;">${cfg.intro}</p>` : ''}
      <div class="panel">
        <p class="lede" style="margin:0;">${cfg.askHtml}</p>
        <textarea data-reflect-id="s${idx}legacy" placeholder="${esc(cfg.reflectPlaceholder||'답을 적어보세요...')}"></textarea>
        <div class="btn-row"><button class="btn btn-primary" id="s${idx}-legacy-btn">다음 세대에게 전하기</button></div>
        <div class="legacy-card" id="s${idx}-legacyCard"></div>
      </div>
      ${cfg.refsChips ? `<div class="panel"><p style="margin:0 0 6px; color:var(--parchment);">오늘 지나온 본문 전체</p>
        <div class="refs-summary">${cfg.refsChips.map(c=>`<span class="ref-chip">${esc(c)}</span>`).join('')}</div></div>` : ''}
      <div class="panel">
        <p style="margin:0 0 4px; color:var(--parchment); font-family:'Noto Serif KR',serif; font-size:19px;">오늘 말씀 적용노트</p>
        <p style="margin:0 0 16px; color:var(--muted); font-size:13px;">우측 하단의 "📝 적용노트" 버튼을 누르면 언제든 열어서 이어 쓸 수 있습니다.</p>
        <div class="btn-row"><button class="btn btn-primary" id="s${idx}-notes-btn">📝 적용노트 열기</button></div>
      </div>
      ${cfg.nextChapter ? `
      <a class="next-chapter-card" href="${esc(cfg.nextChapter.href)}">
        <div><div class="nc-eyebrow">다음 이야기 · ${esc(cfg.nextChapter.label)}</div><div class="nc-title">${esc(cfg.nextChapter.title)}</div></div>
        <div class="nc-arrow">→</div>
      </a>` : ''}
      <div class="btn-row">
        <button class="btn" id="s${idx}-restart-btn">처음부터 다시</button>
        <a class="btn" href="index.html">🏠 처음 화면으로</a>
      </div>
    </section>`;
  }
  function wireLegacyStage(cfg, idx){
    if(cfg.recapQuiz){
      cfg.recapQuiz.forEach((r,ri)=>{
        renderQuizUnit(
          Object.assign({kind:'truefalse'}, r),
          `s${idx}-recap${ri}-choices`, `s${idx}-recap${ri}-feedback`,
          (isCorrect)=>{ recordFirstTry(`s${idx}recap${ri}`, isCorrect); registerAnswer(isCorrect); }
        );
      });
    }
    document.getElementById(`s${idx}-legacy-btn`).onclick = ()=>{
      const val = ($(`textarea[data-reflect-id="s${idx}legacy"]`)||{}).value || '';
      const card = document.getElementById(`s${idx}-legacyCard`);
      card.innerHTML = val.trim()
        ? `"${esc(val.trim())}"<br><span style="font-family:'Noto Sans KR',sans-serif; font-style:normal; font-size:13px; color:var(--muted);">— 오늘, 다음 세대에게 전한 말</span>`
        : `이 밤을 기억하는 이유는, 우리를 구원하신 분이 우리가 아니라 여호와이시기 때문입니다.`;
      card.classList.add('show');
      logCompletion();
    };
    document.getElementById(`s${idx}-notes-btn`).onclick = ()=> toggleNotes();
    document.getElementById(`s${idx}-restart-btn`).onclick = ()=> restart();
  }

  /* ---------------------------------------------------------------------
     Notes drawer
     --------------------------------------------------------------------- */
  function renderNotesDrawer(cfg){
    const chapters = Object.keys(cfg.chapters);
    const tabs = chapters.map((ch,i)=>`<button class="chap-tab ${i===0?'active':''}" data-note-tab="${ch}">${esc(cfg.chapters[ch].label||('출애굽기 '+ch+'장'))}</button>`).join('');
    const panes = chapters.map((ch,i)=>{
      const fields = (cfg.chapters[ch].noteFields||[]).map(f=>`
        <div class="app-field">
          <label>${esc(f.label)}</label>
          <span class="hint">${esc(f.hint)}</span>
          <textarea data-note-id="${ch}_${f.id}" placeholder="${esc(f.placeholder||'')}"></textarea>
        </div>`).join('<div class="notes-divider"></div>');
      return `<div class="chap-pane ${i===0?'active':''}" data-note-pane="${ch}">${fields}</div>`;
    }).join('');
    return `
    <button id="notesToggle" class="notes-fab">📝 적용노트</button>
    <div id="notesOverlay" class="notes-overlay">
      <aside class="notes-drawer">
        <div class="notes-header"><span>${esc(cfg.notesTitle||'오늘 말씀 적용노트')}</span><button class="notes-close" id="notesCloseBtn" aria-label="닫기">✕</button></div>
        <p class="hint" style="margin:0 0 14px;">게임 중 어느 장면에서든 떠오르는 생각을 바로 적어두세요.</p>
        <div class="chap-tabs">${tabs}</div>
        ${panes}
        <div class="btn-row">
          <button class="btn btn-primary" id="notesPreviewBtn">정리해서 미리보기</button>
          <button class="btn" id="notesCopyBtn" style="display:none;">📋 전체 복사하기</button>
        </div>
        <span class="copy-status" id="copyStatus"></span>
        <div class="app-preview" id="appPreview"></div>
      </aside>
    </div>`;
  }
  function toggleNotes(){ document.getElementById('notesOverlay').classList.toggle('show'); }
  function wireNotesDrawer(cfg){
    document.getElementById('notesToggle').onclick = toggleNotes;
    document.getElementById('notesCloseBtn').onclick = toggleNotes;
    document.getElementById('notesOverlay').addEventListener('click', (e)=>{ if(e.target.id==='notesOverlay') toggleNotes(); });
    $all('[data-note-tab]').forEach(tab=>{
      tab.onclick = ()=>{
        const ch = tab.dataset.noteTab;
        $all('[data-note-tab]').forEach(t=>t.classList.toggle('active', t===tab));
        $all('[data-note-pane]').forEach(p=>p.classList.toggle('active', p.dataset.notePane===ch));
      };
    });
    document.getElementById('notesPreviewBtn').onclick = ()=>{
      const box = document.getElementById('appPreview');
      box.textContent = buildApplicationText(cfg);
      box.classList.add('show');
      document.getElementById('notesCopyBtn').style.display='inline-block';
    };
    document.getElementById('notesCopyBtn').onclick = async ()=>{
      const text = buildApplicationText(cfg);
      const status = document.getElementById('copyStatus');
      try{ await navigator.clipboard.writeText(text); status.textContent='복사되었습니다 ✓'; }
      catch(e){ status.textContent='복사에 실패했습니다'; }
      setTimeout(()=>{ status.textContent=''; }, 2500);
    };
  }
  function buildApplicationText(cfg){
    const get = id => { const t = $(`textarea[data-note-id="${id}"]`); return (t && t.value.trim()) ? t.value.trim() : '(작성하지 않음)'; };
    const blocks = Object.keys(cfg.chapters).map(ch=>{
      const fields = cfg.chapters[ch].noteFields||[];
      const body = fields.map(f=>`■ ${f.label}\n${get(ch+'_'+f.id)}`).join('\n\n');
      return `[${cfg.chapters[ch].label||('출애굽기 '+ch+'장')}]\n\n${body}`;
    }).join('\n\n\n');
    return `[${cfg.notesTitle||'묵상 적용노트'}]\n\n${blocks}`;
  }

  /* ---------------------------------------------------------------------
     Text drawer (full chapter text + glossary tab)
     --------------------------------------------------------------------- */
  let textFontStep = 0;
  function renderTextDrawer(cfg){
    const chapters = Object.keys(cfg.chapters);
    const tabs = chapters.map((ch,i)=>`<button class="chap-tab ${i===0?'active':''}" data-text-tab="${ch}">${esc(ch)}장</button>`).join('')
      + `<button class="chap-tab" data-text-tab="gloss">📖 용어 사전</button>`;
    const panes = chapters.map((ch,i)=>{
      const verses = (cfg.chapters[ch].verses||[]).map(v=>`<div class="verse-block"><span class="vnum">${v.n}</span><p>${v.html}</p></div>`).join('');
      return `<div class="chap-pane ${i===0?'active':''}" data-text-pane="${ch}">${verses}</div>`;
    }).join('');
    return `
    <button id="textToggle" class="text-fab">📖 본문 전체보기</button>
    <div id="textOverlay" class="text-overlay">
      <aside class="text-drawer" id="textDrawer">
        <div class="text-header"><span>${esc(cfg.drawerTitle||'본문 읽기')}</span><button class="notes-close" id="textCloseBtn" aria-label="닫기">✕</button></div>
        <p class="hint" style="margin:0 0 14px;">개역개정 옮김</p>
        <div class="text-font-controls">
          <span class="hint" style="margin:0;">글자 크기</span>
          <button class="font-btn" id="fontMinusBtn">가−</button>
          <button class="font-btn" id="fontPlusBtn">가+</button>
        </div>
        <div class="chap-tabs">${tabs}</div>
        ${panes}
        <div class="chap-pane" data-text-pane="gloss"><p class="hint" style="margin:0 0 14px;">이 장에 나오는 어려운 낱말을 한눈에 모아두었습니다.</p><div id="glossListChapter"></div></div>
      </aside>
    </div>`;
  }
  function wireTextDrawer(){
    document.getElementById('textToggle').onclick = toggleTextDrawer;
    document.getElementById('textCloseBtn').onclick = toggleTextDrawer;
    document.getElementById('textOverlay').addEventListener('click', (e)=>{ if(e.target.id==='textOverlay') toggleTextDrawer(); });
    $all('[data-text-tab]').forEach(tab=>{
      tab.onclick = ()=>{
        const ch = tab.dataset.textTab;
        $all('[data-text-tab]').forEach(t=>t.classList.toggle('active', t===tab));
        $all('[data-text-pane]').forEach(p=>p.classList.toggle('active', p.dataset.textPane===ch));
        if(ch==='gloss' && window.PBS_renderGlossaryList) PBS_renderGlossaryList(document.getElementById('glossListChapter'));
      };
    });
    document.getElementById('fontMinusBtn').onclick = ()=>adjustTextFont(-1);
    document.getElementById('fontPlusBtn').onclick = ()=>adjustTextFont(1);
  }
  function toggleTextDrawer(){ document.getElementById('textOverlay').classList.toggle('show'); }
  function adjustTextFont(dir){
    textFontStep = Math.max(-2, Math.min(3, textFontStep+dir));
    const size = 15 + textFontStep;
    $all('.verse-block p').forEach(p=> p.style.fontSize = size+'px');
  }

  /* ---------------------------------------------------------------------
     Top study bar + progress map + history/celebration overlays
     --------------------------------------------------------------------- */
  function renderTopChrome(cfg){
    const mapNodes = cfg.mapLabels.map((label,i)=>`<span class="map-node ${i===0?'current':''}" data-n="${i}"><span class="dot"></span>${esc(label)}</span>`).join('');
    return `
    <div class="study-bar">
      <div class="brand" style="font-family:'Noto Serif KR', serif; font-weight:700; font-size:14px; color:var(--gold-soft); letter-spacing:0.05em;">${esc(cfg.brand)}</div>
      <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
        <span class="score-hud" id="scoreHud">⭐ 0점 · 🔥 0콤보</span>
        ${cfg.music && cfg.music.tracks && cfg.music.tracks.length ? `<button class="btn btn-small music-btn" id="musicBtn">♪ 배경음악</button>` : ''}
        <button class="icon-btn" id="historyBtn" aria-label="학습 기록" title="학습 기록">📊</button>
        <div class="stage-tag" id="stageTag">${esc(cfg.stageTags[0])}</div>
      </div>
    </div>
    <div class="progress-map" id="progressMap">${mapNodes}</div>
    <div id="historyOverlay" class="history-overlay">
      <div class="history-modal">
        <div class="text-header"><span>학습 기록</span><button class="notes-close" id="historyCloseBtn" aria-label="닫기">✕</button></div>
        <div class="chap-tabs">
          <button class="chap-tab active" id="htab-log">기록</button>
          <button class="chap-tab" id="htab-badges">배지</button>
        </div>
        <div class="chap-pane active" id="histpane-log"><div id="historyList"></div></div>
        <div class="chap-pane" id="histpane-badges"><div id="badgeGallery"></div></div>
        <div class="btn-row"><button class="btn" id="historyClearBtn">기록 전체 지우기</button></div>
      </div>
    </div>
    <div id="celebrationOverlay" class="history-overlay" style="z-index:95;">
      <div class="history-modal celebration-modal">
        <h2 style="font-family:'Noto Serif KR',serif; color:var(--gold-soft); margin:6px 0 10px; font-size:22px;">🎉 여정을 마쳤습니다</h2>
        <p id="celebrationStats" style="margin:0 0 16px; color:var(--parchment);"></p>
        <div id="celebrationBadges"></div>
        <div class="btn-row" style="justify-content:center;"><button class="btn btn-primary" id="celebrationCloseBtn">확인</button></div>
      </div>
    </div>`;
  }
  function wireMusicButton(cfg){
    const btn = document.getElementById('musicBtn');
    if(!btn || !cfg.music || !cfg.music.tracks || !cfg.music.tracks.length) return;
    if(window.PBS_attachBgmPlayer) PBS_attachBgmPlayer(btn, cfg.music.tracks);
  }
  function wireTopChrome(){
    document.getElementById('historyBtn').onclick = PBSStudyToggleHistory;
    document.getElementById('historyCloseBtn').onclick = PBSStudyToggleHistory;
    document.getElementById('historyOverlay').addEventListener('click', (e)=>{ if(e.target.id==='historyOverlay') PBSStudyToggleHistory(); });
    document.getElementById('historyClearBtn').onclick = PBSStudyClearHistory;
    document.getElementById('htab-log').onclick = ()=>switchHistTab('log');
    document.getElementById('htab-badges').onclick = ()=>switchHistTab('badges');
    document.getElementById('celebrationCloseBtn').onclick = PBSStudyCloseCelebration;
    document.getElementById('celebrationOverlay').addEventListener('click', (e)=>{ if(e.target.id==='celebrationOverlay') PBSStudyCloseCelebration(); });
  }

  /* ---------------------------------------------------------------------
     Restart
     --------------------------------------------------------------------- */
  function restart(){
    $all('textarea').forEach(t=>t.value='');
    $all('.legacy-card').forEach(c=>c.classList.remove('show'));
    $all('.feedback').forEach(f=>{ f.classList.remove('show'); f.innerHTML=''; });
    $all('.chain-beat').forEach((b,i)=>{ b.style.display = b.id.endsWith('beat0') ? 'block' : 'none'; });
    $all('[id$="-continue"]').forEach(elm=> elm.style.display='none');
    $all('[id$="-takeaway"]').forEach(elm=> elm.style.display='none');
    $all('[id$="-match"]').forEach(elm=>{ elm.style.display='none'; elm.innerHTML=''; });
    $all('[id$="-cineQpanel"]').forEach(elm=> elm.style.display='none');
    seqState = {}; matchState = null; cineInitDone = {};
    sessionStart = Date.now(); firstTryCorrect = {}; sessionLogged = false;
    score=0; combo=0; bestCombo=0; updateScoreHud();
    document.getElementById('appPreview').classList.remove('show');
    document.getElementById('notesCopyBtn').style.display='none';
    document.getElementById('notesOverlay').classList.remove('show');
    document.getElementById('textOverlay').classList.remove('show');
    PBSStudyCloseCelebration();
    saveJSON(STORAGE_KEY, null, 'progress');
    const banner = document.getElementById('continueBanner'); if(banner) banner.style.display='none';
    CFG.stages.forEach((stageCfg, i)=>{
      const idx = i+1;
      if(stageCfg.type==='quizChain') wireQuizChainStage(stageCfg, idx);
      if(stageCfg.type==='legacy' && stageCfg.recapQuiz){
        stageCfg.recapQuiz.forEach((r,ri)=>{
          renderQuizUnit(Object.assign({kind:'truefalse'}, r), `s${idx}-recap${ri}-choices`, `s${idx}-recap${ri}-feedback`,
            (isCorrect)=>{ recordFirstTry(`s${idx}recap${ri}`, isCorrect); registerAnswer(isCorrect); });
        });
      }
    });
    if(window.PBS_Debug){ PBS_Debug.log('restart()'); PBS_Debug.update(debugSnapshot()); }
    goTo(0);
  }

  /* ---------------------------------------------------------------------
     Public init
     --------------------------------------------------------------------- */
  function init(cfg){
    if(window.PBS_Debug) PBS_Debug.init();
    CFG = cfg;
    STORAGE_KEY = cfg.storageId+'_progress_v1';
    HISTORY_KEY = cfg.storageId+'_history_v1';
    BADGES_KEY = cfg.storageId+'_badges_v1';
    storageAvailable = testStorage();

    document.body.insertAdjacentHTML('afterbegin', `
      <canvas id="starfield" class="pbs-canvas-bg"></canvas>
      <canvas id="fxCanvas" class="pbs-canvas-bg" style="position:fixed;"></canvas>
      <div id="lamp-glow"></div>
      <div id="pbsNavRoot"></div>
    `);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = renderTopChrome(cfg) + renderStage0(cfg) + cfg.stages.map((s,i)=>{
      const idx = i+1;
      if(s.type==='quizChain') return renderQuizChainStage(s, idx);
      if(s.type==='sequence') return renderSequenceStage(s, idx);
      if(s.type==='cinematic') return renderCinematicStage(s, idx);
      if(s.type==='legacy') return renderLegacyStage(s, idx);
      return '';
    }).join('');
    document.body.appendChild(wrap);

    document.body.insertAdjacentHTML('beforeend', renderNotesDrawer(cfg) + renderTextDrawer(cfg));

    // wire chrome
    wireTopChrome();
    wireMusicButton(cfg);
    wireNotesDrawer(cfg);
    wireTextDrawer();

    // wire per-stage interactivity
    cfg.stages.forEach((s,i)=>{
      const idx = i+1;
      if(s.type==='quizChain') wireQuizChainStage(s, idx);
      if(s.type==='legacy') wireLegacyStage(s, idx);
    });

    // stage 0 wiring
    document.getElementById('startBtn').onclick = ()=> goTo(1);
    $all('.diff-btn').forEach(b=>{
      b.onclick = ()=>{
        difficulty = b.dataset.d;
        $all('.diff-btn').forEach(x=>x.classList.toggle('active', x===b));
        try{ localStorage.setItem(cfg.storageId+'_difficulty_v1', difficulty); }catch(e){}
        if(window.PBS_Debug){ PBS_Debug.log('difficulty → '+difficulty); PBS_Debug.update(debugSnapshot()); }
      };
    });
    const nameInput = document.getElementById('playerNameInput');
    try{ const saved = localStorage.getItem(cfg.storageId+'_playerName'); if(saved) playerName = saved; }catch(e){}
    nameInput.value = playerName==='Player' ? '' : playerName;
    nameInput.addEventListener('input', ()=>{
      playerName = nameInput.value.trim() || 'Player';
      try{ localStorage.setItem(cfg.storageId+'_playerName', playerName); }catch(e){}
    });
    try{ const savedDiff = localStorage.getItem(cfg.storageId+'_difficulty_v1'); if(savedDiff){ difficulty=savedDiff; $all('.diff-btn').forEach(b=>b.classList.toggle('active', b.dataset.d===difficulty)); } }catch(e){}

    // autosave listeners
    const debounced = (()=>{ let t; return ()=>{ clearTimeout(t); t=setTimeout(autosave, 600); }; })();
    $all('textarea').forEach(t=> t.addEventListener('input', debounced));

    // continue banner
    const saved = loadJSON(STORAGE_KEY, 'progress');
    if(saved && saved.stage){
      document.getElementById('continueText').textContent = `저장된 진행이 있습니다 — ${cfg.stageTags[saved.stage]}까지 (마지막 저장: ${formatDate(saved.savedAt)})`;
      document.getElementById('continueBanner').style.display = 'block';
      document.getElementById('restoreBtn').onclick = ()=>{
        sessionStart = saved.startedAt || Date.now();
        firstTryCorrect = saved.firstTryCorrect || {};
        Object.keys(saved.notes||{}).forEach(id=>{ const t=$(`textarea[data-note-id="${id}"]`); if(t) t.value = saved.notes[id]; });
        Object.keys(saved.reflections||{}).forEach(id=>{ const t=$(`textarea[data-reflect-id="${id}"]`); if(t) t.value = saved.reflections[id]; });
        document.getElementById('continueBanner').style.display='none';
        if(window.PBS_Debug) PBS_Debug.log('restoreProgress() → stage '+saved.stage);
        goTo(saved.stage);
      };
      document.getElementById('dismissBtn').onclick = ()=>{ document.getElementById('continueBanner').style.display='none'; };
    }

    updateScoreHud();

    if(window.PBS_renderNav) PBS_renderNav(cfg.navCurrent);
    if(window.PBS_startStarfield) PBS_startStarfield(document.getElementById('starfield'), { density: 70 });
    if(window.PBS_initGlossary) PBS_initGlossary(document);
    if(window.PBS_Debug){ PBS_Debug.log('init('+cfg.storageId+')'); PBS_Debug.update(debugSnapshot()); }
  }

  window.PBSStudy = { init };
})();
