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
            requiredFields: ["guid", "name", "values"],
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

    global.DSS_MODEL = {
        version: "0.1",
        referenceFields,
        tables,
        importerDefaults,
        createEmptyDocument
    };
})(window);
