/* ==========================================================================
   PBS shared progress system — daily streak + per-chapter personal-best
   records + a shared badge icon/name lookup, so score/combo/badges have
   somewhere to land instead of resetting into nothing every replay.
   Used by pbs-engine.js, exodus-11-12.html, and index.html.
   ========================================================================== */
(function(){
  const STREAK_KEY = 'pbs_streak_v1';

  function todayStr(){
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function daysBetween(a, b){
    return Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000);
  }

  /* ---------- daily streak: counts a day the moment any question is answered ---------- */
  function recordActivity(){
    let data;
    try{ const raw = localStorage.getItem(STREAK_KEY); data = raw ? JSON.parse(raw) : null; }catch(e){ return null; }
    if(!data) data = { count:0, longest:0, lastDate:null };
    const today = todayStr();
    if(data.lastDate === today) return data;
    data.count = (data.lastDate && daysBetween(data.lastDate, today) === 1) ? data.count + 1 : 1;
    data.lastDate = today;
    if(data.count > data.longest) data.longest = data.count;
    try{ localStorage.setItem(STREAK_KEY, JSON.stringify(data)); }catch(e){}
    return data;
  }
  function getStreak(){
    let data;
    try{ const raw = localStorage.getItem(STREAK_KEY); data = raw ? JSON.parse(raw) : null; }catch(e){ data = null; }
    if(!data) return { count:0, longest:0, lastDate:null, active:false };
    const gap = data.lastDate ? daysBetween(data.lastDate, todayStr()) : null;
    return Object.assign({ active: gap !== null && gap <= 1 }, data);
  }

  /* ---------- personal-best score per chapter ---------- */
  function bestKey(storageId){ return storageId + '_best_v1'; }
  function getBest(storageId){
    try{ const raw = localStorage.getItem(bestKey(storageId)); return raw ? JSON.parse(raw) : null; }catch(e){ return null; }
  }
  function setBestIfHigher(storageId, entry){
    const prev = getBest(storageId);
    if(!prev || (entry.score||0) > prev.score){
      const rec = {
        score: entry.score||0, correct: entry.correct||0, total: entry.total||0,
        bestCombo: entry.bestCombo||0, durationSec: entry.durationSec||0, achievedAt: Date.now()
      };
      try{ localStorage.setItem(bestKey(storageId), JSON.stringify(rec)); }catch(e){}
      return { isNewBest: true, best: rec, prev };
    }
    return { isNewBest: false, best: prev, prev };
  }

  /* ---------- shared badge metadata (icon/name) across all chapter files ---------- */
  const BADGE_META = {
    perfect_score: { icon:'💯', name:'만점 순례자' },
    fast_finish:   { icon:'⚡', name:'빠른 발걸음' },
    fast_exit:     { icon:'⚡', name:'빠른 탈출' },
    devoted:       { icon:'📖', name:'말씀 지킴이' },
    perfect_door:  { icon:'🚪', name:'완벽한 문설주' }
  };

  window.PBS_recordActivity = recordActivity;
  window.PBS_getStreak = getStreak;
  window.PBS_getBest = getBest;
  window.PBS_setBestIfHigher = setBestIfHigher;
  window.PBS_BADGE_META = BADGE_META;
})();
