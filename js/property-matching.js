(function (global) {
    'use strict';
    const rows = (doc, table) => doc.data[table] || [];
    const norm = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    function canonical(value) {
        if (Array.isArray(value)) return value.map(canonical);
        if (!value || typeof value !== 'object') return value;
        const redundantRaw = value.kind === 'restriction' && !(value.unsupportedFacets || []).length ||
            value.type && value.values && Object.values(value.values).every(item => item !== null);
        return Object.fromEntries(Object.keys(value).filter(key => key !== 'raw' || !redundantRaw).sort().map(key => [key, canonical(value[key])]));
    }
    function key(property) { return property.ids ? JSON.stringify(canonical(property.ids)) : property.guid; }
    const propertyName = property => String(property.nameIfc || property.nameCz || '').normalize('NFC').trim();
    const cache = new WeakMap();
    function context(doc) {
        if (cache.has(doc)) return cache.get(doc);
        const result = new Map(rows(doc, 'Properties').map(p => [p.guid, { groups: new Set(), objects: new Set(), type: '', dataType: '', unit: '' }]));
        const groups = new Map(rows(doc, 'GroupsOfProperties').map(g => [g.guid, g]));
        for (const g of groups.values()) for (const id of g.properties || []) if (result.has(id)) result.get(id).groups.add(g.name || '');
        for (const obj of rows(doc, 'DataObjects')) for (const groupId of obj.loin?.nongraphical?.groupsOfProperties || []) {
            for (const id of groups.get(groupId)?.properties || []) if (result.has(id)) result.get(id).objects.add(obj.nameCz || obj.name || obj.guid);
        }
        for (const p of rows(doc, 'Properties')) {
            const c = result.get(p.guid);
            c.type = rows(doc, 'IfcTypes').find(x => x.guid === p.ifcType)?.type || p.ids?.requirement?.attributes?.dataType || '';
            c.dataType = rows(doc, 'DataTypes').find(x => x.guid === p.dataType)?.type || '';
            c.unit = rows(doc, 'Units').find(x => x.guid === p.unit)?.unit || '';
        }
        cache.set(doc, result); return result;
    }
    function dataFamily(info) {
        const value = norm(info.dataType || info.type);
        if (/enum|string|label|text|identifier/.test(value)) return 'string';
        if (/double|singleprecision|real|float|decimal/.test(value)) return 'real';
        if (/integer|int$|count/.test(value)) return 'integer';
        if (/date|time/.test(value)) return 'date';
        if (/boolean|logical/.test(value)) return 'boolean';
        if (/reference/.test(value)) return 'reference';
        return '';
    }
    function typeAgreement(a, b) {
        // JSON IfcTypes can describe SingleValue/ReferenceValue, while IDS uses
        // IFC primitive types. Those vocabularies must not be compared directly.
        const left = dataFamily(a), right = dataFamily(b);
        return !left || !right ? 'unknown' : left === right ? 'compatible' : 'different';
    }
    function automatic(target, source) {
        const ids = new Set(rows(target, 'Properties').map(p => p.guid));
        return rows(source, 'Properties').filter(p => ids.has(p.guid)).map(p => ({ target: p.guid, source: p.guid, method: 'guid' }));
    }
    function validate(target, source, pairs) {
        const targetIds = new Set(rows(target, 'Properties').map(p => p.guid));
        const sourceIds = new Set(rows(source, 'Properties').map(p => p.guid));
        const autos = automatic(target, source), used = new Set(autos.map(p => p.source));
        for (const p of pairs) {
            if (!targetIds.has(p.target) || !sourceIds.has(p.source) || used.has(p.source)) throw new Error('Neplatná nebo opakovaná vazba vlastnosti. Každá vlastnost DSS2 může mít jen jeden protějšek.');
            const a = propertyName(rows(target, 'Properties').find(x => x.guid === p.target)), b = propertyName(rows(source, 'Properties').find(x => x.guid === p.source));
            if (!a || a !== b) throw new Error('Vlastnosti musí mít stejný název (nameIfc, případně nameCz). Podobný název nestačí.');
            used.add(p.source);
        }
        return new Map(autos.concat(pairs).map(p => [p.source, p.target]));
    }
    function save(target, source, pairs) {
        validate(target, source, pairs);
        return pairs.map(p => {
            const a = rows(target, 'Properties').find(x => x.guid === p.target), b = rows(source, 'Properties').find(x => x.guid === p.source);
            return { target: key(a), source: key(b), targetName: a.nameCz || a.nameIfc, sourceName: b.nameCz || b.nameIfc,
                targetGroups: [...context(target).get(a.guid).groups], sourceGroups: [...context(source).get(b.guid).groups], method: p.method || 'manual', basis: p.basis };
        });
    }
    function load(target, source, saved) {
        if (!Array.isArray(saved)) throw new Error('Mapa vlastností musí být seznam vazeb.');
        const resolve = (doc, value) => {
            const found = rows(doc, 'Properties').filter(p => key(p) === value || p.guid === value);
            if (found.length !== 1) throw new Error('Vlastnost v mapě chybí nebo není jednoznačná.');
            return found[0].guid;
        };
        const autos = automatic(target, source);
        const result = saved.map(p => ({ target: resolve(target, p.target), source: resolve(source, p.source), method: p.method === 'name' ? 'name' : 'manual', basis: p.basis }))
            .filter(p => !autos.some(a => a.source === p.source && a.target === p.target));
        validate(target, source, result); return result;
    }
    function recommend(targetDoc, sourceDoc, selected, candidates, selectedSide) {
        const aDoc = selectedSide === 'target' ? targetDoc : sourceDoc;
        const bDoc = selectedSide === 'target' ? sourceDoc : targetDoc;
        const a = context(aDoc).get(selected.guid);
        return candidates.map(candidate => {
            const best = { rank: propertyName(selected) && propertyName(selected) === propertyName(candidate) ? 90 : 0, reasons: ['Přesně stejný název'], warnings: [] };
            const b = context(bDoc).get(candidate.guid), reasons = [...best.reasons], warnings = [...best.warnings];
            let rank = best.rank;
            const sameGroup = [...a.groups].some(g => b.groups.has(g));
            if (rank && sameGroup) { rank += 15; reasons.push('Shodná sada vlastností'); }
            if (rank) {
                const agreement = typeAgreement(a, b);
                if (agreement === 'compatible') { rank += 5; reasons.push('Slučitelný datový typ'); }
                else if (agreement === 'different') { rank = Math.max(1, rank - 20); warnings.push('Odlišný datový typ: ' + (a.dataType || a.type) + ' / ' + (b.dataType || b.type)); }
            }
            return { object: candidate, rank, reasons, warnings };
        }).filter(x => x.rank > 0).sort((a, b) => b.rank - a.rank || (a.object.nameCz || '').localeCompare(b.object.nameCz || '', 'cs'));
    }
    function propose(target, source, pairs) {
        const used = new Set(automatic(target, source).concat(pairs).map(p => p.source));
        const result = [];
        for (const s of rows(source, 'Properties').filter(p => !used.has(p.guid))) {
            const b = context(source).get(s.guid);
            let candidates = rows(target, 'Properties').filter(t => {
                const a = context(target).get(t.guid);
                return propertyName(t) && propertyName(t) === propertyName(s);
            });
            const grouped = candidates.filter(t => [...context(target).get(t.guid).groups].some(group => b.groups.has(group)));
            if (grouped.length) candidates = grouped;
            // An exact name in the same group identifies the base definition;
            // keep its type, and retain the IDS type inside the scoped rule.
            // Type is a tie-breaker for duplicates or a weaker group-less match.
            if (candidates.length > 1 || !grouped.length) candidates = candidates.filter(t => typeAgreement(context(target).get(t.guid), b) !== 'different');
            if (candidates.length === 1) result.push({ target: candidates[0].guid, source: s.guid, method: 'name', basis: grouped.length ? 'name+group' : 'unique-name' });
        }
        return result;
    }
    function el(tag, text, parent) {
        const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (parent) parent.append(node); return node;
    }
    const uiCache = new WeakMap();
    function render(parent, target, source, pairs, update) {
        let ui = uiCache.get(target);
        if (!ui) { ui = { selected: { target: '', source: '' }, queries: { target: '', source: '' }, pages: { target: 0, source: 0 }, groups: { target: '', source: '' } }; uiCache.set(target, ui); }
        const section = el('section', undefined, parent); section.className = 'property-matching-panel'; section.id = 'property-matching-panel';
        el('h2', '2. Párování vlastností', section);
        el('p', 'Skupina → vlastnosti. Automat propojí přesně stejné názvy; skupina pomůže rozlišit stejnojmenné položky. Jednu základní definici lze použít pro více variant požadavků IDS. Struktura skupin DSS1 zůstává zachovaná.', section);
        const autos = automatic(target, source), all = autos.concat(pairs);
        const toolbar = el('div', undefined, section); toolbar.className = 'matching-toolbar';
        el('strong', `${all.length} vazeb vlastností · GUID ${autos.length} · automat názvů ${pairs.filter(p => p.method === 'name').length} · ručně ${pairs.filter(p => p.method !== 'name').length}`, toolbar);
        const proposeButton = el('button', 'Navrhnout jednoznačné shody', toolbar);
        const autoButton = el('button', 'Automaticky spárovat stejné názvy', toolbar); autoButton.id = 'property-auto-match';
        autoButton.onclick = () => { const next = pairs.concat(propose(target, source, pairs)); validate(target, source, next); ui.selected = { target: '', source: '' }; update(next); };
        const saveButton = el('button', 'Uložit matici vlastností', toolbar);
        saveButton.onclick = () => {
            const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 3, propertyPairs: save(target, source, pairs) }, null, 2)], { type: 'application/json' }));
            const a = el('a'); a.href = url; a.download = 'dss-matice-vlastnosti.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        const file = el('input', undefined, toolbar); file.type = 'file'; file.accept = '.json'; file.hidden = true;
        const loadButton = el('button', 'Načíst matici vlastností', toolbar); loadButton.onclick = () => file.click();
        file.onchange = async () => {
            if (!file.files.length) return;
            try {
                const value = JSON.parse(await file.files[0].text());
                if (value.version !== 3) throw new Error('Neplatná verze matice vlastností.');
                const next = load(target, source, value.propertyPairs); ui.selected = { target: '', source: '' }; update(next);
            } catch (e) { alert('Matici nelze načíst: ' + e.message); }
        };
        const preview = el('div', undefined, section);
        proposeButton.onclick = () => {
            preview.replaceChildren(); const proposed = propose(target, source, pairs);
            el('h3', `Návrhy vlastností (${proposed.length})`, preview);
            el('p', 'Přesně stejný název a jednoznačný protějšek; přednost má shoda skupiny. Datový typ a definice DSS1 zůstávají zachované, požadavek IDS se uloží zvlášť. Návrhy zatím nejsou potvrzené.', preview);
            for (const p of proposed.slice(0, 20)) {
                const a = rows(target, 'Properties').find(x => x.guid === p.target), b = rows(source, 'Properties').find(x => x.guid === p.source);
                el('p', `${a.nameCz} ↔ ${b.nameCz} · ${[...context(source).get(b.guid).groups].join(', ')}`, preview);
            }
            if (proposed.length > 20) el('p', `Zobrazeno prvních 20 z ${proposed.length} návrhů. Po potvrzení jsou všechny vazby v tabulce níže a v uložené matici.`, preview);
            const confirm = el('button', `Potvrdit ${proposed.length} návrhů vlastností`, preview); confirm.disabled = !proposed.length;
            confirm.onclick = () => { const next = pairs.concat(proposed); validate(target, source, next); ui.selected = { target: '', source: '' }; update(next); };
            const cancel = el('button', 'Zavřít návrhy', preview); cancel.onclick = () => preview.replaceChildren();
        };
        const grid = el('div', undefined, section); grid.className = 'matching-columns';
        const left = el('div', undefined, grid), middle = el('div', undefined, grid), right = el('div', undefined, grid);
        left.className = right.className = 'matching-column'; middle.className = 'matching-action';
        const summary = el('p', '', middle), pairButton = el('button', 'Párovat vlastnosti ↔', middle); pairButton.id = 'property-matching-pair';
        const redraw = {};
        function updateButton() {
            const a = rows(target, 'Properties').find(p => p.guid === ui.selected.target), b = rows(source, 'Properties').find(p => p.guid === ui.selected.source);
            pairButton.disabled = !a || !b || !propertyName(a) || propertyName(a) !== propertyName(b); summary.textContent = a && b ? propertyName(a) && propertyName(a) === propertyName(b) ? `${a.nameCz} ↔ ${b.nameCz}` : 'Názvy se liší nebo chybí. Vlastnosti se párují jen při přesné shodě názvu.' : 'Vyberte vlastnost v obou sloupcích.';
        }
        function column(box, side, doc) {
            el('h3', side === 'target' ? 'Vlastnosti DSS1' : 'Vlastnosti DSS2', box);
            const groupLabel = el('label', 'Skupina vlastností', box), groupSelect = el('select', undefined, box); groupSelect.id = 'property-group-' + side; groupLabel.htmlFor = groupSelect.id;
            el('option', 'Všechny skupiny', groupSelect).value = '';
            const names = [...new Set([...context(doc).values()].flatMap(c => [...c.groups]))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'cs'));
            for (const name of names) el('option', name, groupSelect).value = name;
            groupSelect.value = ui.groups[side];
            const suggestions = el('div', undefined, box); suggestions.className = 'matching-recommendations';
            const label = el('label', 'Hledat název, HBHBIM příkaz, sadu nebo použití', box);
            const search = el('input', undefined, box); search.type = 'search'; search.id = 'property-search-' + side; label.htmlFor = search.id; search.value = ui.queries[side];
            const count = el('small', '', box), list = el('div', undefined, box); list.className = 'matching-object-list';
            const pagination = el('div', undefined, box); pagination.className = 'matching-pagination';
            function draw() {
                list.replaceChildren(); suggestions.replaceChildren(); pagination.replaceChildren();
                // A source rule is consumed once; a base definition can serve
                // several rules whose scope remains on individual data objects.
                const used = new Set(side === 'source' ? all.map(p => p.source) : []);
                const available = rows(doc, 'Properties').filter(p => !used.has(p.guid));
                const other = side === 'target' ? 'source' : 'target', otherDoc = side === 'target' ? source : target;
                const selected = rows(otherDoc, 'Properties').find(p => p.guid === ui.selected[other]);
                const ranked = selected ? recommend(target, source, selected, available, other) : [];
                const ranks = new Map(ranked.map(x => [x.object.guid, x]));
                const query = norm(ui.queries[side]);
                const found = available.filter(p => {
                    const c = context(doc).get(p.guid);
                    return (!ui.groups[side] || c.groups.has(ui.groups[side])) && norm([p.nameCz, p.nameIfc, ...global.DSS_MODEL.hbhCommands(p), ...c.groups, ...c.objects, p.guid, p.description].join(' ')).includes(query);
                }).sort((a, b) => (ranks.get(b.guid)?.rank || 0) - (ranks.get(a.guid)?.rank || 0));
                function card(p, into, recommended) {
                    const c = context(doc).get(p.guid), node = el('button', undefined, into); node.type = 'button'; node.className = 'matching-object'; node.dataset.propertyGuid = p.guid;
                    node.setAttribute('aria-pressed', String(ui.selected[side] === p.guid));
                    if (ui.selected[side] === p.guid) node.classList.add('is-selected'); if (recommended) node.classList.add('is-recommended');
                    el('strong', p.nameCz || p.nameIfc || '(bez názvu)', node);
                    if (side === 'target') {
                        const count = all.filter(pair => pair.target === p.guid).length;
                        if (count) el('span', `Navázané varianty požadavků: ${count}`, node).className = 'matching-suggestion';
                    }
                    if (p.nameIfc && p.nameIfc !== p.nameCz) el('span', 'IFC název: ' + p.nameIfc, node);
                    for (const command of global.DSS_MODEL.hbhCommands(p)) el('code', 'HBHBIM: ' + command, node).className = 'hbh-command';
                    el('span', [...c.groups].join(', ') + ' · ' + [c.dataType, c.type].filter(Boolean).join(' / ') + (c.unit ? ' · ' + c.unit : ''), node);
                    el('span', `Použití: ${[...c.objects].slice(0, 3).join(', ')}${c.objects.size > 3 ? ' a dalších ' + (c.objects.size - 3) : ''}`, node);
                    const req = p.ids?.requirement;
                    if (req) {
                        el('span', 'IDS: ' + ({ required: 'povinné', optional: 'volitelné', prohibited: 'zakázané' }[req.attributes.cardinality || 'required'] || req.attributes.cardinality), node);
                        if (req.attributes.instructions) el('span', req.attributes.instructions, node);
                        const value = req.values.value;
                        if (value?.kind === 'simpleValue') el('span', 'Požadovaná hodnota: ' + value.value, node);
                        if (value?.enumerations?.length) el('span', 'Povolené hodnoty: ' + value.enumerations.slice(0, 6).join(', ') + (value.enumerations.length > 6 ? ' …' : ''), node);
                        if (value?.patterns?.length) el('span', 'Požadovaný vzor: ' + value.patterns.join(', '), node);
                        for (const bound of [...(value?.bounds || []), ...(value?.lengths || [])]) el('span', `${({ minInclusive: 'Minimum včetně', maxInclusive: 'Maximum včetně', minExclusive: 'Více než', maxExclusive: 'Méně než', length: 'Délka', minLength: 'Nejmenší délka', maxLength: 'Největší délka' }[bound.name] || bound.name)}: ${bound.value}`, node);
                    } else if (p.description) el('span', p.description, node);
                    const evidence = ranks.get(p.guid);
                    if (evidence) { el('span', evidence.reasons.join(' · '), node).className = 'matching-suggestion'; for (const text of evidence.warnings) el('span', text, node).className = 'matching-suggestion-warning'; }
                    node.onclick = () => { ui.selected[side] = ui.selected[side] === p.guid ? '' : p.guid; draw(); ui.pages[other] = 0; redraw[other](); updateButton(); };
                }
                if (selected) {
                    el('h4', 'Doporučené vlastnosti', suggestions);
                    for (const r of ranked.slice(0, 4)) card(r.object, suggestions, true);
                    if (!ranked.length) el('p', 'Není jednoznačný návrh; použijte hledání.', suggestions);
                } else el('p', 'Vyberte vlastnost v protějším sloupci pro návrhy podle názvu, sady a datového typu.', suggestions);
                count.textContent = `${found.length} vlastností ve výběru`;
                ui.pages[side] = Math.min(ui.pages[side], Math.max(0, Math.ceil(found.length / 40) - 1));
                const buckets = new Map();
                for (const p of found.slice(ui.pages[side] * 40, (ui.pages[side] + 1) * 40)) {
                    const groups = ui.groups[side] ? [ui.groups[side]] : [...context(doc).get(p.guid).groups];
                    for (const group of groups.length ? groups : ['Bez skupiny']) { if (!buckets.has(group)) buckets.set(group, []); buckets.get(group).push(p); }
                }
                for (const [name, properties] of buckets) {
                    const group = el('div', undefined, list); group.className = 'property-group'; group.dataset.groupName = name;
                    el('h4', name + ' → vlastnosti', group).className = 'property-group-heading';
                    for (const p of properties) card(p, group, false);
                }
                if (found.length > 40) {
                    const prev = el('button', '← Předchozí', pagination); prev.disabled = ui.pages[side] === 0; prev.onclick = () => { ui.pages[side]--; draw(); };
                    el('span', `${ui.pages[side] + 1} / ${Math.ceil(found.length / 40)}`, pagination);
                    const next = el('button', 'Další →', pagination); next.disabled = (ui.pages[side] + 1) * 40 >= found.length; next.onclick = () => { ui.pages[side]++; draw(); };
                }
            }
            search.oninput = () => { ui.queries[side] = search.value; ui.pages[side] = 0; draw(); }; redraw[side] = draw; draw();
            groupSelect.onchange = () => { ui.groups[side] = groupSelect.value; ui.pages[side] = 0; draw(); };
        }
        column(left, 'target', target); column(right, 'source', source); updateButton();
        pairButton.onclick = () => {
            if (pairButton.disabled) return;
            try { const next = pairs.concat({ ...ui.selected }); validate(target, source, next); ui.selected = { target: '', source: '' }; update(next); }
            catch (e) { alert(e.message); }
        };
        const paired = el('div', undefined, section); paired.className = 'matching-pairs';
        el('h3', `Spárované vlastnosti (${all.length})`, paired);
        if (!all.length) el('p', 'Zatím žádná potvrzená vazba vlastností.', paired);
        else {
            const table = el('table', undefined, paired), head = el('tr', undefined, el('thead', undefined, table));
            for (const text of ['DSS1', 'DSS2 / sada', 'Způsob']) el('th', text, head);
            for (const p of all) {
                const tr = el('tr', undefined, table), a = rows(target, 'Properties').find(x => x.guid === p.target), b = rows(source, 'Properties').find(x => x.guid === p.source);
                const targetCell = el('td', undefined, tr), sourceCell = el('td', undefined, tr);
                el('strong', a.nameCz || a.nameIfc, targetCell); el('small', [...context(target).get(a.guid).groups].join(', '), targetCell);
                for (const command of global.DSS_MODEL.hbhCommands(a)) el('code', 'HBHBIM: ' + command, targetCell).className = 'hbh-command';
                el('strong', b.nameCz || b.nameIfc, sourceCell); el('small', [...context(source).get(b.guid).groups].join(', '), sourceCell);
                for (const command of global.DSS_MODEL.hbhCommands(b)) el('code', 'HBHBIM: ' + command, sourceCell).className = 'hbh-command';
                if (typeAgreement(context(target).get(a.guid), context(source).get(b.guid)) === 'different') el('small', 'Datový typ DSS1: ' + context(target).get(a.guid).dataType + ' · IDS: ' + context(source).get(b.guid).dataType + ' (definice DSS1 zachována)', sourceCell);
                if (b.ids?.requirement?.attributes?.instructions) el('small', b.ids.requirement.attributes.instructions, sourceCell);
                const cell = el('td', undefined, tr);
                if (p.method === 'guid') el('span', 'Shoda GUID', cell);
                else { if (p.method === 'name') el('small', p.basis === 'name+group' ? 'Automat: název + skupina' : 'Automat: jednoznačný název', cell); const remove = el('button', 'Zrušit vazbu vlastnosti', cell); remove.onclick = () => update(pairs.filter(x => x !== p)); }
            }
        }
    }
    global.DSS_PROPERTY_MATCHING = { key, context, automatic, validate, save, load, recommend, propose, render, reset: doc => uiCache.delete(doc) };
})(window);
