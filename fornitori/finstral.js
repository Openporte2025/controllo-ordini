/**
 *  O.P.E.R.A. — Finstral Checker v1.1
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

  // Codice telaio: normalizza rimuovendo suffisso numerico SOLO dopo lettera
  // 965N5 → 965N  |  965 → 965  |  Top72 → Top72
  function normTelaio(s) {
    if (!s) return '';
    const code = s.split(/[\s-]/)[0];
    // Rimuove digit finale solo se c'è una lettera prima (es. 965N5 → 965N)
    return code.replace(/([A-Za-z])\d$/, '$1');
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
    'step-line': '974',
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
  //
  // Formato A (con ambiente): "Pos  AMBIENTE  101 finestra  N  BRM-L  BRM-H"
  //   es. "1 CUCINA 101 finestra 1 790 2125"
  //
  // Formato B (senza ambiente): "Pos  Pos.cl.  Tipo  Pezzi  BRM-L  BRM-H"
  //   es. "1  1  101 finestra  1  1025  1260"
  //
  // Codici tipo:
  //   101 = finestra anta singola  → F
  //   201 = finestra a 2 ante      → F
  //   401 = finestra a 2 ante      → F
  //   601 = porta finestra         → PF
  //   altri con "porta"            → PF

  function parsePDF(testo) {
    const elementi = [];

    const ambienti = 'CUCINA|SOGGIORNO|CAMERA|CAMERETTA|BAGNO\\d?|BAGNO|INGRESSO|STUDIO|SALA|CORRIDOIO|GARAGE|CANTINA|TAVERNA|TINELLO|PRANZO|NOTTE';

    // Pattern A: ha nome ambiente
    const rePosA = new RegExp(
      `\\b(\\d+)\\s+(${ambienti})\\s+(\\d{3}\\s+(?:finestra|portafinestra|porta))\\s+(\\d+)\\s+(\\d{3,4})\\s+(\\d{3,4})`,
      'gi'
    );

    // Pattern B: ha numero pos. cliente (due numeri prima del tipo)
    // "1  1  101 finestra  1  1025  1260"
    const rePosB = /\b(\d+)\s+(\d+)\s+(\d{3}\s+(?:finestra|portafinestra|porta))\s+(\d+)\s+(\d{3,4})\s+(\d{3,4})/gi;

    // Provo prima formato A, poi B se non trova nulla
    let allMatches = [];

    let m;
    while ((m = rePosA.exec(testo)) !== null) {
      allMatches.push({
        index:    m.index,
        posNum:   parseInt(m[1]),
        ambiente: m[2].trim(),
        tipoStr:  m[3].trim().toLowerCase(),
        pezzi:    parseInt(m[4]),
        brmL:     parseInt(m[5]),
        brmH:     parseInt(m[6]),
      });
    }

    if (allMatches.length === 0) {
      // Formato B: usa numero posizione cliente come ambiente
      while ((m = rePosB.exec(testo)) !== null) {
        allMatches.push({
          index:    m.index,
          posNum:   parseInt(m[1]),
          ambiente: `Pos. ${m[2]}`,   // es. "Pos. 1"
          tipoStr:  m[3].trim().toLowerCase(),
          pezzi:    parseInt(m[4]),
          brmL:     parseInt(m[5]),
          brmH:     parseInt(m[6]),
        });
      }
    }

    for (let mi = 0; mi < allMatches.length; mi++) {
      const { posNum, ambiente, tipoStr, pezzi, brmL, brmH, index } = allMatches[mi];

      // Tipo: porta/portafinestra → PF, altrimenti F
      // Anche codice 6xx → PF
      const codTipo = parseInt(tipoStr.split(/\s/)[0]);
      const tipo = (tipoStr.includes('porta') || codTipo >= 600) ? 'PF' : 'F';

      // Numero ante (101=1, 201/401=2, ecc.) — informativo
      const nAnte = codTipo >= 400 ? 2 : codTipo >= 200 ? 2 : 1;

      // Chunk limitato al prossimo match
      const chunkStart = index;
      const chunkEnd   = mi + 1 < allMatches.length
        ? allMatches[mi + 1].index
        : testo.length;
      const chunk = testo.slice(chunkStart, chunkEnd);

      // Lato apertura (Din 1 / Din 2) — prendo l'ultimo nel chunk (anta principale)
      let lato = '';
      const reLato = /Din\s*([12])/gi;
      let mLato;
      while ((mLato = reLato.exec(chunk)) !== null) lato = 'Din ' + mLato[1];

      // Telaio (965, 965N, Top72, ecc.) — cerco il codice numerico nella sezione "Dati telaio"
      let telaio = '';
      const mTelaio = /\b(965N?|Top\s*72|Top\s*80|Finstral\s*74)\b/i.exec(chunk);
      if (mTelaio) telaio = mTelaio[1].replace(/\s+/, '');
      else {
        // fallback: cerca codice numerico telaio "965 telaio"
        const mT2 = /\b(9\d{2})\s+telaio/i.exec(chunk);
        if (mT2) telaio = mT2[1];
      }

      // Tipo anta
      let anta = '';
      const mAnta = /(970K|971K|972K|974)\b/i.exec(chunk);
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

      // Colore interno — può essere numerico (45) o codice (L14)
      // Prendo l'ultimo match nel chunk (come per colore esterno)
      let colInt = '';
      const reColInt = /Col\.\s*int\.\s+(L?\d+)/gi;
      let mColInt;
      while ((mColInt = reColInt.exec(chunk)) !== null) {
        colInt = mColInt[1];
      }

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
      colInt:     'Colore int.',
      colEst:     'Colore est.',
      soglia:     'Soglia',
    },
  };

})();
