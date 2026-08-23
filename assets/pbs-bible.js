/* ==========================================================================
   PBS bible-text loader — turns a plain-text file in assets/bible/ into the
   verses array the text drawer expects ({n, html}[]).

   Expected source format, one verse per line:
     (출 15:3) **여호와는 용사시니 여호와는 그의 이름이시로다**
   - the verse number is read from the last ":N" inside the leading
     "(...)" reference, and that reference is then stripped (the drawer
     already shows the verse number on its own)
   - **...** becomes <b>...</b> for emphasis
   - any word matching a assets/pbs-glossary.js entry is auto-wrapped as
     a clickable <span class="gloss"> (load pbs-glossary.js first)

   Usage (from a chapter HTML shell, before PBSStudy.init):
     PBS_loadBibleText('assets/bible/출애굽기15장.txt').then(function(verses){
       window.EXODUS_15_DATA.chapters['15'].verses = verses;
       PBSStudy.init(window.EXODUS_15_DATA);
     });
   ========================================================================== */
(function(){
  function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Wraps any known glossary word (assets/pbs-glossary.js) found in the text
  // with a clickable <span class="gloss">, so verses loaded from plain text
  // keep the same tap-to-explain behavior as hand-authored chapter data.
  function autoGloss(text){
    var dict = window.PBS_GLOSSARY;
    if(!dict) return text;
    var terms = Object.keys(dict).sort(function(a,b){ return b.length - a.length; });
    if(!terms.length) return text;
    var re = new RegExp(terms.map(escapeRegExp).join('|'), 'g');
    return text.replace(re, function(m){
      return '<span class="gloss" data-term="' + m + '">' + m + '</span>';
    });
  }

  window.PBS_loadBibleText = function(path){
    return fetch(path).then(function(res){
      if(!res.ok) throw new Error('본문 파일을 불러오지 못했습니다: ' + path);
      return res.text();
    }).then(function(raw){
      return raw.split(/\r?\n/)
        .filter(function(line){ return line.trim().length > 0; })
        .map(function(line){
          // each line looks like: (출 15:3) **여호와는 용사시니...**
          // — the verse number is the part after the last ":" inside the
          // leading parenthetical reference, not a separate column.
          var m = line.trim().match(/^\(([^)]*)\)\s*([\s\S]*)$/);
          var n = NaN, rest = line.trim();
          if(m){
            var refParts = m[1].split(':');
            n = parseInt(refParts[refParts.length - 1].trim(), 10);
            rest = m[2];
          }
          rest = rest.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          rest = rest.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
          rest = autoGloss(rest);
          return { n: n, html: rest };
        })
        .filter(function(v){ return !isNaN(v.n); });
    });
  };
})();
