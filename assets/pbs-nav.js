/* ==========================================================================
   PBS shared top navigation — injects a consistent brand + chapter links
   Usage: <div id="pbsNavRoot"></div>  then  PBS_renderNav('11-12');
   current: 'index' | '11-12' | '13' | ...

   Chapter pages live in /chapters/, index.html and manual.html live at
   the site root — this file is loaded by both, so every link is built
   relative to whichever one is currently running (detected from the
   page's own URL) rather than hard-coded. */
(function(){
  const PAGES = [
    { id: '11-12', file: 'exodus-11-12.html', label: '출 11–12장', chapter: true },
    { id: '13', file: 'exodus-13.html', label: '출 13장', chapter: true },
    { id: '14', file: 'exodus-14.html', label: '출 14장', chapter: true },
    { id: '15', file: 'exodus-15.html', label: '출 15장', chapter: true },
    { id: '16', file: 'exodus-16.html', label: '출 16장', chapter: true },
    { id: 'manual', file: 'manual.html', label: '📘 사용법', chapter: false }
  ];

  function renderNav(current){
    const root = document.getElementById('pbsNavRoot');
    if(!root) return;
    const inChapter = location.pathname.indexOf('/chapters/') !== -1;
    const toRoot = inChapter ? '../' : '';
    const toChapters = inChapter ? '' : 'chapters/';
    const homeHref = current === 'index' ? null : toRoot + 'index.html';
    const links = PAGES.map(p=>{
      const isCurrent = p.id === current;
      const href = (p.chapter ? toChapters : toRoot) + p.file;
      return `<a class="pbs-nav-link${isCurrent ? ' current' : ''}" href="${href}"${isCurrent ? ' aria-current="page"' : ''}>${p.label}</a>`;
    }).join('');

    root.innerHTML = `
      <nav class="pbs-nav">
        <a class="pbs-brand" href="${homeHref || '#'}" ${homeHref ? '' : 'style="pointer-events:none;"'}>
          PBS <small>Personal Bible Study</small>
        </a>
        <div class="pbs-nav-links">
          ${links}
          <button type="button" class="pbs-kids-toggle" id="pbsKidsToggle">🧒 쉬운말 모드</button>
        </div>
      </nav>
    `;

    const kidsBtn = document.getElementById('pbsKidsToggle');
    if(kidsBtn){
      try{
        if(localStorage.getItem('pbs_kids_mode') === '1'){
          document.body.classList.add('kids-on');
          kidsBtn.classList.add('on');
        }
      }catch(e){}
      kidsBtn.addEventListener('click', ()=>{
        const on = document.body.classList.toggle('kids-on');
        kidsBtn.classList.toggle('on', on);
        try{ localStorage.setItem('pbs_kids_mode', on ? '1' : '0'); }catch(e){}
      });
    }
  }

  window.PBS_renderNav = renderNav;
})();
