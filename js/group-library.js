(function (global) {
    'use strict';
    const rows = (doc, table) => Array.isArray(doc.data?.[table]) ? doc.data[table] : [];
    const clone = value => JSON.parse(JSON.stringify(value));
    const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const uuid = () => global.crypto?.randomUUID ? global.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16); });
    const refs = { dataType: 'DataTypes', ifcType: 'IfcTypes', unit: 'Units', customEnum: 'CustomEnums' };
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
        catalog(doc); return doc;
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
        const counts = { groups: 0, properties: 0, dependencies: 0, reused: 0 };
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
        let selectedName = '';
        for (const selection of selections) {
            const group = sourceRow('GroupsOfProperties', selection.group), allowed = new Set(group.properties || []);
            const selected = [...new Set(selection.properties || [])]; if (!selected.length) continue;
            if (selected.some(id => !allowed.has(id))) throw new Error('Vybraná vlastnost nepatří do skupiny ' + group.name + '.');
            const imported = { ...clone(group), properties: selected.map(id => copy('Properties', id)) };
            append('GroupsOfProperties', imported); selectedName = group.name || 'Bez názvu skupiny';
        }
        return { doc: changes.length ? { ...target, data } : target, changes, kind: 'groupLibrary', selectedName, counts };
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
        return importGroups(doc, source, [{ group: group.guid, properties: group.properties }]);
    }
    function el(tag, text, parent) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (parent) parent.append(node); return node; }
    function dialog(titleText, id) {
        const box = el('dialog', undefined, document.body); box.id = id; box.className = 'hbh-automation-dialog group-library-dialog';
        const title = el('h2', titleText, box); title.id = id + '-title'; box.setAttribute('aria-labelledby', title.id);
        box.onclose = () => box.remove(); return box;
    }
    function createPicker(doc, apply) {
        const box = dialog('Přidat skupinu vlastností', 'group-create-dialog');
        const label = el('label', 'Název skupiny', box), name = el('input', undefined, box); name.id = 'group-create-name'; label.htmlFor = name.id;
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
        const save = el('button', 'Přidat skupinu', actions); save.id = 'group-create-save'; save.type = 'button';
        save.onclick = () => { try { const change = createGroup(doc, name.value, drafts.map(item => ({ nameCz: item.cz.value, nameIfc: item.ifc.value, type: item.type.value, unit: item.unit.value }))); apply(change); box.close(); } catch (failure) { error.textContent = failure.message; } };
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
    global.DSS_GROUP_LIBRARY = { catalog, readSource, importGroups, createGroup, createPicker, importPicker, assignGroups, assignmentPicker };
})(window);
