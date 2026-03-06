/**
 * O.P.E.R.A. — Checker Core v1.0
 * Logica di confronto comune a tutti i fornitori.
 * Non contiene nulla di specifico per Finstral, Palagina, ecc.
 */

const OPERA_CHECKER = (() => {

  // ── Mappature JSON rilievo ──────────────────────────────────────────────────

  const LATO_MAP = {
    '-1': 'Din 1', '-2': 'Din 2',
     '1': 'Din 1',  '2': 'Din 2',
  };

  // ── Parse JSON progetto ─────────────────────────────────────────────────────

  function parseProgetto(data) {
    const positions = data.positions || [];
    return positions.map((p, idx) => {
      const inf = p.infisso || {};
      const tipoApertura = p.tipoApertura || inf.tipoInfissoAssociato || '';

      // Colori: "L14 - Mogano verniciato" → "L14"
      const coloreEst = (inf.coloreEst || '').split(' - ')[0].trim();
      const coloreInt = (inf.coloreInt || '').split(' - ')[0].trim();

      // Maniglia: "712 - A PRESSIONE" → "712"
      const maniglia = (inf.maniglia || '').split(' - ')[0].trim();

      return {
        posNum:        idx + 1,
        nome:          p.name || `Pos. ${idx + 1}`,
        ambiente:      (p.ambiente || '').trim(),
        tipo:          tipoApertura,           // 'F', 'PF', 'SC', ecc.
        quantita:      parseInt(p.quantita || 1),
        brmL:          parseInt(inf.BRM_L || 0),
        brmH:          parseInt(inf.BRM_H || 0),
        lato:          normLato(inf.lato1),    // 'Din 1' / 'Din 2'
        telaio:        inf.telaio || '',
        tipoAnta:      inf.tipoAnta || '',
        vetro:         inf.vetro || '',
        ferramenta:    inf.ferramenta1 || '',
        coloreEst,
        coloreInt,
        maniglia,
        coloreManiglia: inf.coloreManiglia || '',
        tagli:         inf.codTagliValues || [],
        codModello:    inf.codiceModello || '',
        // Numero ante dal codice modello: 1xx = 1 anta, 2xx/4xx = 2 ante, 3xx/6xx = PF
        nAnte:         calcNAnte(inf.codiceModello),
        // PF = porta finestra → ha soglia sotto, 3 lati telaio (dx/alto/sx)
        // F  = finestra       → telaio circolare 4 lati uguali
        isPF:          tipoApertura === 'PF',
        hasDati:       !!(parseInt(inf.BRM_L) && parseInt(inf.BRM_H)),
      };
    });
  }

  function normLato(s) {
    return LATO_MAP[String(s)] || s || '';
  }

  // Calcola numero ante dal codice modello Finstral
  // 1xx = 1 anta, 2xx/4xx = 2 ante, 3xx = 3 ante, 6xx = PF 1 anta, ecc.
  function calcNAnte(codice) {
    const n = parseInt(codice);
    if (!n) return null;
    const centinaia = Math.floor(n / 100);
    if (centinaia === 1 || centinaia === 6) return 1;
    if (centinaia === 2 || centinaia === 4) return 2;
    if (centinaia === 3) return 3;
    return null;
  }

  // ── Confronto generico ──────────────────────────────────────────────────────
  // Ogni fornitore chiama questa funzione passando i propri dati già normalizzati
  // sotto forma di oggetto { brmL, brmH, tipo, lato, telaio, anta, vetro,
  //                          ferr, colEst, colInt, hasSoglia, ... }

  function confronta(jsonPos, pdfEl) {
    const anomalie = [];
    const dettagli = {};

    function check(campo, vJ, vP, sev = 'err', tolleranza = 0) {
      dettagli[campo] = { json: vJ, pdf: vP };
      if (!vJ || !vP) return; // uno dei due mancante → non segnala
      const uguali = tolleranza > 0
        ? Math.abs(Number(vJ) - Number(vP)) <= tolleranza
        : String(vJ).trim() === String(vP).trim();
      if (!uguali) {
        const diff = tolleranza > 0
          ? `${Number(vJ) - Number(vP) > 0 ? '+' : ''}${Number(vJ) - Number(vP)}mm`
          : null;
        anomalie.push({ campo, json: vJ, pdf: vP, diff, sev });
      }
    }

    // Misure (tolleranza ±2mm)
    check('BRM-L',      jsonPos.brmL,       pdfEl.brmL,    'err', 2);
    check('BRM-H',      jsonPos.brmH,       pdfEl.brmH,    'err', 2);

    // Numero ante (dal codice modello JSON vs nAnte PDF)
    if (jsonPos.nAnte && pdfEl.nAnte) {
      dettagli['N. Ante'] = { json: jsonPos.nAnte, pdf: pdfEl.nAnte };
      if (jsonPos.nAnte !== pdfEl.nAnte) {
        anomalie.push({ campo: 'N. Ante', json: jsonPos.nAnte, pdf: pdfEl.nAnte, sev: 'err' });
      }
    }

    // Tagli telaio
    const tagliJ = (jsonPos.tagli || []).map(t => String(t)).sort().join(', ');
    const tagliP = (pdfEl.tagli || []).map(t => String(t)).sort().join(', ');
    dettagli['Tagli'] = { json: tagliJ || '—', pdf: tagliP || '—' };
    if (tagliJ && tagliP && tagliJ !== tagliP) {
      anomalie.push({ campo: 'Tagli telaio', json: tagliJ, pdf: tagliP, sev: 'warn' });
    }

    // Tipo apertura
    check('Tipo',       jsonPos.tipo,        pdfEl.tipo,    'err');

    // Lato — solo se JSON lo ha salvato
    if (jsonPos.lato && pdfEl.lato) {
      check('Lato', jsonPos.lato, pdfEl.lato, 'err');
    } else if (!jsonPos.lato && pdfEl.lato) {
      anomalie.push({ campo: 'Lato', json: '(non salvato)', pdf: pdfEl.lato, sev: 'warn' });
      dettagli['Lato'] = { json: '—', pdf: pdfEl.lato };
    }

    // Telaio
    check('Telaio',     jsonPos.telaio_norm, pdfEl.telaio,  'err');

    // Tipo anta
    check('Anta',       jsonPos.anta_norm,   pdfEl.anta,    'warn');

    // Vetro
    check('Vetro',      jsonPos.vetro_norm,  pdfEl.vetro,   'err');

    // Ferramenta
    check('Ferramenta', jsonPos.ferr_norm,   pdfEl.ferr,    'warn');

    // Colore esterno
    check('Colore int.', jsonPos.coloreInt,  pdfEl.colInt,  'warn');
    check('Colore est.', jsonPos.coloreEst,  pdfEl.colEst,  'err');

    // Soglia (solo PF)
    // PF = porta finestra: soglia 377K sotto, telaio su 3 lati (non circolare)
    if (jsonPos.isPF) {
      dettagli['Soglia'] = { json: '377K (attesa)', pdf: pdfEl.hasSoglia ? '377K ✓' : '— non trovata' };
      if (!pdfEl.hasSoglia) {
        anomalie.push({ campo: 'Soglia 377K', json: 'attesa', pdf: 'non trovata', sev: 'warn' });
      }
    }

    // Tipo telaio (circolare per F, 3 lati per PF)
    // Solo informativo — non genera anomalia automatica ma registra
    dettagli['Config telaio'] = {
      json: jsonPos.isPF ? '3 lati + soglia' : 'circolare 4 lati',
      pdf:  pdfEl.configTelaio || '—'
    };

    const esito = anomalie.length === 0 ? 'ok'
      : anomalie.some(a => a.sev === 'err') ? 'err' : 'warn';

    return { anomalie, dettagli, esito };
  }

  // ── Abbinamento JSON ↔ PDF ─────────────────────────────────────────────────
  // Abbina le posizioni JSON agli elementi PDF per ambiente + tipo

  function abbina(posizioniJSON, elementiPDF) {
    const risultati = [];
    const pdfUsati = new Set();

    // Rileva se il PDF usa "Pos. N" come ambiente (formato senza nomi stanza)
    const pdfUsaNumPos = elementiPDF.length > 0 &&
      elementiPDF.every(el => /^Pos\.\s*\d+$/i.test(el.ambiente));

    for (const pos of posizioniJSON) {
      if (!pos.hasDati) {
        risultati.push({ json: pos, pdf: null, match: 'missing', result: null });
        continue;
      }

      let best = null, bestIdx = -1;

      if (pdfUsaNumPos) {
        // Abbinamento per numero posizione
        const idx = elementiPDF.findIndex((el, i) =>
          !pdfUsati.has(i) && el.posNum === pos.posNum
        );
        if (idx >= 0) { best = elementiPDF[idx]; bestIdx = idx; }
      }

      if (!best) {
        // Abbinamento per nome ambiente
        const ambNorm = normAmbiente(pos.ambiente);
        const candidati = elementiPDF.filter((el, i) => {
          if (pdfUsati.has(i)) return false;
          const aN = normAmbiente(el.ambiente);
          return aN === ambNorm || aN.startsWith(ambNorm) || ambNorm.startsWith(aN);
        });

        if (candidati.length === 1) {
          best = candidati[0];
          bestIdx = elementiPDF.indexOf(best);
        } else if (candidati.length > 1) {
          const sameTipo = candidati.filter(c => c.tipo === pos.tipo);
          const pool = sameTipo.length > 0 ? sameTipo : candidati;
          pool.sort((a, b) => {
            const da = Math.abs(a.brmL - pos.brmL) + Math.abs(a.brmH - pos.brmH);
            const db = Math.abs(b.brmL - pos.brmL) + Math.abs(b.brmH - pos.brmH);
            return da - db;
          });
          best = pool[0];
          bestIdx = elementiPDF.indexOf(best);
        }
      }

      if (best) {
        pdfUsati.add(bestIdx);
        const result = confronta(pos, best);
        risultati.push({ json: pos, pdf: best, match: 'found', result });
      } else {
        risultati.push({ json: pos, pdf: null, match: 'notfound', result: null });
      }
    }

    const pdfExtra = elementiPDF.filter((_, i) => !pdfUsati.has(i));
    return { risultati, pdfExtra };
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  function normAmbiente(s) {
    return (s || '').toUpperCase().replace(/\d+$/, '').trim();
  }

  // ── API pubblica ─────────────────────────────────────────────────────────────

  return {
    parseProgetto,
    confronta,
    abbina,
    normLato,
    normAmbiente,
  };

})();
