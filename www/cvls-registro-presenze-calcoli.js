(function () {
  "use strict";

  function parseDate(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    try {
      const date = new Date(value);

      if (isNaN(date.getTime())) {
        return null;
      }

      return new Date(date.getTime());
    } catch (error) {
      return null;
    }
  }

  function arrotondaIngresso(value) {
    const d = parseDate(value);
    if (!d) return null;

    const result = new Date(d.getTime());
    result.setSeconds(0, 0);

    const m = result.getMinutes();
    if (m >= 0 && m <= 4) {
      result.setMinutes(0);
    } else if (m >= 5 && m <= 34) {
      result.setMinutes(30);
    } else {
      result.setMinutes(0);
      result.setHours(result.getHours() + 1);
    }

    return result;
  }

  function arrotondaUscita(value) {
    const d = parseDate(value);
    if (!d) return null;

    const result = new Date(d.getTime());
    result.setSeconds(0, 0);

    const m = result.getMinutes();
    if (m >= 0 && m <= 25) {
      result.setMinutes(0);
    } else if (m >= 26 && m <= 55) {
      result.setMinutes(30);
    } else {
      result.setMinutes(0);
      result.setHours(result.getHours() + 1);
    }

    return result;
  }

  function getOrarioRiconosciuto(value, tipo) {
    if (tipo === "ingresso") {
      return arrotondaIngresso(value);
    }

    if (tipo === "uscita") {
      return arrotondaUscita(value);
    }

    return null;
  }

  function calcolaGiornata(options) {
    if (!options) return null;
    const ingresso = arrotondaIngresso(options.ingresso);
    const uscita = arrotondaUscita(options.uscita);

    if (!ingresso || !uscita) return null;

    const pausa = Math.max(0, parseInt(options.pausaMinuti) || 0);
    const viaggio = Math.max(0, parseInt(options.oreViaggioMinuti) || 0);

    const diffMs = uscita.getTime() - ingresso.getTime();
    const lordo = Math.max(0, Math.round(diffMs / 60000));

    const netto = Math.max(0, lordo - pausa);
    const esubero = Math.max(0, netto - 480);
    const viaggioValido = Math.min(viaggio, esubero);
    const straordinario = Math.max(0, esubero - viaggioValido);

    return {
      ingressoRiconosciuto: ingresso,
      uscitaRiconosciuta: uscita,
      totaleLordoMinuti: lordo,
      pausaMinuti: pausa,
      totaleNettoMinuti: netto,
      esuberoMinuti: esubero,
      oreViaggioMinuti: viaggioValido,
      straordinarioMinuti: straordinario
    };
  }

  window.CvlsRegistroPresenzeCalcoli = {
    parseDate: parseDate,
    arrotondaIngresso: arrotondaIngresso,
    arrotondaUscita: arrotondaUscita,
    getOrarioRiconosciuto: getOrarioRiconosciuto,
    calcolaGiornata: calcolaGiornata
  };
})();
