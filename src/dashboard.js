/**
 * dashboard.js — Fleet-wide road condition summary and CSV export
 *
 * PHASE 4 — New SDK concepts introduced here:
 *
 *   StatisticDefinition + queryFeatures with groupByFieldsForStatistics:
 *     Instead of fetching all road features and counting in the browser,
 *     we push the aggregation to the server. The FeatureServer runs a
 *     GROUP BY SQL equivalent and returns one row per condition_label
 *     with the count and sum. This is how production dashboards work —
 *     you never pull thousands of features just to count them.
 *
 *   WHY this matters:
 *     With 5 roads it makes no difference. With 50,000 roads in a real
 *     city dataset, fetching all features to count them in the browser
 *     would be unusably slow. StatisticDefinition keeps the data on the
 *     server and sends only the summary.
 *
 * ARCHITECTURE NOTE:
 *   dashboard.js is a pure AMD module — no side effects, no DOM access on load.
 *   The panel tab wiring is handled in main.js. dashboard.js only exposes
 *   two functions: loadSummary() and exportCSV().
 */

define([], function () {

  /**
   * loadSummary
   * Queries the roads layer for aggregate statistics using StatisticDefinition,
   * then renders an SVG bar chart and summary figures into the dashboard panel.
   *
   * @param {esri/layers/FeatureLayer} roadsLayer
   * @param {HTMLElement} container  — the DOM element to render into
   * @returns {Promise<void>}
   */
  function loadSummary(roadsLayer, container) {
    return loadModules([
      "esri/rest/support/StatisticDefinition",
    ]).then(function (modules) {
      var StatisticDefinition = modules[0];

      // ── Server-side aggregate query ──────────────────────────────────────
      //
      // WHY StatisticDefinition?
      // We want: for each condition_label, count the roads and sum the repair cost.
      // Without statistics we'd fetch all features and do this in JS.
      // StatisticDefinition sends one HTTP request, gets back one row per group.
      //
      // statisticType options: "count", "sum", "min", "max", "avg", "stddev", "var"
      //
      var stats = [
        new StatisticDefinition({
          statisticType: "count",
          onStatisticField: "condition_score",
          outStatisticFieldName: "road_count",
        }),
        new StatisticDefinition({
          statisticType: "sum",
          onStatisticField: "estimated_repair_cost_usd",
          outStatisticFieldName: "total_cost",
        }),
        new StatisticDefinition({
          statisticType: "avg",
          onStatisticField: "condition_score",
          outStatisticFieldName: "avg_score",
        }),
        new StatisticDefinition({
          statisticType: "min",
          onStatisticField: "condition_score",
          outStatisticFieldName: "min_score",
        }),
      ];

      return roadsLayer.queryFeatures({
        where:                       "1=1",      // all roads
        outStatistics:               stats,
        groupByFieldsForStatistics:  ["condition_label", "repair_priority"],
        returnGeometry:              false,
        outFields:                   ["condition_label", "repair_priority"],
      }).then(function (result) {
        renderDashboard(result.features, container);
      });
    });
  }

  /**
   * renderDashboard
   * Builds the dashboard HTML including an SVG bar chart and key metrics.
   * Pure DOM manipulation — no external chart library.
   *
   * @param {esri/Graphic[]} features  — aggregate query result rows
   * @param {HTMLElement}    container
   */
  function renderDashboard(features, container) {
    if (!features || features.length === 0) {
      container.innerHTML = "<em style='color:#8899aa'>No road data available.</em>";
      return;
    }

    // ── Compute totals from aggregate rows ───────────────────────────────
    var totalRoads    = 0;
    var totalCost     = 0;
    var weightedScore = 0;
    var minScore      = Infinity;

    var groups = features.map(function (f) {
      var a = f.attributes;
      totalRoads    += (a.road_count || 0);
      totalCost     += (a.total_cost  || 0);
      weightedScore += (a.avg_score   || 0) * (a.road_count || 0);
      if ((a.min_score || 10) < minScore) minScore = a.min_score;
      return {
        label:    a.condition_label  || "Unknown",
        priority: a.repair_priority  || "—",
        count:    a.road_count       || 0,
        cost:     a.total_cost       || 0,
        avg:      a.avg_score        || 0,
      };
    });

    // Sort: Critical first, Good last
    var order = { "Critical": 0, "Poor": 1, "Fair": 2, "Good": 3 };
    groups.sort(function (a, b) {
      var oa = order[a.label] !== undefined ? order[a.label] : 99;
      var ob = order[b.label] !== undefined ? order[b.label] : 99;
      return oa - ob;
    });

    var fleetAvgScore = totalRoads > 0 ? (weightedScore / totalRoads).toFixed(1) : "—";
    var maxCount      = Math.max.apply(null, groups.map(function (g) { return g.count; }));

    // ── Key metric cards ─────────────────────────────────────────────────
    var html =
      "<strong style='color:#7ec8e3'>🛣 Fleet Summary</strong><br>" +
      "<hr style='border-color:#2a3a4a;margin:6px 0'>" +
      "<div style='display:flex;gap:8px;margin-bottom:10px'>" +
        metricCard("Total Roads",   totalRoads) +
        metricCard("Fleet Avg",     fleetAvgScore + "/10") +
        metricCard("Total Cost",    "$" + abbreviate(totalCost)) +
        metricCard("Worst Score",   minScore === Infinity ? "—" : minScore) +
      "</div>";

    // ── SVG bar chart ────────────────────────────────────────────────────
    //
    // WHY SVG instead of a charting library?
    // Zero dependencies. The chart is simple enough that hand-written SVG
    // is shorter than configuring Chart.js or D3. Every element is visible
    // and editable — good for learning.
    //
    var chartW = 250;
    var barH   = 18;
    var gap    = 6;
    var labelW = 70;
    var chartH = groups.length * (barH + gap);

    html += "<strong style='font-size:11px;color:#8899aa'>Roads by condition</strong><br>";
    html += "<svg width='" + chartW + "' height='" + (chartH + 4) + "' style='display:block;margin:4px 0 10px'>";

    groups.forEach(function (g, i) {
      var y        = i * (barH + gap);
      var barMax   = chartW - labelW - 36;  // space for label + count text
      var barWidth = maxCount > 0 ? Math.max(4, Math.round((g.count / maxCount) * barMax)) : 4;
      var color    = conditionColor(g.label);
      var countTxt = g.count;

      // Label
      html += "<text x='0' y='" + (y + barH - 4) + "' " +
              "font-size='10' fill='#8899aa' font-family='Avenir Next,sans-serif'>" +
              truncate(g.label, 9) + "</text>";

      // Bar
      html += "<rect x='" + labelW + "' y='" + y + "' " +
              "width='" + barWidth + "' height='" + barH + "' " +
              "fill='" + color + "' rx='3'/>";

      // Count
      html += "<text x='" + (labelW + barWidth + 4) + "' y='" + (y + barH - 4) + "' " +
              "font-size='10' fill='#c8dff0' font-family='Avenir Next,sans-serif'>" +
              countTxt + "</text>";
    });
    html += "</svg>";

    // ── Per-group breakdown table ────────────────────────────────────────
    html += "<strong style='font-size:11px;color:#8899aa'>Cost breakdown</strong><br>";
    html += "<table style='width:100%;font-size:11px;border-collapse:collapse;margin-top:4px'>";
    html += "<tr style='color:#7ec8e3'>" +
            "<th style='text-align:left;padding:2px 4px'>Condition</th>" +
            "<th style='text-align:right;padding:2px 4px'>Roads</th>" +
            "<th style='text-align:right;padding:2px 4px'>Est. Cost</th>" +
            "<th style='text-align:right;padding:2px 4px'>Priority</th>" +
            "</tr>";

    groups.forEach(function (g) {
      html += "<tr style='border-top:1px solid #2a3a4a;color:#aabbcc'>" +
              "<td style='padding:3px 4px'>" +
                "<span style='color:" + conditionColor(g.label) + "'>■</span> " + g.label +
              "</td>" +
              "<td style='text-align:right;padding:3px 4px'>" + g.count + "</td>" +
              "<td style='text-align:right;padding:3px 4px'>$" + abbreviate(g.cost) + "</td>" +
              "<td style='text-align:right;padding:3px 4px'>" + g.priority + "</td>" +
              "</tr>";
    });
    html += "</table>";

    container.innerHTML = html;
  }

  /**
   * exportCSV
   * Converts the current analysis result into a CSV file and triggers a download.
   * Uses the browser's Blob + URL.createObjectURL API — no server needed.
   *
   * @param {object} analysisData  — { roadName, schools, hospitals, parcels, roadAvgZ }
   */
  function exportCSV(analysisData) {
    if (!analysisData) return;

    var rows = [];

    // Header
    rows.push(["Type", "Name", "Detail", "Elevation (m)", "Elevation Delta (m)", "Notes"]);

    // Road
    rows.push([
      "Road",
      analysisData.roadName,
      "Condition: " + analysisData.conditionLabel + " (" + analysisData.conditionScore + "/10)",
      Math.round(analysisData.roadAvgZ),
      "0",
      "Repair Priority: " + analysisData.repairPriority,
    ]);

    // Schools
    (analysisData.schools || []).forEach(function (item) {
      var a = item.feature.attributes;
      rows.push([
        "School",
        a.name,
        a.type + " — " + a.enrollment + " students",
        Math.round(item.facilityZ),
        Math.round(item.elevationDelta),
        Math.abs(item.elevationDelta) > 100 ? "WARNING: Significant elevation difference" : "",
      ]);
    });

    // Hospitals
    (analysisData.hospitals || []).forEach(function (item) {
      var a         = item.feature.attributes;
      var emergency = (a.has_emergency === true || a.has_emergency === "true") ? "ER" : "Urgent Care";
      rows.push([
        "Hospital",
        a.name,
        emergency + " — " + a.beds + " beds",
        Math.round(item.facilityZ),
        Math.round(item.elevationDelta),
        Math.abs(item.elevationDelta) > 100 ? "WARNING: Significant elevation difference" : "",
      ]);
    });

    // Parcels
    (analysisData.parcels || []).forEach(function (f) {
      var a = f.attributes;
      rows.push([
        "Parcel",
        a.parcel_id,
        a.owner_name + " — " + a.land_use,
        "—",
        "—",
        "$" + (a.assessed_value_usd || 0).toLocaleString(),
      ]);
    });

    // Convert rows to CSV string
    // WHY manual CSV instead of a library?
    // The dataset is small and the format is simple. One less dependency.
    var csvContent = rows.map(function (row) {
      return row.map(function (cell) {
        // Wrap cells containing commas or quotes in double-quotes
        var str = String(cell).replace(/"/g, '""');
        return /[,"\n]/.test(str) ? '"' + str + '"' : str;
      }).join(",");
    }).join("\n");

    // ── Blob download ────────────────────────────────────────────────────
    //
    // WHY Blob + createObjectURL?
    // We're in a browser with no server. Creating a Blob lets us give the
    // browser a fake "file" URL that triggers the native download dialog.
    // The URL is revoked after 60 seconds to avoid memory leaks.
    //
    var blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    var url  = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "laketon_impact_" + sanitizeFilename(analysisData.roadName) + ".csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  function metricCard(label, value) {
    return "<div style='flex:1;background:#1a2a3a;border:1px solid #2a4a6a;" +
           "border-radius:5px;padding:6px 8px;text-align:center'>" +
           "<div style='font-size:14px;font-weight:bold;color:#7ec8e3'>" + value + "</div>" +
           "<div style='font-size:10px;color:#8899aa;margin-top:2px'>" + label + "</div>" +
           "</div>";
  }

  function conditionColor(label) {
    var l = (label || "").toLowerCase();
    if (l.indexOf("critical") !== -1) return "#dc3232";
    if (l.indexOf("poor")     !== -1) return "#e05a2b";
    if (l.indexOf("fair")     !== -1) return "#ffa500";
    if (l.indexOf("good")     !== -1) return "#32c832";
    return "#7ec8e3";
  }

  function abbreviate(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000)    return (n / 1000).toFixed(0) + "K";
    return String(n);
  }

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + "…" : str;
  }

  function sanitizeFilename(name) {
    return (name || "export").replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  }

  function loadModules(moduleIds) {
    return new Promise(function (resolve, reject) {
      require(moduleIds, function () {
        resolve(Array.prototype.slice.call(arguments));
      }, reject);
    });
  }

  return {
    loadSummary: loadSummary,
    exportCSV:   exportCSV,
  };
});
