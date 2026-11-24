(() => {
  "use strict";

  const root = document.documentElement;
  const themeToggle = document.querySelector(".theme-toggle");
  const menuToggle = document.querySelector(".menu-toggle");
  const primaryNav = document.querySelector(".primary-nav");
  const year = document.getElementById("current-year");

  // Honour a saved preference first, otherwise follow the operating system.
  const savedTheme = (() => {
    try { return localStorage.getItem("univox-theme"); }
    catch { return null; }
  })();

  if (savedTheme === "light" || savedTheme === "dark") {
    root.dataset.theme = savedTheme;
  } else {
    root.dataset.theme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  const updateThemeButton = () => {
    if (!themeToggle) return;
    const isDark = root.dataset.theme === "dark";
    themeToggle.setAttribute("aria-label", isDark ? "Ενεργοποίηση φωτεινής εμφάνισης" : "Ενεργοποίηση σκοτεινής εμφάνισης");
    themeToggle.setAttribute("aria-pressed", String(isDark));
    const themeColor = isDark ? "#0b0d11" : "#f7f8fa";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);
  };

  updateThemeButton();
  themeToggle?.addEventListener("click", () => {
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    try { localStorage.setItem("univox-theme", nextTheme); } catch { /* Private browsing can disable storage. */ }
    updateThemeButton();
  });

  const closeMenu = () => {
    if (!menuToggle || !primaryNav) return;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Άνοιγμα μενού");
    primaryNav.classList.remove("is-open");
  };

  menuToggle?.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Άνοιγμα μενού" : "Κλείσιμο μενού");
    primaryNav?.classList.toggle("is-open", !isOpen);
  });

  primaryNav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  // Staggered section reveals without making content dependent on JavaScript.
  const revealItems = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        currentObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -35px 0px" });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }

  // Small interactive course catalogue preview.
  const searchInput = document.getElementById("course-search");
  const catalogRows = [...document.querySelectorAll(".catalog-row")];
  const filterButtons = [...document.querySelectorAll(".catalog-filter")];
  const resultsContainer = document.getElementById("catalog-results");
  let activeFilter = "all";

  const filterCatalog = () => {
    const query = (searchInput?.value || "").trim().toLocaleLowerCase("el-GR");
    let visibleCount = 0;

    catalogRows.forEach((row) => {
      const matchesCategory = activeFilter === "all" || row.dataset.category === activeFilter;
      const matchesQuery = !query || row.textContent.toLocaleLowerCase("el-GR").includes(query);
      const visible = matchesCategory && matchesQuery;
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    const oldEmpty = resultsContainer?.querySelector(".catalog-empty");
    oldEmpty?.remove();
    if (visibleCount === 0 && resultsContainer) {
      const empty = document.createElement("p");
      empty.className = "catalog-empty";
      empty.textContent = "Δεν βρέθηκαν μαθήματα με αυτά τα κριτήρια.";
      resultsContainer.append(empty);
    }
  };

  searchInput?.addEventListener("input", filterCatalog);
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "all";
      filterButtons.forEach((item) => {
        const selected = item === button;
        item.classList.toggle("is-active", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
      filterCatalog();
    });
  });

  if (year) year.textContent = String(new Date().getFullYear());
})();
