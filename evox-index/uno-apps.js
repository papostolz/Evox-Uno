// Fills the "Apps on Uno" tile from the same catalog the Florida app uses
// (GET https://uno.evox.uno/florida/apps -> { catalog: [{ id, name, desc, icon }] }).
// The catalog is cached in localStorage under "florida-catalog", like app.js does.
// Without a catalog the static badges already in the page stay as they are.
(function () {
  var API = "https://uno.evox.uno/florida";
  var box = document.getElementById("uno-apps");
  if (!box) return;

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function token() {
    try {
      return (JSON.parse(localStorage.getItem("evx-account") || "null") || {}).evxToken || "";
    } catch (_) {
      return "";
    }
  }

  function icon(app) {
    var letter = esc((app.name || "?").charAt(0));
    if (!app.icon) return '<div class="app-icon"><span>' + letter + "</span></div>";
    return (
      '<div class="app-icon"><img src="' + esc(app.icon) + '" alt="" ' +
      'onerror="this.nextElementSibling.hidden=false;this.remove()">' +
      "<span hidden>" + letter + "</span></div>"
    );
  }

  function render(apps) {
    if (!Array.isArray(apps) || !apps.length) return;
    box.innerHTML =
      '<ul class="app-list">' +
      apps
        .map(function (a) {
          return (
            "<li>" + icon(a) +
            '<div class="app-text"><div class="app-name">' + esc(a.name) + "</div>" +
            (a.desc ? '<div class="app-desc">' + esc(a.desc) + "</div>" : "") +
            "</div></li>"
          );
        })
        .join("") +
      "</ul>";
  }

  // 1. cached catalog, so the tile fills straight away
  try {
    render(JSON.parse(localStorage.getItem("florida-catalog") || "[]"));
  } catch (_) {}

  // 2. fresh catalog from the server (needs a signed-in account)
  var t = token();
  if (!t) return;
  fetch(API + "/apps", { headers: { Authorization: "Bearer " + t } })
    .then(function (res) {
      return res.ok ? res.json() : null; // never sign the user out from the landing page
    })
    .then(function (r) {
      if (!r || !Array.isArray(r.catalog)) return;
      try { localStorage.setItem("florida-catalog", JSON.stringify(r.catalog)); } catch (_) {}
      render(r.catalog);
    })
    .catch(function () {});
})();