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

  window.CvlsRegistroPresenzeCalcoli = {
    parseDate: parseDate,
    arrotondaIngresso: arrotondaIngresso,
    arrotondaUscita: arrotondaUscita,
    getOrarioRiconosciuto: getOrarioRiconosciuto
  };
})();
