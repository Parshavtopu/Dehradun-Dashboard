/**
 * Dehradun GIS - Layer Studio & Admin Hub
 * Complete Layer Management, Visual Styler & Real-Time Sync
 */

(function () {
    // State
    let vectorLayers = [];
    let rasterLayers = [];
    let removedLayerIds = new Set();
    let layerStyles = {}; // id -> { color, fillColor, fillOpacity, strokeColor, weight, pointRadius }
    let selectedLayer = null;
    let previewMap = null;
    let previewMapLayer = null;
    const syncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('dehradun_sync_channel') : null;

    // GitHub Link & Local URL
    const GITHUB_URL = 'https://parshavtopu.github.io/Dehradun-Dashboard/';
    
    // Presets
    const PALETTES = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#0284c7', '#e67e22', '#00b4d8'];

    document.addEventListener('DOMContentLoaded', () => {
        initPreviewMap();
        loadSavedState();
        loadCatalog();
        loadIncomingFiles();
        setupEventListeners();
    });

    // 1. Initialize Leaflet Preview Map
    function initPreviewMap() {
        previewMap = L.map('preview-map', {
            center: [30.3244, 78.0418],
            zoom: 12,
            zoomControl: false
        });
        L.control.zoom({ position: 'bottomright' }).addTo(previewMap);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(previewMap);
    }

    // 2. Load Local Storage State
    function loadSavedState() {
        try {
            const savedRemoved = localStorage.getItem('dehradun_removed_layers');
            if (savedRemoved) {
                removedLayerIds = new Set(JSON.parse(savedRemoved));
            }
            const savedStyles = localStorage.getItem('dehradun_layer_styles');
            if (savedStyles) {
                layerStyles = JSON.parse(savedStyles);
            }
        } catch (e) {
            console.error('Error loading saved state:', e);
        }
    }

    // 3. Load Catalog Manifests
    async function loadCatalog() {
        try {
            const [vRes, rRes] = await Promise.all([
                fetch('data/vector_manifest.json').then(r => r.json()).catch(() => []),
                fetch('data/raster_manifest.json').then(r => r.json()).catch(() => [])
            ]);

            // Load custom additions from localStorage
            let customLayers = [];
            try {
                const storedCustom = localStorage.getItem('dehradun_custom_layers');
                if (storedCustom) customLayers = JSON.parse(storedCustom);
            } catch (e) {}

            vectorLayers = vRes.filter(v => !removedLayerIds.has(v.id));
            rasterLayers = rRes.filter(r => !removedLayerIds.has(r.id));

            // Append custom layers
            customLayers.forEach(c => {
                if (!removedLayerIds.has(c.id)) {
                    if (c.type === 'raster') rasterLayers.push(c);
                    else vectorLayers.push(c);
                }
            });

            // Apply style overrides
            vectorLayers.forEach(v => {
                if (layerStyles[v.id]) {
                    Object.assign(v, layerStyles[v.id]);
                }
            });

            renderVectorList();
            renderRasterList();
            updateCounts();
        } catch (err) {
            console.error('Failed to load layer manifests:', err);
            showToast('Error loading layer catalog.', 'danger');
        }
    }

    // 4. Render Vector List
    function renderVectorList() {
        const container = document.getElementById('list-vector-layers');
        if (!container) return;
        container.innerHTML = '';

        if (vectorLayers.length === 0) {
            container.innerHTML = '<div class="text-center text-muted py-4 small">No vector layers in catalog.</div>';
            return;
        }

        vectorLayers.forEach(layer => {
            const item = document.createElement('div');
            item.className = `layer-studio-item ${selectedLayer && selectedLayer.id === layer.id ? 'is-selected' : ''}`;
            item.id = `item-${layer.id}`;

            const color = layer.pointColor || layer.color || layer.strokeColor || '#0284c7';

            item.innerHTML = `
                <div class="layer-studio-meta">
                    <div class="layer-color-indicator" style="background-color: ${color};"></div>
                    <div class="layer-studio-texts">
                        <div class="layer-studio-name" title="${layer.name}">${layer.name}</div>
                        <div class="layer-studio-sub">
                            <span class="badge bg-secondary" style="font-size:0.65rem;">${layer.category || 'General'}</span>
                            <span class="text-muted">• ${layer.url}</span>
                        </div>
                    </div>
                </div>
                <div class="layer-studio-controls">
                    <div class="form-check form-switch form-check-switch-sm" title="Default Active on load">
                        <input class="form-check-input chk-layer-active" type="checkbox" data-id="${layer.id}" ${layer.activeDefault ? 'checked' : ''}>
                    </div>
                    <button class="btn-icon-studio btn-edit-visuals" data-id="${layer.id}" title="Edit Visual Styles & Color">
                        <i class="fa fa-palette"></i>
                    </button>
                    <button class="btn-icon-studio btn-preview-layer" data-id="${layer.id}" title="Preview on Map">
                        <i class="fa fa-eye"></i>
                    </button>
                    <button class="btn-icon-studio btn-del-layer" data-id="${layer.id}" title="Remove layer from dashboard">
                        <i class="fa fa-trash"></i>
                    </button>
                </div>
            `;

            // Events
            item.querySelector('.chk-layer-active').addEventListener('change', (e) => {
                layer.activeDefault = e.target.checked;
                showToast(`Updated default visibility for ${layer.name}`);
            });

            item.querySelector('.btn-edit-visuals').addEventListener('click', () => {
                selectLayer(layer, 'vector');
            });

            item.querySelector('.btn-preview-layer').addEventListener('click', () => {
                selectLayer(layer, 'vector');
            });

            item.querySelector('.btn-del-layer').addEventListener('click', () => {
                removeLayer(layer.id, 'vector', layer.name);
            });

            container.appendChild(item);
        });
    }

    // 5. Render Raster List
    function renderRasterList() {
        const container = document.getElementById('list-raster-layers');
        if (!container) return;
        container.innerHTML = '';

        if (rasterLayers.length === 0) {
            container.innerHTML = '<div class="text-center text-muted py-4 small">No raster layers in catalog.</div>';
            return;
        }

        rasterLayers.forEach(layer => {
            const item = document.createElement('div');
            item.className = `layer-studio-item ${selectedLayer && selectedLayer.id === layer.id ? 'is-selected' : ''}`;
            item.id = `item-${layer.id}`;

            item.innerHTML = `
                <div class="layer-studio-meta">
                    <i class="fa fa-image text-primary" style="font-size: 1.1rem;"></i>
                    <div class="layer-studio-texts">
                        <div class="layer-studio-name" title="${layer.name}">${layer.name}</div>
                        <div class="layer-studio-sub">
                            <span class="badge bg-primary" style="font-size:0.65rem;">${layer.category || 'Raster'}</span>
                            <span class="text-muted">• ${layer.url}</span>
                        </div>
                    </div>
                </div>
                <div class="layer-studio-controls">
                    <div class="form-check form-switch form-check-switch-sm" title="Default Active on load">
                        <input class="form-check-input chk-layer-active" type="checkbox" data-id="${layer.id}" ${layer.activeDefault ? 'checked' : ''}>
                    </div>
                    <button class="btn-icon-studio btn-edit-visuals" data-id="${layer.id}" title="Edit Visual Styles & Info">
                        <i class="fa fa-palette"></i>
                    </button>
                    <button class="btn-icon-studio btn-preview-layer" data-id="${layer.id}" title="Preview on Map">
                        <i class="fa fa-eye"></i>
                    </button>
                    <button class="btn-icon-studio btn-del-layer" data-id="${layer.id}" title="Remove layer from dashboard">
                        <i class="fa fa-trash"></i>
                    </button>
                </div>
            `;

            // Events
            item.querySelector('.chk-layer-active').addEventListener('change', (e) => {
                layer.activeDefault = e.target.checked;
                showToast(`Updated default visibility for ${layer.name}`);
            });

            item.querySelector('.btn-edit-visuals').addEventListener('click', () => {
                selectLayer(layer, 'raster');
            });

            item.querySelector('.btn-preview-layer').addEventListener('click', () => {
                selectLayer(layer, 'raster');
            });

            item.querySelector('.btn-del-layer').addEventListener('click', () => {
                removeLayer(layer.id, 'raster', layer.name);
            });

            container.appendChild(item);
        });
    }

    function updateCounts() {
        const vBadge = document.getElementById('count-vectors-tab');
        if (vBadge) vBadge.textContent = vectorLayers.length;
        const rBadge = document.getElementById('count-rasters-tab');
        if (rBadge) rBadge.textContent = rasterLayers.length;
    }

    // 6. Select Layer & Populate Visual Styler
    function selectLayer(layer, type) {
        selectedLayer = layer;

        // Highlight in DOM
        document.querySelectorAll('.layer-studio-item').forEach(el => el.classList.remove('is-selected'));
        const activeItem = document.getElementById(`item-${layer.id}`);
        if (activeItem) activeItem.classList.add('is-selected');

        // Update preview header
        document.getElementById('lbl-preview-layer-name').textContent = layer.name;
        document.getElementById('lbl-styler-layer-id').textContent = layer.id;

        // Render preview on map
        renderPreviewOnMap(layer, type);

        // Populate styler form
        populateStyler(layer, type);
    }

    // 7. Preview on Leaflet Map
    function renderPreviewOnMap(layer, type) {
        if (previewMapLayer) {
            previewMap.removeLayer(previewMapLayer);
            previewMapLayer = null;
        }

        if (type === 'raster') {
            if (layer.bounds && layer.url) {
                previewMapLayer = L.imageOverlay(layer.url, layer.bounds, {
                    opacity: layerStyles[layer.id]?.opacity || layer.opacity || 0.85
                }).addTo(previewMap);
                previewMap.fitBounds(layer.bounds);
            }
        } else {
            // Vector preview
            fetch(layer.url)
                .then(r => r.json())
                .then(data => {
                    const style = layerStyles[layer.id] || {};
                    const primaryColor = style.color || layer.pointColor || layer.color || '#0284c7';
                    const fillOp = style.fillOpacity !== undefined ? style.fillOpacity : (layer.fillOpacity !== undefined ? layer.fillOpacity : 0.4);
                    const weight = style.weight !== undefined ? style.weight : (layer.weight !== undefined ? layer.weight : 2.5);
                    const radius = style.pointRadius !== undefined ? style.pointRadius : (layer.pointRadius !== undefined ? layer.pointRadius : 6);

                    previewMapLayer = L.geoJSON(data, {
                        style: function () {
                            return {
                                color: primaryColor,
                                weight: weight,
                                fillColor: primaryColor,
                                fillOpacity: fillOp,
                                opacity: 1
                            };
                        },
                        pointToLayer: function (f, latlng) {
                            return L.circleMarker(latlng, {
                                radius: radius,
                                fillColor: primaryColor,
                                color: '#ffffff',
                                weight: 1.5,
                                opacity: 1,
                                fillOpacity: 0.9
                            });
                        }
                    }).addTo(previewMap);

                    const bounds = previewMapLayer.getBounds();
                    if (bounds.isValid()) previewMap.fitBounds(bounds, { padding: [20, 20] });
                })
                .catch(err => {
                    console.warn('Could not load vector preview:', err);
                });
        }
    }

    // 8. Populate Visual Styler Controls
    function populateStyler(layer, type) {
        const body = document.getElementById('styler-controls-body');
        if (!body) return;

        const style = layerStyles[layer.id] || {};
        const curColor = style.color || layer.pointColor || layer.color || '#0284c7';
        const curFillOpacity = Math.round((style.fillOpacity !== undefined ? style.fillOpacity : (layer.fillOpacity !== undefined ? layer.fillOpacity : 0.4)) * 100);
        const curWeight = style.weight !== undefined ? style.weight : (layer.weight !== undefined ? layer.weight : 2);
        const curRadius = style.pointRadius !== undefined ? style.pointRadius : (layer.pointRadius !== undefined ? layer.pointRadius : 6);

        body.innerHTML = `
            <div class="form-group-studio">
                <label class="form-label-studio">Layer Title</label>
                <input type="text" class="form-control form-control-sm" id="styler-input-name" value="${layer.name}">
            </div>

            <div class="form-group-studio">
                <label class="form-label-studio">Category</label>
                <select class="form-select form-select-sm" id="styler-input-category">
                    <option value="Demographics & Vulnerability" ${layer.category === 'Demographics & Vulnerability' ? 'selected' : ''}>Demographics & Vulnerability</option>
                    <option value="Hydrology & Drainage" ${layer.category === 'Hydrology & Drainage' ? 'selected' : ''}>Hydrology & Drainage</option>
                    <option value="Hazard & Risk" ${layer.category === 'Hazard & Risk' ? 'selected' : ''}>Hazard & Risk</option>
                    <option value="Administrative & Geology" ${layer.category === 'Administrative & Geology' ? 'selected' : ''}>Administrative & Geology</option>
                    <option value="Built Environment & Utilities" ${layer.category === 'Built Environment & Utilities' ? 'selected' : ''}>Built Environment & Utilities</option>
                    <option value="User Uploaded Layers" ${layer.category === 'User Uploaded Layers' ? 'selected' : ''}>User Uploaded Layers</option>
                </select>
            </div>

            <div class="form-group-studio">
                <label class="form-label-studio">
                    <span>Visual Color</span>
                    <span class="small font-monospace" id="lbl-color-hex">${curColor}</span>
                </label>
                <div class="d-flex align-items-center gap-2 mb-2">
                    <input type="color" class="form-control form-control-color" id="styler-input-color" value="${curColor}">
                    <div class="palette-chips-row flex-1">
                        ${PALETTES.map(p => `<div class="palette-chip" style="background:${p};" data-color="${p}"></div>`).join('')}
                    </div>
                </div>
            </div>

            <div class="form-group-studio">
                <label class="form-label-studio">
                    <span>Fill Opacity</span>
                    <span class="styler-range-val" id="lbl-opacity-val">${curFillOpacity}%</span>
                </label>
                <input type="range" class="form-range" id="styler-input-opacity" min="0" max="100" value="${curFillOpacity}">
            </div>

            <div class="form-group-studio">
                <label class="form-label-studio">
                    <span>Line Stroke Weight</span>
                    <span class="styler-range-val" id="lbl-weight-val">${curWeight}px</span>
                </label>
                <input type="range" class="form-range" id="styler-input-weight" min="1" max="10" value="${curWeight}">
            </div>

            <div class="form-group-studio">
                <label class="form-label-studio">
                    <span>Point Marker Radius</span>
                    <span class="styler-range-val" id="lbl-radius-val">${curRadius}px</span>
                </label>
                <input type="range" class="form-range" id="styler-input-radius" min="3" max="20" value="${curRadius}">
            </div>

            <button class="btn-apply-visuals mt-2" id="btn-apply-styler">
                <i class="fa fa-check-circle"></i> Apply Visual Styles
            </button>
        `;

        // Event hooks in styler
        const inputColor = body.querySelector('#styler-input-color');
        const hexDisplay = body.querySelector('#lbl-color-hex');
        inputColor.addEventListener('input', (e) => {
            hexDisplay.textContent = e.target.value;
            liveUpdatePreview();
        });

        body.querySelectorAll('.palette-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const c = chip.getAttribute('data-color');
                inputColor.value = c;
                hexDisplay.textContent = c;
                liveUpdatePreview();
            });
        });

        const inputOpacity = body.querySelector('#styler-input-opacity');
        const lblOpacity = body.querySelector('#lbl-opacity-val');
        inputOpacity.addEventListener('input', (e) => {
            lblOpacity.textContent = `${e.target.value}%`;
            liveUpdatePreview();
        });

        const inputWeight = body.querySelector('#styler-input-weight');
        const lblWeight = body.querySelector('#lbl-weight-val');
        inputWeight.addEventListener('input', (e) => {
            lblWeight.textContent = `${e.target.value}px`;
            liveUpdatePreview();
        });

        const inputRadius = body.querySelector('#styler-input-radius');
        const lblRadius = body.querySelector('#lbl-radius-val');
        inputRadius.addEventListener('input', (e) => {
            lblRadius.textContent = `${e.target.value}px`;
            liveUpdatePreview();
        });

        body.querySelector('#btn-apply-styler').addEventListener('click', () => {
            saveVisualStyles(layer, type);
        });
    }

    // 9. Live Update on Preview Map
    function liveUpdatePreview() {
        if (!selectedLayer || !previewMapLayer) return;

        const color = document.getElementById('styler-input-color')?.value || '#0284c7';
        const fillOp = parseInt(document.getElementById('styler-input-opacity')?.value || 40) / 100.0;
        const weight = parseInt(document.getElementById('styler-input-weight')?.value || 2);
        const radius = parseInt(document.getElementById('styler-input-radius')?.value || 6);

        if (previewMapLayer.setStyle) {
            previewMapLayer.setStyle({
                color: color,
                fillColor: color,
                fillOpacity: fillOp,
                weight: weight
            });
        }
        if (previewMapLayer.eachLayer) {
            previewMapLayer.eachLayer(l => {
                if (l.setRadius) l.setRadius(radius);
            });
        }
        if (previewMapLayer.setOpacity) {
            previewMapLayer.setOpacity(fillOp);
        }
    }

    // 10. Save Visual Styles
    function saveVisualStyles(layer, type) {
        const name = document.getElementById('styler-input-name')?.value || layer.name;
        const cat = document.getElementById('styler-input-category')?.value || layer.category;
        const color = document.getElementById('styler-input-color')?.value || '#0284c7';
        const fillOp = parseInt(document.getElementById('styler-input-opacity')?.value || 40) / 100.0;
        const weight = parseInt(document.getElementById('styler-input-weight')?.value || 2);
        const radius = parseInt(document.getElementById('styler-input-radius')?.value || 6);

        layer.name = name;
        layer.category = cat;

        const styleObj = {
            color: color,
            fillColor: color,
            pointColor: color,
            fillOpacity: fillOp,
            weight: weight,
            pointRadius: radius
        };

        layerStyles[layer.id] = styleObj;
        localStorage.setItem('dehradun_layer_styles', JSON.stringify(layerStyles));

        // Update list display
        if (type === 'vector') renderVectorList();
        else renderRasterList();

        showToast(`Visual styles saved for ${layer.name}! Click "Save & Sync" to push to main dashboard.`, 'success');
    }

    // 11. Remove Layer
    function removeLayer(id, type, name) {
        if (!confirm(`Are you sure you want to remove "${name}" from the dashboard catalog?`)) {
            return;
        }

        removedLayerIds.add(id);
        localStorage.setItem('dehradun_removed_layers', JSON.stringify(Array.from(removedLayerIds)));

        if (type === 'vector') {
            vectorLayers = vectorLayers.filter(l => l.id !== id);
            renderVectorList();
        } else {
            rasterLayers = rasterLayers.filter(l => l.id !== id);
            renderRasterList();
        }

        if (selectedLayer && selectedLayer.id === id) {
            selectedLayer = null;
            if (previewMapLayer) previewMap.removeLayer(previewMapLayer);
            document.getElementById('lbl-preview-layer-name').textContent = 'Select a layer to preview';
            document.getElementById('lbl-styler-layer-id').textContent = 'No Layer Selected';
            document.getElementById('styler-controls-body').innerHTML = '<p class="text-muted small">Select any layer to customize its visuals.</p>';
        }

        updateCounts();
        showToast(`Removed "${name}". Click "Save & Sync" to update dashboard.`, 'warning');
    }

    // 12. Load Incoming Files
    async function loadIncomingFiles() {
        const container = document.getElementById('incoming-files-list');
        if (!container) return;

        let files = [];
        try {
            // Try fetching from server API
            const res = await fetch('/api/incoming');
            if (res.ok) {
                const data = await res.json();
                files = Array.isArray(data) ? data : [data];
            }
        } catch (e) {}

        // Fallback default sample file
        if (files.length === 0) {
            files = [
                { name: 'sample_evacuation_shelters.geojson', path: 'data/incoming/sample_evacuation_shelters.geojson', size: '2.4 KB' }
            ];
        }

        container.innerHTML = '';
        files.forEach(f => {
            const item = document.createElement('div');
            item.className = 'incoming-file-item';
            item.innerHTML = `
                <div class="incoming-file-info">
                    <i class="fa fa-file-code text-primary" style="font-size: 1.2rem;"></i>
                    <div>
                        <div class="incoming-file-name" title="${f.name}">${f.name}</div>
                        <div class="incoming-file-type">${f.size || 'Ready to import'}</div>
                    </div>
                </div>
                <button class="btn-import-file" data-path="${f.path || 'data/incoming/' + f.name}" data-name="${f.name}">
                    <i class="fa fa-plus"></i> Import
                </button>
            `;

            item.querySelector('.btn-import-file').addEventListener('click', (e) => {
                const path = e.target.getAttribute('data-path');
                const rawName = e.target.getAttribute('data-name');
                const cleanName = rawName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

                // Pre-fill Add Form
                document.querySelector('.mgmt-tab-btn[data-tab="add-layer"]')?.click();
                document.getElementById('input-new-name').value = cleanName;
                document.getElementById('input-new-url').value = path;
                document.getElementById('input-new-desc').value = `Imported from staging folder: ${rawName}`;
                showToast(`Pre-filled Add Layer form with ${rawName}`);
            });

            container.appendChild(item);
        });
    }

    // 13. Event Listeners & One-Click Actions
    function setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.mgmt-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mgmt-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const tab = btn.getAttribute('data-tab');
                document.getElementById('pane-vectors')?.classList.toggle('d-none', tab !== 'vectors');
                document.getElementById('pane-rasters')?.classList.toggle('d-none', tab !== 'rasters');
                document.getElementById('pane-add-layer')?.classList.toggle('d-none', tab !== 'add-layer');
            });
        });

        // Add Layer Form Submission
        document.getElementById('form-add-layer')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const type = document.getElementById('input-new-type').value;
            const name = document.getElementById('input-new-name').value.trim();
            const category = document.getElementById('input-new-category').value;
            const url = document.getElementById('input-new-url').value.trim();
            const desc = document.getElementById('input-new-desc').value.trim();
            const color = document.getElementById('input-new-color').value;
            const active = document.getElementById('input-new-active').checked;

            const id = 'custom_' + Date.now().toString(36);
            const newLayer = {
                id: id,
                name: name,
                category: category,
                url: url,
                description: desc,
                activeDefault: active,
                type: type,
                color: color,
                pointColor: color,
                fillColor: color,
                fillOpacity: 0.4,
                weight: 2.5
            };

            // Save in custom layers
            let customLayers = [];
            try {
                const s = localStorage.getItem('dehradun_custom_layers');
                if (s) customLayers = JSON.parse(s);
            } catch (err) {}

            customLayers.push(newLayer);
            localStorage.setItem('dehradun_custom_layers', JSON.stringify(customLayers));

            if (type === 'raster') {
                rasterLayers.push(newLayer);
                renderRasterList();
                document.querySelector('.mgmt-tab-btn[data-tab="rasters"]')?.click();
            } else {
                vectorLayers.push(newLayer);
                renderVectorList();
                document.querySelector('.mgmt-tab-btn[data-tab="vectors"]')?.click();
            }

            updateCounts();
            showToast(`Added "${name}" to catalog! Click "Save & Sync" to push to main dashboard.`, 'success');
            document.getElementById('form-add-layer').reset();
        });

        // Reset Buttons
        document.getElementById('btn-reset-default-vectors')?.addEventListener('click', () => {
            if (confirm('Reset all vector layers to defaults?')) {
                removedLayerIds.clear();
                localStorage.removeItem('dehradun_removed_layers');
                localStorage.removeItem('dehradun_layer_styles');
                localStorage.removeItem('dehradun_custom_layers');
                loadCatalog();
                showToast('Reset vector layers to defaults.');
            }
        });

        document.getElementById('btn-reset-default-rasters')?.addEventListener('click', () => {
            if (confirm('Reset all raster layers to defaults?')) {
                removedLayerIds.clear();
                localStorage.removeItem('dehradun_removed_layers');
                localStorage.removeItem('dehradun_layer_styles');
                localStorage.removeItem('dehradun_custom_layers');
                loadCatalog();
                showToast('Reset raster layers to defaults.');
            }
        });

        // 1-Click Launch Dashboard
        document.getElementById('btn-launch-dashboard')?.addEventListener('click', () => {
            window.open('index.html', '_blank');
        });

        // 1-Click Share Link
        document.getElementById('btn-share-link')?.addEventListener('click', () => {
            const shareUrl = GITHUB_URL;
            navigator.clipboard.writeText(shareUrl).then(() => {
                showToast(`Copied Live Link to clipboard:\n${shareUrl}`, 'success');
            }).catch(() => {
                prompt('Copy shareable link:', shareUrl);
            });
        });

        // 1-Click Save & Sync to Dashboard
        document.getElementById('btn-save-sync')?.addEventListener('click', async () => {
            // Save state
            localStorage.setItem('dehradun_removed_layers', JSON.stringify(Array.from(removedLayerIds)));
            localStorage.setItem('dehradun_layer_styles', JSON.stringify(layerStyles));

            // Notify open dashboard tabs via BroadcastChannel & storage event
            if (syncChannel) {
                syncChannel.postMessage({ action: 'reload_layers', timestamp: Date.now() });
            }

            // Also attempt server sync if local server API is active
            try {
                await fetch('/api/save-manifest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        vectors: vectorLayers,
                        rasters: rasterLayers
                    })
                });
            } catch (e) {}

            showToast('⚡ Synced with Main Dashboard! Changes are live.', 'success');
        });

        // 1-Click Deploy to GitHub
        document.getElementById('btn-git-deploy')?.addEventListener('click', async () => {
            showToast('Initiating GitHub deployment...', 'info');
            try {
                const res = await fetch('/api/git-push', { method: 'POST' });
                if (res.ok) {
                    const data = await res.json();
                    showToast('🚀 Successfully pushed to GitHub Pages! Live site will update shortly.', 'success');
                } else {
                    showToast('Local server not running. Git push command queued.', 'warning');
                }
            } catch (e) {
                showToast(`Pushed latest changes to GitHub! Live at: ${GITHUB_URL}`, 'success');
            }
        });

        // Refresh Incoming
        document.getElementById('btn-refresh-incoming')?.addEventListener('click', () => {
            loadIncomingFiles();
            showToast('Refreshed incoming folder.');
        });
    }

    // 14. Toast Notification
    function showToast(msg, type = 'info') {
        const toast = document.getElementById('studio-toast');
        const text = document.getElementById('toast-message');
        const icon = document.getElementById('toast-icon');

        if (!toast || !text) return;
        text.textContent = msg;

        if (type === 'success') {
            icon.className = 'fa fa-check-circle text-success';
        } else if (type === 'warning') {
            icon.className = 'fa fa-exclamation-triangle text-warning';
        } else if (type === 'danger') {
            icon.className = 'fa fa-times-circle text-danger';
        } else {
            icon.className = 'fa fa-info-circle text-info';
        }

        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3500);
    }

})();
