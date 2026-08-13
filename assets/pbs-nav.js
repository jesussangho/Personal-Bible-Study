/* ==========================================================================
   PBS shared top navigation — injects a consistent brand + chapter links
   Usage: <div id="pbsNavRoot"></div>  then  PBS_renderNav('11-12');
   current: 'index' | '11-12' | '13'
   ========================================================================== */
(function(){
  const PAGES = [
    { id: '11-12', href: 'exodus-11-12.html', label: '출 11–12장' },
    { id: '13', href: 'exodus-13.html', label: '출 13장' }
  ];

  function renderNav(current){
    const root = document.getElementById('pbsNavRoot');
    if(!root) return;
    const homeHref = current === 'index' ? null : 'index.html';
    const links = PAGES.map(p=>{
      const isCurrent = p.id === current;
      return `<a class="pbs-nav-link${isCurrent ? ' current' : ''}" href="${p.href}"${isCurrent ? ' aria-current="page"' : ''}>${p.label}</a>`;
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
