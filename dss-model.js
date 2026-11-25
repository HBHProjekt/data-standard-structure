(function (global) {
    const referenceFields = {
        groupsOfProperties: "GroupsOfProperties",
        property: "Properties",
        customEnum: "CustomEnums",
        geometricalType: "GeometricalTypes",
        color: "Colors",
        precision: "GraphicalPrecisions",
        properties: "Properties",
        dataType: "DataTypes",
        ifcType: "IfcTypes",
        unit: "Units"
    };

    const tables = {
        DataTypes: {
            identityField: "guid",
            requiredFields: ["guid", "type"],
            displayField: "type"
        },
        IfcTypes: {
            identityField: "guid",
            requiredFields: ["guid", "type"],
            displayField: "type"
        },
        Units: {
            identityField: "guid",
            requiredFields: ["guid", "unit"],
            displayField: "unit"
        },
        GeometricalTypes: {
            identityField: "guid",
            requiredFields: ["guid", "type"],
            displayField: "type"
        },
        Colors: {
            identityField: "guid",
            requiredFields: ["guid", "name"],
            displayField: "name"
        },
        GraphicalPrecisions: {
            identityField: "guid",
            requiredFields: ["guid", "name"],
            displayField: "name"
        },
        CustomEnums: {
            identityField: "guid",
            requiredFields: ["guid", "values"],
            displayField: "name"
        },
        GraphicalCatalogue: {
            identityField: "guid",
            requiredFields: ["guid", "name"],
            displayField: "name"
        },
        Properties: {
            identityField: "guid",
            requiredFields: ["guid", "nameCz", "nameIfc", "dataType", "ifcType", "unit", "customEnum"],
            displayField: "nameCz"
        },
        GroupsOfProperties: {
            identityField: "guid",
            requiredFields: ["guid", "name", "properties"],
            displayField: "name"
        },
        DataObjects: {
            identityField: "guid",
            requiredFields: ["guid", "nameCz", "source", "loin"],
            displayField: "nameCz"
        }
    };

    const importerDefaults = {
        topLevel: {
            use: "IDS Import",
            version: "1.0"
        },
        graphical: {
            geometricalType: { type: "NotDefined" },
            color: { name: "Imported IDS default", r: 180, g: 180, b: 180, index: 0 },
            precision: { name: "Imported IDS default" }
        },
        units: {
            none: { unit: "[-]" }
        },
        dataTypes: [
            { key: "String", type: "String" },
            { key: "Enum", type: "Enum" },
            { key: "Integer", type: "Integer" },
            { key: "Real", type: "Real" },
            { key: "Boolean", type: "Boolean" },
            { key: "Date", type: "Date" },
            { key: "Reference", type: "Reference" },
            { key: "Unknown", type: "Unknown" }
        ]
    };

    function createEmptyDocument() {
        return {
            use: importerDefaults.topLevel.use,
            version: importerDefaults.topLevel.version,
            data: {
                DataTypes: [],
                IfcTypes: [],
                Units: [],
                GeometricalTypes: [],
                Colors: [],
                GraphicalPrecisions: [],
                CustomEnums: [],
                GraphicalCatalogue: [],
                Properties: [],
                GroupsOfProperties: [],
                DataObjects: []
            }
        };
    }

    function hbhCommands(property) {
        const commands = [];
        for (const [key, value] of Object.entries(property || {})) if (key.toLowerCase() === 'namehbh') {
            for (const command of Array.isArray(value) ? value : [value]) if (typeof command === 'string' && command.trim()) commands.push(command.trim());
        }
        return [...new Set(commands)];
    }

    function propertyDefault(object, property) {
        return (object.propertyDefaults || []).find(entry => entry.property === property);
    }
    function setPropertyDefault(object, property, value) {
        const entries = (object.propertyDefaults || []).filter(entry => entry.property !== property);
        if (value !== undefined) entries.push({ property, defaultValue: value });
        if (entries.length) object.propertyDefaults = entries;
        else delete object.propertyDefaults;
    }
    function mergePropertyDefaults(target, source, propertyMap = new Map()) {
        for (const entry of source.propertyDefaults || []) {
            const property = propertyMap.get(entry.property) || entry.property;
            const existing = propertyDefault(target, property);
            if (existing && JSON.stringify(existing.defaultValue) !== JSON.stringify(entry.defaultValue)) {
                throw new Error(`Rozdílné výchozí hodnoty pro objekt „${target.nameCz || target.guid}“ a vlastnost ${property}. Sjednoťte je v prohlížeči vstupních standardů.`);
            }
            if (!existing) {
                target.propertyDefaults = target.propertyDefaults || [];
                target.propertyDefaults.push({ ...entry, property });
            }
        }
    }

    global.DSS_MODEL = {
        version: "0.1",
        referenceFields,
        tables,
        importerDefaults,
        createEmptyDocument,
        hbhCommands,
        propertyDefault,
        setPropertyDefault,
        mergePropertyDefaults
    };
})(window);
