/**
 * main.js — Application bootstrap
 *
 * PHASE 5 — NEW SDK CONCEPTS:
 *
 *   1. esri/widgets/Print
 *      Sends the current SceneView to Esri's print service and downloads a
 *      PDF or PNG. Uses the PrintTemplate to control layout, title, and format.
 *
 *   2. FeatureLayerView.highlight()
 *      The FeatureLayerView is the *client-side rendering representation* of a
 *      FeatureLayer. It is different from the layer itself — the layer owns the
 *      data, the LayerView owns the rendered symbols on screen.
 *      highlight() applies the SDK's built-in cyan selection halo to a feature,
 *      replacing our previous manual yellow Graphic overlay.
 *      Obtained via view.whenLayerView(layer).
 *
 *   3. view.goTo()
 *      Animates the camera to frame a geometry or graphic. Used here to fly the
 *      camera to the selected road when the user clicks or searches.
 *      target can be a Graphic, Geometry, Extent, or { target, zoom, tilt, heading }.
 */

require([
  "esri/Map",
  "esri/views/SceneView",
  "esri/widgets/Expand",
  "esri/widgets/Legend",
  "esri/widgets/Home",
  "esri/widgets/Compass",
  "esri/widgets/NavigationToggle",
  "esri/widgets/Editor",
  "esri/widgets/Search",
  "esri/widgets/Print",
  "esri/identity/IdentityManager",
  "esri/core/reactiveUtils",
  "app/layers",
  "app/analysis",
  "app/ui",
  "app/dashboard",
],
function (
  Map, SceneView, Expand, Legend, Home, Compass, NavigationToggle,
  Editor, Search, Print, IdentityManager, reactiveUtils,
  layersModule, analysisModule, uiModule, dashboardModule
) {
  var initLayers           = layersModule.initLayers;
  var runProximityAnalysis = analysisModule.runProximityAnalysis;
  var clearAnalysis        = analysisModule.clearAnalysis;
  var updateReport         = uiModule.updateReport;
  var setLoading           = uiModule.setLoading;
  var showError            = uiModule.showError;
  var showSuccess          = uiModule.showSuccess;
  var loadSummary          = dashboardModule.loadSummary;
  var exportCSV            = dashboardModule.exportCSV;

  var PORTAL_SHARING = "https://gis15.smartgeoapps.com/portal/sharing";

  // ── 1. Enterprise Authentication ─────────────────────────────────────────
  IdentityManager.checkSignInStatus(PORTAL_SHARING)
    .catch(function () {
      return IdentityManager.getCredential(PORTAL_SHARING);
    })
    .catch(function (err) {
      console.warn("Login cancelled or failed:", err);
      updateReport(
        "<strong style='color:#ff6b6b'>Not signed in.</strong><br>" +
        "Click <strong>① Load All Layers</strong> to sign in and load data."
      );
    });

  // ── 2. Map ────────────────────────────────────────────────────────────────
  var map = new Map({
    basemap: "topo-vector",
    ground:  "world-elevation",
  });

  // ── 3. SceneView ──────────────────────────────────────────────────────────
  var view = new SceneView({
    container: "viewDiv",
    map: map,
    camera: {
      position: { longitude: -104.9860, latitude: 39.7350, z: 4500 },
      tilt: 55,
      heading: 345,
    },
    constraints: { altitude: { min: 200, max: 30000 } },
    environment: { atmosphere: { quality: "high" }, starsEnabled: false },
    popup: { dockEnabled: false, dockOptions: { breakpoint: false } },
  });

  // ── 4. Static widgets ─────────────────────────────────────────────────────
  view.ui.add(new Home({ view }),             "top-left");
  view.ui.add(new Compass({ view }),          "top-left");
  view.ui.add(new NavigationToggle({ view }), "top-left");
  view.ui.add(
    new Expand({
      view: view,
      content: new Legend({ view: view, style: "card" }),
      expandIconClass: "esri-icon-layer-list",
      expandTooltip: "Layer Legend",
    }),
    "bottom-left"
  );

  // ── Print widget ───────────────────────────────────────────────────────────
  //
  // WHY Print widget?
  // Print sends the current SceneView state (layers, camera angle, symbology)
  // to Esri's hosted print service, which renders it server-side into a
  // PDF or PNG at print resolution. The browser canvas screenshot approach
  // produces blurry output — the print service uses vector rendering.
  //
  // printServiceUrl: Esri's public print service — works without auth.
  // For Enterprise deployments you'd point this to your own print service:
  // https://yourserver/arcgis/rest/services/Utilities/PrintingTools/GPServer/...
  //
  var printWidget = new Print({
    view: view,
    printServiceUrl:
      "https://utility.arcgisonline.com/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task",
    templateOptions: {
      title:  "Laketon Infrastructure Analysis",
      author: "Laketon Smart City Dept.",
      legendEnabled: true,
    },
  });

  view.ui.add(
    new Expand({
      view: view,
      content: printWidget,
      expandIconClass: "esri-icon-printer",
      expandTooltip: "Print / Export Map",
      expanded: false,
    }),
    "top-left"
  );

  // ── 5. Buttons and state ──────────────────────────────────────────────────
  var btnLoad             = document.getElementById("btnLoadLayers");
  var btnAnalyze          = document.getElementById("btnAnalyze");
  var btnClear            = document.getElementById("btnClear");
  var btnExport           = document.getElementById("btnExport");
  var btnRefreshDashboard = document.getElementById("btnRefreshDashboard");
  var btnPresent          = document.getElementById("btnPresent");

  var selectedRoadGraphic  = null;
  var lastAnalysisData     = null;
  var loadedLayers         = null;
  var activeHighlight      = null;   // FeatureLayerView highlight handle
  var roadsLayerView       = null;   // cached FeatureLayerView for roads
  var presentationMode     = false;

  var layerStatus = { roads: "…", parcels: "…", schools: "…", hospitals: "…" };

  function renderLayerStatus() {
    var icons  = { loaded: "✓", loading: "⏳", error: "✗" };
    var colors = { loaded: "#50c878", loading: "#7ec8e3", error: "#ff6b6b" };
    var html = "<strong>Feature Services</strong><br>";
    Object.keys(layerStatus).forEach(function (key) {
      var s = layerStatus[key];
      html += "<span style='color:" + (colors[s] || "#aabbcc") + "'>" +
              (icons[s] || "…") + " " + key + "</span><br>";
    });
    html += "<br><em style='color:#8899aa'>Click a road or use Search to select.</em>";
    updateReport(html);
  }

  // ── ① Load All Layers ────────────────────────────────────────────────────
  btnLoad.addEventListener("click", function () {
    btnLoad.disabled    = true;
    btnLoad.textContent = "Loading…";
    setLoading("Connecting to Enterprise Feature Services…");

    initLayers(map, view, function (name, status, err) {
      layerStatus[name] = status;
      if (err) console.error("Layer failed [" + name + "]:", err);
      renderLayerStatus();
    })
    .then(function (layers) {
      btnLoad.textContent = "✓ Layers Loaded";
      loadedLayers = layers;

      // ── FeatureLayerView — obtained once, reused for highlight ─────────
      //
      // WHY view.whenLayerView()?
      // The FeatureLayer owns the data — it knows the field schema, sends
      // queries, handles edits. The FeatureLayerView is what the SceneView
      // uses to render the layer visually. They are separate objects.
      // highlight() lives on the LayerView because it is a visual operation,
      // not a data operation — it has no effect on the server.
      //
      // whenLayerView() returns a Promise that resolves when the SceneView
      // has created its rendering representation of the layer.
      //
      view.whenLayerView(layers.roads).then(function (lv) {
        roadsLayerView = lv;
        console.log("Roads LayerView ready — highlight available.");
      });

      // ── Search widget ──────────────────────────────────────────────────
      var searchWidget = new Search({
        view: view,
        includeDefaultSources: false,
        sources: [{
          layer:        layers.roads,
          searchFields: ["name"],
          displayField: "name",
          exactMatch:   false,
          outFields:    ["*"],
          name:         "Road Segments",
          placeholder:  "Search road name…",
          zoomScale:    5000,
        }],
      });
      view.ui.add(searchWidget, { position: "bottom-right", index: 1 });

      searchWidget.on("select-result", function (event) {
        if (!event.result || !event.result.feature) return;
        var oid = event.result.feature.attributes[layers.roads.objectIdField];
        layers.roads.queryFeatures({
          objectIds: [oid], returnGeometry: true, outFields: ["*"],
        }).then(function (result) {
          if (!result.features.length) return;
          selectRoad(result.features[0]);
        }).catch(function (err) {
          showError("Road selection", err, "Try clicking the road directly on the map.");
        });
      });

      // ── Editor widget ──────────────────────────────────────────────────
      layers.roads.when(function () {
        if (!(layers.roads.capabilities &&
              layers.roads.capabilities.editing &&
              layers.roads.capabilities.editing.supportsUpdateAttributes)) {
          console.warn("Roads layer: editing not enabled on Feature Service.");
        }

        var editorWidget = new Editor({
          view: view,
          layerInfos: [{
            layer: layers.roads,
            formTemplate: {
              elements: [
                { type: "field", fieldName: "condition_score",           label: "Condition Score (1–10)" },
                { type: "field", fieldName: "condition_label",           label: "Condition Label" },
                { type: "field", fieldName: "repair_priority",           label: "Repair Priority" },
                { type: "field", fieldName: "estimated_repair_cost_usd", label: "Est. Repair Cost (USD)" },
                { type: "field", fieldName: "last_inspection",           label: "Last Inspection Date" },
              ],
            },
          }],
        });

        var prevState = null;
        reactiveUtils.watch(
          function () { return editorWidget.viewModel.state; },
          function (state) {
            if (prevState === "editing-existing-feature" && state === "ready") {
              showSuccess("Road attributes saved to Enterprise.");
              if (selectedRoadGraphic) {
                var oid = selectedRoadGraphic.attributes[layers.roads.objectIdField];
                layers.roads.queryFeatures({
                  objectIds: [oid], returnGeometry: true, outFields: ["*"],
                }).then(function (result) {
                  if (result.features.length) selectRoad(result.features[0]);
                }).catch(function () {});
              }
            }
            prevState = state;
          }
        );

        view.ui.add(
          new Expand({
            view: view, content: editorWidget,
            expandIconClass: "esri-icon-edit",
            expandTooltip: "Edit Road Attributes",
            expanded: false,
          }),
          { position: "bottom-right", index: 0 }
        );

        setTimeout(function () {
          document.querySelectorAll(".esri-search__input").forEach(function (input) {
            if (!input.getAttribute("autocomplete")) input.setAttribute("autocomplete", "off");
          });
        }, 1000);
      });

      // ── Road click ────────────────────────────────────────────────────
      view.on("click", function (event) {
        var mapPoint = event.mapPoint;
        if (!mapPoint) return;

        require(["esri/geometry/geometryEngine"], function (GeometryEngine) {
          var clickBuffer = GeometryEngine.geodesicBuffer(mapPoint, 80, "meters");
          if (!clickBuffer) return;

          updateReport("<span style='color:#7ec8e3'>⏳ Selecting road…</span>");

          layers.roads.queryFeatures({
            geometry: clickBuffer, spatialRelationship: "intersects",
            returnGeometry: true, outFields: ["*"],
          }).then(function (result) {
            if (!result.features.length) { renderLayerStatus(); return; }
            var best = result.features[0];
            if (result.features.length > 1) {
              var minDist = Infinity;
              result.features.forEach(function (f) {
                var d = GeometryEngine.distance(f.geometry, mapPoint, "meters");
                if (d < minDist) { minDist = d; best = f; }
              });
            }
            selectRoad(best);
          }).catch(function (err) {
            if (err && (err.code === 499 || (err.message && err.message.indexOf("Token") !== -1))) {
              IdentityManager.getCredential(PORTAL_SHARING)
                .then(function () { updateReport("Session refreshed. Click the road again."); })
                .catch(function () { showError("Authentication", new Error("Session expired"), "Please refresh the page."); });
            } else {
              showError("Road selection", err, "Try clicking closer to the road line.");
            }
          });
        });
      });
    })
    .catch(function (err) {
      console.error("initLayers failed:", err);
      showError("Layer load", err, "Check your Enterprise connection and try again.");
      btnLoad.disabled    = false;
      btnLoad.textContent = "① Load All Layers";
    });
  });

  // ── Shared road selection handler ─────────────────────────────────────────
  //
  // PHASE 5 ADDITIONS:
  //   1. FeatureLayerView.highlight() — replaces the manual yellow Graphic
  //   2. view.goTo() — animates camera to frame the selected road
  //
  function selectRoad(roadFeature) {
    selectedRoadGraphic = roadFeature;
    var p = roadFeature.attributes;

    // ── FeatureLayerView.highlight() ───────────────────────────────────────
    //
    // Remove previous highlight before applying a new one.
    // highlight() returns a handle object with a remove() method.
    // If we don't remove the old one, every selection stacks another halo.
    //
    if (activeHighlight) {
      activeHighlight.remove();
      activeHighlight = null;
    }

    if (roadsLayerView) {
      // Pass the objectId — the LayerView uses it to find the rendered feature.
      // We could also pass the Graphic directly, but objectId is more reliable
      // when the LayerView hasn't fully synced its local cache yet.
      activeHighlight = roadsLayerView.highlight(
        roadFeature.attributes[loadedLayers.roads.objectIdField]
      );
    }

    // ── view.goTo() — animated camera fly-to ─────────────────────────────
    //
    // WHY view.goTo()?
    // Without this the map stays wherever the user last navigated.
    // goTo() frames the selected road automatically — essential for
    // presentation mode where the analyst shouldn't need to pan manually.
    //
    // target: the road geometry, extended into a 3D extent with Z padding
    // options.duration: animation time in milliseconds
    // options.easing: "in-out-expo" is smooth and professional-looking
    //
    view.goTo(
      {
        target: roadFeature.geometry,
        tilt:   55,
      },
      {
        duration: 1200,
        easing:   "in-out-expo",
      }
    ).catch(function () {
      // goTo() rejects if interrupted by user navigation — silently ignore
    });

    updateReport(
      "<strong>Selected:</strong> " + p.name + "<br>" +
      "Condition: <strong>" + p.condition_label + "</strong> (" + p.condition_score + "/10)<br>" +
      "Priority: <strong>" + p.repair_priority + "</strong><br>" +
      "Est. Cost: <strong>$" + Number(p.estimated_repair_cost_usd).toLocaleString() + "</strong><br><br>" +
      "<em style='color:#8899aa'>Click ② Analyze to run proximity analysis.<br>" +
      "Use ✏️ (bottom-right) to edit road attributes.</em>"
    );

    btnAnalyze.disabled = false;
    btnClear.disabled   = false;
  }

  // ── ② Analyze ─────────────────────────────────────────────────────────────
  btnAnalyze.addEventListener("click", function () {
    if (!selectedRoadGraphic) return;
    btnAnalyze.disabled    = true;
    btnAnalyze.textContent = "Analyzing…";
    setLoading("Running proximity analysis…");

    runProximityAnalysis(view, selectedRoadGraphic)
      .then(function (results) {
        updateReport(results.reportHtml);
        lastAnalysisData = results;
        btnExport.style.display = "block";
      })
      .catch(function (err) {
        showError("Analysis", err, "Check that the road geometry loaded correctly.");
      })
      .finally(function () {
        btnAnalyze.disabled    = false;
        btnAnalyze.textContent = "② Analyze Selected Road";
      });
  });

  // ── ③ Clear ───────────────────────────────────────────────────────────────
  btnClear.addEventListener("click", function () {
    clearAnalysis(view);
    if (activeHighlight) { activeHighlight.remove(); activeHighlight = null; }
    selectedRoadGraphic = null;
    lastAnalysisData    = null;
    btnAnalyze.disabled = true;
    btnClear.disabled   = true;
    btnExport.style.display = "none";
    renderLayerStatus();
  });

  // ── ⬇ Export CSV ─────────────────────────────────────────────────────────
  btnExport.addEventListener("click", function () {
    if (lastAnalysisData) exportCSV(lastAnalysisData);
  });

  // ── ↻ Refresh Dashboard ───────────────────────────────────────────────────
  btnRefreshDashboard.addEventListener("click", function () {
    if (!loadedLayers || !loadedLayers.roads) {
      document.getElementById("dashboard-content").innerHTML =
        "<em style='color:#ff6b6b'>Load layers first.</em>";
      return;
    }
    var container = document.getElementById("dashboard-content");
    container.innerHTML = "<span style='color:#7ec8e3'>⏳ Querying fleet statistics…</span>";
    loadSummary(loadedLayers.roads, container).catch(function (err) {
      container.innerHTML =
        "<strong style='color:#ff6b6b'>⚠ Dashboard failed</strong><br>" +
        "<span style='color:#aabbcc'>" + (err.message || err) + "</span>";
    });
  });

  // ── Presentation mode — Press F key or click button ───────────────────────
  //
  // WHY presentation mode?
  // When demoing to a city council or management, the panel and widgets
  // distract from the map itself. Presentation mode hides everything except
  // the map and a minimal overlay showing the selected road's condition.
  // The analyst toggles it with the F key or the button in the panel.
  //
  function togglePresentation() {
    presentationMode = !presentationMode;
    var panel = document.getElementById("panel");

    if (presentationMode) {
      panel.style.display = "none";
      view.ui.padding = { top: 15, left: 15, right: 15, bottom: 15 };
      showPresentationOverlay();
      if (btnPresent) btnPresent.textContent = "Exit Presentation (F)";
    } else {
      panel.style.display = "";
      hidePresentationOverlay();
      if (btnPresent) btnPresent.textContent = "⛶ Present (F)";
    }
  }

  function showPresentationOverlay() {
    var existing = document.getElementById("present-overlay");
    if (existing) existing.remove();

    var el = document.createElement("div");
    el.id = "present-overlay";
    el.style.cssText =
      "position:absolute;bottom:24px;left:50%;transform:translateX(-50%);" +
      "background:rgba(15,20,35,0.88);color:#e8eaf0;border-radius:8px;" +
      "padding:12px 24px;z-index:50;backdrop-filter:blur(6px);" +
      "font-family:'Avenir Next',sans-serif;text-align:center;" +
      "box-shadow:0 4px 20px rgba(0,0,0,0.5);min-width:280px;";

    if (selectedRoadGraphic) {
      var p = selectedRoadGraphic.attributes;
      var color = conditionColor(p.condition_label);
      el.innerHTML =
        "<div style='font-size:11px;color:#8899aa;text-transform:uppercase;letter-spacing:1px'>Selected Road</div>" +
        "<div style='font-size:18px;font-weight:bold;color:#7ec8e3;margin:4px 0'>" + p.name + "</div>" +
        "<div style='font-size:13px'>" +
          "<span style='color:" + color + ";font-weight:bold'>" + p.condition_label + "</span>" +
          " &nbsp;·&nbsp; Score: <strong>" + p.condition_score + "/10</strong>" +
          " &nbsp;·&nbsp; Est. cost: <strong>$" + Number(p.estimated_repair_cost_usd).toLocaleString() + "</strong>" +
        "</div>" +
        "<div style='font-size:10px;color:#8899aa;margin-top:6px'>Press F to exit presentation</div>";
    } else {
      el.innerHTML =
        "<div style='font-size:13px;color:#8899aa'>Presentation Mode — select a road to see details</div>" +
        "<div style='font-size:10px;color:#556677;margin-top:6px'>Press F to exit</div>";
    }

    document.body.appendChild(el);
  }

  function hidePresentationOverlay() {
    var el = document.getElementById("present-overlay");
    if (el) el.remove();
  }

  function conditionColor(label) {
    var l = (label || "").toLowerCase();
    if (l.indexOf("critical") !== -1) return "#dc3232";
    if (l.indexOf("poor")     !== -1) return "#e05a2b";
    if (l.indexOf("fair")     !== -1) return "#ffa500";
    if (l.indexOf("good")     !== -1) return "#32c832";
    return "#7ec8e3";
  }

  if (btnPresent) {
    btnPresent.addEventListener("click", togglePresentation);
  }

  // F key toggles presentation mode
  document.addEventListener("keydown", function (e) {
    if (e.key === "f" || e.key === "F") {
      // Don't intercept if user is typing in a search box or input
      if (document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA") return;
      togglePresentation();
    }
  });

  // ── SceneView ready ───────────────────────────────────────────────────────
  view.when(function () {
    console.log("SceneView ready.");
  }).catch(function (err) {
    showError("SceneView", err, "The 3D view failed to initialise.");
  });

},
function (err) {
  console.error("AMD require() failed:", err);
  var report = document.getElementById("report");
  if (report) {
    report.innerHTML =
      "<strong style='color:#ff6b6b'>App failed to load.</strong><br>" +
      "Module: " + (err.requireModules && err.requireModules[0]) + "<br>" +
      (err.message || "");
  }
  var btn = document.getElementById("btnLoadLayers");
  if (btn) btn.disabled = false;
});
