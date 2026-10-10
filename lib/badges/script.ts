/**
 * Script que roda na vitrine pública da loja (colado em “Códigos externos” da Nuvemshop). Fica pequeno de propósito: só lê os selos do
 * produto da página (pelo endereço /produtos/<handle>) e desenha três elementos com textContent (nunca innerHTML). Qualquer erro é
 * engolido: a vitrine nunca pode quebrar por causa dele.
 */
export const SCRIPT_SELOS = `(function () {
  try {
    var m = location.pathname.match(/\\/produtos\\/([^\\/?#]+)/);
    if (!m) return;
    var me = document.currentScript;
    var src = me && me.src ? new URL(me.src) : null;
    if (!src) return;
    var store = src.searchParams.get("store") || (window.LS && window.LS.store && window.LS.store.id);
    if (!store || document.getElementById("inuvem-selos")) return;
    var handle = decodeURIComponent(m[1]).toLowerCase();
    fetch(src.origin + "/api/loja/selos?s=" + encodeURIComponent(store) + "&h=" + encodeURIComponent(handle))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.v === 1) desenhar(d); })
      .catch(function () {});
  } catch (e) {}

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text) n.textContent = text;
    return n;
  }

  function desenhar(d) {
    var itens = [];
    if (d.ultimas) itens.push(el("span", "display:inline-block;padding:4px 10px;border-radius:999px;background:#b3261e;color:#fff;font-size:13px;font-weight:600;", "Últimas unidades!"));
    var relogio = null;
    if (d.promoAte) {
      var fim = new Date(d.promoAte).getTime();
      if (fim > Date.now()) {
        relogio = el("span", "display:inline-block;padding:4px 10px;border-radius:999px;background:#222;color:#fff;font-size:13px;font-variant-numeric:tabular-nums;");
        itens.push(relogio);
        var tick = function () {
          var s = Math.floor((fim - Date.now()) / 1000);
          if (s <= 0) { relogio.style.display = "none"; clearInterval(t); return; }
          var dias = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60;
          var p = function (n) { return (n < 10 ? "0" : "") + n; };
          relogio.textContent = "Oferta termina em " + (dias > 0 ? dias + "d " : "") + p(h) + ":" + p(mi) + ":" + p(se);
        };
        var t = setInterval(tick, 1000);
        tick();
      }
    }
    if (d.whatsapp && /^\\d{12,13}$/.test(d.whatsapp.numero)) {
      var a = el("a", "display:inline-block;padding:8px 14px;border-radius:6px;border:1px solid #1f8f4e;color:#1f8f4e;font-size:14px;font-weight:600;text-decoration:none;", "Falar no WhatsApp sobre esta peça");
      a.href = "https://wa.me/" + d.whatsapp.numero + "?text=" + encodeURIComponent(d.whatsapp.texto + " " + location.href);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      itens.push(a);
    }
    if (itens.length === 0) return;
    var caixa = el("div", "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0;");
    caixa.id = "inuvem-selos";
    itens.forEach(function (i) { caixa.appendChild(i); });
    var ancora = document.querySelector(".js-addtocart") || document.querySelector('[data-store^="product-form"]') || document.querySelector("form.js-product-form");
    if (ancora && ancora.parentNode) { ancora.parentNode.insertBefore(caixa, ancora); return; }
    var titulo = document.querySelector("h1");
    if (titulo && titulo.parentNode) titulo.parentNode.insertBefore(caixa, titulo.nextSibling);
  }
})();
`;
