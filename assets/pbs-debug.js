/* ==========================================================================
   PBS shared debug mode — a toggleable overlay that shows live app state
   and a change-log, so bugs (like "why is the wrong track playing") can be
   diagnosed by looking, not guessing. Off by default; never touches page
   content. Turn on with ?debug=1 in the URL (persists via localStorage),
   turn off with ?debug=0 or the ✕ on the panel.
   ========================================================================== */
(function(){
  let panel = null;
  let enabled = false;
  const logLines = [];

  function readFlag(){
    try{
      const params = new URLSearchParams(location.search);
      if(params.get('debug') === '1') localStorage.setItem('pbs_debug', '1');
      if(params.get('debug') === '0') localStorage.removeItem('pbs_debug');
      return localStorage.getItem('pbs_debug') === '1';
    }catch(e){ return false; }
  }

  function ensurePanel(){
    if(panel) return panel;
    panel = document.createElement('div');
    panel.id = 'pbsDebugPanel';
    panel.innerHTML = `
      <div class="pbs-debug-header">
        <span>🐞 PBS DEBUG</span>
        <button id="pbsDebugClose" aria-label="디버그 모드 끄기" title="디버그 모드 끄기">✕</button>
      </div>
      <div class="pbs-debug-section-tag">state</div>
      <pre id="pbsDebugBody"></pre>
      <div class="pbs-debug-section-tag">log</div>
      <pre class="pbs-debug-log" id="pbsDebugLog"></pre>
    `;
    document.body.appendChild(panel);
    document.getElementById('pbsDebugClose').onclick = ()=>{
      try{ localStorage.removeItem('pbs_debug'); }catch(e){}
      panel.remove(); panel = null; enabled = false;
    };
    return panel;
  }

  function init(){
    enabled = readFlag();
    if(!enabled) return;
    ensurePanel();
    console.info('%c🐞 PBS 디버그 모드 켜짐 — URL에 ?debug=0 을 붙이면 꺼집니다.', 'color:#c9a24b; font-weight:bold;');
  }

  function log(label, detail){
    if(!enabled) return;
    const t = new Date().toLocaleTimeString('ko-KR', {hour12:false});
    logLines.unshift(`[${t}] ${label}`);
    if(logLines.length > 40) logLines.length = 40;
    const el = document.getElementById('pbsDebugLog');
    if(el) el.textContent = logLines.join('\n');
    if(detail !== undefined) console.log('%c[PBS DEBUG] ' + label, 'color:#c9a24b;', detail);
    else console.log('%c[PBS DEBUG] ' + label, 'color:#c9a24b;');
  }

  function update(stateObj){
    if(!enabled) return;
    const body = document.getElementById('pbsDebugBody');
    if(body) body.textContent = JSON.stringify(stateObj, null, 2);
  }

  window.PBS_Debug = {
    init, log, update,
    get enabled(){ return enabled; }
  };
})();
