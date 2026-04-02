(function (global) {
    const IDS_NS = "http://standards.buildingsmart.org/IDS";
    const XS_NS = "http://www.w3.org/2001/XMLSchema";
    const ALLOWED_OPTIONALITY = new Set(["1|unbounded", "0|unbounded", "0|0"]);
    const RESTRICTION_TAGS = new Set([
        "enumeration",
        "pattern",
        "minInclusive",
        "maxInclusive",
        "minExclusive",
        "maxExclusive",
        "length",
        "minLength",
        "maxLength",
        "totalDigits",
        "fractionDigits"
    ]);

    function createGuid() {
        if (global.crypto && typeof global.crypto.randomUUID === "function") {
            return global.crypto.randomUUID();
        }

        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (char) {
            const random = Math.random() * 16 | 0;
            const value = char === "x" ? random : (random & 0x3 | 0x8);
            return value.toString(16);
        });
    }

    function createDiagnostic(severity, code, message, location, details) {
        return {
            severity,
            code,
            message,
            location: location || "IDS document",
            details: details || null
        };
    }

    function childrenByLocalName(node, name) {
        return Array.from(node.children || []).filter(function (child) {
            return child.localName === name;
        });
    }

    function firstChildByLocalName(node, name) {
        const children = childrenByLocalName(node, name);
        return children.length > 0 ? children[0] : null;
    }

    function textValue(node) {
        return node && typeof node.textContent === "string" ? node.textContent.trim() : "";
    }

    function simpleValue(node) {
        const simple = firstChildByLocalName(node, "simpleValue");
        return textValue(simple);
    }

    function xmlElementToObject(element) {
        const attributes = {};
        for (const attribute of Array.from(element.attributes || [])) {
            attributes[attribute.name] = attribute.value;
        }

        const children = Array.from(element.children || []).map(xmlElementToObject);
        const directText = Array.from(element.childNodes || [])
            .filter(function (node) {
                return node.nodeType === Node.TEXT_NODE;
            })
            .map(function (node) {
                return node.textContent.trim();
            })
            .filter(Boolean)
            .join(" ");

        return {
            name: element.localName,
            namespaceUri: element.namespaceURI,
            attributes,
            text: directText || "",
            children
        };
    }

    function parseRestriction(valueElement, location, diagnostics) {
        const simple = simpleValue(valueElement);
        if (simple) {
            return {
                kind: "simpleValue",
                value: simple
            };
        }

        const restriction = Array.from(valueElement.children || []).find(function (child) {
            return child.localName === "restriction" && child.namespaceURI === XS_NS;
        });

        if (!restriction) {
            return null;
        }

        const result = {
            kind: "restriction",
            base: restriction.getAttribute("base") || "",
            enumerations: [],
            patterns: [],
            bounds: [],
            lengths: [],
            unsupportedFacets: [],
            raw: xmlElementToObject(restriction)
        };

        for (const facet of Array.from(restriction.children || [])) {
            if (!RESTRICTION_TAGS.has(facet.localName)) {
                result.unsupportedFacets.push({
                    name: facet.localName,
                    value: facet.getAttribute("value") || textValue(facet)
                });
                diagnostics.push(createDiagnostic(
                    "warning",
                    "IDS_UNSUPPORTED_RESTRICTION",
                    "Unsupported IDS restriction facet was preserved as metadata.",
                    location,
                    { facet: facet.localName }
                ));
                continue;
            }

            const value = facet.getAttribute("value") || textValue(facet);

            if (facet.localName === "enumeration") {
                result.enumerations.push(value);
            } else if (facet.localName === "pattern") {
                result.patterns.push(value);
            } else if (facet.localName === "totalDigits" || facet.localName === "fractionDigits") {
                result.unsupportedFacets.push({ name: facet.localName, value: value });
                diagnostics.push(createDiagnostic(
                    "warning",
                    "IDS_UNSUPPORTED_DIGIT_RESTRICTION",
                    "IDS digit restrictions were found but are not enforced by the importer.",
                    location,
                    { facet: facet.localName, value: value }
                ));
            } else if (facet.localName.indexOf("Length") !== -1 || facet.localName === "length") {
                result.lengths.push({ name: facet.localName, value: value });
            } else {
                result.bounds.push({ name: facet.localName, value: value });
            }
        }

        return result;
    }

    function parseFacetElement(element, diagnostics, location) {
        const parsed = {
            type: element.localName,
            attributes: {},
            values: {},
            raw: xmlElementToObject(element)
        };

        for (const attribute of Array.from(element.attributes || [])) {
            parsed.attributes[attribute.name] = attribute.value;
        }

        for (const child of Array.from(element.children || [])) {
            if (child.localName === "value") {
                parsed.values.value = parseRestriction(child, location, diagnostics);
                continue;
            }

            const simple = simpleValue(child);
            if (simple) {
                parsed.values[child.localName] = simple;
                continue;
            }

            parsed.values[child.localName] = xmlElementToObject(child);
        }

        return parsed;
    }

    function normalizeSpecificationOptionality(minOccurs, maxOccurs) {
        const minValue = minOccurs || "1";
        const maxValue = maxOccurs || "unbounded";
        const key = minValue + "|" + maxValue;

        if (key === "1|unbounded") {
            return "required";
        }

        if (key === "0|unbounded") {
            return "optional";
        }

        if (key === "0|0") {
            return "prohibited";
        }

        return "custom";
    }

    function parseSpecification(specElement, diagnostics, index) {
        const name = specElement.getAttribute("name") || ("Specification " + (index + 1));
        const location = "Specification \"" + name + "\"";
        const applicabilityElement = firstChildByLocalName(specElement, "applicability");
        const requirementsElement = firstChildByLocalName(specElement, "requirements");
        const spec = {
            name,
            identifier: specElement.getAttribute("identifier") || "",
            ifcVersion: specElement.getAttribute("ifcVersion") || "",
            description: specElement.getAttribute("description") || "",
            optionality: "required",
            applicabilityCardinality: null,
            applicability: [],
            requirements: [],
            raw: xmlElementToObject(specElement)
        };

        if (!applicabilityElement) {
            diagnostics.push(createDiagnostic(
                "error",
                "IDS_MISSING_APPLICABILITY",
                "Specification is missing applicability.",
                location
            ));
        } else {
            const minOccurs = applicabilityElement.getAttribute("minOccurs") || "1";
            const maxOccurs = applicabilityElement.getAttribute("maxOccurs") || "unbounded";
            spec.applicabilityCardinality = { minOccurs, maxOccurs };
            spec.optionality = normalizeSpecificationOptionality(minOccurs, maxOccurs);

            if (!ALLOWED_OPTIONALITY.has(minOccurs + "|" + maxOccurs)) {
                diagnostics.push(createDiagnostic(
                    "warning",
                    "IDS_INVALID_OPTIONALITY",
                    "Specification uses an unsupported minOccurs/maxOccurs combination.",
                    location,
                    { minOccurs, maxOccurs }
                ));
            }

            for (const facetElement of Array.from(applicabilityElement.children || [])) {
                spec.applicability.push(parseFacetElement(facetElement, diagnostics, location + " applicability"));
            }
        }

        if (!requirementsElement) {
            diagnostics.push(createDiagnostic(
                "warning",
                "IDS_MISSING_REQUIREMENTS",
                "Specification has no requirements block.",
                location
            ));
        } else {
            for (const facetElement of Array.from(requirementsElement.children || [])) {
                spec.requirements.push(parseFacetElement(facetElement, diagnostics, location + " requirements"));
            }
        }

        return spec;
    }

    function parseIdsDocument(content) {
        const diagnostics = [];
        const parser = new DOMParser();
        const xml = parser.parseFromString(content, "application/xml");
        const parserError = xml.querySelector("parsererror");

        if (parserError) {
            diagnostics.push(createDiagnostic(
                "error",
                "IDS_XML_PARSE_ERROR",
                "The IDS file could not be parsed as XML.",
                "IDS document",
                { parserError: textValue(parserError) }
            ));

            return {
                valid: false,
                xml: null,
                info: null,
                specifications: [],
                diagnostics
            };
        }

        const root = xml.documentElement;
        if (!root || root.localName !== "ids") {
            diagnostics.push(createDiagnostic(
                "error",
                "IDS_INVALID_ROOT",
                "The IDS file must contain an ids:ids root element.",
                "IDS document"
            ));
            return {
                valid: false,
                xml,
                info: null,
                specifications: [],
                diagnostics
            };
        }

        if (root.namespaceURI !== IDS_NS) {
            diagnostics.push(createDiagnostic(
                "warning",
                "IDS_NAMESPACE_MISMATCH",
                "The IDS root namespace differs from the IDS 1.0 namespace.",
                "IDS document",
                { namespaceUri: root.namespaceURI || "" }
            ));
        }

        const schemaLocation = root.getAttribute("xsi:schemaLocation") || root.getAttributeNS("http://www.w3.org/2001/XMLSchema-instance", "schemaLocation") || "";
        if (!schemaLocation || schemaLocation.indexOf("ids.xsd") === -1) {
            diagnostics.push(createDiagnostic(
                "warning",
                "IDS_SCHEMA_LOCATION_MISSING",
                "The IDS file does not advertise the standard IDS XSD schema location.",
                "IDS document",
                { schemaLocation: schemaLocation }
            ));
        }

        const infoElement = firstChildByLocalName(root, "info");
        const info = infoElement ? {
            title: textValue(firstChildByLocalName(infoElement, "title")),
            version: textValue(firstChildByLocalName(infoElement, "version")),
            author: textValue(firstChildByLocalName(infoElement, "author")),
            date: textValue(firstChildByLocalName(infoElement, "date")),
            purpose: textValue(firstChildByLocalName(infoElement, "purpose")),
            milestone: textValue(firstChildByLocalName(infoElement, "milestone"))
        } : null;

        if (!info) {
            diagnostics.push(createDiagnostic(
                "warning",
                "IDS_MISSING_INFO",
                "The IDS file does not contain an info section.",
                "IDS document"
            ));
        }

        const specificationsElement = firstChildByLocalName(root, "specifications");
        if (!specificationsElement) {
            diagnostics.push(createDiagnostic(
                "error",
                "IDS_MISSING_SPECIFICATIONS",
                "The IDS file does not contain any specifications.",
                "IDS document"
            ));

            return {
                valid: false,
                xml,
                info,
                specifications: [],
                diagnostics
            };
        }

        const specifications = Array.from(specificationsElement.children || []).map(function (specElement, index) {
            return parseSpecification(specElement, diagnostics, index);
        });

        return {
            valid: diagnostics.every(function (entry) {
                return entry.severity !== "error";
            }),
            xml,
            info,
            specifications,
            diagnostics
        };
    }

    function summarizeRestriction(valueData) {
        if (!valueData) {
            return "";
        }

        if (valueData.kind === "simpleValue") {
            return "Expected value: " + valueData.value;
        }

        const parts = [];
        if (valueData.base) {
            parts.push("Base " + valueData.base);
        }
        if (valueData.enumerations.length > 0) {
            parts.push("Allowed values: " + valueData.enumerations.join(", "));
        }
        if (valueData.patterns.length > 0) {
            parts.push("Patterns: " + valueData.patterns.join(", "));
        }
        if (valueData.bounds.length > 0) {
            parts.push("Bounds: " + valueData.bounds.map(function (item) {
                return item.name + "=" + item.value;
            }).join(", "));
        }
        if (valueData.lengths.length > 0) {
            parts.push("Lengths: " + valueData.lengths.map(function (item) {
                return item.name + "=" + item.value;
            }).join(", "));
        }

        return parts.join(". ");
    }

    function mapIdsDataType(dataType) {
        const normalized = (dataType || "").toUpperCase();

        if (!normalized) {
            return "Unknown";
        }
        if (normalized.indexOf("BOOLEAN") !== -1 || normalized.indexOf("LOGICAL") !== -1) {
            return "Boolean";
        }
        if (normalized.indexOf("DATE") !== -1 || normalized.indexOf("TIME") !== -1) {
            return "Date";
        }
        if (normalized.indexOf("REAL") !== -1 || normalized.indexOf("FLOAT") !== -1 || normalized.indexOf("DOUBLE") !== -1 || normalized.indexOf("NUMBER") !== -1) {
            return "Real";
        }
        if (normalized.indexOf("INT") !== -1 || normalized.indexOf("COUNT") !== -1) {
            return "Integer";
        }
        if (normalized.indexOf("ENUM") !== -1) {
            return "Enum";
        }
        if (normalized.indexOf("REFERENCE") !== -1) {
            return "Reference";
        }
        if (normalized.indexOf("LABEL") !== -1 || normalized.indexOf("TEXT") !== -1 || normalized.indexOf("IDENTIFIER") !== -1) {
            return "String";
        }

        return "Unknown";
    }

    function splitSpecificationName(specificationName, fallbackGroupName) {
        const rawName = (specificationName || "").trim();
        const separatorIndex = rawName.indexOf("-");

        if (separatorIndex === -1) {
            return {
                groupOfDataObjectsCz: fallbackGroupName,
                nameCz: rawName || "IDS Import"
            };
        }

        const groupName = rawName.slice(0, separatorIndex).trim();
        const dataObjectName = rawName.slice(separatorIndex + 1).trim();

        return {
            groupOfDataObjectsCz: groupName || fallbackGroupName,
            nameCz: dataObjectName || rawName
        };
    }

    function buildDssFromIds(parsed, options) {
        const model = global.DSS_MODEL;
        const document = model.createEmptyDocument();
        const diagnostics = parsed.diagnostics.slice();
        const sourceName = options.fileName || "IDS import";
        const groupByName = new Map();
        const propertyBySignature = new Map();
        const enumBySignature = new Map();
        const dataTypeByKey = new Map();
        const ifcTypeByKey = new Map();
        const defaultUnit = { guid: createGuid(), unit: model.importerDefaults.units.none.unit };
        const defaultGeometricalType = Object.assign({ guid: createGuid() }, model.importerDefaults.graphical.geometricalType);
        const defaultColor = Object.assign({ guid: createGuid() }, model.importerDefaults.graphical.color);
        const defaultPrecision = Object.assign({ guid: createGuid() }, model.importerDefaults.graphical.precision);
        const stats = {
            idsTitle: parsed.info && parsed.info.title ? parsed.info.title : "",
            idsVersion: parsed.info && parsed.info.version ? parsed.info.version : "",
            specificationsTotal: parsed.specifications.length,
            applicabilityFacetsTotal: 0,
            requirementFacetsTotal: 0,
            propertyRequirementsTotal: 0,
            mappedProperties: 0,
            mappedGroups: 0,
            mappedDataObjects: 0,
            customEnumsCreated: 0,
            ifcTypesCreated: 0,
            unsupportedApplicability: 0,
            unsupportedRequirements: 0
        };

        document.use = "IDS Import";
        document.version = parsed.info && parsed.info.version ? parsed.info.version : "1.0";
        document.data.Units.push(defaultUnit);
        document.data.GeometricalTypes.push(defaultGeometricalType);
        document.data.Colors.push(defaultColor);
        document.data.GraphicalPrecisions.push(defaultPrecision);

        for (const entry of model.importerDefaults.dataTypes) {
            const row = { guid: createGuid(), type: entry.type };
            document.data.DataTypes.push(row);
            dataTypeByKey.set(entry.key, row);
        }

        function ensureIfcType(typeName) {
            const key = typeName || "IfcLabel";
            if (!ifcTypeByKey.has(key)) {
                const row = {
                    guid: createGuid(),
                    type: key
                };
                document.data.IfcTypes.push(row);
                ifcTypeByKey.set(key, row);
                stats.ifcTypesCreated++;
            }
            return ifcTypeByKey.get(key);
        }

        function ensureCustomEnum(propertyName, values) {
            if (!values || values.length === 0) {
                return null;
            }

            const signature = propertyName + "|" + values.join("|");
            if (!enumBySignature.has(signature)) {
                const row = {
                    guid: createGuid(),
                    name: propertyName || "IDS enumeration",
                    values: values.slice()
                };
                document.data.CustomEnums.push(row);
                enumBySignature.set(signature, row);
                stats.customEnumsCreated++;
            }

            return enumBySignature.get(signature);
        }

        function ensureGroup(groupName) {
            const key = groupName || "IDS Imported Properties";
            if (!groupByName.has(key)) {
                const row = {
                    guid: createGuid(),
                    name: key,
                    properties: []
                };
                document.data.GroupsOfProperties.push(row);
                groupByName.set(key, row);
                stats.mappedGroups++;
            }

            return groupByName.get(key);
        }

        function ensureProperty(requirement) {
            const propertySet = requirement.values.propertySet || "IDS Imported Properties";
            const propertyName = requirement.values.baseName || requirement.values.name || "Unnamed IDS property";
            const ifcTypeName = requirement.attributes.dataType || "IfcLabel";
            const dssTypeKey = mapIdsDataType(ifcTypeName);
            const restriction = requirement.values.value;
            const enumRow = restriction && restriction.enumerations.length > 0 ? ensureCustomEnum(propertyName, restriction.enumerations) : null;
            const signature = [
                propertySet,
                propertyName,
                ifcTypeName,
                requirement.attributes.cardinality || "",
                enumRow ? enumRow.guid : "",
                restriction && restriction.kind === "simpleValue" ? restriction.value : ""
            ].join("|");

            if (!propertyBySignature.has(signature)) {
                const descriptionParts = [];
                if (requirement.attributes.instructions) {
                    descriptionParts.push(requirement.attributes.instructions);
                }
                const restrictionSummary = summarizeRestriction(restriction);
                if (restrictionSummary) {
                    descriptionParts.push(restrictionSummary);
                }

                const row = {
                    guid: createGuid(),
                    nameCz: propertyName,
                    nameIfc: propertyName,
                    description: descriptionParts.join(" ").trim(),
                    dataType: (dataTypeByKey.get(dssTypeKey) || dataTypeByKey.get("Unknown")).guid,
                    ifcType: ensureIfcType(ifcTypeName).guid,
                    unit: defaultUnit.guid,
                    customEnum: enumRow ? enumRow.guid : "",
                    defaultValue: restriction && restriction.kind === "simpleValue" ? restriction.value : ""
                };

                document.data.Properties.push(row);
                propertyBySignature.set(signature, row);
                stats.mappedProperties++;
            }

            return propertyBySignature.get(signature);
        }

        parsed.specifications.forEach(function (specification) {
            const location = "Specification \"" + specification.name + "\"";
            const dataObjectNames = splitSpecificationName(
                specification.name,
                parsed.info && parsed.info.title ? parsed.info.title : "IDS Import"
            );
            const propertyRequirements = specification.requirements.filter(function (item) {
                return item.type === "property";
            });
            const unsupportedRequirements = specification.requirements.filter(function (item) {
                return item.type !== "property";
            });
            const unsupportedApplicability = specification.applicability.filter(function (item) {
                return item.type !== "entity";
            });
            stats.applicabilityFacetsTotal += specification.applicability.length;
            stats.requirementFacetsTotal += specification.requirements.length;
            stats.propertyRequirementsTotal += propertyRequirements.length;
            stats.unsupportedRequirements += unsupportedRequirements.length;
            stats.unsupportedApplicability += unsupportedApplicability.length;

            unsupportedRequirements.forEach(function (facet) {
                diagnostics.push(createDiagnostic(
                    "warning",
                    "IDS_REQUIREMENT_NOT_MAPPED",
                    "Requirement facet is parsed but not mapped directly into DSS yet.",
                    location,
                    { facetType: facet.type }
                ));
            });

            unsupportedApplicability.forEach(function (facet) {
                diagnostics.push(createDiagnostic(
                    "warning",
                    "IDS_APPLICABILITY_NOT_MAPPED",
                    "Applicability facet is parsed but not mapped directly into DSS yet.",
                    location,
                    { facetType: facet.type }
                ));
            });

            const groupGuids = [];
            const enumGuids = [];
            const groupsTouched = new Set();

            propertyRequirements.forEach(function (requirement) {
                if (!requirement.values.baseName) {
                    diagnostics.push(createDiagnostic(
                        "warning",
                        "IDS_PROPERTY_MISSING_NAME",
                        "Property requirement is missing baseName and was recovered with a fallback name.",
                        location,
                        { propertySet: requirement.values.propertySet || "" }
                    ));
                }

                const group = ensureGroup(requirement.values.propertySet);
                const property = ensureProperty(requirement);

                if (!group.properties.includes(property.guid)) {
                    group.properties.push(property.guid);
                }

                if (!groupsTouched.has(group.guid)) {
                    groupGuids.push(group.guid);
                    groupsTouched.add(group.guid);
                }

                if (property.customEnum && !enumGuids.includes(property.customEnum)) {
                    enumGuids.push(property.customEnum);
                }
            });

            document.data.DataObjects.push({
                guid: createGuid(),
                typeAspectCode: "",
                nameCz: dataObjectNames.nameCz,
                groupOfDataObjectsCz: dataObjectNames.groupOfDataObjectsCz,
                source: sourceName,
                loin: {
                    nongraphical: {
                        groupsOfProperties: groupGuids,
                        customEnums: enumGuids,
                        relatedStandards: []
                    },
                    graphical: {
                        geometricalType: defaultGeometricalType.guid,
                        color: defaultColor.guid,
                        precision: defaultPrecision.guid,
                        relatedStandards: [],
                        catalogueModel: ""
                    }
                }
            });
            stats.mappedDataObjects++;
        });

        return {
            jsonData: document,
            diagnostics: diagnostics,
            stats: stats,
            recoveries: diagnostics.filter(function (entry) {
                return entry.code.indexOf("RECOVERY") !== -1 || entry.code === "IDS_PROPERTY_MISSING_NAME";
            })
        };
    }

    function importIdsToDss(content, options) {
        const parsed = parseIdsDocument(content);
        if (!parsed.valid && parsed.specifications.length === 0) {
            return {
                success: false,
                jsonData: null,
                diagnostics: parsed.diagnostics
            };
        }

        const converted = buildDssFromIds(parsed, options || {});
        const fatalErrors = converted.diagnostics.filter(function (entry) {
            return entry.severity === "error";
        });

        return {
            success: fatalErrors.length === 0 || !!converted.jsonData,
            jsonData: converted.jsonData,
            diagnostics: converted.diagnostics,
            stats: converted.stats
        };
    }

    global.IDS_IMPORTER = {
        importIdsToDss: importIdsToDss,
        parseIdsDocument: parseIdsDocument
    };
})(window);
