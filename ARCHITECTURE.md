# Laketon Smart City — Architecture Document

> **Status:** Locked for Phase 3
> **Last updated:** Phase 2 complete
> **Scope decision:** Keep it simple. Browser-only. No backend. No automation.
> Prove the app logic is sound before introducing data pipeline complexity.

---

## 1. Product Description

**Laketon Infrastructure Analyzer** is a 3D web GIS application for city infrastructure
analysts to assess road repair priority and its impact on nearby critical facilities.

A user selects a road segment, runs a proximity analysis, and receives:
- The road's condition score and estimated repair cost
- A list of schools, hospitals, and parcels within a 500m buffer
- Elevation delta flags — facilities on significantly different terrain than the road
- Impact metrics: total students affected, hospital beds near the corridor, assessed parcel value

All facility attributes (bed counts, enrollment, condition scores) are maintained manually
by city staff using the built-in Editor widget. This is intentional — it eliminates
data pipeline variables so any bug found is an app logic bug, not a sync issue.

---

## 2. Architecture — Locked

```
Browser (localhost:8080 or any static web server)
│
├── index.html          UI shell, ArcGIS CDN, dojoConfig
├── main.js             AMD bootstrap — auth, SceneView, widgets, button wiring
└── src/
    ├── layers.js       FeatureLayer construction, renderers, popup templates
    ├── analysis.js     GeometryEngine buffer, spatial query, elevation delta, report
    └── ui.js           updateReport() — DOM utility

        │  HTTPS + IdentityManager token (auto-attached)
        ▼
ArcGIS Enterprise  (gis15.smartgeoapps.com)
└── /server/rest/services/Hosted/
    ├── Laketon_roads/FeatureServer/0
    ├── parcels/FeatureServer/0
    ├── schools/FeatureServer/0
    └── hospitals/FeatureServer/0
```

**There is no backend service. There is no Python script. There is no ETL pipeline.**
The browser talks directly to Enterprise Feature Services. That is the entire stack.

---

## 3. Locked Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data source | ArcGIS Enterprise Feature Services | Live, queryable, editable, multi-user |
| Attribute maintenance | Manual via Editor widget | Eliminates pipeline as a failure variable |
| Transport mode context | Not included | Adds complexity without changing repair decisions |
| Backend service | None | SDK handles auth, queries, and edits directly in the browser |
| Real-time data | Not in scope | User edits via applyEdits() are the only writes |
| Analysis engine | GeometryEngine (client-side) | Zero latency, no credits, sufficient for 2D buffer + proximity |
| Authentication | IdentityManager.getCredential() | No app registration needed, works for internal Enterprise use |
| Map view | SceneView (3D) | Z elevation differences are meaningful for proximity analysis |
| Road selection | 80m geodesic buffer on click | SceneView hitTest has no tolerance — spatial query is more reliable |
| Module system | Pure AMD define()/require() | Avoids ES module / Dojo loader conflict |
| Basemap | topo-vector | Works without ArcGIS Online API key |

---

## 4. Data Flow

```
1. Page loads
   → IdentityManager.getCredential() → Enterprise login dialog
   → Token cached for session

2. User clicks "Load All Layers"
   → 4x FeatureLayer.when() → layers query schema from FeatureServer
   → Renderers applied, popups configured, Editor widget mounted

3. User clicks a road on the map
   → GeometryEngine.geodesicBuffer(click point, 80m)
   → roads.queryFeatures(buffer) → nearest road selected
   → Road attributes shown in panel, Analyze button enabled

4. User clicks "Analyze Selected Road"
   → GeometryEngine.geodesicBuffer(road geometry, 500m)
   → schools.queryFeatures(500m buffer)
   → hospitals.queryFeatures(500m buffer)
   → parcels.queryFeatures(500m buffer)
   → Z elevation delta calculated for each facility
   → Impact report rendered in panel

5. User clicks Edit (pencil icon, bottom-right)
   → Editor widget opens
   → User updates condition_score, repair_priority, etc.
   → FeatureLayer.applyEdits() → change saved to Enterprise
   → Layer refreshes automatically

6. User clicks "Clear Analysis"
   → GraphicsLayer (buffer + highlights) cleared
   → Panel reset
```

---

## 5. File Responsibilities

| File | Owns | Does NOT own |
|---|---|---|
| `index.html` | Layout, CDN links, dojoConfig | Logic of any kind |
| `main.js` | App bootstrap, auth, SceneView, widget wiring, button events | Layer construction, spatial math |
| `src/layers.js` | FeatureLayer creation, renderers, popup templates | Queries, edits, analysis |
| `src/analysis.js` | Buffer, spatial queries, elevation delta, report HTML | Layer construction, DOM |
| `src/ui.js` | Writing HTML to the report panel | Everything else |

---

## 6. Phase Roadmap

| Phase | Status | Deliverable |
|---|---|---|
| 1 | ✅ Complete | SceneView, GeoJSONLayer, client-side analysis, elevation delta proof-of-concept |
| 2 | ✅ Complete | FeatureLayer, Enterprise auth, Editor widget for manual attribute editing |
| 3 | ✅ Complete | Production hardening — error handling, layer load states, edit confirmation, token recovery, search, draggable UI |
| 4 | ✅ Complete | Dashboard — StatisticDefinition aggregate queries, SVG bar chart, CSV export |
| 5 | ✅ Complete | Presentation layout — Print widget, FeatureLayerView.highlight(), view.goTo(), presentation mode |

---

## 7. What Phase 3 Covers

Phase 3 is not about new features — it is about making what exists reliable.

- **Robust error handling** ✅ — every async call has a visible error state in the panel
- **Layer load feedback** ✅ — individual layer load status (✓/✗) per service
- **Fault-tolerant partial analysis** ✅ — Promise.allSettled so one down service doesn't kill the analysis
- **Token expiry recovery** ✅ — 499 detection + transparent re-login prompt
- **Search widget** ✅ — find roads by name, no click precision required
- **Draggable panel** ✅ — panel can be repositioned, collapses to title bar
- **Edit confirmation** ✅ — reactiveUtils watches Editor viewModel state, shows save result + refreshes panel
- **Browser console clean** ✅ — autocomplete attribute injected on Search input after render
- **Edge case: no road within click radius** ✅ — panel restores to layer status display silently

---

## 8. Explicitly Out of Scope (Do Not Build)

- Python backend / orchestration service
- External API integrations (hospital EHR, school SIS, asset management systems)
- Transport mode analysis
- Real-time sensor data / StreamLayer
- Automated ETL pipelines
- Versioning or branch workflows
- Multi-user conflict resolution
