/* ============================================================
   app.js — Weather Globe frontend logic (CesiumJS + pywebview)
   ============================================================ */

// ── 1. Cesium Viewer Setup ──────────────────────────────────
// No Ion token needed — we use OSM/ESRI tiles directly (no Cesium Ion services)
// Setting an empty/no token avoids the 401 auth error on startup
Cesium.Ion.defaultAccessToken = "";

let viewer;
try {
   viewer = new Cesium.Viewer("cesiumContainer", {
      // baseLayer: false prevents CesiumJS from firing the default async request
      // to api.cesium.com/v1/assets/2 (Ion World Imagery) which causes a 401
      // when no Ion token is provided. We add our own OSM layer below instead.
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      // skyBox:false + skyAtmosphere causes a black globe — keep both or neither
      skyBox: new Cesium.SkyBox({
         sources: {
            positiveX: "https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_px.jpg",
            negativeX: "https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mx.jpg",
            positiveY: "https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_py.jpg",
            negativeY: "https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_my.jpg",
            positiveZ: "https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_pz.jpg",
            negativeZ: "https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mz.jpg",
         },
      }),
      skyAtmosphere: new Cesium.SkyAtmosphere(),
   });

   // ── Add OSM imagery (post-1.104 API) ──
   // Use subdomained OSM URLs (a/b/c) to avoid ERR_QUIC_PROTOCOL_ERROR in Chrome.
   // Chrome's QUIC/HTTP3 path fails on the single-domain tile.openstreetmap.org;
   // rotating across subdomains forces standard HTTP connections.
   // Note: removeAll() is not needed here because baseLayer:false already
   // ensures the viewer starts with zero imagery layers.

   const osmProvider = new Cesium.UrlTemplateImageryProvider({
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      subdomains: ["a", "b", "c"],
      maximumLevel: 19,
      credit: "© OpenStreetMap contributors",
   });

   const osmLayer = viewer.imageryLayers.addImageryProvider(osmProvider);

   // Fallback: if OSM tiles keep failing, silently swap to ESRI World Imagery
   // (no API key required, very reliable).
   let osmFailCount = 0;
   osmProvider.errorEvent.addEventListener(() => {
      osmFailCount++;
      if (osmFailCount === 10) {
         console.warn("⚠️ OSM tiles failing repeatedly — switching to ESRI World Imagery fallback.");
         viewer.imageryLayers.remove(osmLayer, false);
         viewer.imageryLayers.addImageryProvider(
            new Cesium.ArcGisMapServerImageryProvider({
               url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
            })
         );
      }
   });

   // Flat ellipsoid terrain (no Cesium Ion needed)
   viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();

   viewer.scene.globe.enableLighting = false;
   viewer.cesiumWidget.creditContainer.style.display = "none";

   console.log("✅ CesiumJS viewer initialized successfully");
} catch (err) {
   console.error("❌ CesiumJS init failed:", err);
   document.body.innerHTML =
      `<div style="color:#ff6b6b;font-family:monospace;padding:40px;background:#0a0e1a;height:100vh;">
       <h2>⚠️ CesiumJS failed to initialize</h2>
       <pre>${err.message}\n${err.stack}</pre>
     </div>`;
}

// ── 2. Weather-icon map ─────────────────────────────────────
const ICON_MAP = {
   "clear sky": "☀️",
   "few clouds": "🌤️",
   "scattered clouds": "⛅",
   "broken clouds": "🌥️",
   "overcast clouds": "☁️",
   "drizzle": "🌦️",
   "shower rain": "🌦️",
   "light rain": "🌧️",
   "moderate rain": "🌧️",
   "heavy rain": "🌧️",
   "rain": "🌧️",
   "thunderstorm": "⛈️",
   "snow": "❄️",
   "light snow": "🌨️",
   "mist": "🌫️",
   "fog": "🌫️",
   "haze": "🌫️",
   "dust": "🌪️",
   "sand": "🌪️",
};

function getIcon(desc) {
   const d = (desc || "").toLowerCase();
   for (const [k, v] of Object.entries(ICON_MAP)) {
      if (d.includes(k)) return v;
   }
   return "🌡️";
}

// ── 3. Marker management ────────────────────────────────────
let activeMarker = null;

function placeMarker(lat, lon, label) {
   if (activeMarker) viewer.entities.remove(activeMarker);

   activeMarker = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
         pixelSize: 13,
         color: Cesium.Color.fromCssColorString("#00d4ff"),
         outlineColor: Cesium.Color.WHITE,
         outlineWidth: 2,
         disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
         text: label,
         font: "600 12px Inter, sans-serif",
         fillColor: Cesium.Color.WHITE,
         outlineColor: Cesium.Color.BLACK,
         outlineWidth: 2,
         style: Cesium.LabelStyle.FILL_AND_OUTLINE,
         verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
         pixelOffset: new Cesium.Cartesian2(0, -22),
         disableDepthTestDistance: Number.POSITIVE_INFINITY,
         showBackground: true,
         backgroundColor: Cesium.Color.fromCssColorString("rgba(10,14,26,0.82)"),
         backgroundPadding: new Cesium.Cartesian2(8, 5),
      },
   });
}

// ── 4. Camera fly-to ────────────────────────────────────────
function flyTo(lat, lon, altMeters = 1_500_000) {
   viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, altMeters),
      duration: 1.8,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
   });
}

// ── 5. UI helpers ───────────────────────────────────────────
const el = (id) => document.getElementById(id);

function showLoading() { el("loadingOverlay").classList.remove("hidden"); }
function hideLoading() { el("loadingOverlay").classList.add("hidden"); }

let toastTimer = null;
function showToast(msg) {
   const t = el("toast");
   t.textContent = msg;
   t.classList.remove("hidden");
   clearTimeout(toastTimer);
   toastTimer = setTimeout(() => t.classList.add("hidden"), 3500);
}

function showPanel() {
   el("weatherPanel").classList.remove("hidden");
   el("hint").classList.add("hidden");
}

function hidePanel() { el("weatherPanel").classList.add("hidden"); }

// ── 6. Render weather data into the panel ───────────────────
function renderWeather(data) {
   hideLoading();

   // API error or network error
   if (data.error) { showToast(data.error); return; }
   if (data.cod && data.cod !== 200) {
      showToast(data.message || "Location not found.");
      return;
   }

   const city = data.name || "Unknown";
   const country = data.sys?.country || "";
   const temp = Math.round(data.main?.temp ?? 0);
   const feels = Math.round(data.main?.feels_like ?? 0);
   const desc = data.weather?.[0]?.description || "—";
   const humidity = data.main?.humidity ?? "—";
   const wind = data.wind?.speed ?? "—";
   const pressure = data.main?.pressure ?? "—";
   const visKm = data.visibility != null
      ? (data.visibility / 1000).toFixed(1)
      : "—";
   const lat = data.coord?.lat;
   const lon = data.coord?.lon;

   el("cityName").textContent = city;
   el("countryName").textContent = country;
   el("temperature").textContent = `${temp}°C`;
   el("feelsLike").textContent = `Feels like ${feels}°C`;
   el("weatherDesc").textContent = desc.charAt(0).toUpperCase() + desc.slice(1);
   el("weatherEmoji").textContent = getIcon(desc);
   el("humidity").textContent = `${humidity}%`;
   el("windSpeed").textContent = `${wind} m/s`;
   el("pressure").textContent = `${pressure} hPa`;
   el("visibility").textContent = `${visKm} km`;

   showPanel();

   if (lat != null && lon != null) {
      placeMarker(lat, lon, city);
      flyTo(lat, lon);
   }
}

// ── 7. API call wrappers ────────────────────────────────────
async function getWeatherByCity(city) {
   showLoading();
   try {
      const data = await window.pywebview.api.fetch_weather_by_city(city);
      renderWeather(data);
   } catch (err) {
      hideLoading();
      showToast("Failed to reach backend.");
      console.error(err);
   }
}

async function getWeatherByCoords(lat, lon) {
   showLoading();
   try {
      const data = await window.pywebview.api.fetch_weather_by_coords(lat, lon);
      renderWeather(data);
   } catch (err) {
      hideLoading();
      showToast("Failed to reach backend.");
      console.error(err);
   }
}

// ── 8. Globe click handler ──────────────────────────────────
const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction(function (click) {
   const cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
   if (!cartesian) return;

   const carto = Cesium.Cartographic.fromCartesian(cartesian);
   const lat = Cesium.Math.toDegrees(carto.latitude);
   const lon = Cesium.Math.toDegrees(carto.longitude);
   getWeatherByCoords(lat, lon);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// ── 9. Search bar ───────────────────────────────────────────
function doSearch() {
   const city = el("searchInput").value.trim();
   if (!city) { showToast("Please enter a city name."); return; }
   getWeatherByCity(city);
}

el("searchBtn").addEventListener("click", doSearch);
el("searchInput").addEventListener("keydown", (e) => {
   if (e.key === "Enter") doSearch();
});

// ── 10. Close panel ─────────────────────────────────────────
el("closePanel").addEventListener("click", () => {
   hidePanel();
   el("hint").classList.remove("hidden");
});

// ── 11. Wait for pywebview to be ready ──────────────────────
window.addEventListener("pywebviewready", () => {
   console.log("pywebview bridge ready ✓");
});
