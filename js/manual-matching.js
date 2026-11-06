(function (global) {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    const norm = value => String(value || '').trim().toLocaleLowerCase('cs').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const rows = (doc, table) => doc.data[table] || [];
    const links = obj => obj.loin && obj.loin.nongraphical ? obj.loin.nongraphical.groupsOfProperties || [] : [];
    function aspectCodes(obj) {
        if (typeof obj.typeAspectCode === 'string' && obj.typeAspectCode.trim()) return [obj.typeAspectCode.trim()];
        const facets = [...(obj.ids && obj.ids.requirements || []), ...(obj.ids && obj.ids.applicability || [])]
            .filter(facet => facet.type === 'classification');
        const typed = facets.filter(facet => /typov.*aspekt/.test(norm(facet.values && facet.values.system)) ||
            /typov.*aspekt/.test(norm(facet.attributes && facet.attributes.uri)));
        const codes = [];
        for (const facet of typed.length ? typed : facets) {
            const value = facet.values && facet.values.value;
            const values = typeof value === 'string' ? [value] : value && value.kind === 'simpleValue' ? [value.value] : value && value.enumerations || [];
            for (const text of values) codes.push(...(String(text).match(/%[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g) || []));
        }
        return [...new Set(codes)];
    }
    const label = row => [row.nameCz || row.name, ...aspectCodes(row), row.groupOfDataObjectsCz, row.ids && row.ids.identifier].filter(Boolean).join(' — ');
    function properties(doc, obj) {
        const groups = new Set(links(obj));
        const ids = new Set(rows(doc, 'GroupsOfProperties').filter(g => groups.has(g.guid)).flatMap(g => g.properties || []));
        return rows(doc, 'Properties').filter(p => ids.has(p.guid));
    }
    function uniqueSuggestion(target, candidates) {
        const found = candidates.filter(x => norm(x.nameCz) === norm(target.nameCz) ||
            (target.nameIfc && x.nameIfc && norm(x.nameIfc) === norm(target.nameIfc)));
        return found.length === 1 ? found[0].guid : '';
    }
    const profileCache = new WeakMap();
    function objectProfile(obj) {
        if (profileCache.has(obj)) return profileCache.get(obj);
        const name = norm(obj.nameCz || obj.name).replace(/[^a-z0-9]+/g, ' ').trim();
        const mainName = name.replace(/\s+(?:a|vcetne)\s+prislusenstvi$/, '');
        const tokens = mainName.split(/\s+/).filter(Boolean);
        // A conservative heuristic for Czech word endings, not a language model.
        const stems = tokens.map(word => {
            for (const ending of ['ove', 'ova', 'ovy', 'ami', 'emi', 'ech', 'ich', 'um', 'ou', 'a', 'o', 'y', 'i', 'u', 'e']) {
                if (word.endsWith(ending) && word.length - ending.length >= 4) return word.slice(0, -ending.length);
            }
            return word;
        });
        const grams = new Set();
        for (let i = 0; i < mainName.length - 2; i++) grams.add(mainName.slice(i, i + 3));
        const codes = aspectCodes(obj).map(code => {
            const match = code.toUpperCase().match(/%([A-Z]{3}[A-Z0-9._-]*)/) || code.toUpperCase().match(/^([A-Z]{3}[A-Z0-9._-]*)$/);
            return match && match[1];
        }).filter(Boolean);
        const profile = { name, accessorySuffix: mainName !== name, tokens, stems, grams, codes, components: [...new Set(codes.map(code => code.slice(0, 3)))] };
        profileCache.set(obj, profile); return profile;
    }
    function suggestionFor(selected, candidate) {
        const a = objectProfile(selected), b = objectProfile(candidate);
        const exactName = !!a.name && a.name === b.name;
        const sameForm = a.stems.length > 0 && [...a.stems].sort().join(' ') === [...b.stems].sort().join(' ');
        const overlap = (left, right) => [...left].filter(value => right.has(value)).length;
        const tokenA = new Set(a.stems), tokenB = new Set(b.stems);
        const tokenScore = tokenA.size + tokenB.size ? 2 * overlap(tokenA, tokenB) / (tokenA.size + tokenB.size) : 0;
        const gramScore = a.grams.size + b.grams.size ? 2 * overlap(a.grams, b.grams) / (a.grams.size + b.grams.size) : 0;
        let similarity = exactName ? 1 : sameForm ? .94 : Math.max(tokenScore * .9, gramScore * .85);
        const opposite = a.tokens.some(word => word.startsWith('ne') && b.tokens.includes(word.slice(2))) || b.tokens.some(word => word.startsWith('ne') && a.tokens.includes(word.slice(2)));
        if (opposite) similarity = Math.min(similarity, .25);
        const sameCodes = a.codes.filter(code => b.codes.includes(code));
        const components = a.components.filter(code => b.components.includes(code));
        const reasons = [], warnings = [];
        let rank = 0;
        if (sameCodes.length) { rank = 110; reasons.push('Shodný CCI kód: %' + sameCodes.join(', %')); }
        if (exactName) { rank = Math.max(rank, 90); reasons.push(exactText(selected.nameCz || selected.name) === exactText(candidate.nameCz || candidate.name) ? 'Shodný název' : 'Shodný název po sjednocení zápisu'); }
        else if (!opposite && sameForm) { rank = Math.max(rank, 85); reasons.push('Podobný tvar názvu (jednotné / množné číslo)'); }
        else if (similarity >= .55) { rank = Math.max(rank, 40 + Math.round(similarity * 20)); reasons.push('Podobný název / společná slova'); }
        if (similarity >= .55 && (a.accessorySuffix || b.accessorySuffix)) reasons.push('Porovnáno bez dodatku „a příslušenství“');
        if (components.length) {
            rank = Math.max(rank, 60) + (similarity >= .55 ? 20 : 0);
            if (!sameCodes.length) reasons.push('Stejná CCI komponenta: ' + components.join(', ') + ' (první 3 písmena)');
        }
        if (a.components.length && b.components.length && !components.length) warnings.push('Odlišná CCI komponenta: ' + a.components.join(', ') + ' / ' + b.components.join(', '));
        if (opposite) warnings.push('Pozor na opačný význam názvu (ne…).');
        if (warnings.length) rank = Math.max(0, rank - 35);
        return { object: candidate, rank, reasons, warnings };
    }
    function recommend(selected, candidates) {
        return candidates.map(obj => suggestionFor(selected, obj)).filter(item => item.rank > 0 && item.reasons.length)
            .sort((a, b) => b.rank - a.rank || label(a.object).localeCompare(label(b.object), 'cs'));
    }
    function stableObject(obj) { return obj.ids ? obj.ids.identifier || JSON.stringify([obj.ids.name, obj.ids.ifcVersion]) : obj.guid; }
    let state = null;
    function readInputs() {
        return [1, 2].map(n => {
            const input = document.getElementById('fileInput' + n);
            return global.DSS_DOCUMENTS ? global.DSS_DOCUMENTS.read(input) : JSON.parse(input.dataset.json);
        });
    }
    function signature(doc) { return JSON.stringify(doc); }
    function guidPairs(target, source) {
        const targets = new Map(), sources = new Map();
        for (const [doc, index] of [[target, targets], [source, sources]]) for (const obj of rows(doc, 'DataObjects')) {
            if (typeof obj.guid !== 'string' || !obj.guid.trim()) continue;
            if (!index.has(obj.guid)) index.set(obj.guid, []);
            index.get(obj.guid).push(obj);
        }
        const pairs = [];
        for (const [guid, incoming] of sources) if (targets.has(guid)) {
            if (incoming.length !== 1 || targets.get(guid).length !== 1) throw new Error('Shoda GUID není jednoznačná: ' + guid);
            pairs.push({ target: guid, source: guid, properties: [], method: 'guid' });
        }
        return pairs;
    }
    const exactText = value => String(value || '').normalize('NFC').trim();
    function propose(target, source, pairs = []) {
        const occupied = guidPairs(target, source).concat(pairs);
        const usedTarget = new Set(occupied.map(pair => pair.target)), usedSource = new Set(occupied.map(pair => pair.source));
        const targets = new Map(), reverse = new Map(), candidates = new Map();
        const codes = object => aspectCodes(object).map(exactText).sort().join('|');
        for (const object of rows(target, 'DataObjects')) {
            const name = exactText(object.nameCz || object.name); if (!name) continue;
            if (!targets.has(name)) targets.set(name, []); targets.get(name).push(object);
        }
        // Count candidates across the full inputs, including occupied objects.
        // Consuming one duplicate must never turn another uncertain pair into an automatic match.
        for (const object of rows(source, 'DataObjects')) {
            const name = exactText(object.nameCz || object.name); if (!name) continue;
            const found = (targets.get(name) || []).filter(candidate => {
                const a = exactText(candidate.groupOfDataObjectsCz), b = exactText(object.groupOfDataObjectsCz);
                if (a && b && a !== b) return false;
                const ac = codes(candidate), bc = codes(object);
                return !ac || !bc || ac === bc;
            });
            candidates.set(object.guid, found);
            for (const candidate of found) reverse.set(candidate.guid, (reverse.get(candidate.guid) || 0) + 1);
        }
        const proposed = [];
        for (const [sourceId, found] of candidates) if (found.length === 1 && reverse.get(found[0].guid) === 1 && !usedSource.has(sourceId) && !usedTarget.has(found[0].guid))
            proposed.push({ target: found[0].guid, source: sourceId, properties: [], method: 'name' });
        validate(target, source, occupied.concat(proposed));
        return proposed;
    }
    function mergeReport(target, source, manual, onlyMatched) {
        const automatic = guidPairs(target, source);
        validate(target, source, automatic.concat(manual));
        const dss1Objects = rows(target, 'DataObjects').length, dss2Objects = rows(source, 'DataObjects').length;
        const matchedByGuid = automatic.length, matchedByName = manual.filter(pair => pair.method === 'name').length, matchedManually = manual.length - matchedByName;
        const unmatchedDss1 = dss1Objects - matchedByGuid - manual.length;
        const unmatchedDss2 = dss2Objects - matchedByGuid - manual.length;
        const allObjectsMatchedByGuid = dss1Objects > 0 && dss2Objects > 0 && matchedByGuid === dss1Objects && matchedByGuid === dss2Objects && !matchedManually;
        const message = allObjectsMatchedByGuid
            ? 'Všechno se povedlo napárovat na základě shody GUID. (Všechny datové objekty DSS1 i DSS2.)'
            : `Datové objekty — shoda GUID: ${matchedByGuid}, úplná shoda názvu: ${matchedByName}, ručně: ${matchedManually}. Bez protějšku: DSS1 ${unmatchedDss1}, DSS2 ${unmatchedDss2}. Z DSS2 se ${onlyMatched ? 'vynechá' : 'přidá'} ${unmatchedDss2} nespárovaných objektů.`;
        const inputGuidMatchesByTable = {};
        for (const [table, incoming] of Object.entries(source.data)) {
            const ids = new Set(rows(target, table).map(x => x.guid).filter(Boolean));
            inputGuidMatchesByTable[table] = new Set(incoming.filter(x => x.guid && ids.has(x.guid)).map(x => x.guid)).size;
        }
        return { dss1Objects, dss2Objects, matchedByGuid, matchedByName, matchedManually, unmatchedDss1, unmatchedDss2,
            addedFromDss2: onlyMatched ? 0 : unmatchedDss2, excludedFromDss2: onlyMatched ? unmatchedDss2 : 0,
            allObjectsMatchedByGuid, inputGuidMatchesByTable, message };
    }
    function validate(target, source, pairs) {
        const used = new Set(), usedTarget = new Set();
        for (const pair of pairs) {
            const t = rows(target, 'DataObjects').find(x => x.guid === pair.target);
            const s = rows(source, 'DataObjects').find(x => x.guid === pair.source);
            if (!t || !s || used.has(s.guid) || usedTarget.has(t.guid)) throw new Error('Neplatná nebo opakovaná vazba objektu. Obnovte párování.');
            used.add(s.guid); usedTarget.add(t.guid);
            const tp = new Set(properties(target, t).map(x => x.guid));
            const sp = new Set(properties(source, s).map(x => x.guid));
            const seenT = new Set(), seenS = new Set();
            for (const p of pair.properties) {
                if (!tp.has(p.target) || !sp.has(p.source) || seenT.has(p.target) || seenS.has(p.source)) throw new Error('Neplatná nebo opakovaná vazba vlastnosti.');
                seenT.add(p.target); seenS.add(p.source);
            }
        }
    }
    function addMetadata(target, source) {
        const entry = source.ids || { guid: source.guid, name: source.nameCz };
        target.idsMappings = target.idsMappings || [];
        if (!target.idsMappings.some(x => JSON.stringify(x) === JSON.stringify(entry))) target.idsMappings.push(clone(entry));
    }
    function pruneSource(doc, roots) {
        const byId = new Map();
        for (const table of Object.values(doc.data)) for (const row of table) {
            if (!byId.has(row.guid)) byId.set(row.guid, []);
            byId.get(row.guid).push(row);
        }
        const kept = new Set(rows(doc, 'DataObjects')), queue = [...roots, ...kept];
        function visit(value) {
            if (typeof value === 'string') {
                for (const row of byId.get(value) || []) if (!kept.has(row)) { kept.add(row); queue.push(row); }
            } else if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) if (key !== 'guid') visit(child);
        }
        while (queue.length) visit(queue.pop());
        return { ...doc, data: Object.fromEntries(Object.entries(doc.data).map(([table, data]) => [table, data.filter(row => kept.has(row))])) };
    }
    function compactIds(value) {
        if (Array.isArray(value)) return value.map(compactIds);
        if (!value || typeof value !== 'object') return value;
        // Keep original XML for values the parser could not interpret.
        const redundantRaw = value.kind === 'restriction' && !(value.unsupportedFacets || []).length ||
            value.type && value.values && Object.values(value.values).every(item => item !== null);
        return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'raw' || !redundantRaw).map(([key, item]) => [key, compactIds(item)]));
    }
    function compactSource(doc) {
        for (const table of Object.values(doc.data)) for (const row of table) {
            if (row.ids) row.ids = compactIds(row.ids);
        }
        for (const obj of rows(doc, 'DataObjects')) if (obj.ids) {
            // Property rules already live on the referenced Properties rows.
            obj.ids.propertyRequirements = properties(doc, obj).map(p => p.guid);
            obj.ids.requirements = (obj.ids.requirements || []).filter(f => f.type !== 'property');
        }
    }
    function applyPairs(targetDoc, sourceDoc, pairs, options = {}) {
        const automatic = guidPairs(targetDoc, sourceDoc);
        validate(targetDoc, sourceDoc, automatic.concat(pairs));
        const globalProperties = global.DSS_PROPERTY_MATCHING.validate(targetDoc, sourceDoc, options.propertyPairs || []);
        if (options.onlyMatched && !pairs.length && !automatic.length) throw new Error('Nejdřív spárujte alespoň jeden objekt, nebo vypněte volbu Pouze spárované objekty z IDS.');
        let selected = sourceDoc;
        if (options.onlyMatched) {
            const ids = new Set(automatic.concat(pairs).map(p => p.source));
            selected = { ...sourceDoc, data: { ...sourceDoc.data, DataObjects: rows(sourceDoc, 'DataObjects').filter(x => ids.has(x.guid)) } };
            selected = pruneSource(selected, []);
        }
        const target = clone(targetDoc), source = clone(selected);
        const scopedGroups = new Set();
        if (options.compact) compactSource(source);
        // Record each requirement on its source object's scope before remapping
        // shared property definitions. Constraints must never leak to all users
        // of a shared target property.
        function setPropertyRules(obj, map) {
            if (obj.propertyDefaults) {
                const remapped = {};
                global.DSS_MODEL.mergePropertyDefaults(remapped, obj, map);
                obj.propertyDefaults = remapped.propertyDefaults;
            }
            if (!obj.ids) return;
            const list = properties(source, obj);
            obj.ids.propertyRequirements = list.map(p => map.get(p.guid) || p.guid);
            obj.ids.propertyRules = list.filter(p => p.ids && p.ids.requirement).map(p => ({
                property: map.get(p.guid) || p.guid, propertySet: p.ids.propertySet,
                requirement: compactIds(p.ids.requirement)
            }));
        }
        for (const obj of rows(source, 'DataObjects')) setPropertyRules(obj, globalProperties);
        for (const [sourceId, targetId] of globalProperties) {
            const p = rows(source, 'Properties').find(x => x.guid === sourceId);
            if (p) addMetadata(rows(target, 'Properties').find(x => x.guid === targetId), p);
        }
        for (const pair of pairs) {
            const t = rows(target, 'DataObjects').find(x => x.guid === pair.target);
            const s = rows(source, 'DataObjects').find(x => x.guid === pair.source);
            const propMap = new Map([...globalProperties, ...pair.properties.map(p => [p.source, p.target])]);
            setPropertyRules(s, propMap);
            global.DSS_MODEL.mergePropertyDefaults(t, s);
            addMetadata(t, s);
            for (const p of pair.properties) addMetadata(rows(target, 'Properties').find(x => x.guid === p.target), rows(source, 'Properties').find(x => x.guid === p.source));
            t.loin = t.loin || {};
            t.loin.nongraphical = t.loin.nongraphical || {};
            t.loin.nongraphical.groupsOfProperties = links(t).slice();
            const linkedProperties = new Set(properties(target, t).map(p => p.guid));
            // Keep the base hierarchy. Already-linked mapped properties need
            // only their scoped IDS rules, not a duplicate imported group.
            const groups = rows(source, 'GroupsOfProperties').filter(g => links(s).includes(g.guid));
            for (const group of groups) {
                const extra = [...new Set((group.properties || []).map(id => propMap.get(id) || id))].filter(id => !linkedProperties.has(id));
                if (!extra.length) continue;
                const existing = links(t).map(id => rows(target, 'GroupsOfProperties').find(g => g.guid === id) || rows(source, 'GroupsOfProperties').find(g => g.guid === id))
                    .filter(g => g && g.name === group.name);
                // Clone a shared base group only for this object when adding
                // fields; other objects using that group must remain unchanged.
                const copy = clone(existing.length === 1 ? existing[0] : group);
                copy.guid = global.crypto.randomUUID();
                copy.properties = existing.length === 1 ? [...new Set([...(existing[0].properties || []), ...extra])] : extra;
                source.data.GroupsOfProperties.push(copy);
                scopedGroups.add(copy.guid);
                if (existing.length === 1) t.loin.nongraphical.groupsOfProperties = links(t).filter(id => id !== existing[0].guid);
                t.loin.nongraphical.groupsOfProperties.push(copy.guid);
                extra.forEach(id => linkedProperties.add(id));
            }
            const enums = new Set(t.loin.nongraphical.customEnums || []);
            for (const id of s.loin && s.loin.nongraphical && s.loin.nongraphical.customEnums || []) enums.add(id);
            t.loin.nongraphical.customEnums = [...enums];
            source.data.DataObjects = source.data.DataObjects.filter(x => x.guid !== s.guid);
        }
        // Remaining objects (including GUID matches) also use the property map.
        for (const group of rows(source, 'GroupsOfProperties')) if (!scopedGroups.has(group.guid)) group.properties = [...new Set((group.properties || []).map(id => globalProperties.get(id) || id))];
        source.data.Properties = rows(source, 'Properties').filter(p => !globalProperties.has(p.guid));
        // Keep groups now referenced from the target as well as the source.
        const groupIds = new Set([...rows(target, 'DataObjects'), ...rows(source, 'DataObjects')].flatMap(links));
        source.data.GroupsOfProperties = rows(source, 'GroupsOfProperties').filter(g => groupIds.has(g.guid));
        const propertyIds = new Set(rows(source, 'GroupsOfProperties').flatMap(g => g.properties || []));
        source.data.Properties = rows(source, 'Properties').filter(p => propertyIds.has(p.guid));
        // The first file defines the resulting standard's top-level metadata.
        for (const key of Object.keys(source)) if (key !== 'data') delete source[key];
        const propertyReport = {
            matchedByGuid: global.DSS_PROPERTY_MATCHING.automatic(targetDoc, selected).length,
            matchedByName: (options.propertyPairs || []).filter(p => p.method === 'name' && rows(selected, 'Properties').some(x => x.guid === p.source)).length,
            matchedManually: (options.propertyPairs || []).filter(p => p.method !== 'name' && rows(selected, 'Properties').some(x => x.guid === p.source)).length,
            configuredManual: (options.propertyPairs || []).length
        };
        return { target, source: options.onlyMatched ? pruneSource(source, rows(target, 'DataObjects')) : source, propertyReport };
    }
    function element(tag, text, parent) {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (parent) parent.append(node);
        return node;
    }
    function showAspectCodes(obj, parent) {
        const codes = aspectCodes(obj);
        if (codes.length) {
            const badge = element('span', codes.join(' · '), parent);
            badge.className = 'matching-aspect-code';
            badge.title = obj.typeAspectCode && obj.typeAspectCode.trim() ? 'typeAspectCode' : 'Kód klasifikace IDS';
        }
    }
    function render() {
        const root = document.getElementById('matching-content');
        root.hidden = false; root.replaceChildren();
        const objects = rows(state.target, 'DataObjects');
        const sources = rows(state.source, 'DataObjects');
        const allPairs = state.automatic.concat(state.pairs);
        const toolbar = element('div', undefined, root); toolbar.className = 'matching-toolbar';
        const nameCount = state.pairs.filter(pair => pair.method === 'name').length;
        const counter = element('strong', `${allPairs.length} dvojic · GUID ${state.automatic.length} · úplná shoda názvu ${nameCount} · ručně ${state.pairs.length - nameCount}`, toolbar);
        counter.setAttribute('aria-live', 'polite');
        const save = element('button', 'Uložit mapu', toolbar);
        save.onclick = () => {
            const saved = state.pairs.map(p => ({
                target: stableObject(objects.find(x => x.guid === p.target)),
                source: stableObject(sources.find(x => x.guid === p.source)), properties: [], ...(p.method === 'name' ? { method: 'name' } : {})
            }));
            const propertyPairs = global.DSS_PROPERTY_MATCHING.save(state.target, state.source, state.propertyPairs);
            const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 3, pairs: saved, propertyPairs }, null, 2)], { type: 'application/json' }));
            const a = element('a'); a.href = url; a.download = 'dss-parovani.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        const load = element('input'); load.type = 'file'; load.accept = '.json'; load.hidden = true;
        const loadButton = element('button', 'Načíst mapu', toolbar); loadButton.onclick = () => load.click(); toolbar.append(load);
        load.onchange = async () => {
            if (!load.files.length) return;
            try {
                const saved = JSON.parse(await load.files[0].text());
                if (![1, 2, 3].includes(saved.version) || !Array.isArray(saved.pairs)) throw new Error('Neplatný formát mapy.');
                const pairs = saved.pairs.map(p => {
                    if (p.properties && (!Array.isArray(p.properties) || p.properties.length)) throw new Error('Tato mapa obsahuje párování vlastností. Nyní lze načítat pouze vazby objektů.');
                    const ts = objects.filter(x => stableObject(x) === p.target || x.guid === p.target), ss = sources.filter(x => stableObject(x) === p.source || x.guid === p.source);
                    if (ts.length !== 1 || ss.length !== 1) throw new Error('Objekt mapy chybí nebo není jednoznačný.');
                    return { target: ts[0].guid, source: ss[0].guid, properties: [], ...(p.method === 'name' ? { method: 'name' } : {}) };
                });
                const manual = pairs.filter(p => !state.automatic.some(a => a.target === p.target && a.source === p.source));
                validate(state.target, state.source, state.automatic.concat(manual));
                const propertyPairs = saved.propertyPairs === undefined ? state.propertyPairs : global.DSS_PROPERTY_MATCHING.load(state.target, state.source, saved.propertyPairs);
                if (saved.propertyPairs !== undefined) global.DSS_PROPERTY_MATCHING.reset(state.target);
                state.pairs = manual; state.propertyPairs = propertyPairs; state.selected = { target: '', source: '' }; render();
            } catch (e) { alert('Mapu nelze načíst: ' + e.message); }
        };
        const proposals = element('div', undefined, root);
        const proposeButton = element('button', 'Navrhnout jednoznačné shody objektů', toolbar); proposeButton.id = 'object-propose-match';
        const autoButton = element('button', 'Automaticky spárovat stejné názvy objektů', toolbar); autoButton.id = 'object-auto-match';
        function accept(proposed) {
            const next = state.pairs.concat(proposed); validate(state.target, state.source, state.automatic.concat(next));
            state.pairs = next; state.selected = { target: '', source: '' };
            const accepted = new Set(proposed.map(pair => pair.source));
            state.proposalSelected = (state.proposalSelected || []).filter(id => !accepted.has(id));
            state.message = proposed.length ? `Podle úplné shody názvu spárováno ${proposed.length} objektů. Ostatní vazby zůstávají beze změny.` : 'Žádné další jednoznačné úplné shody. Nejasné nebo částečné shody potvrďte ručně v obou sloupcích.';
            render();
        }
        autoButton.onclick = () => { try { accept(propose(state.target, state.source, state.pairs)); } catch (error) { alert(error.message); } };
        function drawProposals() {
            proposals.replaceChildren(); proposals.className = 'object-proposals';
            const proposed = propose(state.target, state.source, state.pairs);
            const chosen = new Set((state.proposalSelected || []).filter(id => proposed.some(pair => pair.source === id)));
            const targetById = new Map(objects.map(object => [object.guid, object])), sourceById = new Map(sources.map(object => [object.guid, object]));
            element('h3', `Návrhy objektů (${proposed.length})`, proposals);
            element('p', 'DSS1 vlevo, DSS2 vpravo. Každou dvojici potvrďte zvlášť, označte více návrhů nebo potvrďte všechny. Párují se pouze úplné jednoznačné shody bez rozporu skupin a CCI kódů.', proposals);
            const searchLabel = element('label', 'Hledat v návrzích', proposals), search = element('input', undefined, proposals);
            search.type = 'search'; search.id = 'object-proposal-search'; searchLabel.htmlFor = search.id; search.value = state.proposalQuery || '';
            const actions = element('div', undefined, proposals); actions.className = 'matching-toolbar';
            const selectAll = element('button', 'Označit nalezené', actions); selectAll.id = 'object-proposal-select';
            const clear = element('button', 'Zrušit výběr', actions);
            const confirmSelected = element('button', 'Potvrdit označené', actions); confirmSelected.id = 'object-proposal-confirm-selected';
            const confirmAll = element('button', `Potvrdit všechny návrhy (${proposed.length})`, actions); confirmAll.id = 'object-proposal-confirm-all';
            confirmAll.disabled = !proposed.length; confirmAll.onclick = () => accept(proposed);
            const close = element('button', 'Zavřít návrhy', actions); close.onclick = () => { state.proposalsOpen = false; proposals.replaceChildren(); proposals.className = ''; };
            const count = element('p', '', proposals); count.setAttribute('role', 'status');
            const headings = element('div', undefined, proposals); headings.className = 'object-proposal-row object-proposal-heading';
            element('strong', 'DSS1', headings); element('span', 'Potvrzení dvojice', headings); element('strong', 'DSS2', headings);
            const list = element('div', undefined, proposals); list.className = 'object-proposal-list';
            list.onscroll = () => { state.proposalScroll = list.scrollTop; };
            let found = [];
            function selectionChanged() {
                state.proposalSelected = [...chosen];
                count.textContent = `Zobrazeno ${found.length} z ${proposed.length} návrhů · označeno ${chosen.size}. Potvrzené dvojice se přesunou do seznamu spárovaných objektů.`;
                confirmSelected.textContent = `Potvrdit označené (${chosen.size})`; confirmSelected.disabled = !chosen.size;
            }
            function objectCard(object, parent) {
                const card = element('div', undefined, parent); card.className = 'object-proposal-card'; card.title = object.guid;
                element('strong', object.nameCz || object.name, card); showAspectCodes(object, card);
                if (object.groupOfDataObjectsCz) element('small', object.groupOfDataObjectsCz, card);
                if (object.ids?.identifier) element('small', object.ids.identifier, card);
            }
            function drawRows() {
                list.replaceChildren();
                found = proposed.filter(pair => norm(label(targetById.get(pair.target)) + ' ' + label(sourceById.get(pair.source))).includes(norm(search.value)));
                for (const pair of found) {
                    const row = element('div', undefined, list); row.className = 'object-proposal-row'; row.dataset.proposalSource = pair.source;
                    objectCard(targetById.get(pair.target), row);
                    const action = element('div', undefined, row); action.className = 'object-proposal-action';
                    const selectLabel = element('label', undefined, action), checkbox = element('input', undefined, selectLabel); checkbox.type = 'checkbox'; checkbox.checked = chosen.has(pair.source); checkbox.dataset.proposalSelect = pair.source;
                    checkbox.setAttribute('aria-label', 'Označit dvojici ' + label(targetById.get(pair.target)) + ' a ' + label(sourceById.get(pair.source)));
                    element('span', ' Označit dvojici', selectLabel);
                    checkbox.onchange = () => { if (checkbox.checked) chosen.add(pair.source); else chosen.delete(pair.source); selectionChanged(); };
                    element('small', 'Úplná shoda názvu', action);
                    const confirm = element('button', 'Potvrdit dvojici ↔', action); confirm.dataset.proposalConfirm = pair.source; confirm.onclick = () => accept([pair]);
                    objectCard(sourceById.get(pair.source), row);
                }
                if (!found.length) element('p', proposed.length ? 'Žádný návrh neodpovídá hledání.' : 'Žádné další jednoznačné úplné shody. Pro ostatní objekty použijte ruční párování níže.', list);
                selectionChanged();
                list.scrollTop = state.proposalScroll || 0;
            }
            selectAll.onclick = () => { found.forEach(pair => chosen.add(pair.source)); drawRows(); };
            clear.onclick = () => { chosen.clear(); drawRows(); };
            confirmSelected.onclick = () => accept(proposed.filter(pair => chosen.has(pair.source)));
            search.oninput = () => { state.proposalQuery = search.value; state.proposalScroll = 0; drawRows(); }; drawRows();
        }
        proposeButton.onclick = () => { state.proposalsOpen = true; drawProposals(); };
        if (state.proposalsOpen) drawProposals();
        element('p', 'Automat páruje pouze jednoznačné úplné shody názvů. Podobné názvy a CCI komponenty se nabízejí po výběru objektu v protějším sloupci a vyžadují ruční potvrzení.', root);
        const layout = element('div', undefined, root); layout.className = 'matching-columns';
        const left = element('div', undefined, layout); left.className = 'matching-column';
        const middle = element('div', undefined, layout); middle.className = 'matching-action';
        const right = element('div', undefined, layout); right.className = 'matching-column';
        const selectedText = element('p', 'Vyberte jeden objekt v každém sloupci.', middle);
        const pairButton = element('button', 'Párovat ↔', middle); pairButton.id = 'matching-pair'; pairButton.disabled = true;
        const status = element('p', state.message || '', root); status.className = 'matching-status'; status.setAttribute('role', 'status');
        const redraw = {};
        function updateAction() {
            const t = objects.find(x => x.guid === state.selected.target);
            const s = sources.find(x => x.guid === state.selected.source);
            pairButton.disabled = !t || !s;
            selectedText.textContent = t && s ? `${t.nameCz} ↔ ${s.nameCz}` : t ? 'Teď vyberte objekt v DSS2.' : s ? 'Teď vyberte objekt v DSS1.' : 'Vyberte jeden objekt v každém sloupci.';
        }
        function column(parent, key, title, all) {
            const heading = element('div', undefined, parent); heading.className = 'matching-column-heading';
            element('h3', title, heading);
            const file = document.getElementById(key === 'target' ? 'fileInput1' : 'fileInput2');
            element('small', file.dataset.importFileName || 'Načtený standard', heading);
            const suggestions = element('div', undefined, parent); suggestions.className = 'matching-recommendations';
            const searchLabel = element('label', `Hledat v ${title}`, parent);
            const search = element('input', undefined, parent); search.type = 'search'; search.id = 'matching-search-' + key;
            searchLabel.htmlFor = search.id; search.placeholder = 'Název, kód, skupina nebo identifikátor…'; search.value = state.queries[key];
            const count = element('small', undefined, parent);
            const list = element('div', undefined, parent); list.className = 'matching-object-list'; list.setAttribute('aria-label', `Objekty ${title}`);
            const navigation = element('div', undefined, parent); navigation.className = 'matching-pagination';
            function draw() {
                list.replaceChildren(); navigation.replaceChildren();
                suggestions.replaceChildren();
                const paired = new Set(allPairs.map(p => p[key]));
                const query = norm(state.queries[key]);
                const available = all.filter(x => !paired.has(x.guid));
                const oppositeKey = key === 'target' ? 'source' : 'target';
                const oppositeObjects = key === 'target' ? sources : objects;
                const chosen = oppositeObjects.find(x => x.guid === state.selected[oppositeKey]);
                const ranked = chosen ? recommend(chosen, available) : [];
                const scores = new Map(ranked.map(item => [item.object.guid, item]));
                const found = available.filter(x => norm(label(x) + ' ' + x.guid).includes(query));
                if (chosen) found.sort((a, b) => (scores.get(b.guid)?.rank || 0) - (scores.get(a.guid)?.rank || 0));
                const pageSize = 60;
                state.pages[key] = Math.min(state.pages[key], Math.max(0, Math.ceil(found.length / pageSize) - 1));
                const offset = state.pages[key] * pageSize;
                count.textContent = `${found.length} nalezeno · ${all.length - paired.size} nespárováno z ${all.length}`;
                function cardFor(obj, container, recommended) {
                    const card = element('button', undefined, container); card.type = 'button'; card.className = 'matching-object';
                    card.dataset.guid = obj.guid;
                    if (obj.guid === state.selected[key]) card.classList.add('is-selected');
                    card.setAttribute('aria-pressed', String(obj.guid === state.selected[key]));
                    card.title = label(obj) + '\n' + obj.guid;
                    element('strong', obj.nameCz || obj.name || '(bez názvu)', card);
                    showAspectCodes(obj, card);
                    if (obj.groupOfDataObjectsCz) element('span', obj.groupOfDataObjectsCz, card);
                    if (obj.ids && obj.ids.identifier) element('small', obj.ids.identifier, card);
                    const evidence = scores.get(obj.guid);
                    if (evidence) {
                        const badge = element('span', evidence.reasons.join(' · '), card); badge.className = 'matching-suggestion';
                        for (const warning of evidence.warnings) element('span', warning, card).className = 'matching-suggestion-warning';
                    }
                    if (recommended) card.classList.add('is-recommended');
                    card.onclick = () => {
                        state.selected[key] = state.selected[key] === obj.guid ? '' : obj.guid;
                        draw(); state.pages[oppositeKey] = 0; redraw[oppositeKey](); updateAction();
                    };
                }
                if (chosen) {
                    element('h4', 'Doporučené protějšky', suggestions);
                    element('p', `Pro „${chosen.nameCz || chosen.name}“. Návrhy potvrďte tlačítkem Párovat; vyhledávání níže je neomezuje.`, suggestions);
                    if (!ranked.length) element('p', 'Nenašel se dostatečně podobný název ani CCI kód. Zkuste vlastní hledání.', suggestions);
                    const top = element('div', undefined, suggestions); top.className = 'matching-recommendation-list';
                    for (const item of ranked.slice(0, 6)) cardFor(item.object, top, true);
                    if (ranked.length > 6) element('p', `Nejlepších 6 z ${ranked.length} návrhů. Další jsou seřazené nahoře v seznamu níže.`, suggestions);
                } else element('p', 'Označte objekt v protějším sloupci — zde se nabídnou podobné názvy a CCI komponenty.', suggestions);
                if (!found.length) element('p', 'Žádné objekty. Zkuste upravit hledání.', list);
                for (const obj of found.slice(offset, offset + pageSize)) cardFor(obj, list, false);
                if (found.length > pageSize) {
                    const prev = element('button', '← Předchozí', navigation); prev.disabled = offset === 0;
                    prev.onclick = () => { state.pages[key]--; draw(); list.scrollTop = 0; };
                    element('span', `${state.pages[key] + 1} / ${Math.ceil(found.length / pageSize)}`, navigation);
                    const next = element('button', 'Další →', navigation); next.disabled = offset + pageSize >= found.length;
                    next.onclick = () => { state.pages[key]++; draw(); list.scrollTop = 0; };
                }
            }
            search.oninput = () => { state.queries[key] = search.value; state.pages[key] = 0; draw(); };
            redraw[key] = draw; draw();
        }
        column(left, 'target', 'DSS1', objects); column(right, 'source', 'DSS2', sources);
        updateAction();
        pairButton.onclick = () => {
            if (!state.selected.target || !state.selected.source) return;
            const next = state.pairs.concat({ target: state.selected.target, source: state.selected.source, properties: [] });
            try {
                validate(state.target, state.source, state.automatic.concat(next));
                const t = objects.find(x => x.guid === state.selected.target), s = sources.find(x => x.guid === state.selected.source);
                state.message = `Spárováno: ${t.nameCz} ↔ ${s.nameCz}`;
                state.pairs = next; state.selected = { target: '', source: '' }; render();
            } catch (e) { alert(e.message); }
        };
        const pairedSection = element('div', undefined, root); pairedSection.className = 'matching-pairs';
        element('h3', `Spárované objekty (${allPairs.length})`, pairedSection);
        if (state.automatic.length) element('p', 'Shody GUID jsou spárované automaticky. Ručně vybírejte už jen ostatní objekty.', pairedSection);
        if (!allPairs.length) element('p', 'Zatím žádná dvojice. Vyberte objekty nahoře a klikněte na Párovat.', pairedSection);
        else {
            const table = element('table', undefined, pairedSection);
            const head = element('tr', undefined, element('thead', undefined, table));
            for (const title of ['DSS1', 'DSS2', '']) element('th', title, head).scope = 'col';
            const body = element('tbody', undefined, table);
            for (const pair of allPairs) {
                const tr = element('tr', undefined, body);
                for (const [doc, id] of [[state.target, pair.target], [state.source, pair.source]]) {
                    const obj = rows(doc, 'DataObjects').find(x => x.guid === id);
                    const cell = element('td', undefined, tr); element('strong', obj.nameCz, cell);
                    showAspectCodes(obj, cell);
                    element('small', obj.groupOfDataObjectsCz || obj.ids && obj.ids.identifier || obj.guid, cell);
                }
                const actionCell = element('td', undefined, tr);
                if (pair.method === 'guid') { element('strong', 'Shoda GUID', actionCell); continue; }
                element('small', pair.method === 'name' ? 'Úplná shoda názvu' : 'Ručně', actionCell);
                const remove = element('button', 'Zrušit vazbu', actionCell);
                remove.setAttribute('aria-label', `Zrušit vazbu ${objects.find(x => x.guid === pair.target).nameCz}`);
                remove.onclick = () => { state.pairs = state.pairs.filter(p => p !== pair); state.message = 'Vazba zrušena. Objekty jsou opět ve výběru.'; render(); };
            }
        }
        global.DSS_PROPERTY_MATCHING.render(root, state.target, state.source, state.propertyPairs, pairs => { state.propertyPairs = pairs; render(); });
    }

    global.DSS_MATCHING = {
        applyPairs, properties, uniqueSuggestion, aspectCodes, guidPairs, mergeReport, recommend, propose,
        refreshPropertyCommands(previous, next) {
            if (!state) return;
            let changed = false;
            if (state.target === previous) { state.target = next; state.signatures[0] = signature(next); changed = true; }
            if (state.source === previous) { state.source = next; state.signatures[1] = signature(next); changed = true; }
            if (changed) render();
        },
        prepare(target, source) {
            const idsSource = rows(source, 'DataObjects').some(x => x.ids);
            const control = document.getElementById('matching-only-matched');
            const onlyMatched = idsSource && control && control.checked === true;
            if (state && (state.pairs.length || state.propertyPairs.length) &&
                (target !== state.target && signature(target) !== state.signatures[0] || source !== state.source && signature(source) !== state.signatures[1])) throw new Error('Podklady se změnily. Obnovte párování a případně načtěte uloženou mapu.');
            const manual = state ? state.pairs : [];
            const report = mergeReport(target, source, manual, onlyMatched);
            // Equal GUIDs continue through the ordinary GUID merge so all tables
            // retain their existing merge behavior; manual pairs use remapping.
            const propertyPairs = state ? state.propertyPairs : [];
            if (!idsSource && !manual.length && !propertyPairs.length) return { target: clone(target), source: clone(source), report };
            const result = applyPairs(target, source, manual, { onlyMatched, compact: idsSource, propertyPairs });
            report.properties = result.propertyReport;
            report.message += ` Vlastnosti — shoda GUID: ${report.properties.matchedByGuid}, automaticky podle názvu: ${report.properties.matchedByName}, ručně: ${report.properties.matchedManually}.`;
            return { ...result, report };
        }
    };
    document.getElementById('matching-open').onclick = () => {
        try {
            if (typeof resourceJsonData !== 'undefined' && (resourceJsonData === jsonInput1 || resourceJsonData === jsonInput2)) saveModifiedJson(resourceJsonData);
            const [target, source] = readInputs();
            if (!target.data || !source.data) throw new Error('Nejdřív načtěte oba soubory.');
            if (state && (state.pairs.length || state.propertyPairs.length) && !confirm('Obnovení zruší aktuální párování objektů i vlastností. Uložte si mapu, pokud ji chcete použít znovu. Pokračovat?')) return;
            state = { target, source, automatic: guidPairs(target, source), pairs: [], propertyPairs: [], selected: { target: '', source: '' }, queries: { target: '', source: '' }, pages: { target: 0, source: 0 }, signatures: [signature(target), signature(source)] }; render();
        } catch (e) { alert('Párování nelze otevřít: ' + e.message); }
    };
})(window);
