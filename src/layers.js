/**
 * layers.js — Layer creation and symbology
 *
 * PHASE 3 CHANGES:
 *   - Per-layer load status reported individually via onLayerStatus callback
 *   - Each FeatureLayer.when() has its own error handler so one failed service
 *     does not prevent the other three from loading
 *   - Layer load failures are visible in the panel, not swallowed silently
 *
 * WHY per-layer status instead of a single Promise.all?
 * Promise.all rejects as soon as any one promise rejects — if the hospitals
 * service is down, you lose schools, parcels, and roads too even though they
 * loaded fine. Promise.allSettled waits for every layer and lets us report
 * which ones succeeded and which failed individually.
 */

define([], function () {

  var URLS = {
    roads:     "https://gis15.smartgeoapps.com/server/rest/services/Hosted/Laketon_roads/FeatureServer/0",
    parcels:   "https://gis15.smartgeoapps.com/server/rest/services/Hosted/parcels/FeatureServer/0",
    schools:   "https://gis15.smartgeoapps.com/server/rest/services/Hosted/schools/FeatureServer/0",
    hospitals: "https://gis15.smartgeoapps.com/server/rest/services/Hosted/hospitals/FeatureServer/0",
  };

  /**
   * initLayers
   * @param {esri/Map} map
   * @param {esri/views/SceneView} view
   * @param {Function} onLayerStatus  — callback(name, status, error?)
   *   Called for each layer as it resolves or rejects.
   *   status is "loading" | "loaded" | "error"
   * @returns {Promise<{roads, parcels, schools, hospitals}>}
   *   Resolves with whatever layers loaded successfully.
   *   Rejects only if ALL layers failed.
   */
  function initLayers(map, view, onLayerStatus) {
    onLayerStatus = onLayerStatus || function () {};

    return loadModules([
      "esri/layers/FeatureLayer",
      "esri/renderers/SimpleRenderer",
      "esri/renderers/UniqueValueRenderer",
      "esri/renderers/ClassBreaksRenderer",
      "esri/symbols/SimpleLineSymbol",
      "esri/symbols/SimpleMarkerSymbol",
      "esri/symbols/SimpleFillSymbol",
    ]).then(function (modules) {
      var FeatureLayer        = modules[0];
      var SimpleRenderer      = modules[1];
      var UniqueValueRenderer = modules[2];
      var ClassBreaksRenderer = modules[3];
      var SimpleLineSymbol    = modules[4];
      var SimpleMarkerSymbol  = modules[5];
      var SimpleFillSymbol    = modules[6];

      // ── Roads ────────────────────────────────────────────────────────────
      var roadsRenderer = new ClassBreaksRenderer({
        field: "condition_score",
        defaultSymbol: new SimpleLineSymbol({ color: [128, 128, 128], width: 2 }),
        classBreakInfos: [
          {
            minValue: 1, maxValue: 3,
            symbol: new SimpleLineSymbol({ color: [220, 50, 50], width: 4, style: "solid" }),
            label: "Critical / Poor (1–3)",
          },
          {
            minValue: 4, maxValue: 6,
            symbol: new SimpleLineSymbol({ color: [255, 165, 0], width: 3, style: "solid" }),
            label: "Fair (4–6)",
          },
          {
            minValue: 7, maxValue: 10,
            symbol: new SimpleLineSymbol({ color: [50, 200, 100], width: 2, style: "solid" }),
            label: "Good (7–10)",
          },
        ],
      });

      var roadsLayer = new FeatureLayer({
        url:          URLS.roads,
        title:        "Road Segments",
        renderer:     roadsRenderer,
        outFields:    ["*"],
        elevationInfo: { mode: "absolute-height", unit: "meters" },
        popupTemplate: {
          title: "🛣️ {name}",
          content: [{
            type: "fields",
            fieldInfos: [
              { fieldName: "road_id",                   label: "Road ID" },
              { fieldName: "condition_label",            label: "Condition" },
              { fieldName: "condition_score",            label: "Score (1–10)" },
              { fieldName: "repair_priority",            label: "Repair Priority" },
              { fieldName: "surface_type",               label: "Surface Type" },
              { fieldName: "lanes",                      label: "Lanes" },
              { fieldName: "speed_limit_mph",            label: "Speed Limit (mph)" },
              { fieldName: "last_inspection",            label: "Last Inspection" },
              { fieldName: "estimated_repair_cost_usd",  label: "Est. Repair Cost ($)",
                format: { digitSeparator: true, places: 0 } },
            ],
          }],
        },
      });

      // ── Parcels ──────────────────────────────────────────────────────────
      var parcelsRenderer = new UniqueValueRenderer({
        field: "land_use",
        defaultSymbol: new SimpleFillSymbol({
          color: [180, 180, 180, 0.3],
          outline: { color: [100, 100, 100], width: 0.5 },
        }),
        uniqueValueInfos: [
          { value: "Residential",
            symbol: new SimpleFillSymbol({ color: [255, 235, 150, 0.45], outline: { color: [200, 180, 80], width: 0.8 } }),
            label: "Residential" },
          { value: "Commercial",
            symbol: new SimpleFillSymbol({ color: [100, 180, 255, 0.45], outline: { color: [60, 120, 200], width: 0.8 } }),
            label: "Commercial" },
          { value: "Public / School",
            symbol: new SimpleFillSymbol({ color: [150, 255, 150, 0.45], outline: { color: [80, 200, 80], width: 0.8 } }),
            label: "Public / School" },
          { value: "Public / Charter School",
            symbol: new SimpleFillSymbol({ color: [150, 255, 150, 0.45], outline: { color: [80, 200, 80], width: 0.8 } }),
            label: "Public / Charter School" },
          { value: "Medical / Hospital",
            symbol: new SimpleFillSymbol({ color: [255, 150, 150, 0.45], outline: { color: [220, 80, 80], width: 0.8 } }),
            label: "Medical / Hospital" },
          { value: "Mixed Use",
            symbol: new SimpleFillSymbol({ color: [200, 150, 255, 0.45], outline: { color: [150, 80, 220], width: 0.8 } }),
            label: "Mixed Use" },
        ],
      });

      var parcelsLayer = new FeatureLayer({
        url:          URLS.parcels,
        title:        "Land Parcels",
        renderer:     parcelsRenderer,
        outFields:    ["*"],
        opacity:      0.8,
        elevationInfo: { mode: "on-the-ground" },
        popupTemplate: {
          title: "📦 Parcel {parcel_id}",
          content: [{
            type: "fields",
            fieldInfos: [
              { fieldName: "owner_name",         label: "Owner" },
              { fieldName: "land_use",           label: "Land Use" },
              { fieldName: "zoning",             label: "Zoning" },
              { fieldName: "address",            label: "Address" },
              { fieldName: "area_sqft",          label: "Area (sq ft)", format: { digitSeparator: true, places: 0 } },
              { fieldName: "assessed_value_usd", label: "Assessed Value ($)", format: { digitSeparator: true, places: 0 } },
            ],
          }],
        },
      });

      // ── Schools ──────────────────────────────────────────────────────────
      var schoolsLayer = new FeatureLayer({
        url:          URLS.schools,
        title:        "Schools",
        renderer:     new SimpleRenderer({
          symbol: new SimpleMarkerSymbol({
            style: "square", color: [50, 205, 100], size: "14px",
            outline: { color: [255, 255, 255], width: 1.5 },
          }),
        }),
        outFields:    ["*"],
        elevationInfo: { mode: "absolute-height" },
        popupTemplate: {
          title: "🏫 {name}",
          content: [{
            type: "fields",
            fieldInfos: [
              { fieldName: "facility_id",    label: "Facility ID" },
              { fieldName: "type",           label: "School Type" },
              { fieldName: "enrollment",     label: "Enrollment", format: { digitSeparator: true } },
              { fieldName: "principal",      label: "Principal" },
              { fieldName: "phone",          label: "Phone" },
              { fieldName: "address",        label: "Address" },
              { fieldName: "has_bus_access", label: "Bus Access" },
              { fieldName: "elevation_m",    label: "Elevation (m)" },
              { fieldName: "note",           label: "Notes" },
            ],
          }],
        },
      });

      // ── Hospitals ────────────────────────────────────────────────────────
      var hospitalsLayer = new FeatureLayer({
        url:          URLS.hospitals,
        title:        "Hospitals & Clinics",
        renderer:     new SimpleRenderer({
          symbol: new SimpleMarkerSymbol({
            style: "circle", color: [220, 60, 60], size: "16px",
            outline: { color: [255, 255, 255], width: 2 },
          }),
        }),
        outFields:    ["*"],
        elevationInfo: { mode: "absolute-height" },
        popupTemplate: {
          title: "🏥 {name}",
          content: [{
            type: "fields",
            fieldInfos: [
              { fieldName: "facility_id",   label: "Facility ID" },
              { fieldName: "type",          label: "Facility Type" },
              { fieldName: "beds",          label: "Total Beds" },
              { fieldName: "has_emergency", label: "Emergency Dept" },
              { fieldName: "helipad",       label: "Helipad" },
              { fieldName: "phone",         label: "Emergency Phone" },
              { fieldName: "address",       label: "Address" },
              { fieldName: "elevation_m",   label: "Elevation (m)" },
              { fieldName: "note",          label: "Access Notes" },
            ],
          }],
        },
      });

      // ── Add all to map ───────────────────────────────────────────────────
      map.addMany([parcelsLayer, roadsLayer, schoolsLayer, hospitalsLayer]);

      // ── Per-layer load tracking with Promise.allSettled ──────────────────
      //
      // WHY allSettled instead of Promise.all?
      // Promise.all fails fast — one rejected layer kills all four.
      // allSettled waits for every layer and gives us individual pass/fail.
      // We can report "Roads failed, but Schools, Hospitals and Parcels loaded"
      // instead of a single cryptic "load failed" message.
      //
      var layerDefs = [
        { key: "roads",     layer: roadsLayer     },
        { key: "parcels",   layer: parcelsLayer   },
        { key: "schools",   layer: schoolsLayer   },
        { key: "hospitals", layer: hospitalsLayer },
      ];

      layerDefs.forEach(function (def) {
        onLayerStatus(def.key, "loading");
      });

      var whenPromises = layerDefs.map(function (def) {
        return def.layer.when()
          .then(function ()  { onLayerStatus(def.key, "loaded"); return { key: def.key, layer: def.layer }; })
          .catch(function (err) { onLayerStatus(def.key, "error", err); return { key: def.key, error: err }; });
      });

      return Promise.all(whenPromises).then(function (results) {
        var loaded = {};
        var failed = [];

        results.forEach(function (r) {
          if (r.error) { failed.push(r.key); }
          else         { loaded[r.key] = r.layer; }
        });

        // If roads failed, the app can't do analysis — reject
        if (!loaded.roads) {
          return Promise.reject(new Error(
            "Roads layer failed to load — analysis is not possible. " +
            "Check the Feature Service at: " + URLS.roads
          ));
        }

        // Other layers failing is recoverable — analysis will skip them
        if (failed.length > 0) {
          console.warn("Some layers failed to load:", failed.join(", "));
        }

        return {
          roads:     loaded.roads,
          parcels:   loaded.parcels   || null,
          schools:   loaded.schools   || null,
          hospitals: loaded.hospitals || null,
        };
      });
    });
  }

  function loadModules(moduleIds) {
    return new Promise(function (resolve, reject) {
      require(moduleIds, function () {
        resolve(Array.prototype.slice.call(arguments));
      }, reject);
    });
  }

  return { initLayers: initLayers };
});
