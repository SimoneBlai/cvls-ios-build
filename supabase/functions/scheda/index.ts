const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const SUPA_URL = Deno.env.get("SUPABASE_URL");
  const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDate(v) {
    if (!v) return "";
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + "/" + m[2] + "/" + m[1];
    return s;
  }

  function normCode(v) {
    const digits = String(v || "").replace(/\D/g, "");
    return digits.padStart(11, "0").slice(-11);
  }

  async function dbGet(table, qs) {
    const res = await fetch(SUPA_URL + "/rest/v1/" + table + "?" + qs, {
      headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY }
    });
    return res.json();
  }

  const params = new URL(req.url).searchParams;
  const codice = normCode(params.get("device") || params.get("codice") || "");

  if (!codice || codice === "00000000000") {
    return new Response(
      "<!DOCTYPE html><html><body><h2>Codice dispositivo mancante</h2></body></html>",
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/html; charset=UTF-8"
        }
      }
    );
  }

  const dispositivi = await dbGet("dispositivi", "codice_completo=eq." + encodeURIComponent(codice));

  if (!Array.isArray(dispositivi) || dispositivi.length === 0) {
    return new Response(
      `<!DOCTYPE html><html><body><h2>Dispositivo non trovato: ${esc(codice)}</h2></body></html>`,
      {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/html; charset=UTF-8"
        }
      }
    );
  }

  const d = dispositivi[0];
  const dt = (d.dati_tecnici && typeof d.dati_tecnici === "object") ? d.dati_tecnici : {};
  const nome = d.nome || ("Codice: " + codice);

  let interventi = [];
  try {
    const r = await dbGet("manutenzioni", "codice_completo=eq." + encodeURIComponent(codice) + "&order=data.desc");
    if (Array.isArray(r)) interventi = r;
  } catch (_) { /* ignora storico */ }

  const campi = [
    ["Nome dispositivo", d.nome],
    ["Tipo", d.tipo_dispositivo],
    ["Presidio", d.nome_presidio],
    ["Ubicazione", d.nome_ubicazione],
    ["Città", d.nome_citta],
    ["Marca", dt.marca || dt.Marca],
    ["Modello", dt.modello || dt.Modello],
    ["Matricola", dt.matricola || dt.Matricola],
    ["Anno", dt.anno || dt.Anno],
    ["Alimentazione", dt.alimentazione || dt.Alimentazione],
    ["Note", dt.note || dt.Note],
  ].filter(function (c) { return c[1] != null && c[1] !== ""; });

  let specsHtml = "";
  for (let i = 0; i < campi.length; i++) {
    const bt = i === 0 ? "none" : "1px solid #e5e5ea";
    const pt = i === 0 ? "0 0 14px" : "14px 0";
    specsHtml += '<div style="border-top:' + bt + ';padding:' + pt + '">'
      + '<div style="font-size:11px;font-weight:700;color:#8e8e93;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">' + esc(campi[i][0]) + '</div>'
      + '<div style="font-size:17px;font-weight:600;color:#1d1d1f">' + esc(String(campi[i][1])) + '</div>'
      + '</div>';
  }
  if (!specsHtml) specsHtml = '<p style="color:#8e8e93">Nessuna caratteristica registrata.</p>';

  let rowsHtml = "";
  for (let i = 0; i < interventi.length; i++) {
    const r = interventi[i];
    rowsHtml += '<tr>'
      + '<td style="padding:12px 14px;border-bottom:1px solid #ececf0;color:#1d1d1f">' + esc(fmtDate(r.data)) + '</td>'
      + '<td style="padding:12px 14px;border-bottom:1px solid #ececf0;color:#1d1d1f">' + esc(r.descrizione || "") + '</td>'
      + '<td style="padding:12px 14px;border-bottom:1px solid #ececf0;color:#1d1d1f">' + esc(String(r.ore || "")) + '</td>'
      + '<td style="padding:12px 14px;border-bottom:1px solid #ececf0;color:#1d1d1f">' + esc(r.tecnico || "") + '</td>'
      + '</tr>';
  }

  const storicoHtml = rowsHtml
    ? '<div style="overflow-x:auto;border-radius:16px;border:1px solid #e5e5ea;background:#fbfbfd">'
    + '<table style="width:100%;border-collapse:collapse;font-size:14px;min-width:400px">'
    + '<thead><tr style="background:#f5f5f7;border-bottom:1px solid #e5e5ea">'
    + '<th style="text-align:left;padding:11px 14px;font-size:11px;font-weight:700;text-transform:uppercase;color:#6e6e73">Data</th>'
    + '<th style="text-align:left;padding:11px 14px;font-size:11px;font-weight:700;text-transform:uppercase;color:#6e6e73">Descrizione</th>'
    + '<th style="text-align:left;padding:11px 14px;font-size:11px;font-weight:700;text-transform:uppercase;color:#6e6e73">Ore</th>'
    + '<th style="text-align:left;padding:11px 14px;font-size:11px;font-weight:700;text-transform:uppercase;color:#6e6e73">Tecnico</th>'
    + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
    : '<p style="color:#8e8e93;font-size:15px">Nessun intervento registrato.</p>';

  const deepLink = "cvls://device/" + encodeURIComponent(codice);

  const css = [
    "*{box-sizing:border-box;margin:0;padding:0}",
    "body{background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:24px 16px 48px}",
    ".c{max-width:680px;margin:0 auto}",
    ".card{background:rgba(255,255,255,.9);backdrop-filter:blur(20px);border-radius:28px;padding:28px 24px;margin-bottom:18px;box-shadow:0 6px 28px rgba(0,0,0,.07);border:1px solid rgba(255,255,255,.85)}",
    ".btn{display:block;margin-top:22px;padding:15px 20px;border-radius:999px;background:linear-gradient(180deg,#0a84ff,#0071e3);color:#fff;text-align:center;font-size:17px;font-weight:700;cursor:pointer;border:none;width:100%;text-decoration:none;box-shadow:0 8px 22px rgba(0,113,227,.28)}",
    ".st{font-size:20px;font-weight:700;margin-bottom:18px;color:#1d1d1f}",
    ".ft{text-align:center;font-size:13px;color:#8e8e93;line-height:1.7;margin-top:8px}"
  ].join("");

  const logoUrl = "https://pucnnjirnyjihofbkllp.supabase.co/storage/v1/object/public/allegati/logo_cavaletto.png";

  const html = '<!DOCTYPE html><html lang="it"><head>'
    + '<meta charset="utf-8">'
    + '<title>CVLS - Scheda manutenzione</title>'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">'
    + '<style>' + css + '</style>'
    + '</head><body>'
    + '<div class="c">'
    + '<div class="card" style="text-align:center;padding-top:32px;padding-bottom:28px">'
    + '<img src="' + logoUrl + '" style="max-width:220px;width:100%;height:auto;margin-bottom:18px" alt="Cavaletto Sanita" />'
    + '<div style="font-size:28px;font-weight:700;letter-spacing:-.02em;color:#1d1d1f">Scheda manutenzione</div>'
    + '<div style="font-size:17px;color:#6e6e73;font-weight:500;margin-top:6px">' + esc(nome) + '</div>'
    + '<a class="btn" href="' + deepLink + '">Apri nell\'app CVLS</a>'
    + '<div style="margin-top:12px;font-size:13px;color:#8e8e93;line-height:1.5">Se hai l\'app CVLS installata sul telefono, verrai reindirizzato automaticamente.</div>'
    + '</div>'
    + '<div class="card"><div class="st">Caratteristiche tecniche</div>' + specsHtml + '</div>'
    + '<div class="card"><div class="st">Storico manutenzione</div>' + storicoHtml + '</div>'
    + '<div class="ft"><strong>Cavaletto Sanita\' s.r.l.</strong><br>TEL.: 0124/26900 | info@cavalettosanita.it</div>'
    + '</div>'
    + '<script>(function(){'
    + 'var dl=' + JSON.stringify(deepLink) + ';'
    + 'window.location.href=dl;'
    + '})()'
    + '<\/script>'
    + '</body></html>';

  return new Response(html, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html; charset=UTF-8',
    },
  })
})
