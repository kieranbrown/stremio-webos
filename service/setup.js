(function() {
    'use strict';
    var mode = document.getElementById('mode'), url = document.getElementById('url'), status = document.getElementById('status');
    var busy = false;
    var searching = false, discoveryTimer = null, discoveryGeneration = 0;
    var discover = document.getElementById('discover'), stop = document.getElementById('stop-discovery');
    var found = document.getElementById('discovery-results'), discoveryStatus = document.getElementById('discovery-status');
    var rendered = new Set();
    function discoveryButtons(active) { searching = active; discover.disabled = active; stop.hidden = !active; }
    async function stopSearch() {
        discoveryGeneration++;
        clearTimeout(discoveryTimer); discoveryButtons(false);
        try { await fetch('/playback/discovery', { method: 'DELETE' }); } catch (_) {}
    }
    function renderDiscovery(data) {
        (data.servers || []).forEach(function(server) {
            if (rendered.has(server.url)) return;
            rendered.add(server.url);
            var button = document.createElement('button');
            button.textContent = server.url.replace('http://', '') + '  ·  Stremio ' + server.version + '  ·  Cache ' + (server.cacheEnabled ? 'on' : 'off');
            button.onclick = function() {
                url.value = server.url;
                stopSearch();
                discoveryStatus.textContent = 'Server selected. Save and test the connection to use it.';
                document.getElementById('check').focus();
            };
            found.appendChild(button);
        });
        if (data.running) discoveryStatus.textContent = 'Searching this network… ' + data.checked + '/' + data.total + ' checked · ' + rendered.size + ' found';
        else if (data.error) discoveryStatus.textContent = data.error;
        else if (rendered.size) discoveryStatus.textContent = rendered.size + ' server' + (rendered.size === 1 ? '' : 's') + ' found. Select one.' + (data.limited ? ' Search covered nearby addresses only.' : '');
        else discoveryStatus.textContent = data.cancelled ? 'Search stopped.' : 'No compatible servers found. Check that the server is running and local-network access is allowed. HTTPS-only or custom-port servers need a manual address.';
        discoveryButtons(data.running);
    }
    async function pollDiscovery(generation) {
        try {
            var response = await fetch('/playback/discovery'), data = await response.json();
            if (generation !== discoveryGeneration) return;
            if (!response.ok) throw new Error(data.error || 'Search failed');
            renderDiscovery(data);
            if (searching) discoveryTimer = setTimeout(function() { pollDiscovery(generation); }, 500);
        } catch (error) { if (generation === discoveryGeneration) { discoveryButtons(false); discoveryStatus.textContent = error.message; } }
    }
    discover.onclick = async function() {
        if (searching) return;
        var generation = ++discoveryGeneration;
        rendered.clear(); found.replaceChildren(); discoveryButtons(true); discoveryStatus.textContent = 'Starting search…';
        try {
            var response = await fetch('/playback/discovery', { method: 'POST' }), data = await response.json();
            if (generation !== discoveryGeneration) return;
            if (!response.ok) throw new Error(data.error || 'Could not start search');
            renderDiscovery(data); if (searching) discoveryTimer = setTimeout(function() { pollDiscovery(generation); }, 500);
        } catch (error) { if (generation === discoveryGeneration) { discoveryButtons(false); discoveryStatus.textContent = error.message; } }
    };
    stop.onclick = async function() { await stopSearch(); discoveryStatus.textContent = 'Search stopped.'; };
    window.addEventListener('pagehide', function() { if (searching) fetch('/playback/discovery', { method: 'DELETE', keepalive: true }).catch(function() {}); });
    function update() {
        document.getElementById('external').hidden = mode.value !== 'external';
        if (mode.value !== 'external' && searching) stopSearch();
    }
    mode.addEventListener('change', update);
    async function save(test) {
        if (busy) return;
        if (searching) await stopSearch();
        busy = true; status.textContent = 'Saving…';
        try {
            var response = await fetch('/playback/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: mode.value, serverUrl: url.value.trim() }) });
            var data = await response.json(); if (!response.ok) throw new Error(data.error);
            if (test) {
                status.textContent = 'Connecting…';
                response = await fetch('/playback/check'); data = await response.json();
                if (!response.ok) throw new Error(data.error);
                status.textContent = 'Connected — server ' + data.version + (mode.value === 'external' ? '. Disk cache is controlled on the external server.' : '. RAM buffering is active.');
            } else location.href = '/';
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; }
    }
    document.getElementById('save').onclick = function() { save(false); };
    document.getElementById('check').onclick = function() { save(true); };
    document.getElementById('cancel').onclick = function() { location.href = '/'; };
    // Ordinary form controls need explicit D-pad focus movement on TV.
    document.addEventListener('keydown', function(event) {
        if (event.keyCode === 461) { event.preventDefault(); location.href = '/'; return; }
        var controls = Array.from(document.querySelectorAll('select,input,button')).filter(function(el) { return el.offsetParent !== null && !el.disabled; });
        if (event.target.tagName === 'SELECT' && [37,39].includes(event.keyCode)) {
            event.preventDefault();
            var select = event.target;
            select.selectedIndex = (select.selectedIndex + (event.keyCode === 39 ? 1 : select.options.length - 1)) % select.options.length;
            select.dispatchEvent(new Event('change')); return;
        }
        if (event.target.tagName === 'INPUT' && [37,39].includes(event.keyCode)) return;
        if (['SELECT','INPUT'].includes(event.target.tagName) && event.keyCode === 13) {
            event.preventDefault(); controls[(controls.indexOf(event.target) + 1) % controls.length].focus(); return;
        }
        var index = controls.indexOf(document.activeElement), step = [39,40].includes(event.keyCode) ? 1 : [37,38].includes(event.keyCode) ? -1 : 0;
        if (step) { event.preventDefault(); controls[(index + step + controls.length) % controls.length].focus(); }
    });
    fetch('/playback/config').then(function(r) { return r.json(); }).then(function(data) {
        mode.value = data.config.mode; url.value = data.config.serverUrl || ''; update(); mode.focus();
    }).catch(function(error) { status.textContent = error.message; });
})();
