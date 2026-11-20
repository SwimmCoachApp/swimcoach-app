/**
 * Lecture d'une page liveffn « Résultats par structure » et rapprochement avec les nageurs de l'espace.
 * FFN_EVENTS, timeToMs, parseLiveFFNHTML et matchSwimmersToDB sont repris tels quels de club4 ; seule
 * différence : `swimmers` est passé en paramètre (au lieu de DB.swimmers). normalizeName est celle de
 * core/names.js, identique à celle de club4.
 */
import { normalizeName } from '../../core/names.js';
import { swimmerEligibleForComp, seasonOfDateKey, currentSeason } from '../../core/season.js';

export { normalizeName };

// Codes épreuves FFN (vu dans les URL epreuve=X de liveffn)
// distance (m), nage, sex ('F' ou 'M')
export const FFN_EVENTS = {
  // Dames
  1:{d:50,s:'nl',sex:'F'},    2:{d:100,s:'nl',sex:'F'},   3:{d:200,s:'nl',sex:'F'},   4:{d:400,s:'nl',sex:'F'},   5:{d:800,s:'nl',sex:'F'},   6:{d:1500,s:'nl',sex:'F'},
  11:{d:50,s:'dos',sex:'F'},  12:{d:100,s:'dos',sex:'F'}, 13:{d:200,s:'dos',sex:'F'},
  21:{d:50,s:'brasse',sex:'F'},22:{d:100,s:'brasse',sex:'F'},23:{d:200,s:'brasse',sex:'F'},
  31:{d:50,s:'pap',sex:'F'},  32:{d:100,s:'pap',sex:'F'}, 33:{d:200,s:'pap',sex:'F'},
  40:{d:100,s:'4n',sex:'F'},  41:{d:200,s:'4n',sex:'F'},  42:{d:400,s:'4n',sex:'F'},
  // Messieurs
  51:{d:50,s:'nl',sex:'M'},   52:{d:100,s:'nl',sex:'M'},  53:{d:200,s:'nl',sex:'M'},  54:{d:400,s:'nl',sex:'M'},  55:{d:800,s:'nl',sex:'M'},  56:{d:1500,s:'nl',sex:'M'},
  61:{d:50,s:'dos',sex:'M'},  62:{d:100,s:'dos',sex:'M'}, 63:{d:200,s:'dos',sex:'M'},
  71:{d:50,s:'brasse',sex:'M'},72:{d:100,s:'brasse',sex:'M'},73:{d:200,s:'brasse',sex:'M'},
  81:{d:50,s:'pap',sex:'M'},  82:{d:100,s:'pap',sex:'M'}, 83:{d:200,s:'pap',sex:'M'},
  90:{d:100,s:'4n',sex:'M'},  91:{d:200,s:'4n',sex:'M'},  92:{d:400,s:'4n',sex:'M'}
};
export const STROKE_LABELS = {nl:'Nage libre', dos:'Dos', brasse:'Brasse', pap:'Papillon', '4n':'4 Nages'};

// ── Helpers temps ────────────────────────────────────────────────────

// "01:23.58" → 83580 ms   |  "43.64" → 43640 ms   |  "2:31.84" → 151840 ms
export function timeToMs(str){
  if(!str || typeof str!=='string') return null;
  const s = str.trim();
  // Format avec heures (rare) : h:mm:ss.cc
  // Format mm:ss.cc
  // Format ss.cc
  // Écart à club4 (corrigé) : son motif ^(?:(\d+):)?(?:(\d{1,2}):)? lisait « 01:23.58 » comme 1 h 0 min 23 s
  // (3 623 580 ms au lieu des 83 580 annoncés ci-dessus) ; les heures ne sont lues que si les minutes suivent.
  const m = s.match(/^(?:(?:(\d+):)?(\d{1,2}):)?(\d{1,2})\.(\d{1,3})$/);
  if(!m) return null;
  const h   = parseInt(m[1]||'0',10);
  const mn  = parseInt(m[2]||'0',10);
  const sec = parseInt(m[3],10);
  let cs    = m[4];
  // Normaliser en ms (si 2 chiffres → centièmes, si 3 chiffres → ms)
  const ms = cs.length===3 ? parseInt(cs,10) : parseInt(cs,10)*10;
  return ((h*3600 + mn*60 + sec)*1000) + ms;
}

/** @param {number|string} code @returns {string} « 100 Nage libre » (le code peut être texte : colonne event_code) */
export function shortEventLabel(code){
  const e = FFN_EVENTS[code];
  if(!e) return `Épreuve #${code}`;
  return `${e.d} ${STROKE_LABELS[e.s]}`;
}

/**
 * Identifiant de compétition depuis une URL liveffn ou un ID collé (règles de club4).
 * @param {string} raw
 * @returns {string|null}
 */
export function extractCompetitionId(raw){
  const s = String(raw ?? '').trim();
  if(!s) return null;
  const urlMatch = s.match(/competition=(\d+)/);
  if(urlMatch) return urlMatch[1];
  const numMatch = s.match(/\d+/);
  return numMatch ? numMatch[0] : null;
}

// ── Parser HTML liveffn ──────────────────────────────────────────────

export function parseLiveFFNHTML(html){
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Titre : <div class="titre">XXX - 50 m</div> ou "- 25 m"
  const titleEl = doc.querySelector('#header .titre') || doc.querySelector('.titre');
  let compName = titleEl ? titleEl.textContent.trim() : 'Compétition';
  // Extraire bassin
  let pool = null;
  const poolMatch = compName.match(/-\s*(25|50)\s*m\s*$/i);
  if(poolMatch){ pool = poolMatch[1]; compName = compName.replace(/-\s*(25|50)\s*m\s*$/i,'').trim(); }

  // Date : <div class="date">Du Vendredi 17 au Dimanche 19 Avril 2026</div>
  const dateEl = doc.querySelector('#header .date') || doc.querySelectorAll('.date')[0];
  let compDate = null;
  if(dateEl){
    const dtxt = dateEl.textContent.trim();
    // Chercher la 1re date : jour mois année
    const MOIS = {janvier:0,février:1,fevrier:1,mars:2,avril:3,mai:4,juin:5,juillet:6,août:7,aout:7,septembre:8,octobre:9,novembre:10,décembre:11,decembre:11};
    const m = dtxt.toLowerCase().match(/(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/);
    if(m){
      const jour = parseInt(m[1],10);
      const mois = MOIS[m[2]];
      const annee = parseInt(m[3],10);
      if(mois!=null){
        compDate = `${annee}-${String(mois+1).padStart(2,'0')}-${String(jour).padStart(2,'0')}`;
      }
    }
  }

  // Structure : <h2>NOM CLUB <div>Code de la structure : CODE ...</div></h2>
  const h2 = doc.querySelector('#right h2') || doc.querySelector('h2');
  let structName = h2 ? (h2.firstChild ? h2.firstChild.textContent.trim() : h2.textContent.trim()) : '';

  // Table des performances
  const table = doc.querySelector('#right table.tableau') || doc.querySelector('table.tableau');
  if(!table){
    return { competition:{name:compName, date:compDate, pool, structName}, swimmers:[] };
  }

  const swimmers = [];
  let currentSw = null;

  // Parcourir les <tr> : une ligne "resStructureIndividu*" = nouveau nageur, une "survol" = perf
  const rows = table.querySelectorAll('tr');
  rows.forEach(tr=>{
    // Nouveau nageur ? Cellule td avec class resStructureIndividu1 ou 2
    const nameCell = tr.querySelector('td.resStructureIndividu1, td.resStructureIndividu2');
    if(nameCell){
      // "NOM Prénom (2008) FRA"
      const txt = nameCell.textContent.trim();
      const m = txt.match(/^([A-ZÀ-ÖØ-öø-ÿ'\-\s]+?)\s+([A-ZÀ-ÖØ-öø-ÿ][a-zà-öø-ÿ'\-]+(?:\s+[A-ZÀ-ÖØ-öø-ÿ][a-zà-öø-ÿ'\-]+)*)\s+\((\d{4})\)/);
      if(m){
        currentSw = { lastname:m[1].trim(), firstname:m[2].trim(), birthYear:parseInt(m[3],10), performances:[] };
        swimmers.push(currentSw);
      } else {
        // Fallback plus permissif
        const m2 = txt.match(/^(.+?)\s+\((\d{4})\)/);
        if(m2){
          const parts = m2[1].trim().split(/\s+/);
          // Heuristique : 1er mot en MAJ = nom, reste = prénom
          let lastname = parts[0], firstname = parts.slice(1).join(' ');
          // Si plusieurs mots en MAJ au début (noms composés), les regrouper
          let i=1;
          while(i<parts.length && parts[i]===parts[i].toUpperCase() && /[A-Z]/.test(parts[i])){
            lastname += ' ' + parts[i]; i++;
          }
          firstname = parts.slice(i).join(' ') || parts[parts.length-1];
          currentSw = { lastname, firstname, birthYear:parseInt(m2[2],10), performances:[] };
          swimmers.push(currentSw);
        }
      }
      return;
    }

    // Ligne de perf ?
    if(!currentSw) return;
    if(!tr.classList.contains('survol')) return;

    const tds = tr.querySelectorAll('td');
    if(tds.length < 5) return;

    // td[0] = place (ex. "1er", "14e", "---")
    // td[1] = <a>Libellé épreuve</a> avec epreuve=CODE dans l'href
    // td[3] = temps (avec possibles splits dans <table class="split">) ou DSQ/DNS
    // td[4] = réaction
    // td[5] = points

    const rankTxt = tds[0].textContent.trim();
    let rank = null;
    const rM = rankTxt.match(/(\d+)/);
    if(rM) rank = parseInt(rM[1],10);

    const evA = tds[1].querySelector('a');
    if(!evA) return;
    const evLabel = evA.textContent.trim();
    const hrefM = (evA.href||'').match(/epreuve=(\d+)/);
    const evCode = hrefM ? parseInt(hrefM[1],10) : null;
    if(!evCode || !FFN_EVENTS[evCode]) return;

    // Phase : Séries / Finale A / Finale B etc
    let phase = 'series';
    if(/finale\s+a/i.test(evLabel)) phase = 'finale_a';
    else if(/finale\s+b/i.test(evLabel)) phase = 'finale_b';
    else if(/finale/i.test(evLabel)) phase = 'finale';
    else if(/demi/i.test(evLabel)) phase = 'demi';

    // Temps : td.temps (avec splits) ou td.temps_sans_tps_passage
    const tempsCell = tr.querySelector('td.temps, td.temps_sans_tps_passage');
    if(!tempsCell) return;

    // Extraire le temps principal et détecter DSQ/DNS
    let timeDisplay = '', timeMs = null, status = 'ok';
    const rawText = tempsCell.textContent.trim();
    if(/DSQ/i.test(rawText)){ status='dsq'; timeDisplay='DSQ'; }
    else if(/DNS/i.test(rawText)){ status='dns'; timeDisplay='DNS'; }
    else if(/DNF/i.test(rawText)){ status='dnf'; timeDisplay='DNF'; }
    else {
      // Extraire "01:23.58" ou "00:43.64" — le temps est en tête de la cellule
      const tM = rawText.match(/(\d{2}:\d{2}\.\d{2})|(\d{2}:\d{2}:\d{2}\.\d{2})|(\d{2}\.\d{2})/);
      if(tM){
        const raw = tM[0];
        // Si format MM:SS.cc, convertir
        timeDisplay = raw;
        timeMs = timeToMs(raw);
      }
    }

    // Splits (temps de passage) dans <table class="split">
    let splits = null;
    const splitTable = tempsCell.querySelector('table.split');
    if(splitTable){
      splits = [];
      splitTable.querySelectorAll('tr').forEach(stR=>{
        const stTds = stR.querySelectorAll('td');
        if(stTds.length>=3){
          const distTxt = stTds[0].textContent.trim();
          const splitTxt = stTds[1].textContent.trim();
          const lapTxt = stTds[2].textContent.trim();
          const dM = distTxt.match(/(\d+)/);
          if(dM){
            splits.push({
              dist: parseInt(dM[1],10),
              split_ms: timeToMs(splitTxt),
              split_display: splitTxt,
              lap_display: lapTxt
            });
          }
        }
      });
      if(splits.length===0) splits = null;
    }

    // Points — chercher dans toutes les cellules après la cellule temps
    // car selon le format de liveffn, la colonne points peut être à un index variable
    let points = null;
    for(let k = 4; k < tds.length; k++){
      const cellTxt = tds[k].textContent.trim();
      // Format "443 pts" ou "443pts" — au moins 2 chiffres pour éviter de capturer un rang
      const pM = cellTxt.match(/(\d{2,5})\s*pts?\b/i);
      if(pM){ points = parseInt(pM[1],10); break; }
    }
    // Fallback : chercher dans toute la ligne si pas trouvé
    if(points === null){
      const allTxt = tr.textContent;
      const pM2 = allTxt.match(/(\d{2,5})\s*pts?\b/i);
      if(pM2) points = parseInt(pM2[1],10);
    }

    currentSw.performances.push({
      event_code: evCode,
      event_label: evLabel,
      phase,
      time_display: timeDisplay,
      time_ms: timeMs,
      rank, points, status,
      splits
    });
  });

  return { competition:{name:compName, date:compDate, pool, structName}, swimmers };
}

// ── Matching avec les nageurs du groupe ──────────────────────────────

/**
 * @param {object[]} parsedSwimmers nageurs lus par parseLiveFFNHTML
 * @param {string|null} compDate 'AAAA-MM-JJ'
 * @param {object[]} swimmers nageurs de l'espace ouvert
 * @returns {{matched: {swimmer: object, parsed: object, perfs: object[]}[], unmatched: object[], ignoredArchived: object[]}}
 */
export function matchSwimmersToDB(parsedSwimmers, compDate, swimmers){
  const compSeason = compDate ? seasonOfDateKey(compDate) : currentSeason();
  // Index des nageurs DB par clé normalisée — éligibles d'abord, pour qu'un homonyme archivé
  // ne prenne jamais la place d'un nageur actif.
  const byKey = new Map();
  const archivedByKey = new Map();
  swimmers.forEach(sw=>{
    const key = normalizeName(sw.lastname) + '|' + normalizeName(sw.firstname);
    (swimmerEligibleForComp(sw, compSeason) ? byKey : archivedByKey).set(key, sw);
  });

  const matched = []; // [{sw, parsedData, perfs}]
  const unmatched = [];
  const ignoredArchived = [];
  parsedSwimmers.forEach(p=>{
    const k1 = normalizeName(p.lastname) + '|' + normalizeName(p.firstname);
    const k2 = normalizeName(p.firstname) + '|' + normalizeName(p.lastname);
    // Tenter aussi en inversant (si "Prénom Nom" a été mal détecté)
    const sw = byKey.get(k1) || byKey.get(k2);
    if(sw){
      matched.push({ swimmer:sw, parsed:p, perfs:p.performances });
    } else if(archivedByKey.has(k1) || archivedByKey.has(k2)){
      ignoredArchived.push(archivedByKey.get(k1) || archivedByKey.get(k2));
    } else {
      unmatched.push(p);
    }
  });
  return { matched, unmatched, ignoredArchived };
}
