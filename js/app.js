/**
 * Dehradun GIS Portal - Decision Support System (DSS) Main Controller
 * Simplified Architecture with Slum Locations & Population Density
 */

document.addEventListener('DOMContentLoaded', function () {
    // Proj4 UTM 44N definition
    if (typeof proj4 !== 'undefined') {
        proj4.defs("EPSG:32644", "+proj=utm +zone=44 +datum=WGS84 +units=m +no_defs");
    }

    // Application State
    const App = {
        map: null,
        baseLayers: {},
        currentBasemap: 'osm',
        layers: {}, // id -> { layerObj, meta, type, active, bounds }
        rasterManifest: [],
        vectorManifest: [],
        landmarks: [],
        activeMode: 'identify' // 'identify' | 'pan'
    };

    // Initialize Map
    initMap();

    // Load Data Manifests
    loadManifests();

    // Setup Global UI Events
    setupUI();

    function initMap() {
        // Dehradun City Center & Initial Bounds
        const dehradunCenter = [30.3244, 78.0418];
        App.map = L.map('map', {
            center: dehradunCenter,
            zoom: 12,
            zoomControl: false,
            attributionControl: true
        });

        // Define Base Layers
        App.baseLayers = {
            'osm': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors | Dehradun GIS DSS'
            }),
            'satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 18,
                attribution: 'Tiles © Esri'
            }),
            'carto-light': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                maxZoom: 19,
                attribution: '© CartoDB Positron'
            }),
            'carto-dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                maxZoom: 19,
                attribution: '© CartoDB Dark Matter'
            }),
            'topo': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                maxZoom: 17,
                attribution: '© OpenStreetMap, SRTM | OpenTopoMap'
            })
        };

        // Add Default OpenStreetMap base layer
        App.baseLayers['osm'].addTo(App.map);

        // Map Event: Track Cursor Coordinates
        App.map.on('mousemove', function (e) {
            updateCoordinateDisplay(e.latlng);
        });

        // Map Event: Update Zoom Level
        App.map.on('zoomend', function () {
            const zoomElem = document.getElementById('map-zoom-level');
            if (zoomElem) zoomElem.textContent = `Zoom: ${App.map.getZoom()}`;
        });

        // Map Event: Feature Info / Identify on Click
        App.map.on('click', function (e) {
            if (App.activeMode === 'identify') {
                handlePointIdentify(e.latlng);
            }
        });

        // Initialize Measurement Module
        MeasurementTool.init(App.map);

        // Initialize Layer Upload Module
        UploadModule.init(App.map);
    }

    function loadManifests() {
        // Fetch Raster Manifest
        fetch('data/raster_manifest.json')
            .then(res => res.json())
            .then(rasters => {
                App.rasterManifest = rasters;
                initRasterLayers(rasters);

                // Initialize DSS Module with raster data
                DSSModule.init(App.map, rasters);
            })
            .catch(err => console.error('Error loading raster manifest:', err));

        // Fetch Vector Manifest
        fetch('data/vector_manifest.json')
            .then(res => res.json())
            .then(vectors => {
                App.vectorManifest = vectors;
                initVectorLayers(vectors);
            })
            .catch(err => console.error('Error loading vector manifest:', err));

        // Fetch Landmarks for Search Autocomplete
        fetch('data/landmarks.json')
            .then(res => res.json())
            .then(landmarks => {
                App.landmarks = landmarks;
                setupLandmarkSearch(landmarks);
            })
            .catch(err => console.error('Error loading landmarks:', err));
    }

    // 1. Initialize Raster Layers
    function initRasterLayers(rasters) {
        const dssContainer = document.getElementById('list-dss-rasters');
        const countBadge = document.getElementById('count-dss-rasters');
        if (countBadge) countBadge.textContent = rasters.length;

        rasters.forEach(r => {
            const layerObj = L.imageOverlay(r.url, r.bounds, {
                opacity: 0.85,
                interactive: false
            });

            // Flood Inundation active by default
            const isDefaultActive = (r.id === 'flood_inundation');

            App.layers[r.id] = {
                layerObj: layerObj,
                meta: r,
                type: 'raster',
                active: isDefaultActive,
                bounds: r.bounds
            };

            if (isDefaultActive) {
                layerObj.addTo(App.map);
            }

            // Create sidebar layer card
            if (dssContainer) {
                const card = createLayerCard(r.id, r.name, r.category, r.unit, isDefaultActive, r.legend);
                dssContainer.appendChild(card);
            }
        });

        updateLegendDock();
    }

    // 2. Initialize Vector Layers
    function initVectorLayers(vectors) {
        const vulnContainer = document.getElementById('list-vulnerability-layers');
        const hydroContainer = document.getElementById('list-hydro-layers');
        const adminContainer = document.getElementById('list-admin-layers');
        const urbanContainer = document.getElementById('list-urban-layers');

        let countVuln = 0, countHydro = 0, countAdmin = 0, countUrban = 0;

        vectors.forEach(v => {
            const isDefaultActive = v.activeDefault || false;

            // Register in App.layers immediately
            App.layers[v.id] = {
                layerObj: null,
                meta: v,
                type: 'vector',
                active: false,
                bounds: null,
                isLoading: false
            };

            // Append card to corresponding group
            const card = createLayerCard(v.id, v.name, v.category, '', isDefaultActive, v.legend);

            if (v.category.includes('Demographics') || v.category.includes('Vulnerability')) {
                if (vulnContainer) vulnContainer.appendChild(card);
                countVuln++;
            } else if (v.category.includes('Hydrology') || v.category.includes('Drainage')) {
                if (hydroContainer) hydroContainer.appendChild(card);
                else if (adminContainer) adminContainer.appendChild(card);
                countHydro++;
            } else if (v.category.includes('Geology') || v.category.includes('Administrative') || v.category.includes('Boundaries')) {
                if (adminContainer) adminContainer.appendChild(card);
                countAdmin++;
            } else {
                if (urbanContainer) urbanContainer.appendChild(card);
                else if (adminContainer) adminContainer.appendChild(card);
                countUrban++;
            }

            // If active by default, load and display immediately
            if (isDefaultActive) {
                loadAndActivateVectorLayer(v.id);
            }
        });

        const badgeVuln = document.getElementById('count-vuln-layers');
        if (badgeVuln) badgeVuln.textContent = countVuln;
        const badgeHydro = document.getElementById('count-hydro-layers');
        if (badgeHydro) badgeHydro.textContent = countHydro;
        const badgeAdmin = document.getElementById('count-admin-layers');
        if (badgeAdmin) badgeAdmin.textContent = countAdmin;
        const badgeUrban = document.getElementById('count-urban-layers');
        if (badgeUrban) badgeUrban.textContent = countUrban;
    }

    function loadAndActivateVectorLayer(id, callback) {
        const item = App.layers[id];
        if (!item) return;

        if (item.layerObj) {
            if (!App.map.hasLayer(item.layerObj)) {
                App.map.addLayer(item.layerObj);
            }
            item.active = true;
            syncUIState(id, true);
            updateLegendDock();
            if (callback) callback();
            return;
        }

        if (item.isLoading) return;
        item.isLoading = true;

        const btnToggle = document.getElementById(`btn-toggle-${id}`);
        if (btnToggle) btnToggle.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';

        const chip = document.querySelector(`.quick-chip[data-layer-id="${id}"]`);
        if (chip) {
            const badge = chip.querySelector('.badge-status');
            if (badge) {
                badge.className = 'badge-status';
                badge.textContent = '...';
            }
        }

        const v = item.meta;
        fetch(v.url)
            .then(res => res.json())
            .then(geojsonData => {
                let layerObj = null;

                if (v.isChoropleth) {
                    layerObj = createChoroplethLayer(v, geojsonData);
                } else if (v.id === 'vec_slum_locations') {
                    layerObj = createSlumLayer(v, geojsonData);
                } else {
                    layerObj = createVectorLayer(v, geojsonData);
                }

                item.layerObj = layerObj;
                item.bounds = layerObj.getBounds();
                item.isLoading = false;
                item.active = true;

                App.map.addLayer(layerObj);
                syncUIState(id, true);
                updateLegendDock();
                if (callback) callback();
            })
            .catch(err => {
                console.error(`Error loading vector layer ${id}:`, err);
                item.isLoading = false;
                syncUIState(id, false);
            });
    }

    function deactivateVectorLayer(id) {
        const item = App.layers[id];
        if (!item || !item.layerObj) return;
        App.map.removeLayer(item.layerObj);
        item.active = false;
        syncUIState(id, false);
        updateLegendDock();
    }

    // Population Density Choropleth Color Scale
    function getDensityColor(d) {
        return d > 50000 ? '#bd0026' :
               d > 30000 ? '#f03b20' :
               d > 15000 ? '#fd8d3c' :
               d > 5000  ? '#fecc5c' :
                           '#ffffb2';
    }

    function createChoroplethLayer(config, data) {
        return L.geoJSON(data, {
            style: function (feature) {
                const density = feature.properties ? feature.properties.population_density || 0 : 0;
                return {
                    fillColor: getDensityColor(density),
                    weight: 1.5,
                    opacity: 1,
                    color: '#ffffff',
                    dashArray: '2',
                    fillOpacity: 0.75
                };
            },
            onEachFeature: function (feature, layer) {
                if (feature.properties) {
                    const p = feature.properties;
                    const pop = p.population ? parseInt(p.population).toLocaleString() : 'N/A';
                    const density = p.population_density ? Math.round(p.population_density).toLocaleString() : 'N/A';
                    const area = p.area_km2 ? p.area_km2 + ' km²' : 'N/A';

                    const html = `
                        <div class="p-1" style="min-width: 200px;">
                            <div class="fw-bold text-primary border-bottom pb-1 mb-1">
                                <i class="fa fa-city"></i> Ward ${p.ward_no || ''}: ${p.ward_name || ''}
                            </div>
                            <div class="small"><strong>Population:</strong> <span class="badge bg-secondary">${pop}</span></div>
                            <div class="small"><strong>Gross Density:</strong> <span class="badge bg-danger">${density} / km²</span></div>
                            <div class="small"><strong>Ward Area:</strong> ${area}</div>
                            <div class="small"><strong>Zone:</strong> ${p.zone_name || 'N/A'}</div>
                            ${p.area_covered ? `<div class="small text-muted mt-1"><em>${p.area_covered}</em></div>` : ''}
                        </div>
                    `;
                    layer.bindPopup(html);

                    // Hover tooltip
                    layer.bindTooltip(`Ward ${p.ward_no}: ${p.ward_name} (${density}/km²)`, {
                        sticky: true,
                        direction: 'top'
                    });

                    layer.on({
                        mouseover: function (e) {
                            const l = e.target;
                            l.setStyle({ weight: 3, color: '#000000', fillOpacity: 0.9 });
                        },
                        mouseout: function (e) {
                            layer.setStyle({
                                fillColor: getDensityColor(p.population_density || 0),
                                weight: 1.5,
                                color: '#ffffff',
                                fillOpacity: 0.75
                            });
                        }
                    });
                }
            }
        });
    }

    // Slum Locations (Malin Bastis) Layer with Warning Icons
    function createSlumLayer(config, data) {
        return L.geoJSON(data, {
            pointToLayer: function (feature, latlng) {
                const isCritical = (feature.properties && feature.properties.flood_risk && feature.properties.flood_risk.includes('Critical'));
                const fillColor = isCritical ? '#dc2626' : '#ea580c';

                return L.circleMarker(latlng, {
                    radius: isCritical ? 9 : 7,
                    fillColor: fillColor,
                    color: '#ffffff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.95
                });
            },
            onEachFeature: function (feature, layer) {
                if (feature.properties) {
                    const s = feature.properties;
                    const isCritical = s.flood_risk && s.flood_risk.includes('Critical');

                    const html = `
                        <div class="p-1" style="min-width: 220px;">
                            <div class="fw-bold ${isCritical ? 'text-danger' : 'text-warning'} border-bottom pb-1 mb-1">
                                <i class="fa fa-campground"></i> ${s.slum_name}
                            </div>
                            <div class="small"><strong>Ward:</strong> Ward ${s.ward_no} (${s.ward_name})</div>
                            <div class="small"><strong>Location Corridor:</strong> <span class="badge bg-light text-dark border">${s.corridor}</span></div>
                            <div class="small"><strong>Households:</strong> ~${s.households} HH</div>
                            <div class="small"><strong>Estimated Population:</strong> ~${parseInt(s.population_est).toLocaleString()} persons</div>
                            <div class="small mt-1"><strong>Vulnerability:</strong> <span class="badge ${isCritical ? 'bg-danger' : 'bg-warning text-dark'}">${s.flood_risk}</span></div>
                            <div class="small mt-1 text-muted"><strong>Drainage:</strong> ${s.drainage_condition}</div>
                            <div class="small text-muted"><strong>Sanitation:</strong> ${s.sanitation_facility}</div>
                        </div>
                    `;
                    layer.bindPopup(html);

                    layer.bindTooltip(`⛺ ${s.slum_name} (${s.flood_risk.split(' ')[0]} Risk)`, {
                        sticky: true,
                        direction: 'top'
                    });
                }
            }
        });
    }

    function createVectorLayer(config, data) {
        // Use HTML5 Canvas renderer for smooth 60fps rendering of large datasets like 81,497 buildings
        const canvasRenderer = L.canvas({ padding: 0.5 });

        return L.geoJSON(data, {
            renderer: canvasRenderer,
            style: function (feature) {
                const geomType = (feature.geometry && feature.geometry.type) ? feature.geometry.type : '';
                const isLine = geomType.includes('LineString');
                const isPoly = geomType.includes('Polygon');

                return {
                    color: config.color || '#3498db',
                    weight: config.weight || (isLine ? 2.5 : 1),
                    dashArray: config.dashArray || null,
                    fillColor: config.fillColor || config.color || '#3498db',
                    fillOpacity: isPoly ? (config.fillOpacity !== undefined ? config.fillOpacity : 0.4) : 0
                };
            },
            pointToLayer: function (feature, latlng) {
                return L.circleMarker(latlng, {
                    radius: config.pointRadius || 6,
                    fillColor: config.pointColor || '#00a8ff',
                    color: '#ffffff',
                    weight: 1.5,
                    opacity: 1,
                    fillOpacity: 0.9
                });
            },
            onEachFeature: function (feature, layer) {
                if (feature.properties) {
                    let html = `<div class="p-1" style="min-width:180px;">`;
                    html += `<div class="fw-bold border-bottom pb-1 mb-1 text-primary"><i class="fa ${config.icon || 'fa-map-pin'}"></i> ${config.name}</div>`;
                    let pCount = 0;
                    for (let k in feature.properties) {
                        const val = feature.properties[k];
                        if (val !== undefined && val !== null && val !== '') {
                            html += `<div class="small"><strong>${k}:</strong> ${val}</div>`;
                            pCount++;
                            if (pCount >= 8) break;
                        }
                    }
                    html += '</div>';
                    layer.bindPopup(html);
                }
            }
        });
    }

    // Create DOM card for a layer in the sidebar
    function createLayerCard(id, name, category, unit, isActive, legend) {
        const card = document.createElement('div');
        card.className = `layer-item-card ${isActive ? 'is-active' : ''}`;
        card.id = `card-${id}`;

        let legendThumbHtml = '';
        if (legend && legend.length > 0) {
            const colors = legend.map(l => l.color).filter(c => c && !c.includes('0.0)'));
            if (colors.length > 0) {
                legendThumbHtml = `<div class="legend-swatch-thumb" style="background: linear-gradient(to right, ${colors.join(', ')});" title="Color Scale Preview"></div>`;
            }
        }

        card.innerHTML = `
            <div class="layer-row-top">
                <div class="layer-left-info">
                    <button class="layer-toggle-btn ${isActive ? 'active' : ''}" id="btn-toggle-${id}" title="Toggle layer on/off with 1 click">
                        <i class="fa ${isActive ? 'fa-eye' : 'fa-eye-slash'}"></i>
                    </button>
                    <div class="layer-title-box">
                        <div class="layer-name-title" title="${name}">${name}</div>
                        <span class="layer-unit-tag">${unit ? unit + ' • ' : ''}${category}</span>
                    </div>
                </div>
                <div class="layer-actions-group">
                    <button class="btn-layer-icon" id="btn-zoom-${id}" title="Zoom to layer extent">
                        <i class="fa fa-crosshairs"></i>
                    </button>
                </div>
            </div>
            <div class="layer-row-controls">
                <div class="opacity-control-box">
                    <span>Opacity:</span>
                    <input type="range" class="form-range layer-opacity-slider" id="slider-opacity-${id}" min="0" max="100" value="85">
                </div>
                ${legendThumbHtml}
            </div>
        `;

        // 1-Click Toggle
        const btnToggle = card.querySelector(`#btn-toggle-${id}`);
        btnToggle.addEventListener('click', () => {
            toggleLayer(id);
        });

        // Zoom Extent
        const btnZoom = card.querySelector(`#btn-zoom-${id}`);
        btnZoom.addEventListener('click', () => {
            zoomToLayer(id);
        });

        // Opacity Slider
        const slider = card.querySelector(`#slider-opacity-${id}`);
        slider.addEventListener('input', (e) => {
            setLayerOpacity(id, e.target.value / 100.0);
        });

        return card;
    }

    // =========================================================================
    // One-Click Layer Toggling Function
    // =========================================================================
    function syncUIState(id, isActive) {
        const card = document.getElementById(`card-${id}`);
        const btnToggle = document.getElementById(`btn-toggle-${id}`);
        const chip = document.querySelector(`.quick-chip[data-layer-id="${id}"]`);

        if (isActive) {
            if (card) card.classList.add('is-active');
            if (btnToggle) {
                btnToggle.classList.add('active');
                btnToggle.innerHTML = '<i class="fa fa-eye"></i>';
            }
            if (chip) {
                chip.classList.add('active');
                const badge = chip.querySelector('.badge-status');
                if (badge) {
                    badge.className = 'badge-status on';
                    badge.textContent = 'ON';
                }
            }
        } else {
            if (card) card.classList.remove('is-active');
            if (btnToggle) {
                btnToggle.classList.remove('active');
                btnToggle.innerHTML = '<i class="fa fa-eye-slash"></i>';
            }
            if (chip) {
                chip.classList.remove('active');
                const badge = chip.querySelector('.badge-status');
                if (badge) {
                    badge.className = 'badge-status off';
                    badge.textContent = 'OFF';
                }
            }
        }
    }

    function toggleLayer(id) {
        const item = App.layers[id];
        if (!item) return;

        if (item.type === 'raster') {
            if (item.active) {
                App.map.removeLayer(item.layerObj);
                item.active = false;
                syncUIState(id, false);
            } else {
                App.map.addLayer(item.layerObj);
                item.active = true;
                syncUIState(id, true);
            }
            updateLegendDock();
        } else if (item.type === 'vector') {
            if (item.active) {
                deactivateVectorLayer(id);
            } else {
                loadAndActivateVectorLayer(id);
            }
        }
    }

    function zoomToLayer(id) {
        const item = App.layers[id];
        if (!item) return;

        if (!item.layerObj && item.type === 'vector') {
            loadAndActivateVectorLayer(id, () => zoomToLayer(id));
            return;
        }

        if (item.bounds) {
            if (item.bounds.isValid && item.bounds.isValid()) {
                App.map.fitBounds(item.bounds, { padding: [30, 30] });
            } else if (Array.isArray(item.bounds)) {
                App.map.fitBounds(item.bounds, { padding: [30, 30] });
            }
        }
    }

    function setLayerOpacity(id, opacity) {
        const item = App.layers[id];
        if (!item || !item.layerObj) return;

        if (item.layerObj.setOpacity) {
            item.layerObj.setOpacity(opacity);
        } else if (item.layerObj.setStyle) {
            item.layerObj.setStyle({
                opacity: opacity,
                fillOpacity: opacity * 0.75
            });
        }
    }

    // =========================================================================
    // Dynamic Legend Dock
    // =========================================================================
    function updateLegendDock() {
        const legendBody = document.getElementById('legend-body');
        if (!legendBody) return;

        legendBody.innerHTML = '';
        let activeCount = 0;

        for (let id in App.layers) {
            const item = App.layers[id];
            if (item.active && item.meta) {
                activeCount++;
                const block = document.createElement('div');
                block.className = 'legend-layer-block';

                let itemsHtml = '';
                if (item.meta.legend && item.meta.legend.length > 0) {
                    item.meta.legend.forEach(leg => {
                        itemsHtml += `
                            <div class="legend-item-row">
                                <span class="legend-color-box" style="background:${leg.color}; ${leg.border ? 'border:1px solid ' + leg.border : ''}"></span>
                                <span>${leg.label}</span>
                            </div>
                        `;
                    });
                } else if (item.meta.color) {
                    itemsHtml = `
                        <div class="legend-item-row">
                            <span class="legend-color-box" style="background:${item.meta.color};"></span>
                            <span>${item.meta.name}</span>
                        </div>
                    `;
                } else if (item.meta.pointColor) {
                    itemsHtml = `
                        <div class="legend-item-row">
                            <span class="legend-color-box" style="background:${item.meta.pointColor}; border-radius:50%;"></span>
                            <span>${item.meta.name}</span>
                        </div>
                    `;
                }

                block.innerHTML = `
                    <div class="legend-layer-title"><i class="fa fa-layer-group text-primary"></i> ${item.meta.name}</div>
                    ${itemsHtml}
                `;
                legendBody.appendChild(block);
            }
        }

        if (activeCount === 0) {
            legendBody.innerHTML = '<div class="no-active-legend-text text-muted small p-2">Turn on layers to view their color legends.</div>';
        }
    }

    // =========================================================================
    // Point Identify & Pixel Value Sampling
    // =========================================================================
    function handlePointIdentify(latlng) {
        const lat = latlng.lat;
        const lon = latlng.lng;

        let utmX = 0, utmY = 0;
        if (typeof proj4 !== 'undefined') {
            const utm = proj4('EPSG:4326', 'EPSG:32644', [lon, lat]);
            utmX = utm[0];
            utmY = utm[1];
        }

        // Switch to info tab
        document.querySelector('.tab-btn[data-tab="info"]')?.click();

        document.getElementById('inspector-placeholder').style.display = 'none';
        document.getElementById('inspector-content').style.display = 'block';

        document.getElementById('insp-latlon').textContent = `${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E`;
        document.getElementById('insp-utm').textContent = `${Math.round(utmX).toLocaleString()} m E, ${Math.round(utmY).toLocaleString()} m N`;

        const rasterContainer = document.getElementById('insp-raster-values');
        rasterContainer.innerHTML = '';

        let popupContent = `<div class="p-1"><strong>Location Query</strong><hr class="my-1"/>`;
        popupContent += `<div class="small"><strong>Lat/Lon:</strong> ${lat.toFixed(4)}°, ${lon.toFixed(4)}°</div>`;

        let sampledCount = 0;

        for (let id in App.layers) {
            const item = App.layers[id];
            if (item.type === 'raster' && item.active && item.meta && item.meta.matrix) {
                const sampleVal = sampleRasterMatrix(item.meta, lat, lon);
                if (sampleVal !== null) {
                    sampledCount++;
                    let displayVal = `${sampleVal} ${item.meta.unit || ''}`;

                    if (id === 'flood_inundation') {
                        if (sampleVal >= 2) displayVal = '<span class="badge bg-danger">High Inundation Risk</span>';
                        else if (sampleVal === 1) displayVal = '<span class="badge bg-primary">Moderate Risk</span>';
                        else displayVal = '<span class="badge bg-success">Safe / Low Risk</span>';
                    } else if (id === 'slope_analysis') {
                        displayVal = `<strong>${sampleVal}°</strong> (${sampleVal < 5 ? 'Gentle' : (sampleVal < 15 ? 'Moderate' : 'Steep')})`;
                    }

                    rasterContainer.innerHTML += `
                        <div class="d-flex justify-content-between border-bottom py-1 small">
                            <span><i class="fa fa-angle-right text-primary"></i> ${item.meta.name}:</span>
                            <span class="fw-bold">${displayVal}</span>
                        </div>
                    `;
                    popupContent += `<div class="small"><strong>${item.meta.name}:</strong> ${displayVal}</div>`;
                }
            }
        }

        if (sampledCount === 0) {
            rasterContainer.innerHTML = '<div class="text-muted small">No active raster layers intersect this point.</div>';
        }

        popupContent += '</div>';

        L.popup()
            .setLatLng(latlng)
            .setContent(popupContent)
            .openOn(App.map);
    }

    function sampleRasterMatrix(meta, lat, lon) {
        const bounds = meta.bounds;
        const south = bounds[0][0];
        const west = bounds[0][1];
        const north = bounds[1][0];
        const east = bounds[1][1];

        if (lat < south || lat > north || lon < west || lon > east) return null;

        const gridH = meta.gridH;
        const gridW = meta.gridW;

        const row = Math.floor(((north - lat) / (north - south)) * gridH);
        const col = Math.floor(((lon - west) / (east - west)) * gridW);

        if (row >= 0 && row < gridH && col >= 0 && col < gridW) {
            if (meta.matrix[row] && meta.matrix[row][col] !== null) {
                return meta.matrix[row][col];
            }
        }
        return null;
    }

    // =========================================================================
    // UI Event Handlers
    // =========================================================================
    function setupUI() {
        // Quick-Toggle Bar Button Clicks
        const chips = document.querySelectorAll('.quick-chip');
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                const layerId = chip.getAttribute('data-layer-id');
                if (layerId) toggleLayer(layerId);
            });
        });

        // Sidebar Tabs Navigation
        const tabs = document.querySelectorAll('.tab-btn');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const tabName = tab.getAttribute('data-tab');
                document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
                const target = document.getElementById(`pane-${tabName}`);
                if (target) target.classList.add('active');
            });
        });

        // Mobile Sidebar Toggle
        const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
        const sidebar = document.getElementById('portal-sidebar');
        if (btnToggleSidebar && sidebar) {
            btnToggleSidebar.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
            });
        }

        // Basemap Switcher Dropdown
        const basemapLinks = document.querySelectorAll('#basemap-dropdown a');
        basemapLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                basemapLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');

                const basemapKey = link.getAttribute('data-basemap');
                if (App.baseLayers[basemapKey]) {
                    App.map.removeLayer(App.baseLayers[App.currentBasemap]);
                    App.baseLayers[basemapKey].addTo(App.map);
                    App.currentBasemap = basemapKey;
                }
            });
        });

        // Global Buttons in Sidebar
        document.getElementById('btn-all-layers-on')?.addEventListener('click', () => {
            for (let id in App.layers) {
                if (!App.layers[id].active) toggleLayer(id);
            }
        });

        document.getElementById('btn-all-layers-off')?.addEventListener('click', () => {
            for (let id in App.layers) {
                if (App.layers[id].active) toggleLayer(id);
            }
        });

        document.getElementById('btn-reset-map-view')?.addEventListener('click', () => {
            App.map.setView([30.3244, 78.0418], 12);
        });

        // Floating Map Controls (Bottom-Right)
        document.getElementById('btn-tool-home')?.addEventListener('click', () => {
            App.map.setView([30.3244, 78.0418], 12);
        });
        document.getElementById('btn-tool-zoomin')?.addEventListener('click', () => {
            App.map.zoomIn();
        });
        document.getElementById('btn-tool-zoomout')?.addEventListener('click', () => {
            App.map.zoomOut();
        });
        document.getElementById('btn-tool-locate')?.addEventListener('click', () => {
            App.map.locate({ setView: true, maxZoom: 15 });
        });
        document.getElementById('btn-tool-fullscreen')?.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        });

        // Measurement Tools
        document.getElementById('tool-measure-dist')?.addEventListener('click', () => {
            MeasurementTool.start('distance');
        });
        document.getElementById('tool-measure-area')?.addEventListener('click', () => {
            MeasurementTool.start('area');
        });
        document.getElementById('tool-clear-measure')?.addEventListener('click', () => {
            MeasurementTool.clear();
        });

        // Open DSS Tab Button in Header
        document.getElementById('btn-open-dss')?.addEventListener('click', () => {
            document.querySelector('.tab-btn[data-tab="dss"]')?.click();
            if (sidebar.classList.contains('collapsed')) sidebar.classList.remove('collapsed');
        });

        // Open Upload Modal / Tab in Header
        document.getElementById('btn-open-upload')?.addEventListener('click', () => {
            document.querySelector('.tab-btn[data-tab="upload"]')?.click();
            if (sidebar.classList.contains('collapsed')) sidebar.classList.remove('collapsed');
        });

        // Print Report Button
        document.getElementById('btn-print')?.addEventListener('click', () => {
            window.print();
        });

        // Legend Dock Actions
        document.getElementById('btn-legend-min')?.addEventListener('click', () => {
            const body = document.getElementById('legend-body');
            const icon = document.querySelector('#btn-legend-min i');
            if (body.style.display === 'none') {
                body.style.display = 'flex';
                icon.className = 'fa fa-chevron-down';
            } else {
                body.style.display = 'none';
                icon.className = 'fa fa-chevron-up';
            }
        });

        document.getElementById('btn-legend-close')?.addEventListener('click', () => {
            const dock = document.getElementById('floating-legend-dock');
            if (dock) dock.style.display = 'none';
        });

        document.getElementById('btn-toggle-legend-dock')?.addEventListener('click', () => {
            const dock = document.getElementById('floating-legend-dock');
            if (dock) {
                dock.style.display = (dock.style.display === 'none') ? 'flex' : 'none';
            }
        });

        // Search Filter for Layer Tree
        const txtSearchLayer = document.getElementById('txt_search_layer');
        if (txtSearchLayer) {
            txtSearchLayer.addEventListener('input', (e) => {
                const q = e.target.value.toLowerCase().trim();
                const cards = document.querySelectorAll('.layer-item-card');
                cards.forEach(card => {
                    const title = card.querySelector('.layer-name-title')?.textContent.toLowerCase() || '';
                    if (title.includes(q)) {
                        card.style.display = 'block';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });
            document.getElementById('btn-clear-layer-search')?.addEventListener('click', () => {
                txtSearchLayer.value = '';
                txtSearchLayer.dispatchEvent(new Event('input'));
            });
        }
    }

    // =========================================================================
    // Landmark Search Autocomplete
    // =========================================================================
    function setupLandmarkSearch(landmarks) {
        const searchInput = document.getElementById('input-landmark-search');
        const dropdown = document.getElementById('search-results-dropdown');
        const btnClear = document.getElementById('btn-clear-search');

        if (!searchInput || !dropdown) return;

        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().trim();
            if (q.length < 2) {
                dropdown.style.display = 'none';
                if (btnClear) btnClear.style.display = 'none';
                return;
            }

            if (btnClear) btnClear.style.display = 'block';

            const matches = landmarks.filter(l => l.name.toLowerCase().includes(q)).slice(0, 8);
            if (matches.length > 0) {
                dropdown.innerHTML = '';
                matches.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'search-result-item';
                    div.innerHTML = `<i class="fa fa-map-marker-alt"></i> <span>${item.name}</span>`;
                    div.addEventListener('click', () => {
                        App.map.flyTo([item.lat, item.lon], 16, { duration: 1.5 });
                        L.popup()
                            .setLatLng([item.lat, item.lon])
                            .setContent(`<strong>${item.name}</strong><br><span class="small text-muted">Dehradun Location</span>`)
                            .openOn(App.map);
                        dropdown.style.display = 'none';
                        searchInput.value = item.name;
                    });
                    dropdown.appendChild(div);
                });
                dropdown.style.display = 'block';
            } else {
                dropdown.style.display = 'none';
            }
        });

        if (btnClear) {
            btnClear.addEventListener('click', () => {
                searchInput.value = '';
                dropdown.style.display = 'none';
                btnClear.style.display = 'none';
            });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }

    function updateCoordinateDisplay(latlng) {
        const wgsElem = document.getElementById('cursor-wgs84');
        const utmElem = document.getElementById('cursor-utm');

        if (wgsElem) {
            wgsElem.textContent = `Lat: ${latlng.lat.toFixed(4)}° N, Lon: ${latlng.lng.toFixed(4)}° E`;
        }

        if (utmElem && typeof proj4 !== 'undefined') {
            const utm = proj4('EPSG:4326', 'EPSG:32644', [latlng.lng, latlng.lat]);
            utmElem.textContent = `UTM: ${Math.round(utm[0]).toLocaleString()} m E, ${Math.round(utm[1]).toLocaleString()} m N`;
        }
    }
});

