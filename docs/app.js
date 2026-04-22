(function() {
  "use strict";

  const TITLE = "astyanax.se";
  const GURKA_ID = "gurka";
  const COLORS = new Set(["blå", "lila", "röd", "orange", "rosa"]);
  const RICK_PATHS = new Set(["/highscore", "/admin", "/wp-admin", "/img"]);
  const ALLERGI_PATHS = new Set(["/allergisk", "/beroende"]);

  const GURKA_AV_HALFLIFE_ms = 5e3;
  const GURKA_AV_R_pms = -Math.log(2) / GURKA_AV_HALFLIFE_ms;
  const GURKA_STABILITY_cps = 4;
  const GURKA_AV_BASE_dpms = 6e-3;
  const GURKA_MIN_CLICK_DELAY_ms = 1000 / 12;
  const GURKA_CLICK_INC_d = 1;
  const GURKA_CLICK_INC_dpms = 8e-3;
  const GURKA_CLICK_INC_dpmsratio = Math.exp(-GURKA_AV_R_pms * 1e3 / GURKA_STABILITY_cps);

  const GURKA_SPRING_CONST_SQRT_pms = 1e-3;
  const GURKA_SPRING_GRACE_ms = 200;
  const GURKA_MIN_AV_dpms = -0.11 * 360 / 1e3;
  const GURKA_RCLICK_DEC_dpms = 1e-3;

  let lastClickDate = new Date();
  let lastClickA_d = 0;
  let lastClickAV_dpms = GURKA_AV_BASE_dpms;
  let lastClickTurns = BigInt(0);
  let lastClickSpringTwist_d = 0;
  let gurkaAV_dpms = GURKA_AV_BASE_dpms;
  let gurkaA_d = 0;
  let gurkaTurns = BigInt(0);
  let gurkaSpringTwist_d = 0;
  let numDarkmodeClicks = 0;
  let lastDarkmodeDate = new Date();
  const UIObjectVisibility = {};

  function normalizePath(pathname) {
    const decoded = decodeURIComponent(pathname || "/");
    const stripped = decoded.replace(/\/+$/, "");
    return stripped === "" ? "/" : stripped;
  }

  function parseState() {
    const params = new URLSearchParams(window.location.search);
    const path = normalizePath(window.location.pathname);
    const cheatMatch = path.match(/^\/(?:fusk|kod)\/(.+)$/);
    const queryColor = params.get("color");
    const pathColor = path.startsWith("/") ? path.slice(1) : path;
    const today = new Date();
    const mmdd = String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");

    const state = {
      title: TITLE,
      darkmode: path === "/mörk" || params.has("darkmode"),
      allergisk: ALLERGI_PATHS.has(path) || params.has("allergisk"),
      mailfobi: path === "/mailfobi" || params.has("mailfobi"),
      highscore: RICK_PATHS.has(path),
      tomat: path === "/tomat" || params.has("tomat") || params.has("beta") || mmdd === "04-01",
      krabba: path === "/krabba" || params.has("krabba"),
      cage: path === "/cage" || params.has("cage"),
      color: COLORS.has(queryColor) ? queryColor : (COLORS.has(pathColor) ? pathColor : null),
      cheat: params.get("fusk") || (cheatMatch ? decodeURIComponent(cheatMatch[1]) : null),
      mayDay: mmdd === "05-01"
    };

    state.img = "image0.jpg";
    state.imgDarkmode = state.img;
    if (state.color) {
      state.img = state.color + ".png";
      state.imgDarkmode = state.img;
    } else if (state.tomat) {
      state.img = "tomat.jpg";
      state.imgDarkmode = "tomat-transp.png";
    } else if (state.cage) {
      const variant = "cage" + (Math.floor(Math.random() * 3) + 1);
      state.img = variant + ".jpg";
      state.imgDarkmode = variant + "-transp.png";
    } else if (state.krabba) {
      state.img = "krabba.png";
      state.imgDarkmode = state.img;
    }

    return state;
  }

  function applyPageState(state) {
    document.title = state.title;
    document.body.classList.toggle("darkmode", state.darkmode);
    document.body.classList.toggle("image-hidden", state.allergisk);
    document.body.classList.toggle("view-rick", state.highscore);

    const image = "url(/" + state.img + ")";
    const darkImage = "url(/" + state.imgDarkmode + ")";
    document.documentElement.style.setProperty("--gurka-dark-image", darkImage);
    $("#gurka").css("background-image", image);
    $("#preload").css("background", darkImage + " no-repeat -9999px -9999px");

    if (state.mayDay) {
      $("#ui_message")
        .html("glad forsta maj!")
        .css({
          display: "inline",
          backgroundColor: "#ED1C24",
          color: "#fff",
          padding: "6px"
        });
    } else {
      $("#ui_message").hide();
    }
  }

  async function sha1Hex(input) {
    const bytes = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest("SHA-1", bytes);
    return Array.from(new Uint8Array(hash), function(value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  async function applyCheatIfNeeded(state) {
    if (!state.cheat) {
      return;
    }

    const plainHash = await sha1Hex(state.cheat);
    const saltedHash = await sha1Hex("gurka" + state.cheat + "gurka");
    if (plainHash === "8bd0de6b64325b1eda200832f69198f46dbc63c0") {
      lastClickTurns = BigInt(17) * BigInt(10) ** BigInt(18);
    } else if (saltedHash === "36837a903093f2ac924af2b126bffba5c9cc20e0") {
      lastClickTurns = BigInt("1000090000000");
    }
  }

  function hptIntegrate(dt_ms, av0_dpms) {
    const av0_NBL_dpms = av0_dpms - GURKA_AV_BASE_dpms;
    const expRT = Math.exp(GURKA_AV_R_pms * dt_ms);
    const av_NBL_dpms = expRT * av0_NBL_dpms;
    const av_dpms = av_NBL_dpms + GURKA_AV_BASE_dpms;
    const da_NBL_d = av0_NBL_dpms / GURKA_AV_R_pms * (expRT - 1);
    const da_d = da_NBL_d + dt_ms * GURKA_AV_BASE_dpms;
    return [da_d, av_dpms];
  }

  function springIntegrate(dt_ms, av0_dpms, twist0_d) {
    let da_d;
    let av_dpms;
    let twist_d;

    if (dt_ms <= GURKA_SPRING_GRACE_ms) {
      da_d = av0_dpms * dt_ms;
      av_dpms = av0_dpms;
      twist_d = twist0_d + da_d;
    } else {
      const grace_da_d = av0_dpms * GURKA_SPRING_GRACE_ms;
      dt_ms -= GURKA_SPRING_GRACE_ms;
      twist0_d += grace_da_d;

      const phi = Math.atan(-1 / GURKA_SPRING_CONST_SQRT_pms * av0_dpms / twist0_d);
      const A = twist0_d / Math.cos(phi);
      const until_spring_free_ms = 1 / GURKA_SPRING_CONST_SQRT_pms * (Math.PI / 2 - phi);
      if (until_spring_free_ms < dt_ms) {
        twist_d = 0;
        const hptRes = hptIntegrate(dt_ms - until_spring_free_ms, -GURKA_SPRING_CONST_SQRT_pms * A);
        da_d = grace_da_d - twist0_d + hptRes[0];
        av_dpms = hptRes[1];
      } else {
        twist_d = A * Math.cos(GURKA_SPRING_CONST_SQRT_pms * dt_ms + phi);
        av_dpms = -GURKA_SPRING_CONST_SQRT_pms * A * Math.sin(GURKA_SPRING_CONST_SQRT_pms * dt_ms + phi);
        da_d = grace_da_d + twist_d - twist0_d;
      }
    }

    return [da_d, av_dpms, twist_d];
  }

  function updateGurka() {
    const now = new Date();
    const since_last_click_ms = now.getTime() - lastClickDate.getTime();

    let since_last_click_d;
    if (lastClickSpringTwist_d < 0 || lastClickAV_dpms < 0) {
      const res = springIntegrate(since_last_click_ms, lastClickAV_dpms, lastClickSpringTwist_d);
      since_last_click_d = res[0];
      gurkaAV_dpms = res[1];
      gurkaSpringTwist_d = res[2];
    } else {
      const res = hptIntegrate(since_last_click_ms, lastClickAV_dpms);
      since_last_click_d = res[0];
      gurkaAV_dpms = res[1];
    }

    gurkaA_d = (lastClickA_d + since_last_click_d) % 360;
    let since_last_click_turns;
    if (lastClickA_d + since_last_click_d > 0) {
      since_last_click_turns = Math.floor((lastClickA_d + since_last_click_d) / 360);
    } else {
      since_last_click_turns = -Math.floor(-(lastClickA_d + since_last_click_d) / 360);
    }
    gurkaTurns = lastClickTurns + BigInt(since_last_click_turns);
    return now;
  }

  function updateUI() {
    $("#gurka").rotate({
      angle: gurkaA_d,
      center: ["50%", "50%"]
    });
    updateUIObjectVisibility("turns", gurkaTurns, gurkaTurns > 0, false);

    const AV_tps = gurkaAV_dpms / 360 * 1000;
    updateUIObjectVisibility("tps", AV_tps.toFixed(2), AV_tps > 10, AV_tps < 0.5);
    updateUIObjectVisibility("twist", (-gurkaSpringTwist_d / 360).toFixed(1), gurkaSpringTwist_d < -2 * 360, gurkaSpringTwist_d >= 0);
    updateUIObjectVisibility("dir", undefined, AV_tps < -0.1, AV_tps >= 0);
    updateUIObjectVisibility("darkclick", numDarkmodeClicks, numDarkmodeClicks >= 10, numDarkmodeClicks < 5);

    if (numDarkmodeClicks >= 10) {
      const side = Math.min($("#gurkburk").height(), $("#gurkburk").width());
      const short_side = Math.exp(-0.0077 * (numDarkmodeClicks - 10)) * side;
      $("#gurka").css("background-size", Math.round(side) + "px " + Math.round(short_side) + "px");
    } else {
      $("#gurka").css("background-size", "contain");
    }
  }

  function updateUIObjectVisibility(name, value, showIfHidden, hideIfShown) {
    if (!(name in UIObjectVisibility)) {
      UIObjectVisibility[name] = 0;
    }

    const UIobj = $("#ui_" + name);
    if (value !== undefined) {
      if (value === 1337) {
        UIobj.text("l33t");
      } else if (name === "tps") {
        if (UIobj.text() !== YourJS.fullNumber(value)) {
          UIobj.text(YourJS.fullNumber(value));
        }
      } else if (UIobj.text() !== String(value)) {
        UIobj.text(String(value));
      }
    }

    if (showIfHidden && UIObjectVisibility[name] === 0) {
      UIObjectVisibility[name] = 2;
      UIobj.fadeIn(2000, function() {
        UIObjectVisibility[name] = 1;
      });
    } else if (hideIfShown && UIObjectVisibility[name] === 1) {
      UIObjectVisibility[name] = 2;
      UIobj.fadeOut(2000, function() {
        UIObjectVisibility[name] = 0;
      });
    }
  }

  function gurkklick(right) {
    const now = updateGurka();
    if (now.getTime() - lastClickDate.getTime() < GURKA_MIN_CLICK_DELAY_ms) {
      return false;
    }

    lastClickDate = now;
    lastClickTurns = gurkaTurns;
    lastClickSpringTwist_d = gurkaSpringTwist_d;
    if (!right) {
      lastClickA_d = gurkaA_d + GURKA_CLICK_INC_d;
      lastClickAV_dpms = gurkaAV_dpms + GURKA_CLICK_INC_dpms;
      lastClickAV_dpms *= GURKA_CLICK_INC_dpmsratio;
    } else {
      lastClickA_d = gurkaA_d;
      lastClickAV_dpms = Math.max(gurkaAV_dpms - GURKA_RCLICK_DEC_dpms, GURKA_MIN_AV_dpms);
    }

    updateGurka();
    updateUI();
    return false;
  }

  function toggleDarkMode() {
    $("body").toggleClass("darkmode");
    numDarkmodeClicks++;
    lastDarkmodeDate = new Date();
  }

  async function init() {
    const state = parseState();
    applyPageState(state);
    if (state.highscore) {
      return;
    }

    await applyCheatIfNeeded(state);

    setInterval(function() {
      updateGurka();
      updateUI();
    }, 40);

    setInterval(function() {
      const now = new Date();
      if (numDarkmodeClicks > 0 && now - lastDarkmodeDate > 10e3) {
        numDarkmodeClicks--;
      }
    }, 200);

    $("#gurka").click(function() {
      return gurkklick(false);
    });
    $("#gurka").contextmenu(function() {
      return gurkklick(true);
    });
    $("body").keyup(function(event) {
      if (event.keyCode === 32) {
        gurkklick(false);
        return false;
      }
      if (event.keyCode === 8) {
        gurkklick(true);
        return false;
      }
      if (event.keyCode === 68) {
        toggleDarkMode();
        return false;
      }
      return true;
    });
    $(".darkmode_knapp").click(toggleDarkMode);
  }

  document.addEventListener("DOMContentLoaded", function() {
    init().catch(function(error) {
      console.error(error);
    });
  });
})();
