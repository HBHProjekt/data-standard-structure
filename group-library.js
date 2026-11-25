(function (global) {
    'use strict';
    const rows = (doc, table) => Array.isArray(doc.data?.[table]) ? doc.data[table] : [];
    const clone = value => JSON.parse(JSON.stringify(value));
    const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const uuid = () => global.crypto?.randomUUID ? global.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16); });
    const refs = { dataType: 'DataTypes', ifcType: 'IfcTypes', unit: 'Units', customEnum: 'CustomEnums' };
    function userLinks(doc) { return Array.isArray(doc.hbhEditor?.addedGroupProperties) ? doc.hbhEditor.addedGroupProperties : []; }
    function recordUserLinks(result, links) {
        if (!links.length) return result;
        const combined = userLinks(result.doc).slice();
        for (const link of links) if (!combined.some(item => item.groupGuid === link.groupGuid && item.propertyGuid === link.propertyGuid)) combined.push(link);
        const metadata = { ...result.doc.hbhEditor, addedGroupProperties: combined };
        result.changes.push({ keyChain: ['hbhEditor'], oldValue: result.doc.hbhEditor ?? null, newValue: metadata, action: 'set' });
        return { ...result, doc: { ...result.doc, hbhEditor: metadata } };
    }
    function canRemoveProperty(doc, groupGuid, propertyGuid) {
        return rows(doc, 'GroupsOfProperties').filter(group => group.guid === groupGuid && (group.properties || []).includes(propertyGuid)).length === 1 &&
            userLinks(doc).some(link => link.groupGuid === groupGuid && link.propertyGuid === propertyGuid);
    }
    function catalog(doc) {
        if (!doc?.data || !Array.isArray(doc.data.GroupsOfProperties) || !Array.isArray(doc.data.Properties)) throw new Error('Soubor neobsahuje skupiny vlastností a vlastnosti standardu.');
        const properties = new Map(rows(doc, 'Properties').map(row => [row.guid, row]));
        return rows(doc, 'GroupsOfProperties').map(group => ({ group, properties: [...new Set(group.properties || [])].map(guid => properties.get(guid)).filter(Boolean) }));
    }
    function readSource(text, filename = '') {
        let doc;
        if (/\.ids$/i.test(filename) || text.trimStart().startsWith('<')) {
            const imported = global.IDS_IMPORTER.importIdsToDss(text, { fileName: filename });
            if (!imported.success || !imported.jsonData) throw new Error('IDS se nepodařilo načíst. Ověřte soubor.');
            doc = imported.jsonData;
        } else doc = JSON.parse(text);
        catalog(doc); return global.DSS_HBH_AUTOMATIONS?.completeFromIfc(doc).doc || doc;
    }
    const canonical = value => {
        if (Array.isArray(value)) return value.map(canonical);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    };
    const definition = row => JSON.stringify(canonical(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'guid'))));
    function importGroups(target, source, selections) {
        catalog(source);
        const index = new Map(), data = { ...target.data }, changes = [], mapped = new Map(), active = new Set(), destinations = new Map();
        const counts = { groups: 0, properties: 0, dependencies: 0, reused: 0, groupsUpdated: 0 };
        for (const table of ['GroupsOfProperties', 'Properties', 'DataTypes', 'IfcTypes', 'Units', 'CustomEnums']) {
            const byId = new Map();
            for (const row of rows(source, table)) { if (!byId.has(row.guid)) byId.set(row.guid, []); byId.get(row.guid).push(row); }
            index.set(table, byId);
        }
        function sourceRow(table, guid) {
            const found = index.get(table)?.get(guid) || [];
            if (found.length !== 1) throw new Error(`V importu nelze jednoznačně najít ${table}: ${guid}.`);
            return found[0];
        }
        function append(table, row) {
            if (!destinations.has(table)) {
                const all = rows({ data }, table), definitions = new Map();
                for (const item of all) if (!definitions.has(definition(item))) definitions.set(definition(item), item);
                destinations.set(table, { ids: new Set(all.map(item => item.guid)), definitions });
            }
            const destination = destinations.get(table), semantic = definition(row), equal = destination.definitions.get(semantic);
            if (equal) { counts.reused++; return equal.guid; }
            if (!row.guid || destination.ids.has(row.guid)) do { row.guid = uuid(); } while (destination.ids.has(row.guid));
            const current = rows({ data }, table); data[table] = [...current, row];
            destination.ids.add(row.guid); destination.definitions.set(semantic, row);
            changes.push({ keyChain: ['data', table, current.length], oldValue: null, newValue: row, action: 'set' });
            if (table === 'GroupsOfProperties') counts.groups++; else if (table === 'Properties') counts.properties++; else counts.dependencies++;
            return row.guid;
        }
        function copy(table, guid) {
            const key = table + '|' + guid;
            if (mapped.has(key)) return mapped.get(key);
            if (active.has(key)) throw new Error('Import obsahuje kruhový odkaz: ' + guid);
            active.add(key);
            const row = clone(sourceRow(table, guid));
            // Only real DSS references are traversed. IDS dataType attributes are text, not GUIDs.
            for (const [field, dependency] of table === 'Properties' ? Object.entries(refs) : []) {
                if (row[field] === undefined || row[field] === null || row[field] === '') continue;
                row[field] = Array.isArray(row[field]) ? row[field].map(id => copy(dependency, id)) : copy(dependency, row[field]);
            }
            const id = append(table, row); mapped.set(key, id); active.delete(key); return id;
        }
        let selectedName = ''; const additions = [];
        for (const selection of selections) {
            const group = sourceRow('GroupsOfProperties', selection.group), allowed = new Set(group.properties || []);
            const selected = [...new Set(selection.properties || [])]; if (!selected.length) continue;
            if (selected.some(id => !allowed.has(id))) throw new Error('Vybraná vlastnost nepatří do skupiny ' + group.name + '.');
            const imported = { ...clone(group), properties: selected.map(id => copy('Properties', id)) };
            if (selection.into) {
                const groups = rows({ data }, 'GroupsOfProperties'), found = groups.map((row, i) => row.guid === selection.into ? i : -1).filter(i => i >= 0);
                if (found.length !== 1) throw new Error('Cílová skupina chybí nebo nemá jednoznačné GUID.');
                const position = found[0], original = groups[position], added = imported.properties.filter(id => !(original.properties || []).includes(id));
                const names = new Map();
                for (const id of [...(original.properties || []), ...added]) {
                    const p = rows({ data }, 'Properties').find(row => row.guid === id);
                    if (!p) throw new Error('Chybí definice vlastnosti: ' + id);
                    const name = String(p.nameIfc || p.nameIFC || p.nameCz || '').normalize('NFC').trim();
                    if (name && names.has(name) && names.get(name) !== id) throw new Error('Skupina už obsahuje jinou vlastnost s IFC názvem: ' + name);
                    names.set(name, id);
                }
                if (added.length) {
                    data.GroupsOfProperties = groups.slice(); data.GroupsOfProperties[position] = { ...original, properties: [...(original.properties || []), ...added] };
                    changes.push({ keyChain: ['data', 'GroupsOfProperties', position, 'properties'], oldValue: original.properties || [], newValue: data.GroupsOfProperties[position].properties, action: 'set' });
                    counts.groupsUpdated++;
                    additions.push(...added.map(propertyGuid => ({ groupGuid: original.guid, propertyGuid })));
                }
                selectedName = original.name || 'Bez názvu skupiny';
            } else { append('GroupsOfProperties', imported); selectedName = group.name || 'Bez názvu skupiny'; }
        }
        return recordUserLinks({ doc: changes.length ? { ...target, data } : target, changes, kind: 'groupLibrary', selectedName, counts }, additions);
    }
    function createGroup(doc, name, properties) {
        name = String(name || '').trim();
        if (!name) throw new Error('Zadejte název skupiny.');
        if (rows(doc, 'GroupsOfProperties').some(row => norm(row.name) === norm(name))) throw new Error('Skupina s tímto názvem už existuje. Zadejte jiný název.');
        if (!properties.length) throw new Error('Přidejte alespoň jednu vlastnost.');
        const source = global.DSS_MODEL.createEmptyDocument(), seen = new Set();
        function ensure(table, field, value) {
            let row = source.data[table].find(row => row[field] === value);
            if (!row) { row = { guid: uuid(), [field]: value }; source.data[table].push(row); }
            return row.guid;
        }
        for (const item of properties) {
            const nameCz = String(item.nameCz || '').trim(), nameIfc = String(item.nameIfc || '').trim() || nameCz;
            if (!nameCz) throw new Error('Vyplňte český název každé vlastnosti.');
            if (seen.has(nameIfc)) throw new Error('Opakovaný IFC název vlastnosti: ' + nameIfc);
            seen.add(nameIfc);
            source.data.Properties.push({ guid: uuid(), nameCz, nameIfc,
                dataType: ensure('DataTypes', 'type', item.type || 'String'), ifcType: ensure('IfcTypes', 'type', 'SingleValue'),
                unit: ensure('Units', 'unit', String(item.unit || '').trim() || '[-]'), customEnum: '' });
        }
        const group = { guid: uuid(), name, properties: source.data.Properties.map(row => row.guid) }; source.data.GroupsOfProperties.push(group);
        const result = importGroups(doc, source, [{ group: group.guid, properties: group.properties }]);
        const created = rows(result.doc, 'GroupsOfProperties').find(item => item.name === name);
        return recordUserLinks(result, (created?.properties || []).map(propertyGuid => ({ groupGuid: created.guid, propertyGuid })));
    }
    function el(tag, text, parent) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (parent) parent.append(node); return node; }
    function dialog(titleText, id) {
        const box = el('dialog', undefined, document.body); box.id = id; box.className = 'hbh-automation-dialog group-library-dialog';
        const title = el('h2', titleText, box); title.id = id + '-title'; box.setAttribute('aria-labelledby', title.id);
        box.onclose = () => box.remove(); return box;
    }
    function extendGroup(doc, guid, drafts, existing = []) {
        const groups = rows(doc, 'GroupsOfProperties').filter(group => group.guid === guid);
        if (groups.length !== 1) throw new Error('Cílová skupina není jednoznačná.');
        if (!drafts.length && !existing.length) throw new Error('Přidejte nebo vyberte alespoň jednu vlastnost.');
        const source = drafts.length ? createGroup(global.DSS_MODEL.createEmptyDocument(), groups[0].name || 'Skupina', drafts).doc : global.DSS_MODEL.createEmptyDocument();
        let group = source.data.GroupsOfProperties[0];
        if (!group) { group = { guid: uuid(), name: groups[0].name, properties: [] }; source.data.GroupsOfProperties.push(group); }
        for (const id of new Set(existing)) {
            const found = rows(doc, 'Properties').filter(p => p.guid === id);
            if (found.length !== 1) throw new Error('Vybraná vlastnost není jednoznačná.');
            source.data.Properties.push(found[0]); group.properties.push(id);
        }
        for (const table of ['DataTypes', 'IfcTypes', 'Units', 'CustomEnums']) source.data[table] = [...source.data[table], ...rows(doc, table)];
        return importGroups(doc, source, [{ group: group.guid, properties: group.properties, into: guid }]);
    }
    function createPicker(doc, apply, existingGroups) {
        const extending = !!existingGroups?.length;
        const box = dialog(extending ? 'Přidat vlastnosti do skupiny' : 'Přidat skupinu vlastností', 'group-create-dialog');
        const label = el('label', 'Název skupiny', box), name = el('input', undefined, box); name.id = 'group-create-name'; label.htmlFor = name.id;
        let targetGroup = existingGroups?.[0]?.guid;
        const chosen = new Set();
        if (extending) {
            name.value = existingGroups[0].name; name.readOnly = true;
            if (existingGroups.length > 1) {
                const selectLabel = el('label', 'Konkrétní varianta skupiny', box), select = el('select', undefined, selectLabel); select.id = 'group-extend-target';
                for (const group of existingGroups) el('option', `${group.name} · ${(group.properties || []).length} vlastností · ${group.guid}`, select).value = group.guid;
                select.value = targetGroup; select.onchange = () => { targetGroup = select.value; };
            }
            el('p', 'Doplňuje se konkrétní sdílená skupina. Nové vlastnosti uvidí všechny objekty, které ji používají.', box);
            const library = el('details', undefined, box); el('summary', 'Vybrat existující vlastnosti standardu', library);
            const search = el('input', undefined, library); search.type = 'search'; search.placeholder = 'Hledat vlastnost'; search.setAttribute('aria-label', search.placeholder);
            const output = el('div', undefined, library); output.className = 'group-import-list'; let limit = 100;
            function drawLibrary() {
                output.replaceChildren();
                const found = rows(doc, 'Properties').filter(p => norm([p.nameCz, p.nameIfc, p.guid].join(' ')).includes(norm(search.value)));
                for (const p of found.slice(0, limit)) {
                    const label = el('label', undefined, output); label.className = 'group-assignment-choice';
                    const check = el('input', undefined, label); check.type = 'checkbox'; check.checked = chosen.has(p.guid); check.dataset.existingProperty = p.guid;
                    el('span', `${p.nameCz || p.nameIfc} · ${p.nameIfc || ''} · ${p.guid}`, label);
                    check.onchange = () => { if (check.checked) chosen.add(p.guid); else chosen.delete(p.guid); };
                }
                if (found.length > limit) { const more = el('button', 'Dalších 100 vlastností', output); more.type = 'button'; more.onclick = () => { limit += 100; drawLibrary(); }; }
            }
            search.oninput = () => { limit = 100; drawLibrary(); }; drawLibrary();
        }
        el('p', 'Zadejte vlastnosti nové skupiny. Pokud IFC název nevyplníte, použije se český název. Automaty a číselníky přiřadíte po uložení v přehledu.', box);
        const list = el('div', undefined, box); const drafts = [];
        function addRow() {
            const row = el('div', undefined, list); row.className = 'group-create-property';
            const field = (caption, tag = 'input') => { const label = el('label', caption, row), input = el(tag, undefined, label); return input; };
            const cz = field('Český název'), ifc = field('IFC název'), type = field('Datový typ', 'select'), unit = field('Jednotka');
            for (const value of ['String', 'Integer', 'Real', 'Boolean', 'Date', 'Enum', 'Reference']) el('option', value, type).value = value; type.value = 'String';
            unit.placeholder = '[-]';
            const item = { row, cz, ifc, type, unit }; drafts.push(item);
            const remove = el('button', 'Odebrat vlastnost', row); remove.type = 'button'; remove.onclick = () => { drafts.splice(drafts.indexOf(item), 1); row.remove(); };
        }
        addRow();
        const add = el('button', '＋ Přidat vlastnost', box); add.type = 'button'; add.id = 'group-create-add-property'; add.onclick = addRow;
        const error = el('p', '', box); error.className = 'hbh-picker-error'; error.setAttribute('role', 'alert');
        const actions = el('div', undefined, box); actions.className = 'standard-toolbar';
        const save = el('button', extending ? 'Přidat vlastnosti do skupiny' : 'Přidat skupinu', actions); save.id = 'group-create-save'; save.type = 'button';
        save.onclick = () => { try {
            const values = drafts.filter(item => !extending || item.cz.value.trim() || item.ifc.value.trim() || item.unit.value.trim()).map(item => ({ nameCz: item.cz.value, nameIfc: item.ifc.value, type: item.type.value, unit: item.unit.value }));
            const change = extending ? extendGroup(doc, targetGroup, values, [...chosen]) : createGroup(doc, name.value, values);
            if (!change.changes.length) { error.textContent = 'Vybrané vlastnosti už ve skupině jsou.'; return; }
            apply(change); box.close();
        } catch (failure) { error.textContent = failure.message; } };
        const cancel = el('button', 'Zrušit', actions); cancel.type = 'button'; cancel.onclick = () => box.close();
        box.showModal(); return box;
    }
    function importPicker(doc, apply) {
        const box = dialog('Importovat skupiny a vlastnosti', 'group-import-dialog');
        el('p', 'Vyberte JSON nebo IDS a označte skupiny a vlastnosti pro přidání do knihovny tohoto standardu. Existující definice se nepřepisují; shodné se znovu použijí. K datovým objektům se skupiny automaticky nepřiřazují.', box);
        const label = el('label', 'Zdrojový soubor JSON / IDS', box), file = el('input', undefined, box); file.id = 'group-import-file'; file.type = 'file'; file.accept = '.json,.ids,application/json,text/xml,application/xml'; label.htmlFor = file.id;
        const summary = el('p', 'Nejprve vyberte soubor.', box); summary.setAttribute('role', 'status');
        const search = el('input', undefined, box); search.id = 'group-import-search'; search.type = 'search'; search.placeholder = 'Hledat skupinu nebo vlastnost'; search.setAttribute('aria-label', search.placeholder); search.disabled = true;
        const controls = el('div', undefined, box); controls.className = 'standard-toolbar';
        const selectAll = el('button', 'Vybrat nalezené skupiny', controls), clear = el('button', 'Zrušit výběr', controls);
        const list = el('div', undefined, box); list.className = 'group-import-list';
        const error = el('p', '', box); error.className = 'hbh-picker-error'; error.setAttribute('role', 'alert');
        const actions = el('div', undefined, box); actions.className = 'standard-toolbar';
        const save = el('button', 'Importovat vybrané', actions); save.id = 'group-import-save'; save.disabled = true;
        const cancel = el('button', 'Zrušit', actions); cancel.onclick = () => box.close();
        let source, entries = [], selection = new Map(), generation = 0;
        const found = () => entries.filter(entry => norm([entry.group.name, ...entry.properties.flatMap(p => [p.nameCz, p.nameIfc])].join(' ')).includes(norm(search.value)));
        function update() {
            const selected = [...selection.values()].filter(ids => ids.size), propertyCount = selected.reduce((count, ids) => count + ids.size, 0);
            summary.textContent = `Ve zdroji ${entries.length} skupin · vybráno ${selected.length} skupin / ${propertyCount} přiřazení vlastností. Přenesou se i potřebné typy, jednotky a číselníky.`;
            save.disabled = !propertyCount;
        }
        function draw() {
            list.replaceChildren();
            for (const entry of found()) {
                const { group, properties } = entry;
                const ids = selection.get(group.guid) || new Set(); selection.set(group.guid, ids);
                const block = el('div', undefined, list); block.className = 'group-import-block';
                const label = el('label', undefined, block), check = el('input', undefined, label); check.type = 'checkbox'; check.dataset.groupImport = group.guid; check.disabled = !properties.length;
                el('strong', `${group.name || 'Bez názvu skupiny'} (${properties.length} vlastností)`, label);
                el('small', group.guid, block);
                const detail = el('details', undefined, block); el('summary', 'Vybrat jednotlivé vlastnosti', detail);
                let loaded = false; const children = [];
                function sync() { check.checked = properties.length > 0 && ids.size === properties.length; check.indeterminate = ids.size > 0 && ids.size < properties.length; update(); }
                detail.ontoggle = () => {
                    if (!detail.open || loaded) return; loaded = true;
                    for (const property of properties) {
                        const label = el('label', undefined, detail), child = el('input', undefined, label); child.type = 'checkbox'; child.checked = ids.has(property.guid); child.dataset.groupProperty = property.guid;
                        el('span', property.nameCz || property.nameIfc || property.guid, label);
                        if (property.nameIfc && property.nameIfc !== property.nameCz) el('small', property.nameIfc, label);
                        child.onchange = () => { if (child.checked) ids.add(property.guid); else ids.delete(property.guid); sync(); }; children.push({ child, guid: property.guid });
                    }
                };
                check.onchange = () => { ids.clear(); if (check.checked) properties.forEach(property => ids.add(property.guid)); children.forEach(({ child, guid }) => { child.checked = ids.has(guid); }); sync(); };
                check.checked = properties.length > 0 && ids.size === properties.length; check.indeterminate = ids.size > 0 && ids.size < properties.length;
            }
            if (!list.children.length && source) el('p', 'Žádná skupina neodpovídá hledání.', list);
            update();
        }
        selectAll.disabled = clear.disabled = true;
        selectAll.onclick = () => { found().forEach(entry => selection.set(entry.group.guid, new Set(entry.properties.map(property => property.guid)))); draw(); };
        clear.onclick = () => { selection.clear(); draw(); }; search.oninput = draw;
        file.onchange = async () => {
            const selectedFile = file.files?.[0], token = ++generation;
            source = null; entries = []; selection.clear(); list.replaceChildren(); save.disabled = true; search.disabled = selectAll.disabled = clear.disabled = true; error.textContent = '';
            if (!selectedFile) { summary.textContent = 'Nejprve vyberte soubor.'; return; }
            summary.textContent = 'Načítám skupiny a vlastnosti…';
            try {
                const text = await selectedFile.text(); if (token !== generation || !box.open) return;
                source = readSource(text, selectedFile.name); entries = catalog(source); search.value = ''; search.disabled = selectAll.disabled = clear.disabled = false; draw();
            } catch (failure) { if (token === generation) { error.textContent = failure.message; summary.textContent = 'Soubor se nepodařilo načíst.'; } }
        };
        save.onclick = () => { try {
            if (!source) return;
            const change = importGroups(doc, source, [...selection].map(([group, properties]) => ({ group, properties: [...properties] })));
            if (!change.changes.length) { summary.textContent = 'Vybrané skupiny a vlastnosti už ve standardu jsou. Nic se nepřepisovalo.'; return; }
            apply(change); box.close();
        } catch (failure) { error.textContent = failure.message; } };
        box.showModal(); return box;
    }
    function assignGroups(doc, objectGuids, groupGuids) {
        const objects = new Set(objectGuids), groups = [...new Set(groupGuids)];
        if (!objects.size || !groups.length) throw new Error('Vyberte alespoň jeden datový objekt a jednu skupinu vlastností.');
        const objectIds = new Map(), groupIds = new Map();
        for (const row of rows(doc, 'DataObjects')) objectIds.set(row.guid, (objectIds.get(row.guid) || 0) + 1);
        for (const row of rows(doc, 'GroupsOfProperties')) groupIds.set(row.guid, (groupIds.get(row.guid) || 0) + 1);
        if ([...objects].some(id => !objectIds.has(id)) || groups.some(id => !groupIds.has(id))) throw new Error('Vybraný objekt nebo skupina už ve standardu není. Otevřete dialog znovu.');
        for (const id of objects) if (objectIds.get(id) !== 1) throw new Error('Datový objekt nemá jednoznačné GUID: ' + id);
        for (const id of groups) if (groupIds.get(id) !== 1) throw new Error('Skupina nemá jednoznačné GUID: ' + id);
        const changes = []; let linksAdded = 0, objectsChanged = 0;
        const next = rows(doc, 'DataObjects').map((object, index) => {
            if (!objects.has(object.guid)) return object;
            const current = object.loin?.nongraphical?.groupsOfProperties || [];
            if (!Array.isArray(current)) throw new Error('Objekt má nečitelný seznam skupin: ' + (object.nameCz || object.guid));
            const existing = new Set(current), added = groups.filter(id => !existing.has(id));
            if (!added.length) return object;
            const loin = { ...object.loin, nongraphical: { ...object.loin?.nongraphical, groupsOfProperties: [...current, ...added] } };
            // Log the complete changed branch, including any previously absent parents.
            changes.push({ keyChain: ['data', 'DataObjects', index, 'loin'], oldValue: object.loin ?? null, newValue: loin, action: 'set' });
            linksAdded += added.length; objectsChanged++;
            return { ...object, loin };
        });
        return { doc: changes.length ? { ...doc, data: { ...doc.data, DataObjects: next } } : doc, changes, kind: 'groupAssignment', linksAdded, objectsChanged };
    }
    function assignmentPicker(doc, currentObjectGuid, apply) {
        const box = dialog('Přiřadit skupiny datovým objektům', 'group-assignment-dialog');
        el('p', 'Vyberte skupiny vlevo a datové objekty vpravo. Skupiny se přidají k vybraným objektům; již přiřazené skupiny a ostatní údaje zůstanou zachované.', box);
        const chosenGroups = new Set(), chosenObjects = new Set();
        const currentObject = rows(doc, 'DataObjects').find(object => object.guid === currentObjectGuid);
        if (currentObject) { chosenObjects.add(currentObjectGuid); el('p', 'Předvybraný objekt: ' + (currentObject.nameCz || currentObject.name || currentObject.guid), box); }
        const columns = el('div', undefined, box); columns.className = 'group-assignment-columns';
        const summary = el('p', '', box); summary.setAttribute('role', 'status'); summary.id = 'group-assignment-summary';
        const error = el('p', '', box); error.className = 'hbh-picker-error'; error.setAttribute('role', 'alert');
        const actions = el('div', undefined, box); actions.className = 'standard-toolbar';
        const save = el('button', 'Přiřadit skupiny', actions); save.id = 'group-assignment-save'; save.type = 'button';
        const cancel = el('button', 'Zrušit', actions); cancel.type = 'button'; cancel.onclick = () => box.close();
        function update() {
            summary.textContent = `Vybráno skupin: ${chosenGroups.size} · datových objektů: ${chosenObjects.size}. Již existující přiřazení se nepřidají podruhé.`;
            save.disabled = !chosenGroups.size || !chosenObjects.size;
        }
        function column(title, items, chosen, side) {
            const section = el('section', undefined, columns); el('h3', title, section);
            const search = el('input', undefined, section); search.type = 'search'; search.id = 'group-assignment-search-' + side; search.placeholder = 'Hledat ' + (side === 'groups' ? 'skupinu' : 'objekt'); search.setAttribute('aria-label', search.placeholder);
            const buttons = el('div', undefined, section); buttons.className = 'standard-toolbar';
            const all = el('button', side === 'objects' ? `Všechny datové objekty (${items.length})` : `Všechny skupiny (${items.length})`, buttons); all.id = 'group-assignment-all-' + side; all.type = 'button';
            const foundButton = el('button', 'Označit nalezené', buttons); foundButton.type = 'button';
            const clear = el('button', 'Zrušit výběr', buttons); clear.type = 'button';
            const count = el('p', '', section), list = el('div', undefined, section); list.className = 'group-assignment-list';
            let limit = 100;
            const matches = () => items.filter(item => item.search.includes(norm(search.value)));
            function draw() {
                list.replaceChildren(); const found = matches(); count.textContent = `${found.length} položek · označeno ${chosen.size}`;
                for (const item of found.slice(0, limit)) {
                    const label = el('label', undefined, list); label.className = 'group-assignment-choice';
                    const check = el('input', undefined, label); check.type = 'checkbox'; check.checked = chosen.has(item.guid); check.dataset.assignmentSide = side; check.dataset.assignmentGuid = item.guid;
                    const description = el('span', undefined, label); el('strong', item.name, description); el('small', item.detail, description);
                    check.onchange = () => { if (check.checked) chosen.add(item.guid); else chosen.delete(item.guid); count.textContent = `${found.length} položek · označeno ${chosen.size}`; update(); };
                }
                if (!found.length) el('p', items.length ? 'Nic neodpovídá hledání.' : side === 'groups' ? 'Nejprve přidejte nebo importujte skupinu v záložce Skupiny → vlastnosti.' : 'Standard nemá datové objekty.', list);
                if (found.length > limit) { const more = el('button', 'Zobrazit dalších 100', list); more.type = 'button'; more.onclick = () => { limit += 100; draw(); }; }
                update();
            }
            all.onclick = () => { items.forEach(item => chosen.add(item.guid)); draw(); };
            foundButton.onclick = () => { matches().forEach(item => chosen.add(item.guid)); draw(); };
            clear.onclick = () => { chosen.clear(); draw(); };
            search.oninput = () => { limit = 100; draw(); }; draw();
        }
        column('Skupiny vlastností', rows(doc, 'GroupsOfProperties').map(group => ({ guid: group.guid, name: group.name || 'Bez názvu skupiny',
            detail: `${(group.properties || []).length} vlastností · ${group.guid}`, search: norm([group.name, group.guid].join(' ')) })), chosenGroups, 'groups');
        column('Datové objekty', rows(doc, 'DataObjects').map(object => ({ guid: object.guid, name: object.nameCz || object.name || '(bez názvu)',
            detail: [object.groupOfDataObjectsCz, object.typeAspectCode, object.guid].filter(Boolean).join(' · '),
            search: norm([object.nameCz, object.name, object.groupOfDataObjectsCz, object.typeAspectCode, object.guid].join(' ')) })), chosenObjects, 'objects');
        save.onclick = () => { try {
            const change = assignGroups(doc, [...chosenObjects], [...chosenGroups]);
            if (!change.changes.length) { summary.textContent = 'Všechny vybrané skupiny už jsou přiřazené vybraným objektům. Nic se nezměnilo.'; return; }
            apply(change); box.close();
        } catch (failure) { error.textContent = failure.message; } };
        box.showModal(); return box;
    }
    function editProperty(doc, guid, values) {
        const found = rows(doc, 'Properties').map((p, i) => p.guid === guid ? i : -1).filter(i => i >= 0);
        if (found.length !== 1) throw new Error('Vlastnost nemá jednoznačné GUID.');
        const position = found[0], original = doc.data.Properties[position], nameCz = String(values.nameCz || '').trim(), nameIfc = String(values.nameIfc || '').trim() || nameCz;
        if (!nameCz) throw new Error('Vyplňte český název vlastnosti.');
        for (const group of rows(doc, 'GroupsOfProperties').filter(group => (group.properties || []).includes(guid)))
            for (const id of group.properties || []) if (id !== guid) {
                const other = rows(doc, 'Properties').find(p => p.guid === id);
                if (other && String(other.nameIfc || other.nameIFC || other.nameCz || '').trim() === nameIfc) throw new Error('Ve skupině ' + group.name + ' už existuje jiná vlastnost s IFC názvem ' + nameIfc + '.');
            }
        const data = { ...doc.data }, changes = [];
        function ensure(table, field, value) {
            value = String(value || '').trim(); if (!value) return '';
            const existing = rows({ data }, table).find(row => row[field] === value); if (existing) return existing.guid;
            const current = rows({ data }, table), row = { guid: uuid(), [field]: value }; data[table] = [...current, row];
            changes.push({ keyChain: ['data', table, current.length], oldValue: null, newValue: row, action: 'set' }); return row.guid;
        }
        if (!String(values.type || '').trim()) throw new Error('Vyberte datový typ.');
        const ifcKey = Object.hasOwn(original, 'nameIfc') || !Object.hasOwn(original, 'nameIFC') ? 'nameIfc' : 'nameIFC';
        const next = { ...original, nameCz, [ifcKey]: nameIfc, dataType: ensure('DataTypes', 'type', values.type),
            ifcType: ensure('IfcTypes', 'type', values.ifcType), unit: ensure('Units', 'unit', values.unit), description: String(values.description || '') };
        for (const key of [ifcKey === 'nameIfc' ? 'nameIFC' : 'nameIfc']) if (Object.hasOwn(next, key)) next[key] = nameIfc;
        for (const key of Object.keys(next)) if (JSON.stringify(next[key]) !== JSON.stringify(original[key]))
            changes.push({ keyChain: ['data', 'Properties', position, key], oldValue: original[key] ?? null, newValue: next[key], action: 'set' });
        data.Properties = rows(doc, 'Properties').slice(); data.Properties[position] = next;
        return { doc: changes.length ? { ...doc, data } : doc, changes, kind: 'propertyDefinition', propertyGuid: guid };
    }
    function propertyPicker(doc, property, apply) {
        const box = dialog('Upravit definici vlastnosti', 'property-definition-dialog');
        const users = rows(doc, 'GroupsOfProperties').filter(group => (group.properties || []).includes(property.guid));
        el('p', `Sdílená vlastnost: ${property.nameCz || property.nameIfc}. Používá ji ${users.length} skupin. Úprava platí ve všech těchto skupinách a navázaných objektech.`, box);
        function field(title, id, value, tag = 'input') {
            const label = el('label', title, box), input = el(tag, undefined, box); input.id = id; label.htmlFor = id; input.value = value || ''; return input;
        }
        const cz = field('Český název', 'property-definition-name', property.nameCz), ifc = field('IFC název', 'property-definition-ifc', property.nameIfc || property.nameIFC);
        const currentType = rows(doc, 'DataTypes').find(row => row.guid === property.dataType)?.type || '';
        const type = field('Datový typ', 'property-definition-type', '', 'select');
        for (const value of new Set([currentType, ...rows(doc, 'DataTypes').map(row => row.type), 'String', 'Integer', 'Real', 'Boolean', 'Date', 'Enum', 'Reference'].filter(Boolean))) el('option', value, type).value = value;
        type.value = currentType || 'String';
        const ifcType = field('IFC typ', 'property-definition-ifc-type', rows(doc, 'IfcTypes').find(row => row.guid === property.ifcType)?.type);
        const unit = field('Jednotka', 'property-definition-unit', rows(doc, 'Units').find(row => row.guid === property.unit)?.unit);
        const description = field('Popis', 'property-definition-description', property.description, 'textarea'); description.rows = 3;
        el('p', 'Změna typu sama nepřevádí existující výchozí hodnoty ani hodnoty číselníku. Zkontrolujte jejich vhodnost. Automat a číselník vybíráte samostatně v tabulce.', box);
        const error = el('p', '', box); error.className = 'hbh-picker-error'; error.setAttribute('role', 'alert');
        const actions = el('div', undefined, box); actions.className = 'standard-toolbar';
        const save = el('button', 'Uložit definici', actions); save.type = 'button'; save.id = 'property-definition-save';
        save.onclick = () => { try { const change = editProperty(doc, property.guid, { nameCz: cz.value, nameIfc: ifc.value, type: type.value, ifcType: ifcType.value, unit: unit.value, description: description.value }); if (change.changes.length) apply(change); box.close(); } catch (failure) { error.textContent = failure.message; } };
        const cancel = el('button', 'Zrušit', actions); cancel.type = 'button'; cancel.onclick = () => box.close();
        box.showModal(); return box;
    }
    function removePropertyFromGroups(doc, propertyGuid, groupGuids) {
        const ids = new Set(groupGuids); if (!ids.size) throw new Error('Vyberte skupinu pro odebrání.');
        for (const id of ids) if (!canRemoveProperty(doc, id, propertyGuid)) throw new Error('Původní vlastnosti zdrojové skupiny nelze odebírat.');
        const changes = [];
        const groups = rows(doc, 'GroupsOfProperties').map((group, index) => {
            if (!ids.has(group.guid)) return group;
            const properties = group.properties.filter(id => id !== propertyGuid);
            changes.push({ keyChain: ['data', 'GroupsOfProperties', index, 'properties'], oldValue: group.properties, newValue: properties, action: 'set' });
            return { ...group, properties };
        });
        const metadata = { ...doc.hbhEditor, addedGroupProperties: userLinks(doc).filter(link => !(ids.has(link.groupGuid) && link.propertyGuid === propertyGuid)) };
        changes.push({ keyChain: ['hbhEditor'], oldValue: doc.hbhEditor, newValue: metadata, action: 'set' });
        return { doc: { ...doc, data: { ...doc.data, GroupsOfProperties: groups }, hbhEditor: metadata }, changes, kind: 'groupPropertyRemoval', groupsChanged: ids.size };
    }
    function propertyRemovalPicker(doc, property, groupGuids, apply) {
        const box = dialog('Odebrat vlastnost ze skupiny', 'group-property-remove-dialog');
        el('p', 'Vlastnost: ' + (property.nameCz || property.nameIfc), box);
        el('p', 'Odebrat lze pouze ručně přidaná přiřazení. Zdrojové vazby jsou pevné. Definice vlastnosti a přiřazení v ostatních skupinách zůstanou zachované; změna sdílené skupiny platí pro všechny objekty, které ji používají.', box);
        const selected = new Set(), choices = rows(doc, 'GroupsOfProperties').filter(group => groupGuids.includes(group.guid) && (group.properties || []).includes(property.guid));
        const removable = choices.filter(group => canRemoveProperty(doc, group.guid, property.guid));
        const actions = el('div', undefined, box); actions.className = 'standard-toolbar';
        const save = el('button', 'Odebrat z označených skupin', actions); save.type = 'button'; save.id = 'group-property-remove-save';
        for (const group of choices) {
            const allowed = canRemoveProperty(doc, group.guid, property.guid), label = el('label', undefined, box); label.className = 'group-assignment-choice';
            const check = el('input', undefined, label); check.type = 'checkbox'; check.disabled = !allowed; check.dataset.removeGroupProperty = group.guid;
            if (allowed && removable.length === 1) { check.checked = true; selected.add(group.guid); }
            el('span', `${group.name} · ${group.guid} · ${allowed ? 'Přidané přiřazení' : 'Zdrojová vlastnost – chráněná'}`, label);
            check.onchange = () => { if (check.checked) selected.add(group.guid); else selected.delete(group.guid); save.disabled = !selected.size; };
        }
        save.disabled = !selected.size;
        const error = el('p', '', box); error.className = 'hbh-picker-error'; error.setAttribute('role', 'alert');
        save.onclick = () => { try { apply(removePropertyFromGroups(doc, property.guid, [...selected])); box.close(); } catch (failure) { error.textContent = failure.message; } };
        const cancel = el('button', 'Zrušit', actions); cancel.type = 'button'; cancel.onclick = () => box.close();
        box.showModal(); return box;
    }
    global.DSS_GROUP_LIBRARY = { catalog, readSource, importGroups, createGroup, createPicker, importPicker, assignGroups, assignmentPicker, extendGroup, editProperty, propertyPicker, canRemoveProperty, removePropertyFromGroups, propertyRemovalPicker };
})(window);
