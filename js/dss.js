/**
 * Dehradun GIS Portal - Decision Support System (DSS) Module
 * Multi-Criteria Spatial Evaluation (MCE) for Hazard & Planning
 */

const DSSModule = (function () {
    let map = null;
    let dssOverlayLayer = null;
    let rasterManifest = null;
    let rasterDataMap = {}; // id -> manifest object

    const PRESETS = {
        monsoon: { flood: 40, rain: 35, slope: 10, twi: 10, lulc: 5 },
        steep_drainage: { flood: 15, rain: 20, slope: 45, twi: 10, lulc: 10 },
        urban_sponge: { flood: 25, rain: 15, slope: 10, twi: 25, lulc: 25 },
        balanced: { flood: 30, rain: 25, slope: 20, twi: 15, lulc: 10 }
    };

    function init(mapInstance, manifest) {
        map = mapInstance;
        rasterManifest = manifest;

        // Index rasters by id
        manifest.forEach(r => {
            rasterDataMap[r.id] = r;
        });

        setupEventListeners();
    }

    function setupEventListeners() {
        const sliders = ['flood', 'rain', 'slope', 'twi', 'lulc'];
        sliders.forEach(key => {
            const slider = document.getElementById(`slider-w-${key}`);
            if (slider) {
                slider.addEventListener('input', () => {
                    const val = slider.value;
                    const display = document.getElementById(`val-w-${key}`);
                    if (display) display.textContent = `${val}%`;
                    updateTotalWeight();
                    const presetSelect = document.getElementById('dss-preset-select');
                    if (presetSelect) presetSelect.value = 'custom';
                });
            }
        });

        // Preset selector
        const presetSelect = document.getElementById('dss-preset-select');
        if (presetSelect) {
            presetSelect.addEventListener('change', (e) => {
                const p = PRESETS[e.target.value];
                if (p) {
                    setSlider('flood', p.flood);
                    setSlider('rain', p.rain);
                    setSlider('slope', p.slope);
                    setSlider('twi', p.twi);
                    setSlider('lulc', p.lulc);
                    updateTotalWeight();
                }
            });
        }

        // Compute button
        const btnCompute = document.getElementById('btn-compute-dss');
        if (btnCompute) {
            btnCompute.addEventListener('click', computeMCE);
        }

        // Clear button
        const btnClear = document.getElementById('btn-clear-dss');
        if (btnClear) {
            btnClear.addEventListener('click', clearDSS);
        }
    }

    function setSlider(key, val) {
        const slider = document.getElementById(`slider-w-${key}`);
        const display = document.getElementById(`val-w-${key}`);
        if (slider) slider.value = val;
        if (display) display.textContent = `${val}%`;
    }

    function updateTotalWeight() {
        const f = parseInt(document.getElementById('slider-w-flood')?.value || 0);
        const r = parseInt(document.getElementById('slider-w-rain')?.value || 0);
        const s = parseInt(document.getElementById('slider-w-slope')?.value || 0);
        const t = parseInt(document.getElementById('slider-w-twi')?.value || 0);
        const l = parseInt(document.getElementById('slider-w-lulc')?.value || 0);
        const total = f + r + s + t + l;

        const totalElem = document.getElementById('total-weight-display');
        if (totalElem) {
            totalElem.textContent = `${total}%`;
            if (total === 100) {
                totalElem.className = 'total-badge text-success fw-bold';
            } else {
                totalElem.className = 'total-badge text-danger fw-bold';
            }
        }
    }

    function computeMCE() {
        const wFlood = parseFloat(document.getElementById('slider-w-flood')?.value || 0) / 100.0;
        const wRain = parseFloat(document.getElementById('slider-w-rain')?.value || 0) / 100.0;
        const wSlope = parseFloat(document.getElementById('slider-w-slope')?.value || 0) / 100.0;
        const wTwi = parseFloat(document.getElementById('slider-w-twi')?.value || 0) / 100.0;
        const wLulc = parseFloat(document.getElementById('slider-w-lulc')?.value || 0) / 100.0;

        const totalW = wFlood + wRain + wSlope + wTwi + wLulc;
        if (totalW <= 0) {
            alert('Please assign positive weights to calculate Decision Support Index.');
            return;
        }

        // Use base grid from Flood Inundation or Slope
        const baseLayer = rasterDataMap['flood_inundation'] || rasterDataMap['slope_analysis'];
        if (!baseLayer || !baseLayer.matrix) {
            console.error('Base matrix not available for DSS analysis.');
            return;
        }

        const gridH = baseLayer.gridH;
        const gridW = baseLayer.gridW;
        const bounds = baseLayer.bounds;

        // References to layer matrices
        const mFlood = rasterDataMap['flood_inundation']?.matrix;
        const mRain = rasterDataMap['rainfall_aoi']?.matrix;
        const mSlope = rasterDataMap['slope_analysis']?.matrix;
        const mTwi = rasterDataMap['twi_wetness']?.matrix;
        const mLulc = rasterDataMap['lulc_fr']?.matrix;

        // Create canvas for rendering
        const canvas = document.createElement('canvas');
        canvas.width = gridW;
        canvas.height = gridH;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(gridW, gridH);
        const data = imgData.data;

        let highCount = 0;
        let medCount = 0;
        let lowCount = 0;
        let totalValid = 0;

        for (let y = 0; y < gridH; y++) {
            for (let x = 0; x < gridW; x++) {
                const idx = (y * gridW + x) * 4;

                // Extract normalized factor values
                const valFlood = (mFlood && mFlood[y] && mFlood[y][x] !== null) ? mFlood[y][x] : null;
                const valRain = (mRain && mRain[y] && mRain[y][x] !== null) ? mRain[y][x] : null;
                const valSlope = (mSlope && mSlope[y] && mSlope[y][x] !== null) ? mSlope[y][x] : null;
                const valTwi = (mTwi && mTwi[y] && mTwi[y][x] !== null) ? mTwi[y][x] : null;
                const valLulc = (mLulc && mLulc[y] && mLulc[y][x] !== null) ? mLulc[y][x] : null;

                // If at least 2 factors are valid, compute composite risk
                let subWeight = 0;
                let subScore = 0;

                if (valFlood !== null) {
                    const normFlood = valFlood >= 2 ? 1.0 : (valFlood === 1 ? 0.5 : 0.0);
                    subScore += wFlood * normFlood;
                    subWeight += wFlood;
                }
                if (valRain !== null && valRain > 100) {
                    const normRain = Math.max(0, Math.min(1, (valRain - 2940) / (4243 - 2940)));
                    subScore += wRain * normRain;
                    subWeight += wRain;
                }
                if (valSlope !== null) {
                    const normSlope = Math.max(0, Math.min(1, valSlope / 35.0));
                    subScore += wSlope * normSlope;
                    subWeight += wSlope;
                }
                if (valTwi !== null) {
                    const normTwi = Math.max(0, Math.min(1, valTwi / 18.0));
                    subScore += wTwi * normTwi;
                    subWeight += wTwi;
                }
                if (valLulc !== null) {
                    const normLulc = Math.max(0, Math.min(1, (valLulc - 0.18) / (2.74 - 0.18)));
                    subScore += wLulc * normLulc;
                    subWeight += wLulc;
                }

                if (subWeight > 0.1) {
                    const composite = subScore / subWeight; // 0 to 1
                    totalValid++;

                    let r = 0, g = 0, b = 0, a = 210;

                    if (composite >= 0.65) {
                        // High Risk: Crimson Red
                        r = 231; g = 76; b = 60;
                        highCount++;
                    } else if (composite >= 0.35) {
                        // Moderate Risk: Amber/Orange
                        r = 243; g = 156; b = 18;
                        medCount++;
                    } else {
                        // Low Risk: Emerald Green
                        r = 46; g = 204; b = 113;
                        lowCount++;
                    }

                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
                    data[idx + 3] = a;
                } else {
                    data[idx + 3] = 0; // Transparent
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);

        // Remove old overlay if present
        if (dssOverlayLayer) {
            map.removeLayer(dssOverlayLayer);
            dssOverlayLayer = null;
        }

        // Add new overlay to map
        const dataUrl = canvas.toDataURL();
        dssOverlayLayer = L.imageOverlay(dataUrl, bounds, {
            opacity: 0.85,
            interactive: false
        }).addTo(map);

        map.fitBounds(bounds, { padding: [20, 20] });

        // Update statistical summary
        updateSummaryCard(highCount, medCount, lowCount, totalValid);
    }

    function updateSummaryCard(high, med, low, total) {
        const card = document.getElementById('dss-results-card');
        if (!card) return;

        card.style.display = 'block';

        if (total === 0) total = 1;
        const pctHigh = Math.round((high / total) * 100);
        const pctMed = Math.round((med / total) * 100);
        const pctLow = Math.max(0, 100 - pctHigh - pctMed);

        const totalAreaKm2 = 136.7; // Dehradun study AOI area
        const areaHigh = ((pctHigh / 100.0) * totalAreaKm2).toFixed(1);
        const areaMed = ((pctMed / 100.0) * totalAreaKm2).toFixed(1);
        const areaLow = ((pctLow / 100.0) * totalAreaKm2).toFixed(1);

        document.getElementById('risk-bar-high').style.width = `${pctHigh}%`;
        document.getElementById('risk-bar-med').style.width = `${pctMed}%`;
        document.getElementById('risk-bar-low').style.width = `${pctLow}%`;

        document.getElementById('stat-high-pct').textContent = `${pctHigh}%`;
        document.getElementById('stat-med-pct').textContent = `${pctMed}%`;
        document.getElementById('stat-low-pct').textContent = `${pctLow}%`;

        document.getElementById('stat-high-area').textContent = areaHigh;
        document.getElementById('stat-med-area').textContent = areaMed;
        document.getElementById('stat-low-area').textContent = areaLow;
    }

    function clearDSS() {
        if (dssOverlayLayer) {
            map.removeLayer(dssOverlayLayer);
            dssOverlayLayer = null;
        }
        const card = document.getElementById('dss-results-card');
        if (card) card.style.display = 'none';
    }

    return {
        init,
        computeMCE,
        clearDSS
    };
})();
