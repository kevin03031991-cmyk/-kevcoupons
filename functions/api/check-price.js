const ALLOWED = [
  "zalando.de",
  "www.zalando.de",
  "amazon.de",
  "www.amazon.de",
  "saturn.de",
  "www.saturn.de",
  "peek-cloppenburg.de",
  "www.peek-cloppenburg.de",
  "aboutyou.de",
  "www.aboutyou.de",
  "adidas.de",
  "www.adidas.de",
  "nike.com",
  "www.nike.com",
  "cyberport.de",
  "www.cyberport.de"
];

function allowed(hostname) {
  const h = String(hostname || "").toLowerCase();
  return ALLOWED.some(d => h === d || h.endsWith("." + d));
}

function parseNumber(value) {
  if (value == null) return null;

  let s = String(value)
    .replace(/\u00a0/g, " ")
    .replace(/[€$£]/g, "")
    .trim()
    .replace(/[^\d.,]/g, "");

  if (!s) return null;

  if (s.includes(".") && s.includes(",")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const n = Number(s);

  return Number.isFinite(n) && n > 0 && n < 100000
    ? Math.round(n * 100) / 100
    : null;
}

function findPrice(html) {
  const candidates = [];

  function add(value, source, priority) {
    const price = parseNumber(value);
    if (price !== null) {
      candidates.push({ price, source, priority });
    }
  }

  const jsonLd =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match;

  while ((match = jsonLd.exec(html))) {
    try {
      const data = JSON.parse(match[1]);

      const visit = obj => {
        if (!obj || typeof obj !== "object") return;

        if (Array.isArray(obj)) {
          obj.forEach(visit);
          return;
        }

        if (obj.offers) {
          const offers = Array.isArray(obj.offers)
            ? obj.offers
            : [obj.offers];

          offers.forEach(offer => {
            add(offer.price, "JSON-LD Offer", 100);
            add(offer.lowPrice, "JSON-LD Offer", 95);
          });
        }

        Object.values(obj).forEach(visit);
      };

      visit(data);
    } catch (_) {}
  }

  const patterns = [
    [
      /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)/i,
      "Meta product price",
      90
    ],
    [
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:price:amount["']/i,
      "Meta product price",
      90
    ],
    [
      /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)/i,
      "Meta itemprop price",
      85
    ],
    [
      /"currentPrice"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/i,
      "currentPrice",
      75
    ],
    [
      /"salePrice"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/i,
      "salePrice",
      70
    ]
  ];

  for (const [regex, source, priority] of patterns) {
    const m = html.match(regex);
    if (m) add(m[1], source, priority);
  }

  if (!candidates.length) {
    return { price: null, source: "Kein Preis erkannt" };
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestPost(context) {
  let body;

  try {
    body = await context.request.json();
  } catch (_) {
    return json({ error: "Ungültige Anfrage." }, 400);
  }

  if (!body?.url || typeof body.url !== "string") {
    return json({ error: "Bitte eine Produkt-URL angeben." }, 400);
  }

  let url;

  try {
    url = new URL(body.url);
  } catch (_) {
    return json({ error: "Ungültiger Produktlink." }, 400);
  }

  if (url.protocol !== "https:" || !allowed(url.hostname)) {
    return json({ error: "Dieser Shop wird noch nicht unterstützt." }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "de-DE,de;q=0.9,en;q=0.8"
      }
    });

    if (!response.ok) {
  if (response.status === 403) {
    return json(
      {
        error:
          "Dieser Shop blockiert die automatische Preisprüfung. Du kannst den Artikel weiterhin beobachten und über „Öffnen“ den aktuellen Preis direkt beim Shop prüfen."
      },
      403
    );
  }

  return json(
    { error: "Der Shop konnte gerade nicht automatisch geprüft werden." },
    502
  );
}

    const finalUrl = new URL(response.url);

    if (!allowed(finalUrl.hostname)) {
      return json(
        { error: "Weiterleitung zu einer nicht unterstützten Domain." },
        400
      );
    }

    const html = (await response.text()).slice(0, 3000000);
    const result = findPrice(html);

    return json({
      price: result.price,
      currency: "EUR",
      url: finalUrl.toString(),
      source: result.source,
      checkedAt: new Date().toISOString()
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      return json(
        { error: "Die Produktseite hat zu lange für eine Antwort gebraucht." },
        504
      );
    }

    console.error("check-price error:", e);

    return json(
      { error: "Produktseite konnte nicht geprüft werden." },
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}
