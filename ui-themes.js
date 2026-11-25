(function () {
    'use strict';
    const modes = new Set(['icy', 'heavy', 'calm']), key = 'hbh-dss-visual-mode';
    const buttons = [...document.querySelectorAll('.theme-switch[data-theme]')];
    function apply(mode) {
        if (!modes.has(mode)) mode = 'icy';
        document.body.classList.toggle('icy-mode', mode !== 'calm');
        document.body.classList.toggle('heavy-mode', mode === 'heavy');
        document.body.dataset.visualMode = mode;
        for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.theme === mode));
        try { localStorage.setItem(key, mode); } catch (_) { /* Private/file contexts may disallow storage. */ }
    }
    let saved = 'icy';
    try { saved = localStorage.getItem(key) || 'icy'; } catch (_) {}
    apply(saved);
    for (const button of buttons) button.onclick = () => apply(button.dataset.theme);

    // Presentation-only observation: no document parsing or data mutations.
    const bannerToggle = document.getElementById('banner-compact');
    if (bannerToggle) {
        let compact = false;
        const inputs = ['fileInput1', 'fileInput2', 'fileInputMerged'].map(id => document.getElementById(id)).filter(Boolean);
        function refreshBanner() {
            const loaded = inputs.some(input => !!input.dataset.json);
            document.body.dataset.hasStandard = String(loaded);
            document.body.dataset.bannerCompact = String(compact);
            bannerToggle.hidden = !loaded;
            bannerToggle.textContent = compact ? 'Rozbalit banner' : 'Sbalit banner';
            bannerToggle.setAttribute('aria-expanded', String(!compact));
        }
        bannerToggle.onclick = () => { compact = !compact; refreshBanner(); };
        if (typeof MutationObserver !== 'undefined') {
            const observer = new MutationObserver(refreshBanner);
            for (const input of inputs) observer.observe(input, { attributes: true, attributeFilter: ['data-json'] });
        }
        refreshBanner();
    }

    // A small UI-only transmission. It never reads or writes standard documents.
    let taps = 0, lastTap = 0;
    const logo = document.getElementById('brand-signal');
    function transmission() {
        if (document.getElementById('secret-transmission')) return;
        const box = document.createElement('dialog'); box.id = 'secret-transmission'; box.className = 'hbh-automation-dialog secret-transmission';
        const serial = document.createElement('p'); serial.className = 'secret-serial'; serial.textContent = 'HBH / CONTROL ROOM / FREKVENCE 021'; box.append(serial);
        const title = document.createElement('h2'); title.id = 'secret-transmission-title'; title.textContent = 'SIGNÁL ZACHYCEN.'; box.append(title); box.setAttribute('aria-labelledby', title.id);
        const wave = document.createElement('div'); wave.className = 'secret-wave'; wave.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 21; i++) { const bar = document.createElement('span'); bar.style.setProperty('--bar', String((i * 7 + 3) % 11 + 2)); wave.append(bar); }
        box.append(wave);
        const text = document.createElement('p'); text.textContent = 'Vysíláme na stejné frekvenci. Projektujeme. Propojujeme. A občas necháme data trochu zazpívat.'; box.append(text);
        const footer = document.createElement('p'); footer.className = 'secret-serial'; footer.textContent = 'YOU FOUND THE CONTROL ROOM. / 001'; box.append(footer);
        const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Zpět do vysílání'; close.onclick = () => box.close(); box.append(close);
        box.onclose = () => { box.remove(); logo?.focus(); };
        document.body.append(box); box.showModal();
    }
    if (logo) logo.onclick = () => {
        const now = Date.now(); taps = now - lastTap < 1200 ? taps + 1 : 1; lastTap = now;
        if (taps >= 3) { taps = 0; transmission(); }
    };
})();
