// Pablete ESPN ☕ — data source settings. The league sheet (tab HISTORIAL) is published
// as CSV; the page fetches it on every load. Team names in the sheet are matched to
// config/league.json by name; aliases cover the names that differ.

export const PABLETE = {
  csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTFzr6YHqhxPpu1wdMzoCor3CruujPE11g0eIx-FC4rER0oqtAIGdiDOT9x3Zt7H-RtGBj-P6kmjb0g/pub?gid=449176894&single=true&output=csv",
  fetchTimeoutMs: 15000,

  // Last good CSV kept in the viewer's browser, used when the sheet can't be reached.
  cacheKey: "pablete_csv_v1",
  // A CSV must have at least this many valid rows to be shown or cached.
  minValidRows: 8,

  // Sheet name -> team id in config/league.json (only names that differ from league.json).
  teamAliases: {
    "Georgehood Team": "jorge",
  },

  // Column headers in the sheet (matched ignoring case, accents and extra spaces).
  columns: {
    date: "FECHA",
    team: "EQUIPO",
    points: "PUNTOS TOTALES",
    spaces: "ESPACIOS USADOS",
    outs: "OUTS",
  },
};
