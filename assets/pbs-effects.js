/* ==========================================================================
   PBS shared visual effects — canvas starfield, fire/cloud pillar, confetti
   Vanilla Canvas2D, no external libraries. Respects prefers-reduced-motion.
   ========================================================================== */
(function(){
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resizeCanvas(cv){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = cv.clientWidth * dpr;
    cv.height = cv.clientHeight * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /* ---------- starfield: twinkling desert-night sky ---------- */
  function startStarfield(cv, opts){
    opts = opts || {};
    const density = opts.density || 90;
    let ctx = resizeCanvas(cv);
    let stars = [];
    function seed(){
      const w = cv.clientWidth, h = cv.clientHeight;
      stars = Array.from({length: density}, ()=>({
        x: Math.random()*w,
        y: Math.random()*h*0.75,
        r: Math.random()*1.4 + 0.3,
        phase: Math.random()*Math.PI*2,
        speed: 0.6 + Math.random()*1.1
      }));
    }
    seed();
    window.addEventListener('resize', ()=>{ ctx = resizeCanvas(cv); seed(); });
    if(REDUCED){
      const w = cv.clientWidth, h = cv.clientHeight;
      ctx.clearRect(0,0,w,h);
      stars.forEach(s=>{
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
      });
      return;
    }
    let t = 0;
    function frame(){
      t += 0.016;
      const w = cv.clientWidth, h = cv.clientHeight;
      ctx.clearRect(0,0,w,h);
      stars.forEach(s=>{
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(t*s.speed + s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,255,255,${tw*0.75})`;
        ctx.fill();
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- fire & cloud pillar: rising particles, day/night blend ---------- */
  function startPillar(cv, opts){
    opts = opts || {};
    let ctx = resizeCanvas(cv);
    window.addEventListener('resize', ()=>{ ctx = resizeCanvas(cv); });
    let mode = opts.mode || 'fire'; // 'fire' | 'cloud'
    let particles = [];
    let running = true;

    function spawn(){
      const w = cv.clientWidth, h = cv.clientHeight;
      const cx = w/2;
      if(mode === 'fire'){
        particles.push({
          x: cx + (Math.random()-0.5)*26, y: h - 6,
          vx: (Math.random()-0.5)*0.5, vy: -(0.9 + Math.random()*1.6),
          r: 3 + Math.random()*6, life: 1,
          hue: 20 + Math.random()*30
        });
      } else {
        particles.push({
          x: cx + (Math.random()-0.5)*70, y: h - 10,
          vx: (Math.random()-0.5)*0.25, vy: -(0.3 + Math.random()*0.5),
          r: 14 + Math.random()*20, life: 1,
          hue: 0
        });
      }
    }

    function frame(){
      if(!running) return;
      const w = cv.clientWidth, h = cv.clientHeight;
      ctx.clearRect(0,0,w,h);

      const spawnCount = REDUCED ? 1 : (mode==='fire' ? 3 : 1);
      for(let i=0;i<spawnCount;i++) spawn();

      particles.forEach(p=>{
        p.x += p.vx; p.y += p.vy; p.life -= (mode==='fire' ? 0.012 : 0.006);
      });
      particles = particles.filter(p=> p.life > 0);

      particles.forEach(p=>{
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI*2);
        if(mode === 'fire'){
          ctx.fillStyle = `hsla(${p.hue}, 95%, ${50 + p.life*20}%, ${p.life*0.85})`;
        } else {
          ctx.fillStyle = `rgba(236,225,198,${p.life*0.5})`;
        }
        ctx.fill();
      });

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      setMode(m){ mode = m; particles = []; },
      stop(){ running = false; },
    };
  }

  /* ---------- confetti burst (canvas, one-shot) ---------- */
  function burstConfetti(cv, opts){
    opts = opts || {};
    const ctx = resizeCanvas(cv);
    const colors = opts.colors || ['#c9a24b','#e3c579','#a83244','#ece1c6','#7fb3cf'];
    const w = cv.clientWidth, h = cv.clientHeight;
    let pieces = Array.from({length: opts.count || 60}, ()=>({
      x: w/2 + (Math.random()-0.5)*60,
      y: h*0.15,
      vx: (Math.random()-0.5)*7,
      vy: -(Math.random()*5 + 3),
      rot: Math.random()*Math.PI*2,
      vr: (Math.random()-0.5)*0.3,
      size: 5 + Math.random()*5,
      color: colors[Math.floor(Math.random()*colors.length)],
      grav: 0.18 + Math.random()*0.08,
      life: 1
    }));
    let running = true;
    function frame(){
      if(!running) return;
      ctx.clearRect(0,0,w,h);
      pieces.forEach(p=>{
        p.vy += p.grav; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 0.008;
      });
      pieces = pieces.filter(p=> p.life > 0 && p.y < h + 40);
      pieces.forEach(p=>{
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size*0.6);
        ctx.restore();
      });
      if(pieces.length > 0){ requestAnimationFrame(frame); }
      else { ctx.clearRect(0,0,w,h); running = false; }
    }
    requestAnimationFrame(frame);
  }

  /* ---------- sparkle burst: small gold particle pop (quiz feedback, etc.) ---------- */
  function sparkleBurst(cv, x, y, opts){
    opts = opts || {};
    const ctx = resizeCanvas(cv);
    const w = cv.clientWidth, h = cv.clientHeight;
    const colors = opts.colors || ['#e3c579','#c9a24b','#fff6dd'];
    let pieces = Array.from({length: opts.count || 18}, ()=>{
      const a = Math.random()*Math.PI*2;
      const speed = 1.5 + Math.random()*3;
      return {
        x, y, vx: Math.cos(a)*speed, vy: Math.sin(a)*speed,
        r: 1.5 + Math.random()*2.5, life: 1,
        color: colors[Math.floor(Math.random()*colors.length)]
      };
    });
    let running = true;
    function frame(){
      if(!running) return;
      ctx.clearRect(0,0,w,h);
      pieces.forEach(p=>{ p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= 0.025; });
      pieces = pieces.filter(p=> p.life > 0);
      pieces.forEach(p=>{
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0,p.r*p.life), 0, Math.PI*2);
        ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, p.life);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      if(pieces.length > 0){ requestAnimationFrame(frame); }
      else { ctx.clearRect(0,0,w,h); running = false; }
    }
    requestAnimationFrame(frame);
  }

  /* ---------- background music: real playlist, no synth fallback ----------
     Plays real audio files (mp3) from a chapter's /music folder. The
     trigger button opens a small popover listing every track so the
     listener can pick exactly which song plays, plus prev/next/play
     controls. Files are kept out of git (see .gitignore) — this only
     needs the file paths at runtime. There is intentionally no
     generated-sound fallback of any kind. ---------- */
  function attachBgmPlayer(buttonEl, tracks, opts){
    if(!buttonEl || !tracks || !tracks.length) return null;
    opts = opts || {};
    const audio = new Audio();
    audio.preload = 'none';
    audio.volume = opts.volume != null ? opts.volume : 0.55;
    let idx = 0;
    let popover = null;
    let lastError = null;

    function trackLabel(path){
      return path.split('/').pop().replace(/\.[^.]+$/, '');
    }
    function load(i){
      idx = ((i % tracks.length) + tracks.length) % tracks.length;
      lastError = null;
      audio.src = encodeURI(tracks[idx]);
    }
    function playCurrent(){
      return audio.play().catch(err=>{ lastError = err; renderPopover(); throw err; });
    }
    function next(){ load(idx+1); playCurrent().catch(()=>{}); }
    function prev(){ load(idx-1); playCurrent().catch(()=>{}); }
    audio.addEventListener('ended', next);
    audio.addEventListener('play', updateButton);
    audio.addEventListener('pause', updateButton);
    audio.addEventListener('error', ()=>{ lastError = true; renderPopover(); });

    function updateButton(){
      buttonEl.textContent = audio.paused ? '♪ 배경음악' : '♪ 재생 중 ⏸';
      buttonEl.classList.toggle('is-playing', !audio.paused);
      renderPopover();
    }
    function closePopover(){
      if(popover){ popover.remove(); popover = null; }
      document.removeEventListener('click', outsideHandler, true);
      window.removeEventListener('resize', closePopover);
    }
    function outsideHandler(e){
      if(popover && !popover.contains(e.target) && e.target !== buttonEl){ closePopover(); }
    }
    function buildHtml(){
      const tracksHtml = tracks.map((t,i)=>{
        const isCurrent = i===idx;
        const playing = isCurrent && !audio.paused;
        return `<div class="bgm-track ${playing?'playing':''}" data-i="${i}">
          <span class="bgm-track-icon">${playing ? '🔊' : '♪'}</span>
          <span class="bgm-track-name">${trackLabel(t)}</span>
        </div>`;
      }).join('');
      return `
        <div class="bgm-header"><span>🎵 배경 음악</span><button class="gp-close" id="bgmCloseBtn" aria-label="닫기">✕</button></div>
        <div class="bgm-tracklist">${tracksHtml}</div>
        <div class="bgm-controls">
          <button class="icon-btn" id="bgmPrevBtn" aria-label="이전 곡" title="이전 곡">⏮</button>
          <button class="icon-btn" id="bgmPlayBtn" aria-label="재생/일시정지" title="재생/일시정지">${audio.paused ? '▶' : '⏸'}</button>
          <button class="icon-btn" id="bgmNextBtn" aria-label="다음 곡" title="다음 곡">⏭</button>
        </div>
        ${lastError ? `<p class="bgm-error">이 곡을 재생할 수 없습니다. 파일 위치를 확인해주세요.</p>` : ''}
      `;
    }
    function wirePopover(){
      popover.querySelectorAll('.bgm-track').forEach(el=>{
        el.onclick = ()=>{
          const i = parseInt(el.dataset.i,10);
          if(i === idx){ audio.paused ? playCurrent().catch(()=>{}) : audio.pause(); }
          else { load(i); playCurrent().catch(()=>{}); }
        };
      });
      popover.querySelector('#bgmPrevBtn').onclick = prev;
      popover.querySelector('#bgmNextBtn').onclick = next;
      popover.querySelector('#bgmPlayBtn').onclick = ()=>{ audio.paused ? playCurrent().catch(()=>{}) : audio.pause(); };
      popover.querySelector('#bgmCloseBtn').onclick = closePopover;
    }
    function renderPopover(){
      if(!popover) return;
      popover.innerHTML = buildHtml();
      wirePopover();
    }
    function openPopover(){
      if(popover){ closePopover(); return; }
      popover = document.createElement('div');
      popover.className = 'bgm-popover';
      document.body.appendChild(popover);
      const r = buttonEl.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.right - 260), window.innerWidth - 268);
      const top = r.bottom + 8;
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';
      renderPopover();
      requestAnimationFrame(()=> popover.classList.add('show'));
      setTimeout(()=>{
        document.addEventListener('click', outsideHandler, true);
        window.addEventListener('resize', closePopover);
      }, 0);
    }

    load(0);
    buttonEl.textContent = '♪ 배경음악';
    buttonEl.onclick = openPopover;

    return {
      audio,
      next, prev,
      play: playCurrent,
      pause(){ audio.pause(); }
    };
  }

  window.PBS_startStarfield = startStarfield;
  window.PBS_startPillar = startPillar;
  window.PBS_burstConfetti = burstConfetti;
  window.PBS_sparkleBurst = sparkleBurst;
  window.PBS_attachBgmPlayer = attachBgmPlayer;
})();
