const SOURCES = [
  { name: "TrustDeals", url: "https://www.trustdeals.de/view/zalando.de" },
  { name: "GutscheinJagen", url: "https://www.gutscheinjagen.de/gutschein/zalando.de" },
  { name: "CouponFollow", url: "https://couponfollow.de/gutscheine/zalando.de" }
];

function textFromHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#8211;|&#8212;/gi,"-")
    .replace(/&#038;/gi,"&").replace(/\s+/g," ").trim();
}

const STOP = new Set(["ZALANDO","GUTSCHEIN","RABATTCODE","AKTIONSCODE","NEWSLETTER","AMAZON","COOKIE","LOGIN","DETAILS","RABATT","ANGEBOT","GUTSCHEINE","OKTOBER","VERSAND","KOSTENLOS","SPAREN","T-MOBILE"]);
function plausible(code){
  if(!code || code.length<4 || code.length>20 || STOP.has(code)) return false;
  if(!/^[A-Z0-9][A-Z0-9-]*$/.test(code) || !/[A-Z]/.test(code)) return false;
  if(/^\d+$/.test(code) || /^20\d\d$/.test(code) || /-$/.test(code) || /OTK\d*$/i.test(code)) return false;
  return true;
}
function badContext(s){
  // Offensichtlich falsche oder abgelaufene Bereiche
  if (/abgelaufen|abgelaufene\s+rabattcodes|nicht\s+mehr\s+gültig|nicht\s+mehr\s+verfügbar/i.test(s)) {
    return true;
  }

  // Alte Treffer aussortieren: "vor 2 Monaten", "vor 8 Monaten",
  // "vor 1 Jahr", "vor 3 Jahren" usw.
  if (/vor\s+(?:[2-9]|\d{2,})\s+monaten/i.test(s)) {
    return true;
  }

  if (/vor\s+\d+\s+jahren?/i.test(s)) {
    return true;
  }

  // Bisherige Fremdtreffer weiterhin blockieren
  return /ähnlichen\s+shops|shops?\s+wie\s+zalando|beliebte\s+shops|dieser\s+gutscheincode\s+wird\s+am\s+öftesten\s+auch\s+bei\s+shops/i.test(s);
}
function sourceSpecificPlausible(code, sourceName, context){
  if(!plausible(code) || badContext(context)) return false;
  if(sourceName === "TrustDeals" && /OTK\d*$/i.test(code)) return false;
  if(/^(?:SALE|EXTRA|WILKOMMEN)\d{1,2}$/i.test(code) && /ähnlichen\s+shops|shops?\s+wie\s+zalando/i.test(context)) return false;
  return true;
}
function findCodes(text){
  const hits = new Map();

  const re = /(?:gutscheincode|rabattcode|aktionscode|couponcode|promo[- ]?code|code)\s*(?:anzeigen|kopieren)?\s*(?:ist|lautet|:|-)?\s*["']?([A-Z0-9][A-Z0-9-]{3,19})["']?/gi;

  let m;

  while ((m = re.exec(text)) !== null) {
    const code = m[1].toUpperCase();

    if (!plausible(code)) continue;
    if (!/[0-9-]/.test(code)) continue;

    const s = Math.max(0, m.index - 120);
    const e = Math.min(text.length, m.index + m[0].length + 190);
    const context = text.slice(s, e);

    if (badContext(context)) continue;

    hits.set(code, context);
  }

  return [...hits].map(([code,context]) => ({code,context}));
}
function benefitFromContext(s){
  const around=s.replace(/\s+/g," ");
  const pct=around.match(/(?:bis\s+zu\s+)?(\d{1,2})\s?%\s*(?:Rabatt|sparen|Nachlass)?/i);
  if(pct && Number(pct[1])>0 && Number(pct[1])<=80) return pct[0].trim();
  const eur=around.match(/(\d{1,3})\s?€\s*(?:Rabatt|Gutschein)?/i);
  if(eur && Number(eur[1])>0) return eur[0].trim();
  return "Rabattcode – Höhe/Bedingungen auf der Quelle prüfen";
}
function cleanContext(s){return s.replace(/\s+/g," ").slice(0,240).trim();}

export async function onRequestGet(){
  const checkedAt=new Date().toISOString(), found=new Map(), checkedSources=[];
  for(const source of SOURCES){
    try{
      const r=await fetch(source.url,{headers:{"user-agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1","accept-language":"de-DE,de;q=0.9,en;q=0.7"},redirect:"follow"});
      checkedSources.push({name:source.name,url:source.url,status:r.status});
      if(!r.ok) continue;
      const text=textFromHtml(await r.text());
      for(const hit of findCodes(text)){
        if(!sourceSpecificPlausible(hit.code, source.name, hit.context)) continue;
        const old=found.get(hit.code);
        if(old){if(!old.sources.some(x=>x.url===source.url)) old.sources.push(source);continue;}
        found.set(hit.code,{shop:"Zalando",code:hit.code,benefit:benefitFromContext(hit.context),conditions:cleanContext(hit.context),source:source.name,sourceUrl:source.url,sources:[source],checkedAt});
      }
    }catch(e){checkedSources.push({name:source.name,url:source.url,error:String(e.message||e)});}
  }
  const coupons=[...found.values()].map(c=>{
  c.sourceCount=c.sources.length;

  if(c.sourceCount>=2){
    c.status=`Sehr guter Kandidat – auf ${c.sourceCount} Quellen gefunden`;
    c.confidence="hoch";
  }else{
    c.status="Kandidat aus einer öffentlichen Quelle – bitte bei Zalando prüfen";
    c.confidence="mittel";
  }

  delete c.sources;
  return c;
}).sort((a,b)=>b.sourceCount-a.sourceCount || a.code.localeCompare(b.code));
  return new Response(JSON.stringify({checkedAt,coupons,checkedSources,message:coupons.length?`${coupons.length} gefilterte Zalando-Code-Kandidat(en) gefunden. Vor dem Kauf im Zalando-Warenkorb prüfen.`:"Keine ausreichend plausiblen Zalando-Code-Kandidaten gefunden. Die Quellen wurden geprüft, aber unsichere, abgelaufene oder fremde Treffer wurden ausgefiltert."}), {status:200,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"}});
};
