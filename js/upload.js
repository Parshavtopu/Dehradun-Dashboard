/**
 * Dehradun GIS Portal - Dynamic Layer Upload Module
 * Supports GeoTIFF, GeoJSON, Shapefile ZIP, and CSV
 */

const UploadModule = (function () {
    let map = null;
    let uploadedLayers = {}; // layerId -> { layer, meta }
    let layerCounter = 1;

    function init(mapInstance) {
        map = mapInstance;
        setupUI();
    }

    function setupUI() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-layer-upload');
        const btnBrowse = document.getElementById('btn-browse-file');

        if (btnBrowse && fileInput) {
            btnBrowse.addEventListener('click', () => fileInput.click());
        }

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    handleFile(e.target.files[0]);
                }
            });
        }

        if (dropZone) {
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('dragover');
            });

            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFile(e.dataTransfer.files[0]);
                }
            });
        }

        // Sample layer buttons
        document.getElementById('btn-load-sample-fire')?.addEventListener('click', () => {
            loadSampleGeoJson('data/vectors/fire_station.geojson', 'Emergency Fire Stations (Uploaded)', '#c0392b');
        });
        document.getElementById('btn-load-sample-sensors')?.addEventListener('click', () => {
            loadSampleGeoJson('data/vectors/environmental_sensor.geojson', 'IoT Environmental Sensors (Uploaded)', '#27ae60');
        });
        document.getElementById('btn-load-sample-drain')?.addEventListener('click', () => {
            loadSampleGeoJson('data/vectors/stw_drain.geojson', 'Storm Water Drainage (Uploaded)', '#2980b9');
        });
    }

    function showStatus(text, pct) {
        const box = document.getElementById('upload-status-box');
        const label = document.getElementById('upload-status-text');
        const bar = document.getElementById('upload-progress-bar');
        if (box) box.style.display = 'block';
        if (label) label.textContent = text;
        if (bar) bar.style.width = `${pct}%`;
    }

    function hideStatus() {
        const box = document.getElementById('upload-status-box');
        if (box) box.style.display = 'none';
    }

    function handleFile(file) {
        const fileName = file.name;
        const ext = fileName.split('.').pop().toLowerCase();

        showStatus(`Reading ${fileName}...`, 20);

        if (ext === 'geojson' || ext === 'json') {
            processGeoJsonFile(file);
        } else if (ext === 'tif' || ext === 'tiff') {
            processGeoTiffFile(file);
        } else if (ext === 'zip') {
            processShapefileZip(file);
        } else if (ext === 'csv') {
            processCsvFile(file);
        } else {
            alert(`Unsupported file format: .${ext}\nPlease upload GeoJSON, GeoTIFF (.tif), Shapefile (.zip), or CSV.`);
            hideStatus();
        }
    }

    // 1. Process GeoJSON
    function processGeoJsonFile(file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                showStatus('Parsing GeoJSON...', 60);
                const geojsonData = JSON.parse(e.target.result);
                addGeoJsonToMap(geojsonData, file.name);
            } catch (err) {
                alert('Error parsing GeoJSON: ' + err.message);
                hideStatus();
            }
        };
        reader.readAsText(file);
    }

    // 2. Process GeoTIFF with GeoRaster
    function processGeoTiffFile(file) {
        const reader = new FileReader();
        reader.onload = async function (e) {
            try {
                showStatus('Decoding GeoTIFF array buffer...', 40);
                const arrayBuffer = e.target.result;

                if (typeof parseGeoraster === 'undefined') {
                    throw new Error('GeoRaster library is loading. Please try again in a few seconds.');
                }

                const georaster = await parseGeoraster(arrayBuffer);
                showStatus('Generating raster tiles...', 80);

                const minVal = georaster.mins ? georaster.mins[0] : 0;
                const maxVal = georaster.maxs ? georaster.maxs[0] : 255;
                const range = (maxVal - minVal) || 1;

                const layer = new GeoRasterLayer({
                    georaster: georaster,
                    opacity: 0.8,
                    pixelValuesToColorFn: values => {
                        const val = values[0];
                        if (val === georaster.noDataValue || isNaN(val)) return null;
                        const norm = Math.max(0, Math.min(1, (val - minVal) / range));
                        // Spectral Color Ramp
                        const r = Math.round(255 * norm);
                        const b = Math.round(255 * (1 - norm));
                        const g = Math.round(180 * Math.sin(norm * Math.PI));
                        return `rgba(${r}, ${g}, ${b}, 0.8)`;
                    },
                    resolution: 128
                });

                layer.addTo(map);

                const bounds = [
                    [georaster.ymin, georaster.xmin],
                    [georaster.ymax, georaster.xmax]
                ];

                // If coordinates look like UTM Zone 44N (e.g. y > 1,000,000)
                if (georaster.ymin > 1000000 && typeof proj4 !== 'undefined') {
                    const sw = proj4('+proj=utm +zone=44 +datum=WGS84 +units=m +no_defs', 'EPSG:4326', [georaster.xmin, georaster.ymin]);
                    const ne = proj4('+proj=utm +zone=44 +datum=WGS84 +units=m +no_defs', 'EPSG:4326', [georaster.xmax, georaster.ymax]);
                    map.fitBounds([[sw[1], sw[0]], [ne[1], ne[0]]]);
                } else {
                    map.fitBounds(bounds);
                }

                registerUploadedLayer(layer, file.name, 'raster', bounds);
                hideStatus();
            } catch (err) {
                console.error(err);
                alert('Error parsing GeoTIFF: ' + err.message);
                hideStatus();
            }
        };
        reader.readAsArrayBuffer(file);
    }

    // 3. Process Shapefile in ZIP
    function processShapefileZip(file) {
        const reader = new FileReader();
        reader.onload = async function (e) {
            try {
                showStatus('Extracting ESRI Shapefile archive...', 50);
                if (typeof shp === 'undefined') {
                    throw new Error('Shapefile parser library is not loaded.');
                }
                const geojson = await shp(e.target.result);
                addGeoJsonToMap(geojson, file.name);
            } catch (err) {
                console.error(err);
                alert('Error reading Shapefile ZIP: ' + err.message);
                hideStatus();
            }
        };
        reader.readAsArrayBuffer(file);
    }

    // 4. Process CSV with Lat/Lon
    function processCsvFile(file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                showStatus('Parsing CSV coordinates...', 50);
                const text = e.target.result;
                const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
                if (lines.length < 2) throw new Error('CSV is empty or missing data rows.');

                const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
                let latIdx = headers.findIndex(h => ['lat', 'latitude', 'y', 'point_y'].includes(h));
                let lonIdx = headers.findIndex(h => ['lon', 'lng', 'longitude', 'x', 'point_x'].includes(h));

                if (latIdx === -1 || lonIdx === -1) {
                    throw new Error('CSV must contain Latitude ("lat") and Longitude ("lon") columns.');
                }

                const features = [];
                for (let i = 1; i < lines.length; i++) {
                    const cols = lines[i].split(',');
                    const lat = parseFloat(cols[latIdx]);
                    const lon = parseFloat(cols[lonIdx]);

                    if (!isNaN(lat) && !isNaN(lon)) {
                        const props = {};
                        headers.forEach((h, idx) => {
                            props[h] = cols[idx] ? cols[idx].trim() : '';
                        });

                        features.push({
                            type: 'Feature',
                            geometry: {
                                type: 'Point',
                                coordinates: [lon, lat]
                            },
                            properties: props
                        });
                    }
                }

                const fc = { type: 'FeatureCollection', features: features };
                addGeoJsonToMap(fc, file.name);
            } catch (err) {
                alert('Error processing CSV: ' + err.message);
                hideStatus();
            }
        };
        reader.readAsText(file);
    }

    function addGeoJsonToMap(geojsonData, name) {
        showStatus('Rendering features on map...', 85);

        const randomColor = getRandomColor();
        const layer = L.geoJSON(geojsonData, {
            style: function () {
                return {
                    color: randomColor,
                    weight: 2.5,
                    opacity: 0.9,
                    fillColor: randomColor,
                    fillOpacity: 0.3
                };
            },
            pointToLayer: function (feature, latlng) {
                return L.circleMarker(latlng, {
                    radius: 6,
                    fillColor: randomColor,
                    color: '#ffffff',
                    weight: 1.5,
                    opacity: 1,
                    fillOpacity: 0.85
                });
            },
            onEachFeature: function (feature, featLayer) {
                if (feature.properties) {
                    let content = `<div class="p-1"><strong>${name}</strong><hr class="my-1"/>`;
                    for (let key in feature.properties) {
                        content += `<div class="small"><strong>${key}:</strong> ${feature.properties[key]}</div>`;
                    }
                    content += '</div>';
                    featLayer.bindPopup(content);
                }
            }
        }).addTo(map);

        const bounds = layer.getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20] });
        }

        registerUploadedLayer(layer, name, 'vector', bounds, randomColor);
        hideStatus();
    }

    function loadSampleGeoJson(url, name, color) {
        showStatus(`Loading ${name}...`, 40);
        fetch(url)
            .then(res => res.json())
            .then(data => {
                const layer = L.geoJSON(data, {
                    style: { color: color, weight: 2.5, fillOpacity: 0.25 },
                    pointToLayer: (f, latlng) => L.circleMarker(latlng, {
                        radius: 6,
                        fillColor: color,
                        color: '#ffffff',
                        weight: 1.5,
                        fillOpacity: 0.9
                    }),
                    onEachFeature: (feature, l) => {
                        if (feature.properties) {
                            let text = `<div class="p-1"><strong>${name}</strong><hr class="my-1"/>`;
                            for (let k in feature.properties) {
                                text += `<div class="small"><strong>${k}:</strong> ${feature.properties[k]}</div>`;
                            }
                            text += '</div>';
                            l.bindPopup(text);
                        }
                    }
                }).addTo(map);

                const bounds = layer.getBounds();
                if (bounds.isValid()) map.fitBounds(bounds);
                registerUploadedLayer(layer, name, 'vector', bounds, color);
                hideStatus();
            })
            .catch(err => {
                alert('Error loading sample layer: ' + err.message);
                hideStatus();
            });
    }

    function registerUploadedLayer(layer, name, type, bounds, color) {
        const layerId = 'user_layer_' + (layerCounter++);
        uploadedLayers[layerId] = {
            layer: layer,
            name: name,
            type: type,
            bounds: bounds,
            active: true
        };

        // Add to DOM list in sidebar
        const list = document.getElementById('list-user-uploads');
        if (list) {
            const emptyHint = list.querySelector('.empty-upload-hint');
            if (emptyHint) emptyHint.remove();

            const card = document.createElement('div');
            card.className = 'layer-item-card is-active';
            card.id = `card-${layerId}`;
            card.innerHTML = `
                <div class="layer-row-top">
                    <div class="layer-left-info">
                        <button class="layer-toggle-btn active" id="btn-toggle-${layerId}" title="Toggle layer on/off">
                            <i class="fa fa-eye"></i>
                        </button>
                        <div class="layer-title-box">
                            <div class="layer-name-title" title="${name}">${name}</div>
                            <span class="layer-unit-tag">${type.toUpperCase()} • User Upload</span>
                        </div>
                    </div>
                    <div class="layer-actions-group">
                        <button class="btn-layer-icon" id="btn-zoom-${layerId}" title="Zoom to layer extent">
                            <i class="fa fa-crosshairs"></i>
                        </button>
                        <button class="btn-layer-icon text-danger" id="btn-remove-${layerId}" title="Remove layer">
                            <i class="fa fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="layer-row-controls">
                    <div class="opacity-control-box">
                        <span>Opacity:</span>
                        <input type="range" class="form-range layer-opacity-slider" id="slider-opacity-${layerId}" min="0" max="100" value="80">
                    </div>
                </div>
            `;
            list.appendChild(card);

            // Toggle logic
            const btnToggle = card.querySelector(`#btn-toggle-${layerId}`);
            btnToggle.addEventListener('click', () => {
                toggleUploadedLayer(layerId);
            });

            // Zoom logic
            const btnZoom = card.querySelector(`#btn-zoom-${layerId}`);
            btnZoom.addEventListener('click', () => {
                if (bounds && bounds.isValid && bounds.isValid()) {
                    map.fitBounds(bounds);
                } else if (Array.isArray(bounds)) {
                    map.fitBounds(bounds);
                }
            });

            // Remove logic
            const btnRemove = card.querySelector(`#btn-remove-${layerId}`);
            btnRemove.addEventListener('click', () => {
                removeUploadedLayer(layerId);
            });

            // Opacity logic
            const slider = card.querySelector(`#slider-opacity-${layerId}`);
            slider.addEventListener('input', (e) => {
                const op = e.target.value / 100.0;
                if (layer.setOpacity) layer.setOpacity(op);
                else if (layer.setStyle) layer.setStyle({ fillOpacity: op * 0.4, opacity: op });
            });

            // Update user uploads count badge
            const countBadge = document.getElementById('count-user-uploads');
            if (countBadge) {
                countBadge.textContent = Object.keys(uploadedLayers).length;
            }
        }

        // Add chip to Quick Toggle Bar
        const bar = document.getElementById('quick-toggle-bar');
        if (bar) {
            const chip = document.createElement('button');
            chip.className = 'quick-chip active';
            chip.id = `chip-${layerId}`;
            chip.innerHTML = `<i class="fa fa-layer-group"></i> ${truncate(name, 14)} <span class="badge-status on">ON</span>`;
            chip.addEventListener('click', () => {
                toggleUploadedLayer(layerId);
            });
            bar.appendChild(chip);
        }

        // Switch to Layers tab to show the new layer
        document.querySelector('.tab-btn[data-tab="layers"]')?.click();
    }

    function toggleUploadedLayer(layerId) {
        const item = uploadedLayers[layerId];
        if (!item) return;

        const card = document.getElementById(`card-${layerId}`);
        const btnToggle = document.getElementById(`btn-toggle-${layerId}`);
        const chip = document.getElementById(`chip-${layerId}`);

        if (item.active) {
            // Turn OFF
            map.removeLayer(item.layer);
            item.active = false;
            if (card) card.classList.remove('is-active');
            if (btnToggle) {
                btnToggle.classList.remove('active');
                btnToggle.innerHTML = '<i class="fa fa-eye-slash"></i>';
            }
            if (chip) {
                chip.classList.remove('active');
                chip.querySelector('.badge-status').className = 'badge-status off';
                chip.querySelector('.badge-status').textContent = 'OFF';
            }
        } else {
            // Turn ON
            map.addLayer(item.layer);
            item.active = true;
            if (card) card.classList.add('is-active');
            if (btnToggle) {
                btnToggle.classList.add('active');
                btnToggle.innerHTML = '<i class="fa fa-eye"></i>';
            }
            if (chip) {
                chip.classList.add('active');
                chip.querySelector('.badge-status').className = 'badge-status on';
                chip.querySelector('.badge-status').textContent = 'ON';
            }
        }
    }

    function removeUploadedLayer(layerId) {
        const item = uploadedLayers[layerId];
        if (!item) return;

        map.removeLayer(item.layer);
        delete uploadedLayers[layerId];

        document.getElementById(`card-${layerId}`)?.remove();
        document.getElementById(`chip-${layerId}`)?.remove();

        const countBadge = document.getElementById('count-user-uploads');
        if (countBadge) {
            countBadge.textContent = Object.keys(uploadedLayers).length;
        }
    }

    function getRandomColor() {
        const colors = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c', '#d35400'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    function truncate(str, max) {
        return str.length > max ? str.substring(0, max) + '...' : str;
    }

    return {
        init,
        handleFile,
        toggleUploadedLayer
    };
})();
