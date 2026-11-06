(function (global) {
    'use strict';
    const isGuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    const title = row => row && (row.nameCz || row.name || row.nameIfc || row.type || row.typeOfObject || row.unit ||
        (Object.hasOwn(row, 'r') && Object.hasOwn(row, 'g') && Object.hasOwn(row, 'b') ? `RGB ${row.r}, ${row.g}, ${row.b}` : '') ||
        (row.horizontalPrecision && row.verticalPrecision ? `${row.horizontalPrecision} / ${row.verticalPrecision}` : '') ||
        (Array.isArray(row.enumList) ? `Číselník (${row.enumList.length} hodnot)` : Array.isArray(row.values) ? `Číselník (${row.values.length} hodnot)` : '')) || '(bez názvu)';
    const show = value => value === undefined ? '(pole chybí)' : JSON.stringify(value)?.slice(0, 250);
    function jsonPath(parts) {
        return parts.reduce((path, part) => typeof part === 'number' ? path + '[' + part + ']' : /^[A-Za-z_$][\w$]*$/.test(part) ? path + '.' + part : path + '[' + JSON.stringify(part) + ']', '$');
    }
    function validate(json, options = {}) {
        const diagnostics = [];
        const model = global.DSS_MODEL || {};
        const references = { ...(model.referenceFields || {}), ...(options.references || {}), customEnums: 'CustomEnums' };
        if (!json || typeof json !== 'object' || Array.isArray(json)) return [{ severity: 'error', code: 'DSS_ROOT_INVALID', message: 'Kořen JSONu musí být objekt.', location: 'Kořen standardu', details: { path: '$', hint: 'Načtěte JSON datového standardu, nikoli samostatný seznam nebo mapu párování.' } }];
        if (!json.data || typeof json.data !== 'object' || Array.isArray(json.data)) return [{ severity: 'error', code: 'DSS_DATA_MISSING', message: 'Chybí objekt data s tabulkami standardu.', location: 'Kořen standardu', details: { path: '$.data', hint: 'Tabulky DataObjects, Properties a další musí být uvnitř objektu data.' } }];
        const records = [], byGuid = new Map(), usage = new Map();
        for (const [table, data] of Object.entries(json.data)) {
            if (!Array.isArray(data)) {
                diagnostics.push({ severity: 'error', code: 'DSS_TABLE_INVALID', message: 'Tabulka musí obsahovat seznam záznamů.', location: table, details: { table, path: jsonPath(['data', table]), hint: 'V této tabulce se očekává pole [ … ], nikoli jeden objekt nebo text.' } });
                continue;
            }
            data.forEach((row, index) => {
                const record = { table, index, row };
                records.push(record);
                if (row && isGuid(row.guid)) {
                    if (!byGuid.has(row.guid)) byGuid.set(row.guid, []);
                    byGuid.get(row.guid).push(record);
                }
            });
        }
        function referencesIn(value, path, record, emit) {
            if (!value || typeof value !== 'object') return;
            for (const [key, child] of Object.entries(value)) {
                const next = path.concat(Array.isArray(value) ? Number(key) : key);
                if (key === 'ids' || key === 'idsMappings') {
                    const entries = Array.isArray(child) ? child : [child];
                    entries.forEach((metadata, index) => {
                        if (metadata && Object.hasOwn(metadata, 'propertyRequirements')) {
                            const metaPath = Array.isArray(child) ? next.concat(index) : next;
                            emit(metadata.propertyRequirements, metaPath.concat('propertyRequirements'), 'Properties', 'propertyRequirements');
                        }
                    });
                } else if (references[key]) {
                    // Units.unit stores the unit symbol, not a foreign key.
                    if (!(record.table === 'Units' && key === 'unit' && next.length === 1)) emit(child, next, references[key], key);
                } else if (child && typeof child === 'object') referencesIn(child, next, record, emit);
            }
        }
        const outgoing = new Map();
        for (const record of records) {
            const ids = new Set();
            referencesIn(record.row, [], record, value => {
                for (const id of Array.isArray(value) ? value : [value]) if (isGuid(id)) ids.add(id);
            });
            outgoing.set(record, ids);
        }
        // Follow DSS relationships once per data object to show affected objects
        // on property/group/dictionary diagnostics, without traversing raw IDS.
        for (const root of records.filter(record => record.table === 'DataObjects' && record.row && typeof record.row === 'object')) {
            const queue = [root], visited = new Set();
            while (queue.length) {
                const record = queue.pop();
                if (visited.has(record)) continue;
                visited.add(record);
                if (!usage.has(record)) usage.set(record, { count: 0, examples: [] });
                const owners = usage.get(record); owners.count++;
                if (owners.examples.length < 5) owners.examples.push({ name: title(root.row), group: root.row.groupOfDataObjectsCz || '', typeAspectCode: root.row.typeAspectCode || '', guid: root.row.guid || '', path: jsonPath(['data', 'DataObjects', root.index]) });
                for (const id of outgoing.get(record) || []) queue.push(...(byGuid.get(id) || []));
            }
        }
        function add(record, fieldPath, code, message, hint, actual, expectedTable, technicalMessage, severity = 'error') {
            const owners = usage.get(record) || { count: 0, examples: [] };
            const parts = ['data', record.table, record.index, ...fieldPath];
            const row = record.row;
            diagnostics.push({ severity, code, message,
                location: `${record.table} → „${title(row)}“ (řádek ${record.index + 1})`,
                details: { table: record.table, rowIndex: record.index, rowName: title(row), rowGuid: row && row.guid || null,
                    field: fieldPath.join('.'), path: jsonPath(parts), actual: show(actual), expectedTable: expectedTable || null,
                    hint, usedBy: owners.examples, affectedObjects: owners.count,
                    technicalMessage: technicalMessage || message } });
        }
        for (const record of records) {
            const { row, table } = record;
            if (!row || typeof row !== 'object' || Array.isArray(row)) {
                add(record, [], 'DSS_ROW_INVALID', 'Záznam není objekt s pojmenovanými poli.', 'V uvedeném řádku se očekává objekt { … }, nikoli text, číslo nebo null.', row); continue;
            }
            // The producing application owns the JSON schema. The merger checks
            // identities and references, not names, required fields or enum shapes.
            if (!isGuid(row.guid)) add(record, ['guid'], 'DSS_GUID_INVALID', 'Záznam nemá platný vlastní GUID.', 'Pole guid musí obsahovat identifikátor ve tvaru xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. Existující odkazy na záznam musí zůstat konzistentní.', row.guid, null, 'Invalid GUID value: ' + show(row.guid));
            else if (byGuid.get(row.guid).length > 1) add(record, ['guid'], 'DSS_GUID_DUPLICATE', 'Stejný GUID používá více záznamů.', 'Najděte všechny výskyty tohoto GUID. Ověřte, zda jde o duplicitní záznam nebo o dvě různé položky; neopravujte identifikátor bez odpovídající úpravy odkazů.', row.guid);
            referencesIn(row, [], record, (value, path, expectedTable, key) => {
                const values = Array.isArray(value) ? value : [value];
                values.forEach((id, index) => {
                    // An unset optional relation is not a broken reference.
                    if (!Array.isArray(value) && (id === '' || id === null || id === undefined)) return;
                    const itemPath = Array.isArray(value) ? path.concat(index) : path;
                    if (!isGuid(id)) {
                        add(record, itemPath, 'DSS_REFERENCE_INVALID', 'Pole má obsahovat odkaz GUID, ale obsahuje jinou hodnotu.', `Pole „${key}“ odkazuje do tabulky ${expectedTable}. Vyhledejte správný záznam v této tabulce a použijte jeho guid, nikoli jeho název.`, id, expectedTable, 'Invalid GUID definition: ' + show(id));
                    } else if (!byGuid.has(id)) {
                        add(record, itemPath, 'DSS_REFERENCE_MISSING', 'Odkaz míří na záznam, který ve standardu chybí.', `V tabulce ${expectedTable} hledejte řádek s guid ${id}. Pokud chybí, je potřeba doplnit odpovídající definici nebo opravit odkaz na existující položku.`, id, expectedTable, 'Invalid GUID reference: ' + id);
                    } else if (!byGuid.get(id).some(target => target.table === expectedTable)) {
                        add(record, itemPath, 'DSS_REFERENCE_WRONG_TABLE', 'GUID existuje, ale odkazuje do nesprávné tabulky.', `GUID byl nalezen v ${[...new Set(byGuid.get(id).map(target => target.table))].join(', ')}. Pole „${key}“ očekává záznam z tabulky ${expectedTable}.`, id, expectedTable, 'Invalid GUID reference: wrong table ' + id);
                    }
                });
            });
        }
        return diagnostics;
    }
    global.DSS_VALIDATOR = { validate };
})(window);
