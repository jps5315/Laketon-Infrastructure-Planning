/**
 * analysis.js — Proximity and impact analysis
 *
 * PHASE 3 CHANGES:
 *   - Promise.allSettled replaces Promise.all for the three spatial queries
 *     so one unavailable service doesn't cancel the entire analysis
 *   - Each query failure is reported individually in the impact report
 *   - Null layer guards — if a layer failed to load, its query is skipped
 *   - Buffer null check with explicit error message
 */

define([], function () {

  var BUFFER_RADIUS_METERS = 500;

  /**
   * runProximityAnalysis
   * 1. Geodesic buffer around the selected road
   * 2. Draw buffer + road highlight on map
   * 3. Fault-tolerant spatial queries — schools, hospitals, parcels
   * 4. Z elevation delta annotation for facilities
   * 5. Return HTML impact report
   *
   * @param {esri/views/SceneView} view
   * @param {esri/Graphic} roadGraphic  — fully hydrated feature from queryFeatures()
   * @returns {Promise<{reportHtml: string}>}
   */
  function runProximityAnalysis(view, roadGraphic) {
    return loadModules([
      "esri/geometry/geometryEngine",
      "esri/layers/GraphicsLayer",
      "esri/Graphic",
    ]).then(function (modules) {
      var GeometryEngine = modules[0];
      var GraphicsLayer  = modules[1];
      var Graphic        = modules[2];

      var roadGeometry = roadGraphic.geometry;
      var roadAttrs    = roadGraphic.attributes;

      // ── Step 1: Geodesic buffer ──────────────────────────────────────────
      //
      // WHY geodesic?
      // Planar buffers use flat projected coordinates. At ~39.7°N a planar
      // 500m buffer is measurably larger than 500m on the Earth's surface.
      // Geodesic buffers account for curvature — correct for city planning.
      //
      var bufferGeometry = GeometryEngine.geodesicBuffer(
        roadGeometry, BUFFER_RADIUS_METERS, "meters"
      );

      if (!bufferGeometry) {
        return Promise.reject(new Error(
          "Geodesic buffer returned null. " +
          "The road geometry may be missing Z coordinates or have an invalid spatial reference. " +
          "Ensure the roads Feature Service was loaded with returnGeometry: true."
        ));
      }

      // ── Step 2: Analysis graphics layer ─────────────────────────────────
      //
      // WHY findLayerById before creating?
      // The user may run analysis multiple times. We reuse the existing
      // GraphicsLayer and call removeAll() rather than adding duplicate layers.
      //
      var analysisLayer = view.map.findLayerById("analysis-layer");
      if (!analysisLayer) {
        analysisLayer = new GraphicsLayer({
          id:    "analysis-layer",
          title: "Analysis Results",
        });
        view.map.add(analysisLayer);
      }
      analysisLayer.removeAll();

      // Buffer polygon — dashed blue outline, transparent fill
      analysisLayer.add(new Graphic({
        geometry: bufferGeometry,
        symbol: {
          type: "simple-fill",
          color: [100, 180, 255, 0.12],
          outline: { color: [100, 180, 255, 0.9], width: 1.5, style: "dash" },
        },
      }));

      // Yellow highlight over the selected road
      analysisLayer.add(new Graphic({
        geometry: roadGeometry,
        symbol: { type: "simple-line", color: [255, 255, 0], width: 5, style: "solid" },
      }));

      // ── Step 3: Fault-tolerant spatial queries ───────────────────────────
      //
      // WHY Promise.allSettled instead of Promise.all?
      // Promise.all rejects the moment any single query fails.
      // If the hospitals Feature Service is temporarily unavailable,
      // Promise.all would cancel the schools and parcels queries too.
      // Promise.allSettled runs all three regardless — we get partial results
      // and report which service was unavailable rather than failing silently.
      //
      var schoolsLayer   = view.map.layers.find(function (l) { return l.title === "Schools"; });
      var hospitalsLayer = view.map.layers.find(function (l) { return l.title === "Hospitals & Clinics"; });
      var parcelsLayer   = view.map.layers.find(function (l) { return l.title === "Land Parcels"; });

      var spatialQuery = {
        geometry:            bufferGeometry,
        spatialRelationship: "intersects",
        returnGeometry:      true,
        outFields:           ["*"],
      };

      // Build query promises — null-guard each layer in case it failed to load
      var schoolsPromise   = schoolsLayer
        ? schoolsLayer.queryFeatures(spatialQuery)
        : Promise.reject(new Error("Schools layer not available"));

      var hospitalsPromise = hospitalsLayer
        ? hospitalsLayer.queryFeatures(spatialQuery)
        : Promise.reject(new Error("Hospitals layer not available"));

      var parcelsPromise   = parcelsLayer
        ? parcelsLayer.queryFeatures(spatialQuery)
        : Promise.reject(new Error("Parcels layer not available"));

      return Promise.allSettled([
        schoolsPromise,
        hospitalsPromise,
        parcelsPromise,
      ]).then(function (results) {
        // Extract features or empty arrays from each settled result
        var schoolFeatures   = results[0].status === "fulfilled" ? results[0].value.features : [];
        var hospitalFeatures = results[1].status === "fulfilled" ? results[1].value.features : [];
        var parcelFeatures   = results[2].status === "fulfilled" ? results[2].value.features : [];

        // Track which queries failed for the report
        var queryWarnings = [];
        if (results[0].status === "rejected") queryWarnings.push("Schools (" + results[0].reason.message + ")");
        if (results[1].status === "rejected") queryWarnings.push("Hospitals (" + results[1].reason.message + ")");
        if (results[2].status === "rejected") queryWarnings.push("Parcels (" + results[2].reason.message + ")");

        // ── Step 4: Z elevation delta annotation ──────────────────────────
        //
        // geodesicBuffer() is 2D — it finds facilities within 500m in XY.
        // A hospital on a 240m cliff is inside the 2D buffer but unreachable
        // from the valley road. We calculate elevation delta and flag it.
        //
        var roadAvgZ           = average(getRoadZValues(roadGeometry));
        var annotatedSchools   = annotateWithElevationDelta(schoolFeatures,   roadAvgZ);
        var annotatedHospitals = annotateWithElevationDelta(hospitalFeatures, roadAvgZ);

        // ── Step 5: Draw result markers ────────────────────────────────────
        // Orange = significantly elevated (>100m delta), Yellow = same terrain
        annotatedSchools.concat(annotatedHospitals).forEach(function (item) {
          var elevated = Math.abs(item.elevationDelta) > 100;
          analysisLayer.add(new Graphic({
            geometry: item.feature.geometry,
            symbol: {
              type: "simple-marker",
              style: "circle",
              color: elevated ? [255, 120, 0] : [255, 255, 0],
              size: "12px",
              outline: { color: [0, 0, 0], width: 1.5 },
            },
          }));
        });

        var reportHtml = buildReport(
          roadAttrs,
          annotatedSchools,
          annotatedHospitals,
          parcelFeatures,
          roadAvgZ,
          queryWarnings
        );

        // Return raw data alongside HTML so the dashboard can export it
        return {
          reportHtml:     reportHtml,
          roadName:       roadAttrs.name || roadAttrs.road_id,
          conditionLabel: roadAttrs.condition_label,
          conditionScore: roadAttrs.condition_score,
          repairPriority: roadAttrs.repair_priority,
          roadAvgZ:       roadAvgZ,
          schools:        annotatedSchools,
          hospitals:      annotatedHospitals,
          parcels:        parcelFeatures,
        };
      });
    });
  }

  /**
   * clearAnalysis — removes all analysis graphics from the map
   */
  function clearAnalysis(view) {
    var analysisLayer = view.map.findLayerById("analysis-layer");
    if (analysisLayer) analysisLayer.removeAll();
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  function getRoadZValues(lineGeometry) {
    var zValues = [];
    if (!lineGeometry || !lineGeometry.paths) return [0];
    lineGeometry.paths.forEach(function (path) {
      path.forEach(function (vertex) {
        if (vertex && typeof vertex === "object" && !Array.isArray(vertex)) {
          if (vertex.z != null) zValues.push(vertex.z);
        } else if (Array.isArray(vertex) && vertex.length >= 3) {
          zValues.push(vertex[2]);
        }
      });
    });
    return zValues.length > 0 ? zValues : [0];
  }

  function average(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
  }

  function annotateWithElevationDelta(features, roadAvgZ) {
    return features.map(function (feature) {
      var geom = feature.geometry;
      var facilityZ = (geom && geom.z != null && !isNaN(geom.z)) ? geom.z : roadAvgZ;
      return { feature: feature, elevationDelta: facilityZ - roadAvgZ, facilityZ: facilityZ };
    });
  }

  function buildReport(roadAttrs, schools, hospitals, parcels, roadAvgZ, warnings) {
    var roadName  = roadAttrs.name || roadAttrs.road_id;
    var totalPop  = schools.reduce(function (s, i)   { return s + (i.feature.attributes.enrollment || 0); }, 0);
    var totalBeds = hospitals.reduce(function (s, i) { return s + (i.feature.attributes.beds || 0); }, 0);

    var html = "<strong>Impact Report — " + roadName + "</strong><br>";
    html += "Avg Elevation: " + Math.round(roadAvgZ) + "m &nbsp;|&nbsp; Buffer: " + BUFFER_RADIUS_METERS + "m<br>";
    html += "<hr style='border-color:#2a3a4a;margin:6px 0'>";

    // Schools
    html += "<strong>🏫 Schools within " + BUFFER_RADIUS_METERS + "m: " + schools.length + "</strong><br>";
    if (schools.length === 0) {
      html += "<em>None found.</em><br>";
    } else {
      schools.forEach(function (item) {
        var a    = item.feature.attributes;
        var flag = Math.abs(item.elevationDelta) > 100
          ? " ⚠️ <em>+" + Math.round(item.elevationDelta) + "m elevation</em>" : "";
        html += "• " + a.name + " (" + a.type + ", " + a.enrollment + " students)" + flag + "<br>";
      });
      html += "Students potentially affected: <strong>" + totalPop + "</strong><br>";
    }

    // Hospitals
    html += "<br><strong>🏥 Hospitals within " + BUFFER_RADIUS_METERS + "m: " + hospitals.length + "</strong><br>";
    if (hospitals.length === 0) {
      html += "<em>None found.</em><br>";
    } else {
      hospitals.forEach(function (item) {
        var a        = item.feature.attributes;
        var flag     = Math.abs(item.elevationDelta) > 100
          ? " ⚠️ <em>+" + Math.round(item.elevationDelta) + "m — different terrain</em>" : "";
        var emergency = (a.has_emergency === true || a.has_emergency === "true") ? "🚨 ER" : "Urgent Care";
        html += "• " + a.name + " (" + emergency + ", " + a.beds + " beds)" + flag + "<br>";
      });
      html += "Hospital beds near corridor: <strong>" + totalBeds + "</strong><br>";
    }

    // Parcels
    html += "<br><strong>📦 Parcels in corridor: " + parcels.length + "</strong><br>";
    if (parcels.length > 0) {
      var totalValue = parcels.reduce(function (s, f) { return s + (f.attributes.assessed_value_usd || 0); }, 0);
      parcels.forEach(function (f) {
        var a = f.attributes;
        html += "• " + a.parcel_id + " — " + a.owner_name + " (" + a.land_use + ")<br>";
      });
      html += "Total assessed value: <strong>$" + totalValue.toLocaleString() + "</strong><br>";
    }

    // Service warnings — shown at the bottom, not as a top-level error
    if (warnings && warnings.length > 0) {
      html += "<br><em style='color:#ffaa44'>⚠ Partial results — unavailable services: "
        + warnings.join("; ") + "</em>";
    }

    return html;
  }

  function loadModules(moduleIds) {
    return new Promise(function (resolve, reject) {
      require(moduleIds, function () {
        resolve(Array.prototype.slice.call(arguments));
      }, reject);
    });
  }

  return {
    runProximityAnalysis: runProximityAnalysis,
    clearAnalysis:        clearAnalysis,
  };
});
