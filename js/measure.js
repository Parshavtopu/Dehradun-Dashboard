/**
 * Dehradun GIS Portal - Measurement Tool Module
 * Distance and Area measurement with Leaflet
 */

const MeasurementTool = (function () {
    let activeMode = null; // 'distance' | 'area' | null
    let map = null;
    let measureLayer = null;
    let currentPoints = [];
    let tempLayer = null;
    let tooltipMarker = null;

    function init(mapInstance) {
        map = mapInstance;
        measureLayer = L.featureGroup().addTo(map);

        // Bind HUD close button
        const btnClose = document.getElementById('btn-close-hud');
        if (btnClose) {
            btnClose.addEventListener('click', stop);
        }

        // Map click handlers for measurement
        map.on('click', handleMapClick);
        map.on('mousemove', handleMouseMove);
        map.on('dblclick', handleDoubleClick);
    }

    function start(mode) {
        clear();
        activeMode = mode;
        currentPoints = [];

        const hud = document.getElementById('measurement-hud');
        const title = document.getElementById('hud-mode-title');
        const hint = document.getElementById('hud-hint');
        const val = document.getElementById('hud-value');

        if (hud) hud.style.display = 'block';

        if (mode === 'distance') {
            if (title) title.innerHTML = '<i class="fa fa-ruler text-warning"></i> Distance Measurement';
            if (hint) hint.textContent = 'Click on the map to add points. Double-click to complete line.';
            if (val) val.textContent = '0.00 m';
            map.getContainer().style.cursor = 'crosshair';
        } else if (mode === 'area') {
            if (title) title.innerHTML = '<i class="fa fa-draw-polygon text-info"></i> Area Measurement';
            if (hint) hint.textContent = 'Click on map to create polygon vertices. Double-click to finish.';
            if (val) val.textContent = '0.00 m²';
            map.getContainer().style.cursor = 'crosshair';
        }
    }

    function stop() {
        activeMode = null;
        map.getContainer().style.cursor = '';
        const hud = document.getElementById('measurement-hud');
        if (hud) hud.style.display = 'none';
        if (tempLayer) {
            map.removeLayer(tempLayer);
            tempLayer = null;
        }
        if (tooltipMarker) {
            map.removeLayer(tooltipMarker);
            tooltipMarker = null;
        }
    }

    function clear() {
        if (measureLayer) measureLayer.clearLayers();
        if (tempLayer) {
            map.removeLayer(tempLayer);
            tempLayer = null;
        }
        if (tooltipMarker) {
            map.removeLayer(tooltipMarker);
            tooltipMarker = null;
        }
        currentPoints = [];
        stop();
    }

    function handleMapClick(e) {
        if (!activeMode) return;

        const pt = e.latlng;
        currentPoints.push(pt);

        // Add vertex marker
        const marker = L.circleMarker(pt, {
            radius: 5,
            color: '#f5a623',
            fillColor: '#ffffff',
            fillOpacity: 1,
            weight: 2
        }).addTo(measureLayer);

        updateDrawing(pt);
    }

    function handleMouseMove(e) {
        if (!activeMode || currentPoints.length === 0) return;

        const pts = [...currentPoints, e.latlng];
        updateDrawing(e.latlng, pts);
    }

    function handleDoubleClick(e) {
        if (!activeMode) return;
        L.DomEvent.stopPropagation(e);

        if (currentPoints.length >= 2) {
            if (activeMode === 'distance') {
                const totalDist = calculateDistance(currentPoints);
                showFinalMeasurement(totalDist, 'distance');
            } else if (activeMode === 'area' && currentPoints.length >= 3) {
                const totalArea = calculatePolygonArea(currentPoints);
                showFinalMeasurement(totalArea, 'area');
            }
        }
        stop();
    }

    function updateDrawing(cursorPt, ptsToDraw) {
        const pts = ptsToDraw || currentPoints;

        if (tempLayer) {
            map.removeLayer(tempLayer);
            tempLayer = null;
        }

        if (activeMode === 'distance' && pts.length >= 2) {
            tempLayer = L.polyline(pts, {
                color: '#f5a623',
                weight: 3,
                dashArray: '5, 5'
            }).addTo(map);

            const dist = calculateDistance(pts);
            updateHudValue(formatDistance(dist));
        } else if (activeMode === 'area' && pts.length >= 3) {
            tempLayer = L.polygon(pts, {
                color: '#00b4d8',
                fillColor: '#0077b6',
                fillOpacity: 0.25,
                weight: 2,
                dashArray: '4, 4'
            }).addTo(map);

            const area = calculatePolygonArea(pts);
            updateHudValue(formatArea(area));
        }
    }

    function showFinalMeasurement(val, mode) {
        const lastPt = currentPoints[currentPoints.length - 1];
        let label = '';

        if (mode === 'distance') {
            label = `Total Distance: <strong>${formatDistance(val)}</strong>`;
            L.polyline(currentPoints, {
                color: '#f5a623',
                weight: 4
            }).addTo(measureLayer);
        } else {
            label = `Total Area: <strong>${formatArea(val)}</strong>`;
            L.polygon(currentPoints, {
                color: '#00b4d8',
                fillColor: '#0077b6',
                fillOpacity: 0.35,
                weight: 3
            }).addTo(measureLayer);
        }

        L.popup({ autoClose: false, closeOnClick: false })
            .setLatLng(lastPt)
            .setContent(label)
            .openOn(map);
    }

    function updateHudValue(text) {
        const valElem = document.getElementById('hud-value');
        if (valElem) valElem.textContent = text;
    }

    function calculateDistance(points) {
        let total = 0;
        for (let i = 0; i < points.length - 1; i++) {
            total += points[i].distanceTo(points[i + 1]);
        }
        return total;
    }

    function formatDistance(meters) {
        if (meters >= 1000) {
            return (meters / 1000).toFixed(2) + ' km';
        }
        return meters.toFixed(1) + ' m';
    }

    function calculatePolygonArea(latlngs) {
        // Spherical polygon area approximation
        const radius = 6378137;
        let area = 0;
        const len = latlngs.length;

        if (len < 3) return 0;

        for (let i = 0; i < len; i++) {
            const p1 = latlngs[i];
            const p2 = latlngs[(i + 1) % len];

            const radX1 = (p1.lng * Math.PI) / 180;
            const radY1 = (p1.lat * Math.PI) / 180;
            const radX2 = (p2.lng * Math.PI) / 180;
            const radY2 = (p2.lat * Math.PI) / 180;

            area += (radX2 - radX1) * (2 + Math.sin(radY1) + Math.sin(radY2));
        }

        area = (Math.abs(area) * radius * radius) / 2.0;
        return area;
    }

    function formatArea(sqMeters) {
        if (sqMeters >= 1000000) {
            return (sqMeters / 1000000).toFixed(2) + ' km²';
        }
        if (sqMeters >= 10000) {
            return (sqMeters / 10000).toFixed(2) + ' hectares';
        }
        return sqMeters.toFixed(1) + ' m²';
    }

    return {
        init,
        start,
        stop,
        clear
    };
})();
