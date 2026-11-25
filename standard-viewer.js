(function (global) {
    'use strict';
    const norm = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const rows = (doc, table) => Array.isArray(doc.data?.[table]) ? doc.data[table] : [];
    const objectGroups = obj => obj.loin?.nongraphical?.groupsOfProperties || [];
    const models = new WeakMap();
    function enumValues(row) { return (Array.isArray(row?.enumList) ? row.enumList : Array.isArray(row?.values) ? row.values : []).map(item => item && typeof item === 'object' && Object.hasOwn(item, 'value') ? item.value : item); }
    function summarizeValue(value) {
        if (!value) return '';
        if (value.kind === 'simpleValue') return 'Požadovaná hodnota: ' + value.value;
        const parts = [];
        if (value.enumerations?.length) parts.push('Povolené hodnoty: ' + value.enumerations.slice(0, 8).join(', ') + (value.enumerations.length > 8 ? ` … (${value.enumerations.length})` : ''));
        if (value.patterns?.length) parts.push('Vzor: ' + value.patterns.join(', '));
        for (const item of [...(value.bounds || []), ...(value.lengths || [])]) parts.push(({ minInclusive: 'Minimum včetně', maxInclusive: 'Maximum včetně', minExclusive: 'Více než', maxExclusive: 'Méně než', length: 'Délka', minLength: 'Nejmenší délka', maxLength: 'Největší délka' }[item.name] || item.name) + ': ' + item.value);
        return parts.join(' · ');
    }
    function createModel(doc) {
        if (models.has(doc)) return models.get(doc);
        const tables = Object.fromEntries(Object.keys(doc.data || {}).map(table => [table, new Map(rows(doc, table).map(row => [row.guid, row]))]));
        const get = (table, id) => tables[table]?.get(id);
        const objects = rows(doc, 'DataObjects').map(obj => ({ key: obj.guid, name: obj.nameCz || obj.name || '(bez názvu)', group: obj.groupOfDataObjectsCz || '',
            code: global.DSS_MATCHING?.aspectCodes(obj).join(' · ') || obj.typeAspectCode || '', row: obj }));
        objects.forEach(item => { item.search = norm([item.name, item.group, item.code].join(' ')); });
        const details = new Map();
        function objectDetail(guid) {
            if (details.has(guid)) return details.get(guid);
            const obj = get('DataObjects', guid); if (!obj) return null;
            const metadata = [obj.ids, ...(obj.idsMappings || [])].filter(Boolean), scoped = new Map();
            const explicitScope = metadata.some(item => Array.isArray(item.propertyRules));
            for (const entry of metadata) for (const rule of entry.propertyRules || []) {
                if (!scoped.has(rule.property)) scoped.set(rule.property, []);
                scoped.get(rule.property).push({ ...rule, specification: entry.name || entry.identifier || '' });
            }
            const seen = new Set(), groups = [];
            for (const id of objectGroups(obj)) {
                const group = get('GroupsOfProperties', id); if (!group) continue;
                const items = (group.properties || []).map(id => get('Properties', id)).filter(Boolean).map(property => {
                    seen.add(property.guid);
                    const fallback = !explicitScope && property.ids?.requirement ? [{ property: property.guid, propertySet: property.ids.propertySet, requirement: property.ids.requirement }] : [];
                    return { property, rules: scoped.get(property.guid) || fallback };
                });
                groups.push({ name: group.name || 'Bez názvu skupiny', row: group, items });
            }
            const extra = [...scoped.keys()].filter(id => !seen.has(id)).map(id => get('Properties', id)).filter(Boolean).map(property => ({ property, rules: scoped.get(property.guid) }));
            if (extra.length) groups.push({ name: 'Další požadované vlastnosti IDS', items: extra });
            const result = { row: obj, groups, propertyCount: new Set(groups.flatMap(g => g.items.map(i => i.property.guid))).size, metadata };
            details.set(guid, result); return result;
        }
        let groupCatalog, enums;
        function groupsCatalog() {
            if (groupCatalog) return groupCatalog;
            const grouped = new Map();
            for (const group of rows(doc, 'GroupsOfProperties')) {
                const name = group.name || 'Bez názvu skupiny';
                if (!grouped.has(name)) grouped.set(name, { key: name, name, group: '', members: [], properties: new Set(), objects: new Set(), search: norm(name) });
                const entry = grouped.get(name); entry.members.push(group);
                for (const id of group.properties || []) if (get('Properties', id)) entry.properties.add(id);
            }
            for (const obj of objects) for (const id of objectGroups(obj.row)) {
                const group = get('GroupsOfProperties', id); if (group) grouped.get(group.name || 'Bez názvu skupiny')?.objects.add(obj.key);
            }
            groupCatalog = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, 'cs')); return groupCatalog;
        }
        function enumsCatalog() {
            if (enums) return enums;
            const used = new Map();
            for (const p of rows(doc, 'Properties')) if (p.customEnum) { if (!used.has(p.customEnum)) used.set(p.customEnum, new Set()); used.get(p.customEnum).add(p.nameCz || p.nameIfc); }
            enums = rows(doc, 'CustomEnums').map(row => {
                const names = [...(used.get(row.guid) || [])].filter(Boolean), name = row.name || names.slice(0, 3).join(', ') || 'Číselník hodnot';
                return { key: row.guid, name, group: '', row, names, search: norm([name, ...names].join(' ')) };
            }); return enums;
        }
        const result = { doc, objects, get, objectDetail, groupsCatalog, enumsCatalog };
        models.set(doc, result); return result;
    }
    function el(tag, text, parent) {
        const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (parent) parent.append(node); return node;
    }
    function technical(parent, title, value) {
        const box = el('details', undefined, parent); el('summary', title, box);
        let loaded = false;
        box.ontoggle = () => { if (box.open && !loaded) { el('pre', JSON.stringify(value, null, 2), box); loaded = true; } };
    }
    function automationCatalog(documents) {
        const found = new Map();
        for (const item of global.DSS_HBH_AUTOMATIONS?.entries || []) found.set(item.command, new Set());
        for (const doc of documents) for (const p of rows(doc, 'Properties')) for (const command of global.DSS_MODEL.hbhCommands(p)) {
            if (!found.has(command)) found.set(command, new Set());
            found.get(command).add(p.nameCz || p.nameIfc || '(bez názvu)');
        }
        return [...found].map(([command, properties]) => ({ command, properties: [...properties], label: global.DSS_HBH_AUTOMATIONS?.label(command) || [...properties][0] || command,
            hint: global.DSS_HBH_AUTOMATIONS?.hint(command) || 'Výstup tohoto příkazu není v knihovně popsán.' }))
            .sort((a, b) => a.label.localeCompare(b.label, 'cs') || a.command.localeCompare(b.command));
    }
    function setAutomation(doc, guid, command) {
        const index = rows(doc, 'Properties').findIndex(p => p.guid === guid);
        if (index < 0) throw new Error('Vlastnost už ve standardu není. Obnovte pohled.');
        const original = doc.data.Properties[index], fields = Object.keys(original).filter(key => key.toLowerCase() === 'namehbh');
        const field = fields[0] || 'nameHBH', value = String(command || '').trim();
        const next = { ...original }; for (const key of fields) delete next[key];
        if (value) next[field] = Array.isArray(original[field]) ? [value] : value;
        const changes = [...new Set([...fields, ...(value ? [field] : [])])].filter(key => JSON.stringify(original[key]) !== JSON.stringify(next[key])).map(key => ({
            keyChain: ['data', 'Properties', index, key], oldValue: original[key] ?? null, newValue: next[key] ?? null,
            action: Object.hasOwn(next, key) ? 'set' : 'remove'
        }));
        if (!changes.length) return { doc, changes, propertyGuid: guid, propertyName: original.nameCz || original.nameIfc };
        const properties = doc.data.Properties.slice(); properties[index] = next;
        return { doc: { ...doc, data: { ...doc.data, Properties: properties } }, changes, propertyGuid: guid, propertyName: original.nameCz || original.nameIfc };
    }
    function setTypeAspect(doc, guid, code) {
        const index = rows(doc, 'DataObjects').findIndex(object => object.guid === guid);
        if (index < 0) throw new Error('Datový objekt už ve standardu není. Obnovte pohled.');
        const original = doc.data.DataObjects[index], value = String(code ?? '').trim();
        if (original.typeAspectCode === value || (!Object.hasOwn(original, 'typeAspectCode') && !value)) return { doc, changes: [], kind: 'typeAspect' };
        const objects = doc.data.DataObjects.slice();
        objects[index] = { ...original, typeAspectCode: value };
        return {
            doc: { ...doc, data: { ...doc.data, DataObjects: objects } }, kind: 'typeAspect',
            changes: [{ keyChain: ['data', 'DataObjects', index, 'typeAspectCode'], oldValue: original.typeAspectCode ?? null, newValue: value, action: 'set' }]
        };
    }
    function addEnumeration(doc, name, text) {
        name = String(name || '').trim();
        const values = Array.isArray(text) ? text : [...new Set(String(text || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
        if (!name) throw new Error('Zadejte název číselníku.');
        if (!values.length) throw new Error('Zadejte alespoň jednu hodnotu, každou na samostatný řádek.');
        if (rows(doc, 'CustomEnums').some(row => norm(row.name) === norm(name))) throw new Error('Číselník s tímto názvem už existuje. Zvolte jiný název.');
        const guid = global.crypto?.randomUUID ? global.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16); });
        const existing = rows(doc, 'CustomEnums');
        const row = existing.some(item => Array.isArray(item.enumList))
            ? { guid, name, enumList: values.map(value => ({ value })) }
            : { guid, name, values };
        return { doc: { ...doc, data: { ...doc.data, CustomEnums: [...existing, row] } }, kind: 'enumeration', enumGuid: guid,
            changes: [{ keyChain: ['data', 'CustomEnums', existing.length], oldValue: null, newValue: row, action: 'set' }] };
    }
    function editEnumeration(doc, guid, name, values) {
        const index = rows(doc, 'CustomEnums').findIndex(row => row.guid === guid);
        if (index < 0) throw new Error('Číselník už ve standardu není. Otevřete přehled znovu.');
        name = String(name || '').trim();
        if (!name) throw new Error('Zadejte název číselníku.');
        if (!Array.isArray(values) || !values.length) throw new Error('Zadejte alespoň jednu hodnotu.');
        const original = doc.data.CustomEnums[index], next = { ...original, name };
        // Reuse entry metadata for retained values, including enumList wrappers.
        const field = Array.isArray(original.enumList) ? 'enumList' : 'values';
        const oldValues = enumValues(original), used = new Set();
        next[field] = values.map(value => {
            const found = oldValues.findIndex((old, i) => !used.has(i) && JSON.stringify(old) === JSON.stringify(value));
            if (found >= 0) { used.add(found); return original[field][found]; }
            return field === 'enumList' ? { value } : value;
        });
        // When both aliases exist keep them consistent instead of leaving stale values.
        if (Array.isArray(original.enumList) && Array.isArray(original.values)) next.values = values;
        const changes = Object.keys(next).filter(key => JSON.stringify(original[key]) !== JSON.stringify(next[key])).map(key => ({
            keyChain: ['data', 'CustomEnums', index, key], oldValue: original[key] ?? null, newValue: next[key], action: 'set'
        }));
        const enums = rows(doc, 'CustomEnums').slice(); enums[index] = next;
        return { doc: changes.length ? { ...doc, data: { ...doc.data, CustomEnums: enums } } : doc, changes, kind: 'enumeration', enumGuid: guid };
    }
    function exportEnumerations(doc, guids) {
        const selected = guids ? new Set(guids) : null;
        return { format: 'DSS-CustomEnums', version: 1, CustomEnums: rows(doc, 'CustomEnums').filter(row => !selected || selected.has(row.guid)) };
    }
    function readEnumerations(payload) {
        if (typeof payload === 'string') payload = JSON.parse(payload);
        const items = Array.isArray(payload) ? payload : payload?.CustomEnums ?? payload?.data?.CustomEnums;
        if (!Array.isArray(items) || !items.length) throw new Error('Soubor neobsahuje číselníky (CustomEnums).');
        const seen = new Set();
        for (const [index, row] of items.entries()) {
            if (!row || typeof row !== 'object' || typeof row.guid !== 'string' || !row.guid.trim() || (!Array.isArray(row.enumList) && !Array.isArray(row.values)))
                throw new Error(`Číselník na řádku ${index + 1} nemá GUID nebo seznam hodnot.`);
            if (seen.has(row.guid)) throw new Error('Soubor obsahuje více číselníků se stejným GUID: ' + row.guid);
            seen.add(row.guid);
        }
        return items;
    }
    function importEnumerations(doc, payload, selectedGuids, replace = false) {
        const incoming = readEnumerations(payload), selected = new Set(selectedGuids);
        const enums = rows(doc, 'CustomEnums').slice(), changes = [];
        let added = 0, replaced = 0, skipped = 0;
        for (const row of incoming) {
            if (!selected.has(row.guid)) continue;
            const index = enums.findIndex(item => item.guid === row.guid);
            if (index >= 0 && !replace) { skipped++; continue; }
            const next = JSON.parse(JSON.stringify(row)), position = index < 0 ? enums.length : index;
            if (index >= 0 && JSON.stringify(enums[index]) === JSON.stringify(next)) { skipped++; continue; }
            changes.push({ keyChain: ['data', 'CustomEnums', position], oldValue: index < 0 ? null : enums[index], newValue: next, action: 'set' });
            if (index < 0) { enums.push(next); added++; } else { enums[index] = next; replaced++; }
        }
        return { doc: changes.length ? { ...doc, data: { ...doc.data, CustomEnums: enums } } : doc, changes, kind: 'enumerationImport', added, replaced, skipped };
    }
    function downloadEnumerations(doc, guids) {
        const payload = exportEnumerations(doc, guids);
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const link = el('a', undefined, document.body); link.href = url; link.download = guids ? 'ciselnik.json' : 'knihovna-ciselniku.json';
        link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function enumerationImportPicker(doc, payload, apply) {
        const incoming = readEnumerations(payload), existing = new Map(rows(doc, 'CustomEnums').map(row => [row.guid, row]));
        const selected = new Set();
        const dialog = el('dialog', undefined, document.body); dialog.id = 'standard-enum-import-dialog'; dialog.className = 'hbh-automation-dialog';
        const title = el('h2', 'Vybrat číselníky pro import', dialog); title.id = 'standard-enum-import-title'; dialog.setAttribute('aria-labelledby', title.id);
        el('p', 'Do projektu se přidají pouze zaškrtnuté číselníky. Stejný název s jiným GUID znamená samostatný číselník.', dialog);
        const search = el('input', undefined, dialog); search.type = 'search'; search.placeholder = 'Hledat číselník'; search.setAttribute('aria-label', 'Hledat číselník k importu');
        const actions = el('div', undefined, dialog); actions.className = 'standard-toolbar';
        const selectAll = el('button', 'Vybrat nalezené', actions), clear = el('button', 'Zrušit výběr', actions);
        const list = el('div', undefined, dialog); list.className = 'hbh-automation-list';
        const replaceLabel = el('label', undefined, dialog), replace = el('input', undefined, replaceLabel); replace.type = 'checkbox'; replace.id = 'standard-enum-import-replace';
        el('span', ' Nahradit vybrané číselníky se stejným GUID (projeví se u všech navázaných vlastností)', replaceLabel);
        const summary = el('p', '', dialog); summary.setAttribute('role', 'status');
        const error = el('p', '', dialog); error.className = 'hbh-picker-error'; error.setAttribute('role', 'alert');
        const footer = el('div', undefined, dialog); footer.className = 'standard-toolbar';
        const save = el('button', 'Importovat vybrané', footer); save.id = 'standard-enum-import-save';
        const cancel = el('button', 'Zrušit', footer); cancel.onclick = () => dialog.close();
        function matches() { return incoming.filter(row => norm(row.name || row.guid).includes(norm(search.value))); }
        function update() {
            const preview = importEnumerations(doc, incoming, [...selected], replace.checked);
            summary.textContent = `Vybráno ${selected.size} z ${incoming.length} · přidat ${preview.added} · nahradit ${preview.replaced} · ponechat ${preview.skipped}`;
            save.disabled = !preview.changes.length;
        }
        function draw() {
            list.replaceChildren();
            for (const row of matches()) {
                const label = el('label', undefined, list); label.className = 'enum-import-option';
                const check = el('input', undefined, label); check.type = 'checkbox'; check.dataset.enumGuid = row.guid; check.checked = selected.has(row.guid);
                check.onchange = () => { if (check.checked) selected.add(row.guid); else selected.delete(row.guid); update(); };
                const description = el('span', undefined, label); el('strong', row.name || row.guid, description);
                el('small', `${enumValues(row).length} hodnot · ${existing.has(row.guid) ? 'Shodné GUID v projektu' : 'Nový číselník'}`, description);
            }
            if (!list.children.length) el('p', 'Žádný číselník neodpovídá hledání.', list);
            update();
        }
        search.oninput = draw; replace.onchange = update;
        selectAll.onclick = () => { matches().forEach(row => selected.add(row.guid)); draw(); };
        clear.onclick = () => { selected.clear(); draw(); };
        save.onclick = () => { try { const change = importEnumerations(doc, incoming, [...selected], replace.checked); if (change.changes.length) apply(change); dialog.close(); } catch (failure) { error.textContent = failure.message; } };
        draw(); dialog.onclose = () => dialog.remove(); dialog.showModal(); return dialog;
    }
    function removeEnumeration(doc, guid) {
        const existing = rows(doc, 'CustomEnums');
        if (existing.filter(row => row.guid === guid).length !== 1) throw new Error('Číselník chybí nebo nemá jednoznačné GUID. Otevřete přehled znovu.');
        const enums = existing.filter(row => row.guid !== guid);
        const changes = [{ keyChain: ['data', 'CustomEnums'], oldValue: existing, newValue: enums, action: 'set' }];
        let unlinked = 0;
        const properties = rows(doc, 'Properties').map((property, index) => {
            if (property.customEnum !== guid) return property;
            const next = { ...property }; delete next.customEnum; unlinked++;
            changes.push({ keyChain: ['data', 'Properties', index, 'customEnum'], oldValue: guid, newValue: null, action: 'remove' });
            return next;
        });
        return { doc: { ...doc, data: { ...doc.data, CustomEnums: enums, ...(unlinked ? { Properties: properties } : {}) } }, changes, kind: 'enumerationRemoval', unlinked };
    }
    function enumerationRemovalPicker(doc, enumeration, apply) {
        const users = rows(doc, 'Properties').filter(property => property.customEnum === enumeration.guid);
        const box = el('dialog', undefined, document.body); box.id = 'standard-enum-remove-dialog'; box.className = 'hbh-automation-dialog';
        const title = el('h2', 'Odstranit číselník', box); title.id = 'standard-enum-remove-title'; box.setAttribute('aria-labelledby', title.id);
        el('p', 'Číselník: ' + (enumeration.name || enumeration.guid), box);
        el('p', users.length ? `Číselník používá ${users.length} vlastností. Odstraněním se zruší i jejich přiřazení k tomuto číselníku. Vlastnosti a jejich výchozí hodnoty zůstanou zachované.` : 'Tento číselník nepoužívá žádná vlastnost. Odstraní se z knihovny standardu.', box);
        if (users.length) {
            const list = el('ul', undefined, box); list.className = 'enum-removal-usage';
            for (const property of users) el('li', (property.nameCz || property.nameIfc || '(bez názvu)') + ' · ' + property.guid, list);
        }
        const error = el('p', '', box); error.className = 'hbh-picker-error'; error.setAttribute('role', 'alert');
        const actions = el('div', undefined, box); actions.className = 'standard-toolbar';
        const remove = el('button', users.length ? 'Odstranit číselník a zrušit přiřazení' : 'Odstranit číselník', actions); remove.id = 'standard-enum-remove-confirm'; remove.type = 'button'; remove.className = 'enum-remove-button';
        remove.onclick = () => { try { apply(removeEnumeration(doc, enumeration.guid)); box.close(); } catch (failure) { error.textContent = failure.message; } };
        const cancel = el('button', 'Zrušit', actions); cancel.type = 'button'; cancel.onclick = () => box.close();
        box.onclose = () => box.remove(); box.showModal(); return box;
    }
    function enumerationPicker(doc, apply, current) {
        const dialog = el('dialog', undefined, document.body); dialog.className = 'hbh-automation-dialog'; dialog.id = 'standard-enum-dialog';
        const title = el('h2', current ? 'Upravit číselník' : 'Přidat vlastní číselník', dialog); title.id = 'standard-enum-title'; dialog.setAttribute('aria-labelledby', title.id);
        const label = el('label', 'Název číselníku', dialog), name = el('input', undefined, dialog);
        name.id = 'standard-enum-name'; label.htmlFor = name.id; name.type = 'text';
        name.value = current?.name || '';
        const originalValues = current ? enumValues(current) : [];
        const displayValue = value => typeof value === 'string' && !/[\r\n]/.test(value) ? value : JSON.stringify(value);
        const originalLines = originalValues.map(displayValue);
        const valuesLabel = el('label', 'Hodnoty — každá na samostatný řádek', dialog), values = el('textarea', undefined, dialog);
        values.id = 'standard-enum-values'; valuesLabel.htmlFor = values.id; values.rows = 10; values.style = 'width:100%;box-sizing:border-box';
        values.value = originalLines.join('\n');
        el('p', current ? 'Úprava platí pro všechny vlastnosti používající tento číselník. GUID a vazby zůstanou zachované. Výchozí hodnoty vlastností se nemění.' : 'Prázdné řádky a opakované hodnoty se v textovém zápisu vynechají. Číselník se přidá do knihovny standardu.', dialog);
        const error = el('p', '', dialog); error.className = 'hbh-picker-error'; error.setAttribute('role', 'alert');
        const actions = el('div', undefined, dialog); actions.className = 'standard-toolbar';
        const save = el('button', current ? 'Uložit změny' : 'Přidat číselník', actions); save.type = 'button'; save.id = 'standard-enum-save';
        save.onclick = () => { try {
            // Retained entries keep their original types; new entries are text.
            // Do not infer numbers: a code such as "001" must remain a string.
            const used = new Set(), seen = new Set();
            const parsed = values.value === originalLines.join('\n') ? originalValues : values.value.split(/\r?\n/).flatMap(line => {
                const index = originalLines.findIndex((original, i) => !used.has(i) && original === line);
                if (index >= 0) { used.add(index); seen.add(JSON.stringify(originalValues[index])); return [originalValues[index]]; }
                const text = line.trim(); if (!text || seen.has(JSON.stringify(text))) return [];
                seen.add(JSON.stringify(text)); return [text];
            });
            const change = current ? editEnumeration(doc, current.guid, name.value, parsed) : addEnumeration(doc, name.value, parsed);
            if (change.changes.length) apply(change); dialog.close();
        } catch (failure) { error.textContent = failure.message; } };
        const cancel = el('button', 'Zrušit', actions); cancel.type = 'button'; cancel.onclick = () => dialog.close();
        dialog.onclose = () => dialog.remove(); dialog.showModal(); return dialog;
    }
    function setPropertyEnumeration(doc, guid, enumGuid) {
        const index = rows(doc, 'Properties').findIndex(row => row.guid === guid);
        if (index < 0) throw new Error('Vlastnost už ve standardu není. Otevřete přehled znovu.');
        if (enumGuid && !rows(doc, 'CustomEnums').some(row => row.guid === enumGuid)) throw new Error('Vybraný číselník není v tomto standardu. Nejprve jej přidejte nebo importujte.');
        const original = doc.data.Properties[index], next = { ...original };
        if (enumGuid) next.customEnum = enumGuid; else delete next.customEnum;
        const changes = JSON.stringify(original) === JSON.stringify(next) ? [] : [{ keyChain: ['data', 'Properties', index, 'customEnum'],
            oldValue: original.customEnum ?? null, newValue: next.customEnum ?? null, action: enumGuid ? 'set' : 'remove' }];
        const properties = rows(doc, 'Properties').slice(); properties[index] = next;
        return { doc: changes.length ? { ...doc, data: { ...doc.data, Properties: properties } } : doc, changes, kind: 'propertyEnumeration', propertyGuid: guid };
    }
    function propertyEnumerationPicker(doc, property, apply) {
        const catalog = createModel(doc).enumsCatalog();
        let selected = property.customEnum || '', limit = 60;
        const dialog = el('dialog', undefined, document.body); dialog.id = 'property-enum-dialog'; dialog.className = 'hbh-automation-dialog';
        const title = el('h2', 'Vybrat číselník — ' + (property.nameCz || property.nameIfc), dialog); title.id = 'property-enum-title'; dialog.setAttribute('aria-labelledby', title.id);
        el('p', 'Přiřazení platí pro všechny objekty používající tuto vlastnost. Výchozí hodnoty zůstanou zachované.', dialog);
        const searchLabel = el('label', 'Hledat číselník podle názvu, hodnoty nebo použití', dialog), search = el('input', undefined, dialog);
        search.id = 'property-enum-search'; searchLabel.htmlFor = search.id; search.type = 'search';
        const selection = el('p', '', dialog); selection.setAttribute('role', 'status');
        const list = el('div', undefined, dialog); list.className = 'hbh-automation-list';
        const preview = el('div', undefined, dialog);
        function drawSelection() {
            const item = catalog.find(item => item.key === selected);
            selection.textContent = item ? 'Vybraný číselník: ' + item.name : selected ? 'Současný odkaz nemá definici v tomto standardu. Vyberte číselník nebo přiřazení odeberte.' : 'Bez číselníku';
            preview.replaceChildren();
            if (item) {
                const box = el('details', undefined, preview); el('summary', `Náhled hodnot (${enumValues(item.row).length})`, box);
                let loaded = false; box.ontoggle = () => { if (box.open && !loaded) { renderPickerValues(box, enumValues(item.row)); loaded = true; } };
            }
            for (const button of list.children) if (button.dataset.enumGuid) button.setAttribute('aria-pressed', String(button.dataset.enumGuid === selected));
        }
        // Keep large enumerations out of the DOM until their preview is opened.
        function renderPickerValues(parent, values) {
            const ul = el('ul', undefined, parent); let shown = 0;
            const more = el('button', 'Dalších 100 hodnot', parent); more.type = 'button';
            const draw = () => { for (const value of values.slice(shown, shown + 100)) el('li', typeof value === 'object' ? JSON.stringify(value) : String(value), ul); shown += 100; more.hidden = shown >= values.length; };
            more.onclick = draw; draw();
        }
        const searchable = catalog.map(item => ({ item, text: item.search + ' ' + norm(item.key) + ' ' + norm(enumValues(item.row).map(value => typeof value === 'object' ? JSON.stringify(value) : String(value)).join(' ')) }));
        function draw() {
            list.replaceChildren();
            const found = searchable.filter(entry => entry.text.includes(norm(search.value)));
            for (const { item } of found.slice(0, limit)) {
                const button = el('button', undefined, list); button.type = 'button'; button.className = 'hbh-automation-option'; button.dataset.enumGuid = item.key;
                el('strong', item.name, button); el('small', `${enumValues(item.row).length} hodnot · ${item.key}`, button);
                if (item.names.length) el('small', 'Použití: ' + item.names.join(', '), button);
                button.onclick = () => { selected = item.key; drawSelection(); };
            }
            if (!found.length) el('p', catalog.length ? 'Žádný číselník neodpovídá hledání.' : 'Standard nemá číselníky. Přidejte nebo importujte je v záložce Číselníky hodnot.', list);
            if (found.length > limit) { const more = el('button', 'Dalších 60 číselníků', list); more.type = 'button'; more.onclick = () => { limit += 60; draw(); }; }
            drawSelection();
        }
        const error = el('p', '', dialog); error.className = 'hbh-picker-error'; error.setAttribute('role', 'alert');
        const actions = el('div', undefined, dialog); actions.className = 'standard-toolbar';
        const save = el('button', 'Uložit přiřazení', actions); save.type = 'button'; save.id = 'property-enum-save';
        save.onclick = () => { try { const change = setPropertyEnumeration(doc, property.guid, selected); if (change.changes.length) apply(change); dialog.close(); } catch (failure) { error.textContent = failure.message; } };
        const remove = el('button', 'Odebrat číselník', actions); remove.type = 'button'; remove.onclick = () => { selected = ''; drawSelection(); };
        const cancel = el('button', 'Zrušit', actions); cancel.type = 'button'; cancel.onclick = () => dialog.close();
        search.oninput = () => { limit = 60; draw(); }; draw();
        dialog.onclose = () => dialog.remove(); dialog.showModal(); return dialog;
    }
    function automationPicker(doc, property, library, apply) {
        const dialog = el('dialog', undefined, document.body); dialog.id = 'hbh-automation-dialog'; dialog.className = 'hbh-automation-dialog';
        const title = el('h2', 'Vybrat automat — ' + (property.nameCz || property.nameIfc), dialog); title.id = 'hbh-automation-title'; dialog.setAttribute('aria-labelledby', title.id);
        el('p', 'Přiřazení patří definici vlastnosti a projeví se ve všech objektech, které ji používají.', dialog);
        const current = global.DSS_MODEL.hbhCommands(property);
        if (current.length > 1) el('p', 'Současná přiřazení: ' + current.join(', ') + '. Uložením zvolíte jeden automat.', dialog);
        const inputLabel = el('label', 'HBHBIM příkaz (lze zadat i nový)', dialog), input = el('input', undefined, dialog);
        input.id = 'hbh-command-input'; inputLabel.htmlFor = input.id; input.type = 'text'; input.value = current[0] || ''; input.autocomplete = 'off';
        const selectedHint = el('p', '', dialog); selectedHint.id = 'hbh-command-hint'; selectedHint.className = 'hbh-automation-hint'; selectedHint.setAttribute('role', 'status');
        input.setAttribute('aria-describedby', selectedHint.id);
        function updateHint() {
            const command = input.value.trim();
            selectedHint.textContent = command ? global.DSS_HBH_AUTOMATIONS?.hint(command) || library.find(item => item.command === command)?.hint || 'Výstup tohoto příkazu není v knihovně popsán.' : 'Vyberte automat a zobrazí se, jakou hodnotu vyplní.';
        }
        input.oninput = updateHint; updateHint();
        const searchLabel = el('label', 'Hledat automat podle českého názvu nebo kódu', dialog), search = el('input', undefined, dialog);
        search.id = 'hbh-command-search'; search.type = 'search'; searchLabel.htmlFor = search.id;
        const list = el('div', undefined, dialog); list.className = 'hbh-automation-list';
        let limit = 80;
        function draw() {
            list.replaceChildren();
            const matches = library.filter(item => norm([item.label, item.command, ...item.properties].join(' ')).includes(norm(search.value)));
            for (const item of matches.slice(0, limit)) {
                const button = el('button', undefined, list); button.type = 'button'; button.className = 'hbh-automation-option';
                button.dataset.command = item.command; button.setAttribute('aria-pressed', String(item.command === input.value));
                el('strong', item.label || item.properties.join(', ') || item.command, button);
                el('code', item.command, button);
                if (item.hint) el('small', item.hint, button).className = 'hbh-automation-hint';
                if (item.properties.length && item.properties.join(', ') !== item.label) el('small', 'Použití: ' + item.properties.join(', '), button);
                button.onclick = () => { input.value = item.command; updateHint(); for (const option of list.children) if (option.dataset.command) option.setAttribute('aria-pressed', String(option.dataset.command === item.command)); };
            }
            if (!matches.length) el('p', 'Žádný příkaz neodpovídá hledání. Můžete ho zadat ručně výše.', list);
            if (matches.length > limit) {
                const more = el('button', `Zobrazit další automaty (${matches.length - limit})`, list); more.type = 'button';
                more.onclick = () => { limit += 80; draw(); };
            }
        }
        search.oninput = () => { limit = 80; draw(); }; draw();
        const error = el('p', '', dialog); error.setAttribute('role', 'alert'); error.className = 'hbh-picker-error';
        const actions = el('div', undefined, dialog); actions.className = 'standard-toolbar';
        const save = el('button', 'Uložit přiřazení', actions); save.type = 'button'; save.id = 'hbh-command-save';
        save.onclick = () => {
            try { const change = setAutomation(doc, property.guid, input.value); if (change.changes.length) apply(change); dialog.close(); }
            catch (failure) { error.textContent = failure.message; }
        };
        const remove = el('button', 'Odebrat automat', actions); remove.type = 'button'; remove.onclick = () => { input.value = ''; updateHint(); };
        const cancel = el('button', 'Zrušit', actions); cancel.type = 'button'; cancel.onclick = () => dialog.close();
        el('p', 'Změny se použijí až tlačítkem Uložit přiřazení. Upravený standard pak stáhnete jako JSON.', dialog);
        dialog.onclose = () => dialog.remove(); dialog.showModal(); return dialog;
    }
    function renderEmpty(root) {
        root.replaceChildren();
        const tabs = el('div', undefined, root); tabs.className = 'standard-tabs';
        for (const [mode, text] of [['objects', 'Objekty → požadované vlastnosti'], ['groups', 'Skupiny → vlastnosti'], ['enums', 'Číselníky hodnot']]) {
            const button = el('button', text, tabs); button.id = 'standard-tab-' + mode; button.disabled = true;
        }
        el('p', 'Načtěte soubor a zvolte DSS1, DSS2 nebo výsledek pro prohlížení a úpravy.', root);
    }
    function render(root, doc, options = {}) {
        const model = createModel(doc);
        const state = { mode: 'objects', selected: '', query: '', group: '', page: 0, detailQueries: {}, openGroups: {}, ...(options.viewState || {}) };
        root.replaceChildren();
        const tabs = el('div', undefined, root); tabs.className = 'standard-tabs';
        const status = el('p', [options.label || 'Standard', options.notice].filter(Boolean).join(' · '), root); status.className = 'standard-status'; status.setAttribute('role', 'status');
        const layout = el('div', undefined, root); layout.className = 'standard-layout';
        const sidebar = el('div', undefined, layout); sidebar.className = 'standard-sidebar';
        const searchLabel = el('label', 'Hledat objekt', sidebar), search = el('input', undefined, sidebar); search.type = 'search'; search.id = 'standard-search'; searchLabel.htmlFor = search.id;
        search.value = state.query;
        const groupLabel = el('label', 'Skupina objektů', sidebar), groupFilter = el('select', undefined, sidebar); groupFilter.id = 'standard-group-filter'; groupLabel.htmlFor = groupFilter.id;
        const count = el('p', '', sidebar), list = el('div', undefined, sidebar); list.className = 'standard-list';
        const pagination = el('div', undefined, sidebar); pagination.className = 'matching-pagination';
        const detail = el('div', undefined, layout); detail.className = 'standard-detail';
        const tabButtons = new Map();
        const addEnum = el('button', '＋ Přidat vlastní číselník', sidebar); addEnum.type = 'button'; addEnum.id = 'standard-enum-add';
        addEnum.disabled = typeof options.onChange !== 'function';
        addEnum.onclick = () => enumerationPicker(doc, change => {
            state.mode = 'enums'; state.selected = change.enumGuid; state.query = ''; state.group = ''; state.page = 0;
            options.onChange(change.doc, change);
        });
        const exportEnums = el('button', 'Exportovat knihovnu číselníků', sidebar); exportEnums.type = 'button'; exportEnums.id = 'standard-enum-export';
        exportEnums.disabled = !rows(doc, 'CustomEnums').length; exportEnums.onclick = () => downloadEnumerations(doc);
        const importEnums = el('button', 'Importovat číselníky…', sidebar); importEnums.type = 'button'; importEnums.id = 'standard-enum-import';
        importEnums.disabled = typeof options.onChange !== 'function';
        const importFile = el('input', undefined, sidebar); importFile.type = 'file'; importFile.accept = '.json,application/json'; importFile.hidden = true;
        const importError = el('p', '', sidebar); importError.className = 'hbh-picker-error'; importError.setAttribute('role', 'alert');
        importEnums.onclick = () => { importFile.value = ''; importFile.click(); };
        importFile.onchange = async () => {
            const file = importFile.files?.[0]; if (!file) return;
            try {
                const incoming = readEnumerations(await file.text()); importError.textContent = '';
                enumerationImportPicker(doc, incoming, change => {
                    state.mode = 'enums'; state.query = ''; state.group = ''; state.page = 0;
                    options.onChange(change.doc, change);
                });
            } catch (failure) { importError.textContent = 'Import číselníků: ' + failure.message; }
        };
        const groupActions = el('div', undefined, sidebar); groupActions.className = 'group-library-actions';
        const applyGroups = change => {
            state.mode = 'groups'; state.selected = change.selectedName; state.query = ''; state.group = ''; state.page = 0;
            options.onChange(change.doc, change);
        };
        const addGroup = el('button', '＋ Přidat skupinu a vlastnosti', groupActions); addGroup.type = 'button'; addGroup.id = 'standard-group-add';
        addGroup.disabled = typeof options.onChange !== 'function'; addGroup.onclick = () => global.DSS_GROUP_LIBRARY.createPicker(doc, applyGroups);
        const importGroups = el('button', 'Importovat skupiny z JSON / IDS…', groupActions); importGroups.type = 'button'; importGroups.id = 'standard-group-import';
        importGroups.disabled = typeof options.onChange !== 'function'; importGroups.onclick = () => global.DSS_GROUP_LIBRARY.importPicker(doc, applyGroups);
        const objectActions = el('div', undefined, sidebar);
        const assignGroups = el('button', 'Přiřadit skupiny objektům…', objectActions); assignGroups.type = 'button'; assignGroups.id = 'standard-object-assign-groups';
        assignGroups.disabled = typeof options.onChange !== 'function' || !model.objects.length;
        assignGroups.onclick = () => global.DSS_GROUP_LIBRARY.assignmentPicker(doc, state.selected, change => {
            state.detailQueries['objects|' + state.selected] = '';
            options.onChange(change.doc, change);
        });
        for (const [mode, text] of [['objects', 'Objekty → požadované vlastnosti'], ['groups', 'Skupiny → vlastnosti'], ['enums', 'Číselníky hodnot']]) {
            const button = el('button', text, tabs); button.id = 'standard-tab-' + mode; tabButtons.set(mode, button);
            button.onclick = () => { state.mode = mode; state.selected = ''; state.query = ''; state.group = ''; state.page = 0; search.value = ''; setup(); };
        }
        function catalog() { return state.mode === 'objects' ? model.objects : state.mode === 'groups' ? model.groupsCatalog() : model.enumsCatalog(); }
        function setup() {
            addEnum.hidden = state.mode !== 'enums';
            groupActions.hidden = state.mode !== 'groups';
            objectActions.hidden = state.mode !== 'objects';
            exportEnums.hidden = importEnums.hidden = importError.hidden = state.mode !== 'enums';
            for (const [mode, button] of tabButtons) button.setAttribute('aria-pressed', String(mode === state.mode));
            searchLabel.textContent = state.mode === 'objects' ? 'Hledat objekt nebo CCI kód' : state.mode === 'groups' ? 'Hledat skupinu' : 'Hledat číselník';
            groupLabel.hidden = groupFilter.hidden = state.mode !== 'objects'; groupFilter.replaceChildren();
            el('option', 'Všechny skupiny objektů', groupFilter).value = '';
            if (state.mode === 'objects') for (const group of [...new Set(model.objects.map(x => x.group))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'cs'))) el('option', group, groupFilter).value = group;
            groupFilter.value = state.group;
            drawList();
        }
        function drawList() {
            const found = catalog().filter(item => (!state.group || item.group === state.group) && item.search.includes(norm(state.query)));
            state.page = Math.min(state.page, Math.max(0, Math.ceil(found.length / 60) - 1));
            if (!found.some(item => item.key === state.selected)) { state.selected = found[0]?.key || ''; drawDetail(); }
            list.replaceChildren(); pagination.replaceChildren(); count.textContent = `${found.length} položek`;
            for (const item of found.slice(state.page * 60, (state.page + 1) * 60)) {
                const button = el('button', undefined, list); button.type = 'button'; button.className = 'standard-item'; button.dataset.standardKey = item.key;
                button.setAttribute('aria-pressed', String(item.key === state.selected));
                el('strong', item.name, button);
                if (item.code) el('span', item.code, button).className = 'matching-aspect-code';
                if (item.group) el('small', item.group, button);
                if (state.mode === 'groups') el('small', `${item.properties.size} vlastností`, button);
                if (state.mode === 'enums') el('small', `${enumValues(item.row).length} hodnot`, button);
                button.onclick = () => { state.selected = item.key; drawDetail(); drawList(); };
            }
            if (!found.length) el('p', 'Žádná položka neodpovídá hledání.', list);
            if (found.length > 60) {
                const prev = el('button', '← Předchozí', pagination); prev.disabled = !state.page; prev.onclick = () => { state.page--; drawList(); };
                el('span', `${state.page + 1} / ${Math.ceil(found.length / 60)}`, pagination);
                const next = el('button', 'Další →', pagination); next.disabled = (state.page + 1) * 60 >= found.length; next.onclick = () => { state.page++; drawList(); };
            }
        }
        function propertiesTable(parent, items, objectScope, groupScope) {
            const table = el('table', undefined, parent); table.className = 'standard-properties';
            const titles = ['Vlastnost', 'HBHBIM automat', 'Číselník hodnot', 'Typ / jednotka', 'Požadavek'];
            titles.push(objectScope ? 'Default pro tento objekt' : 'Default vlastnosti');
            titles.push('Hodnoty a instrukce');
            const head = el('tr', undefined, el('thead', undefined, table)); for (const title of titles) el('th', title, head);
            const body = el('tbody', undefined, table); let shown = 0;
            function more() {
                for (const item of items.slice(shown, shown + 40)) {
                    const p = item.property, tr = el('tr', undefined, body); tr.dataset.propertyGuid = p.guid;
                    const name = el('td', undefined, tr); el('strong', p.nameCz || p.nameIfc || '(bez názvu)', name);
                    if (p.nameIfc && p.nameIfc !== p.nameCz) el('small', p.nameIfc, name);
                    const edit = el('button', 'Upravit vlastnost', name); edit.type = 'button'; edit.className = 'property-edit-button'; edit.dataset.editProperty = p.guid; edit.disabled = typeof options.onChange !== 'function';
                    edit.onclick = () => global.DSS_GROUP_LIBRARY.propertyPicker(doc, p, change => {
                        state.detailQueries[state.mode + '|' + state.selected] = ''; options.onChange(change.doc, change);
                    });
                    if (groupScope) {
                        const removable = groupScope.some(group => global.DSS_GROUP_LIBRARY?.canRemoveProperty(doc, group.guid, p.guid));
                        if (removable) {
                            const remove = el('button', 'Odebrat ze skupiny', name); remove.type = 'button'; remove.className = 'enum-remove-button'; remove.dataset.removeGroupProperty = p.guid; remove.disabled = typeof options.onChange !== 'function';
                            remove.onclick = () => global.DSS_GROUP_LIBRARY.propertyRemovalPicker(doc, p, groupScope.map(group => group.guid), change => options.onChange(change.doc, change));
                        } else el('small', 'Zdrojová vlastnost – nelze odebrat', name);
                    }
                    const automatic = el('td', undefined, tr); automatic.className = 'standard-automation-cell';
                    const commands = global.DSS_MODEL.hbhCommands(p);
                    for (const command of commands) {
                        const pair = el('div', undefined, automatic); pair.className = 'hbh-command-pair';
                        el('strong', global.DSS_HBH_AUTOMATIONS?.label(command) || p.nameCz || p.nameIfc || command, pair);
                        const badge = el('code', command, pair); badge.className = 'hbh-command';
                        const hint = global.DSS_HBH_AUTOMATIONS?.hint(command) || 'Výstup tohoto příkazu není v knihovně popsán.';
                        badge.title = hint;
                        const info = el('details', undefined, pair); info.className = 'hbh-command-help';
                        el('summary', 'Co vyplní?', info); el('p', hint, info).className = 'hbh-automation-hint';
                    }
                    if (!commands.length) el('small', 'Nepřiřazeno', automatic);
                    const choose = el('button', 'Vybrat automat', automatic); choose.type = 'button'; choose.className = 'hbh-choose'; choose.dataset.automationProperty = p.guid;
                    choose.disabled = typeof options.onChange !== 'function';
                    choose.onclick = () => automationPicker(doc, p, options.getAutomationLibrary ? options.getAutomationLibrary() : automationCatalog([doc]), change => {
                        state.detailQueries[state.mode + '|' + state.selected] = '';
                        options.onChange(change.doc, change);
                    });
                    const enumCell = el('td', undefined, tr); enumCell.className = 'standard-enumeration-cell';
                    const assignedEnum = model.enumsCatalog().find(item => item.key === p.customEnum);
                    el('strong', assignedEnum?.name || (p.customEnum ? 'Nedohledaný číselník' : 'Nepřiřazeno'), enumCell);
                    if (assignedEnum) el('small', `${enumValues(assignedEnum.row).length} hodnot`, enumCell);
                    const chooseEnum = el('button', 'Vybrat číselník', enumCell); chooseEnum.type = 'button'; chooseEnum.className = 'hbh-choose'; chooseEnum.dataset.enumerationProperty = p.guid;
                    chooseEnum.disabled = typeof options.onChange !== 'function';
                    chooseEnum.onclick = () => propertyEnumerationPicker(doc, p, change => options.onChange(change.doc, change));
                    const type = model.get('DataTypes', p.dataType)?.type || '', ifc = model.get('IfcTypes', p.ifcType)?.type || '', unit = model.get('Units', p.unit)?.unit || '';
                    el('td', [type, ifc, unit].filter(Boolean).join(' · '), tr);
                    const requirement = el('td', undefined, tr);
                    if (objectScope) defaultEditor(el('td', undefined, tr), objectScope, p);
                    else propertyDefaultEditor(el('td', undefined, tr), p);
                    const values = el('td', undefined, tr);
                    if (item.rules?.length) {
                        for (const binding of item.rules) {
                            const rule = binding.requirement;
                            el('div', ({ required: 'Povinné', optional: 'Volitelné', prohibited: 'Zakázané' }[rule.attributes?.cardinality || 'required'] || rule.attributes?.cardinality), requirement);
                            const text = summarizeValue(rule.values?.value); if (text) el('p', text, values);
                            if (rule.attributes?.instructions) el('p', rule.attributes.instructions, values);
                        }
                    } else el('span', objectScope ? 'Definice DSS' : 'Podle objektu', requirement);
                    if (p.description && !item.rules?.some(r => r.requirement.attributes?.instructions === p.description)) el('p', p.description, values);
                    if (p.defaultValue !== undefined && p.defaultValue !== '') el('p', 'Výchozí hodnota DSS: ' + p.defaultValue, values);
                    const enumeration = model.get('CustomEnums', p.customEnum);
                    if (enumeration) {
                        const choices = enumValues(enumeration), box = el('details', undefined, values); el('summary', `Číselník (${choices.length} hodnot)`, box);
                        let loaded = false; box.ontoggle = () => { if (box.open && !loaded) { renderValues(box, choices); loaded = true; } };
                    }
                    technical(name, 'Technický záznam', { property: p, rules: item.rules || [] });
                }
                shown += 40;
            }
            more();
            if (items.length > shown) { const button = el('button', 'Zobrazit dalších 40 vlastností', parent); button.onclick = () => { more(); if (shown >= items.length) button.remove(); }; }
        }
        function propertyDefaultEditor(parent, property) {
            parent.className = 'standard-default-editor';
            const enumeration = model.get('CustomEnums', property.customEnum);
            const choices = enumeration ? enumValues(enumeration) : null;
            const input = el(choices ? 'select' : 'input', undefined, parent);
            input.setAttribute('aria-label', 'Default vlastnosti: ' + (property.nameCz || property.nameIfc));
            input.disabled = typeof options.onChange !== 'function';
            if (choices) {
                el('option', 'Bez výchozí hodnoty', input).value = '';
                choices.forEach((value, index) => { el('option', typeof value === 'object' ? JSON.stringify(value) : String(value), input).value = String(index); });
            } else input.type = 'text';
            const clear = el('button', 'Vymazat default', parent); clear.type = 'button'; clear.disabled = input.disabled;
            const note = el('small', 'Obecná hodnota pro všechny objekty bez vlastního přepisu.', parent); note.setAttribute('role', 'status');
            function refresh() {
                if (choices) {
                    let index = choices.findIndex(value => JSON.stringify(value) === JSON.stringify(property.defaultValue));
                    if (index < 0 && property.defaultValue !== undefined && property.defaultValue !== null && property.defaultValue !== '') {
                        index = choices.length; choices.push(property.defaultValue);
                        el('option', String(property.defaultValue) + ' (mimo číselník)', input).value = String(index);
                    }
                    input.value = index < 0 ? '' : String(index);
                } else input.value = property.defaultValue == null ? '' : typeof property.defaultValue === 'object' ? JSON.stringify(property.defaultValue) : String(property.defaultValue);
            }
            function save(value) {
                property.defaultValue = value;
                options.onChange?.();
                for (const sync of editors.get(property.guid) || []) sync();
                note.textContent = 'Uloženo do pracovního standardu. Platí pro všechny objekty bez vlastního přepisu.';
            }
            input.onchange = () => save(choices ? input.value === '' ? '' : choices[Number(input.value)] : input.value);
            clear.onclick = () => save('');
            if (!editors.has(property.guid)) editors.set(property.guid, []);
            editors.get(property.guid).push(refresh);
            refresh();
        }
        function defaultEditor(parent, object, property) {
            parent.className = 'standard-default-editor';
            const title = `${object.nameCz || object.guid} → ${property.nameCz || property.nameIfc}`;
            const mode = el('select', undefined, parent);
            mode.setAttribute('aria-label', 'Způsob výchozí hodnoty: ' + title);
            for (const [value, text] of [['inherit', 'Použít obecný default'], ['custom', 'Vlastní hodnota'], ['none', 'Bez výchozí hodnoty']]) el('option', text, mode).value = value;
            const enumeration = model.get('CustomEnums', property.customEnum);
            const choices = enumeration ? enumValues(enumeration) : null;
            const input = el(choices ? 'select' : 'input', undefined, parent);
            input.setAttribute('aria-label', 'Default pro objekt: ' + title);
            if (choices) {
                el('option', 'Vyberte hodnotu…', input).value = '';
                choices.forEach((value, index) => { el('option', typeof value === 'object' ? JSON.stringify(value) : String(value), input).value = String(index); });
            } else input.type = 'text';
            const note = el('small', '', parent); note.setAttribute('role', 'status');
            function refresh() {
                const entry = global.DSS_MODEL.propertyDefault(object, property.guid);
                mode.value = !entry ? 'inherit' : entry.defaultValue === null ? 'none' : 'custom';
                input.hidden = mode.value !== 'custom';
                if (entry && entry.defaultValue !== null) {
                    if (choices) {
                        let index = choices.findIndex(value => JSON.stringify(value) === JSON.stringify(entry.defaultValue));
                        if (index < 0) {
                            index = choices.length; choices.push(entry.defaultValue);
                            el('option', String(entry.defaultValue) + ' (mimo číselník)', input).value = String(index);
                        }
                        input.value = String(index);
                    } else input.value = typeof entry.defaultValue === 'object' ? JSON.stringify(entry.defaultValue) : String(entry.defaultValue);
                }
                note.textContent = !entry ? 'Obecný default: ' + (property.defaultValue === undefined || property.defaultValue === null ? 'nenastaven' : String(property.defaultValue)) : entry.defaultValue === null ? 'Obecný default se nepoužije.' : 'Hodnota platí pouze pro tento objekt.';
            }
            function save(value) {
                global.DSS_MODEL.setPropertyDefault(object, property.guid, value);
                options.onChange?.();
                // A property can occur in multiple groups of the same object.
                for (const sync of editors.get(property.guid) || []) sync();
                note.textContent += ' Uloženo do pracovního standardu.';
            }
            mode.onchange = () => {
                if (mode.value === 'inherit') save(undefined);
                else if (mode.value === 'none') save(null);
                else {
                    input.hidden = false;
                    if (choices && input.value === '') { note.textContent = 'Vyberte a uložte hodnotu číselníku.'; input.focus(); }
                    else save(choices ? choices[Number(input.value)] : input.value);
                }
            };
            input.onchange = () => {
                if (choices && input.value === '') return;
                save(choices ? choices[Number(input.value)] : input.value);
            };
            if (!editors.has(property.guid)) editors.set(property.guid, []);
            editors.get(property.guid).push(refresh);
            refresh();
        }
        function renderValues(parent, choices) {
            const input = el('input', undefined, parent); input.type = 'search'; input.placeholder = 'Hledat hodnotu'; input.setAttribute('aria-label', 'Hledat hodnotu číselníku');
            const output = el('div', undefined, parent); let limit = 100;
            function draw() {
                output.replaceChildren(); const found = choices.filter(value => norm(typeof value === 'object' ? JSON.stringify(value) : value).includes(norm(input.value)));
                el('p', `${found.length} hodnot`, output); const list = el('ul', undefined, output);
                for (const value of found.slice(0, limit)) el('li', typeof value === 'object' ? JSON.stringify(value) : String(value), list);
                if (found.length > limit) { const button = el('button', 'Dalších 100 hodnot', output); button.onclick = () => { limit += 100; draw(); }; }
            }
            input.oninput = () => { limit = 100; draw(); }; draw();
        }
        const editors = new Map();
        function drawDetail() {
            editors.clear();
            detail.replaceChildren(); const item = catalog().find(x => x.key === state.selected); if (!item) { el('p', 'Vyberte položku vlevo.', detail); return; }
            el('h3', item.name, detail); if (item.code) el('p', item.code, detail).className = 'matching-aspect-code';
            if (state.mode === 'enums') {
                if (item.names.length) el('p', 'Použití ve vlastnostech: ' + item.names.join(', '), detail);
                const controls = el('div', undefined, detail); controls.className = 'standard-toolbar';
                const edit = el('button', 'Upravit číselník', controls); edit.type = 'button'; edit.id = 'standard-enum-edit'; edit.disabled = typeof options.onChange !== 'function';
                edit.onclick = () => enumerationPicker(doc, change => {
                    state.query = ''; state.page = 0; options.onChange(change.doc, change);
                }, item.row);
                const download = el('button', 'Exportovat tento číselník', controls); download.type = 'button'; download.onclick = () => downloadEnumerations(doc, [item.key]);
                const remove = el('button', 'Odstranit číselník', controls); remove.type = 'button'; remove.id = 'standard-enum-remove'; remove.className = 'enum-remove-button'; remove.disabled = typeof options.onChange !== 'function';
                remove.onclick = () => enumerationRemovalPicker(doc, item.row, change => {
                    options.onChange(change.doc, change);
                });
                renderValues(detail, enumValues(item.row)); technical(detail, 'Technický záznam číselníku', item.row); return;
            }
            const object = state.mode === 'objects' ? model.objectDetail(item.key) : null;
            if (object) {
                const editor = el('div', undefined, detail); editor.className = 'standard-aspect-editor';
                const label = el('label', 'Typový aspekt', editor), input = el('input', undefined, editor);
                input.id = 'standard-type-aspect'; label.htmlFor = input.id; input.type = 'text';
                input.value = object.row.typeAspectCode || ''; input.placeholder = 'Např. %TRA01';
                input.disabled = typeof options.onChange !== 'function';
                const save = el('button', 'Uložit typový aspekt', editor); save.type = 'button'; save.disabled = input.disabled;
                const note = el('small', 'Kód patří pouze vybranému objektu. Pro odebrání vymažte pole a uložte.', editor); note.setAttribute('role', 'status');
                if (!input.value && item.code) el('small', 'Zobrazený kód pochází z IDS; vlastní typový aspekt má přednost. Původní klasifikace IDS zůstává zachovaná.', editor);
                save.onclick = () => {
                    try {
                        const change = setTypeAspect(doc, object.row.guid, input.value);
                        if (change.changes.length) options.onChange(change.doc, change);
                        else note.textContent = 'Typový aspekt se nezměnil.';
                    } catch (error) { note.textContent = error.message; }
                };
                input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); save.onclick(); } };
            }
            const groups = object ? object.groups : [{ name: item.name, items: [...item.properties].map(id => ({ property: model.get('Properties', id), rules: [] })) }];
            el('p', object ? `${item.group} · ${object.propertyCount} vlastností ve ${groups.length} skupinách` : `${item.properties.size} vlastností · používá ${item.objects.size} objektů`, detail);
            const search = el('input', undefined, detail); search.type = 'search'; search.placeholder = 'Hledat vlastnost nebo HBHBIM příkaz'; search.setAttribute('aria-label', 'Hledat vlastnost v detailu');
            const queryKey = state.mode + '|' + state.selected; search.value = state.detailQueries[queryKey] || '';
            const controls = el('div', undefined, detail); controls.className = 'standard-toolbar';
            if (!object) {
                const addProperties = el('button', '＋ Přidat vlastnosti do skupiny', controls); addProperties.type = 'button'; addProperties.id = 'standard-group-add-properties'; addProperties.disabled = typeof options.onChange !== 'function';
                addProperties.onclick = () => global.DSS_GROUP_LIBRARY.createPicker(doc, change => {
                    state.detailQueries[state.mode + '|' + state.selected] = ''; options.onChange(change.doc, change);
                }, item.members);
            }
            const expand = el('button', 'Rozbalit skupiny', controls), collapse = el('button', 'Sbalit skupiny', controls);
            const groupBox = el('div', undefined, detail);
            let visibleGroups = [];
            expand.onclick = () => { for (const box of visibleGroups) { box.open = true; box.ontoggle(); } };
            collapse.onclick = () => { for (const box of visibleGroups) { box.open = false; box.ontoggle(); } };
            function drawGroups() {
                editors.clear();
                groupBox.replaceChildren(); visibleGroups = []; const query = norm(search.value);
                for (const [index, group] of groups.entries()) {
                    const commands = property => global.DSS_MODEL.hbhCommands(property).flatMap(command => [command, global.DSS_HBH_AUTOMATIONS?.label(command)]);
                    const items = group.items.filter(item => norm([group.name, item.property.nameCz, item.property.nameIfc, ...commands(item.property)].join(' ')).includes(query)); if (!items.length) continue;
                    const box = el('details', undefined, groupBox); box.className = 'standard-property-group';
                    visibleGroups.push(box);
                    el('summary', `${group.name} → ${items.length} vlastností`, box);
                    let loaded = false;
                    const openKey = queryKey + '|' + index + '|' + group.name;
                    const load = () => { state.openGroups[openKey] = box.open; if (box.open && !loaded) { propertiesTable(box, items, object?.row, object ? null : item.members); loaded = true; } };
                    box.ontoggle = load; if (query || (state.openGroups[openKey] ?? index < 2)) { box.open = true; load(); }
                }
                if (!groupBox.children.length) el('p', 'V tomto detailu nebyly nalezeny vlastnosti.', groupBox);
            }
            search.oninput = () => { state.detailQueries[queryKey] = search.value; drawGroups(); }; drawGroups();
            if (object) {
                const nonProperty = object.metadata.flatMap(meta => (meta.requirements || []).filter(rule => rule.type !== 'property'));
                if (nonProperty.length) technical(detail, `Další požadavky IDS (${nonProperty.length})`, nonProperty);
                technical(detail, 'Technický záznam objektu', object.row);
            } else technical(detail, 'Technické záznamy skupiny', item.members);
        }
        search.oninput = () => { state.query = search.value; state.page = 0; drawList(); };
        groupFilter.onchange = () => { state.group = groupFilter.value; state.page = 0; drawList(); };
        setup(); if (state.selected && !detail.children.length) drawDetail(); return { model, state };
    }
    global.DSS_VIEWER = { createModel, render, renderEmpty, enumValues, summarizeValue, automationCatalog, setAutomation, setTypeAspect, automationPicker, addEnumeration, editEnumeration, enumerationPicker,
        exportEnumerations, readEnumerations, importEnumerations, enumerationImportPicker, setPropertyEnumeration, propertyEnumerationPicker, removeEnumeration, enumerationRemovalPicker };
})(window);
