/**
 * O.P.E.R.A. — Finstral Checker v1.1
 * Parser PDF e mappature specifiche per conferme d'ordine Finstral.
 *
 * Formato PDF Finstral:
 *   Pos  Pos.cl.   Tipo          Pezzi  BRM-L  BRM-A  Peso kg  Nr.ident.     Prezzo base
 *    1   CUCINA    101 porta       1     790    2125    80,15   100365045/001   724,17
 *
 * Telaio PF (porta-finestra):
 *   - 377K soglia (lato BASSO) — non è un lato telaio uguale agli altri
 *   - 965N lato destra
 *   - 965N lato alto
 *   - 965N lato sinistra
 *   → 3 lati telaio + 1 soglia = configurazione corretta
 *
 * Telaio F (finestra):
 *   - 965N circol. = circolare, 4 lati uguali
 */

const FINSTRAL_CHECKER = (() => {

  // ── Mappature Finstral → valori normalizzati ────────────────────────────────

  // Codice telaio: rimuove suffisso numerico (965N5 → 965N)
  function normTelaio(s) {
    if (!s) return '';
    const code = s.split(/[\s-]/)[0].replace(/\d$/, '');
    return code; // es. "965N", "Top72", "Top80"
  }

  // Vetro JSON → codice Finstral
  const VETRO_MAP = {
    'triplo sicurezza maggiorata p2a': '11414',
    'triplo sicurezza p2a':            '11414',
    'triplo':                          '11414',
    'doppio':                          '11413',
  };
  function normVetroJSON(s) {
    if (!s) return '';
    const k = s.toLowerCase();
    for (const [pattern, code] of Object.entries(VETRO_MAP)) {
      if (k.includes(pattern)) return code;
    }
    return s;
  }

  // Tipo anta JSON → codice Finstral
  const ANTA_MAP = {
    'slim-line': '970K',
    'standard':  '971K',
  };
  function normAntaJSON(s) {
    return ANTA_MAP[(s || '').toLowerCase()] || s || '';
  }

  // Ferramenta JSON → formato Finstral
  function normFerrJSON(s) {
    if (!s) return '';
    return s.includes('.') ? s : s + '.0';
  }

  // ── Prepara posizioni JSON con valori normalizzati Finstral ─────────────────

  function preparaPosizioniJSON(posizioniJSON) {
    return posizioniJSON.map(pos => ({
      ...pos,
      telaio_norm: normTelaio(pos.telaio),
      anta_norm:   normAntaJSON(pos.tipoAnta),
      vetro_norm:  normVetroJSON(pos.vetro),
      ferr_norm:   normFerrJSON(pos.ferramenta),
    }));
  }

  // ── Parser PDF Finstral ─────────────────────────────────────────────────────

  function parsePDF(testo) {
    const elementi = [];

    // Pattern principale: trova ogni posizione
    // Formato: N  AMBIENTE  101 (finestra|porta|portafinestra)  N  NNNNN  NNNNN
    const rePos = /\b(\d+)\s+(CUCINA|SOGGIORNO|CAMERA|CAMERETTA|BAGNO\d?|BAGNO|INGRESSO|STUDIO|SALA|CORRIDOIO|GARAGE|CANTINA|TAVERNA|TINELLO|PRANZO|NOTTE)\s+(101\s+(?:finestra|porta(?:finestra)?))\s+(\d+)\s+(\d{3,4})\s+(\d{3,4})/gi;

    // Raccolgo prima tutti i match con le loro posizioni
    const allMatches = [];
    let m;
    while ((m = rePos.exec(testo)) !== null) {
      allMatches.push({ m, index: m.index });
    }

    for (let mi = 0; mi < allMatches.length; mi++) {
      m = allMatches[mi].m;

      const posNum  = parseInt(m[1]);
      const ambiente = m[2].trim();
      const tipoStr  = m[3].trim().toLowerCase();
      const pezzi    = parseInt(m[4]);
      const brmL     = parseInt(m[5]);
      const brmH     = parseInt(m[6]);

      // F = finestra (telaio circolare), PF = porta (3 lati + soglia sotto)
      const tipo = tipoStr.includes('porta') ? 'PF' : 'F';

      // Chunk limitato esattamente al prossimo match della stessa regex
      // → evita che i dati della posizione successiva inquinino quella corrente
      const chunkStart = allMatches[mi].index;
      const chunkEnd   = mi + 1 < allMatches.length
        ? allMatches[mi + 1].index
        : testo.length;
      const chunk = testo.slice(chunkStart, chunkEnd);

      // Lato apertura (Din 1 / Din 2)
      let lato = '';
      const mLato = /Din\s*([12])/i.exec(chunk);
      if (mLato) lato = 'Din ' + mLato[1];

      // Telaio (965N, Top72, ecc.)
      let telaio = '';
      const mTelaio = /(965N|Top\s*72|Top\s*80|Finstral\s*74)/i.exec(chunk);
      if (mTelaio) telaio = mTelaio[1].replace(/\s+/, '');

      // Tipo anta
      let anta = '';
      const mAnta = /(970K|971K|972K)/i.exec(chunk);
      if (mAnta) anta = mAnta[1].toUpperCase();

      // Vetro (codice numerico Finstral)
      let vetro = '';
      const mVetro = /(1141\d)/i.exec(chunk);
      if (mVetro) vetro = mVetro[1];

      // Ferramenta
      let ferr = '';
      const mFerr = /(4[01]\d\.\d)/i.exec(chunk);
      if (mFerr) ferr = mFerr[1];

      // Colore esterno — cerco TUTTI i "Col. est. LXX" nel chunk
      // poi prendo l'ultimo trovato (è quello del battente, il più rilevante)
      // NOTA: chunk è già limitato alla posizione corrente, quindi L13/L14
      // non si confondono tra posizioni diverse
      let colEst = '';
      const reCol = /Col\.\s*est\.\s+(L\d+)/gi;
      let mCol;
      while ((mCol = reCol.exec(chunk)) !== null) {
        colEst = mCol[1];
      }

      // Colore interno
      let colInt = '';
      const reColInt = /Col\.\s*int\.\s+([\d]+)/gi;
      const mColInt = reColInt.exec(chunk);
      if (mColInt) colInt = mColInt[1];

      // Soglia 377K — presente solo nelle PF, sul lato BASSO
      // La finestra (F) ha telaio circolare, NON ha soglia
      const hasSoglia = /377K/.test(chunk);

      // Config telaio (descrittiva)
      const configTelaio = tipo === 'PF'
        ? '3 lati (dx/alto/sx) + soglia 377K basso'
        : 'circolare 4 lati';

      elementi.push({
        posNum, ambiente, tipo, pezzi,
        brmL, brmH,
        lato, telaio, anta, vetro, ferr,
        colEst, colInt,
        hasSoglia, configTelaio,
      });
    }

    return elementi;
  }

  // ── Metadati ordine (header PDF) ────────────────────────────────────────────

  function parseMetadati(testo) {
    const meta = {};

    const mRif   = /Rif\.\s+([A-Z\s]+?)(?=\s+nr\.|Data|Sett\.|$)/i.exec(testo);
    const mData  = /(\d{2}\.\d{2}\.\d{4})\s*Conferma/i.exec(testo);
    const mOrd   = /Ordine:\s*([^\s]+\s+[^\s]+)/i.exec(testo);
    const mSett  = /Sett\.prevista:\s*(\S+)/i.exec(testo);
    const mPag   = /Cond\.pagamento:\s*([^\n]+)/i.exec(testo);
    const mCompo = /nr\.\s+ordine\s+Composer\s+(\d+)/i.exec(testo);

    if (mRif)   meta.riferimento   = mRif[1].trim();
    if (mData)  meta.data          = mData[1];
    if (mOrd)   meta.ordine        = mOrd[1].trim();
    if (mSett)  meta.settimana     = mSett[1];
    if (mPag)   meta.pagamento     = mPag[1].trim();
    if (mCompo) meta.nrComposer    = mCompo[1];

    // Totale ordine
    const mTot = /Prezzo\s+tot\.ordine\s+([\d.,]+)/i.exec(testo);
    if (mTot) meta.totaleOrdine = mTot[1].replace('.', '').replace(',', '.');

    return meta;
  }

  // ── API pubblica ─────────────────────────────────────────────────────────────

  return {
    nome: 'Finstral',
    parsePDF,
    parseMetadati,
    preparaPosizioniJSON,
    // Etichette colonne per la UI
    colonne: {
      telaio:     'Telaio',
      anta:       'Tipo anta',
      vetro:      'Vetro',
      ferr:       'Ferramenta',
      colEst:     'Colore est.',
      soglia:     'Soglia',
    },
  };

})();
