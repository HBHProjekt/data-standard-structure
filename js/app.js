const dropZone1 = document.getElementById("drop-zone1");
const dropZone2 = document.getElementById("drop-zone2");
const jsonInput1 = document.getElementById("fileInput1");
const jsonInput2 = document.getElementById("fileInput2");
const fileInputMerged = document.getElementById("fileInputMerged");
const dssModel = window.DSS_MODEL || {};

const localStructureData = (dssModel.referenceFields || {
    "groupsOfProperties": "GroupsOfProperties",
    "property": "Properties",
    "customEnum": "CustomEnums",
    "geometricalType": "GeometricalTypes",
    "color": "Colors",
    "precision": "GraphicalPrecisions",
    "properties": "Properties",
    "dataType": "DataTypes",
    "ifcType": "IfcTypes",
    "unit": "Units"
});
let configDict = Object.assign({}, localStructureData);

// Load the config file and store the data in the configDict object
fetch('structure/structure.json')
    .then(response => response.json())
    .then(data => {
        configDict = Object.assign({}, localStructureData, data);
    })
    .catch(error => {
        configDict = Object.assign({}, localStructureData); // Assign the local JSON data directly
    });


let resourceJsonData = null;
let activeStandardInput = null;
let activeStandardView = null;
const importDiagnosticCache = new WeakMap();
const validationCache = new WeakMap();
const changedValues = new Set();
let ctrlKeyPressed = false;

$(document).keydown(function (event) {
    if (event.ctrlKey) {
        ctrlKeyPressed = true;
    }
});

$(document).keyup(function (event) {
    if (!event.ctrlKey) {
        ctrlKeyPressed = false;
    }
});

//spinner
function showLoadingSpinner() {
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'block';
}

function hideLoadingSpinner() {
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'none';
}

function updateProgressBar(progress) {
    const progressBarInner = document.querySelector('.progress-bar-inner');
    progressBarInner.style.width = progress + '%';
}

function normalizeDiagnostic(entry, fallbackSeverity = "error") {
    if (typeof entry === "string") {
        return {
            severity: fallbackSeverity,
            code: "MESSAGE",
            location: "Application",
            message: entry
        };
    }

    return {
        severity: entry.severity || fallbackSeverity,
        code: entry.code || "MESSAGE",
        location: entry.location || "Application",
        message: entry.message || "",
        details: entry.details || null
    };
}

function createValidationDiagnostics(errors) {
    return errors.map(function (error) {
        if (error && typeof error === 'object') return normalizeDiagnostic(error);
        return normalizeDiagnostic({
            severity: "error",
            code: "DSS_VALIDATION",
            location: "DSS validation",
            message: error
        });
    });
}

function getStoredImportDiagnostics(jsonInput) {
    if (!jsonInput || !jsonInput.dataset.importDiagnostics) {
        return [];
    }

    try {
        const text = jsonInput.dataset.importDiagnostics;
        const previous = importDiagnosticCache.get(jsonInput);
        if (previous && previous.text === text) return previous.diagnostics;
        const diagnostics = JSON.parse(text).map(function (entry) {
            return normalizeDiagnostic(entry, "warning");
        });
        importDiagnosticCache.set(jsonInput, { text, diagnostics });
        return diagnostics;
    } catch (error) {
        return [normalizeDiagnostic({
            severity: "warning",
            code: "IMPORT_DIAGNOSTICS_PARSE_ERROR",
            location: "Imported diagnostics",
            message: "Stored import diagnostics could not be parsed."
        })];
    }
}

function getStoredImportStats(jsonInput) {
    if (!jsonInput || !jsonInput.dataset.importStats) {
        return null;
    }

    try {
        return JSON.parse(jsonInput.dataset.importStats);
    } catch (error) {
        return null;
    }
}

function clearImportState(jsonInput) {
    if (resourceJsonData === jsonInput) resourceJsonData = null;
    if (activeStandardInput === jsonInput) {
        activeStandardInput = null;
        activeStandardView = null;
        const root = document.getElementById('standard-viewer'); root.hidden = false;
        window.DSS_VIEWER.renderEmpty(root);
        document.getElementById('json-viewer').replaceChildren(); document.getElementById('json-viewer').hidden = true;
        document.getElementById('dss-filter').replaceChildren(); document.getElementById('dss-filter').hidden = true;
        document.getElementById('standard-back-browser').hidden = true;
        document.getElementById('download-changes').hidden = true;
        document.getElementById('standard-open-editor').hidden = false;
    }
    window.DSS_DOCUMENTS.clear(jsonInput);
    importDiagnosticCache.delete(jsonInput);
    jsonInput.dataset.json = '';
    jsonInput.dataset.importDiagnostics = '[]';
    jsonInput.dataset.importStats = '';
    jsonInput.dataset.importSourceType = '';
    jsonInput.dataset.importFileName = '';
}

function getCombinedDiagnostics(jsonInput) {
    const diagnostics = getStoredImportDiagnostics(jsonInput);

    if (!jsonInput || !jsonInput.dataset.json) {
        return diagnostics;
    }

    try {
        const jsonData = window.DSS_DOCUMENTS.read(jsonInput);
        const cacheable = jsonData && typeof jsonData === 'object';
        let checked = cacheable ? validationCache.get(jsonData) : null;
        if (!checked || checked.references !== configDict) { checked = { references: configDict, diagnostics: checkJsonValidity(jsonData, { structured: true }) }; if (cacheable) validationCache.set(jsonData, checked); }
        const validation = createValidationDiagnostics(checked.diagnostics).map(entry => ({
            ...entry, details: { ...(entry.details || {}), sourceInputId: jsonInput.id,
                sourceLabel: jsonInput.dataset.importFileName || ({ fileInput1: 'DSS1', fileInput2: 'DSS2', fileInputMerged: 'Sloučený standard' }[jsonInput.id] || 'Standard') }
        }));
        return diagnostics.concat(validation);
    } catch (error) {
        return diagnostics.concat([
            normalizeDiagnostic({
                severity: "error",
                code: "JSON_PARSE_ERROR",
                location: "Imported data",
                message: "Stored imported data is not valid JSON.",
                details: { error: error.message }
            })
        ]);
    }
}

function enableImportButtons(buttonLoadId, buttonCheckId, buttonDownloadId) {
    removeDisabled(buttonLoadId);
    removeDisabled(buttonCheckId);
    removeDisabled(buttonDownloadId);
}

function detectImportType(file, content) {
    const lowerName = (file && file.name ? file.name : "").toLowerCase();
    const trimmedContent = (content || "").trim();

    if (lowerName.endsWith(".ids")) {
        return "ids";
    }

    if (lowerName.endsWith(".json")) {
        return "json";
    }

    if (trimmedContent.startsWith("<")) {
        return "ids";
    }

    return "json";
}

function parseImportedContent(content, file) {
    const importType = detectImportType(file, content);

    if (importType === "ids") {
        const importer = window.IDS_IMPORTER;
        if (!importer || typeof importer.importIdsToDss !== "function") {
            return {
                success: false,
                importType,
                jsonData: null,
                diagnostics: [normalizeDiagnostic({
                    severity: "error",
                    code: "IDS_IMPORTER_MISSING",
                    location: "IDS import",
                    message: "IDS importer is not available."
                })]
            };
        }

        const imported = importer.importIdsToDss(content, {
            fileName: file && file.name ? file.name : "IDS import"
        });

        return {
            success: imported.success && !!imported.jsonData,
            importType,
            jsonData: imported.jsonData,
            stats: imported.stats || null,
            diagnostics: (imported.diagnostics || []).map(function (entry) {
                return normalizeDiagnostic(entry, "warning");
            })
        };
    }

    try {
        return {
            success: true,
            importType,
            jsonData: JSON.parse(content),
            stats: null,
            diagnostics: []
        };
    } catch (error) {
        return {
            success: false,
            importType,
            jsonData: null,
            diagnostics: [normalizeDiagnostic({
                severity: "error",
                code: "JSON_PARSE_ERROR",
                location: "JSON import",
                message: "The JSON file could not be parsed.",
                details: { error: error.message }
            })]
        };
    }
}

function storeImportedData(jsonInput, importResult, file) {
    const refreshViewer = activeStandardInput === jsonInput;
    if (resourceJsonData === jsonInput) resourceJsonData = null;
    const completed = window.DSS_HBH_AUTOMATIONS?.completeFromIfc(importResult.jsonData);
    window.DSS_DOCUMENTS.write(jsonInput, completed?.doc || importResult.jsonData);
    for (const change of completed?.changes || []) changedValues.add(JSON.stringify({ ...change, source: file?.name || jsonInput.id }));
    jsonInput.dataset.importDiagnostics = JSON.stringify(importResult.diagnostics || []);
    jsonInput.dataset.importStats = importResult.stats ? JSON.stringify(importResult.stats) : '';
    jsonInput.dataset.importSourceType = importResult.importType || "json";
    jsonInput.dataset.importFileName = file && file.name ? file.name : "";
    if (refreshViewer) openStandardBrowser(jsonInput);
}

function getOverviewBodyElement(jsonInput) {
    if (!jsonInput || !jsonInput.id) {
        return null;
    }

    const cardIdMap = {
        fileInput1: "json1-overview",
        fileInput2: "json2-overview"
    };
    const cardId = cardIdMap[jsonInput.id];

    if (!cardId) {
        return null;
    }

    const cardElement = document.getElementById(cardId);
    return cardElement ? cardElement.querySelector(".overview-body") : null;
}

function countTableEntries(table) {
    return Array.isArray(table) ? table.length : 0;
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = value == null ? "" : String(value);
    return element.innerHTML;
}

function getImportedDataOverview(jsonInput) {
    if (!jsonInput || !jsonInput.dataset.json) {
        return null;
    }

    try {
        const jsonData = window.DSS_DOCUMENTS.read(jsonInput);
        const dataSection = jsonData && typeof jsonData === "object" && jsonData.data && typeof jsonData.data === "object"
            ? jsonData.data
            : {};
        const tableNames = Object.keys(dataSection).filter(function (tableName) {
            return Array.isArray(dataSection[tableName]);
        });
        const totalRows = tableNames.reduce(function (sum, tableName) {
            return sum + dataSection[tableName].length;
        }, 0);

        return {
            fileName: jsonInput.dataset.importFileName || "Unnamed file",
            sourceType: (jsonInput.dataset.importSourceType || "json").toUpperCase(),
            tableCount: tableNames.length,
            totalRows: totalRows,
            propertyCount: countTableEntries(dataSection.Properties),
            groupCount: countTableEntries(dataSection.GroupsOfProperties),
            dataObjectCount: countTableEntries(dataSection.DataObjects),
            diagnosticsCount: getStoredImportDiagnostics(jsonInput).length,
            importStats: getStoredImportStats(jsonInput)
        };
    } catch (error) {
        return {
            parseError: true,
            fileName: jsonInput.dataset.importFileName || "Loaded file"
        };
    }
}

function renderJsonOverview(jsonInput) {
    const overviewBody = getOverviewBodyElement(jsonInput);
    if (!overviewBody) {
        return;
    }

    const overview = getImportedDataOverview(jsonInput);
    if (!overview) {
        overviewBody.innerHTML = '<div class="overview-placeholder">No file loaded yet.</div>';
        return;
    }

    if (overview.parseError) {
        overviewBody.innerHTML = `
            <div class="overview-file">${escapeHtml(overview.fileName)}</div>
            <div class="overview-placeholder">Loaded file could not be summarized.</div>
        `;
        return;
    }

    overviewBody.innerHTML = `
        <div class="overview-file">${escapeHtml(overview.fileName)}</div>
        <div class="overview-source">Source: ${escapeHtml(overview.sourceType)}</div>
        <dl class="overview-stats">
            <div><dt>Tables</dt><dd>${overview.tableCount}</dd></div>
            <div><dt>Total rows</dt><dd>${overview.totalRows}</dd></div>
            <div><dt>Properties</dt><dd>${overview.propertyCount}</dd></div>
            <div><dt>Groups</dt><dd>${overview.groupCount}</dd></div>
            <div><dt>DataObjects</dt><dd>${overview.dataObjectCount}</dd></div>
            <div><dt>Diagnostics</dt><dd>${overview.diagnosticsCount}</dd></div>
        </dl>
    `;

    if (overview.sourceType === "IDS" && overview.importStats) {
        const stats = overview.importStats;
        overviewBody.innerHTML += `
            <div class="overview-section-title">IDS Import Coverage</div>
            <dl class="overview-stats">
                ${stats.idsTitle ? `<div><dt>IDS title</dt><dd>${escapeHtml(stats.idsTitle)}</dd></div>` : ""}
                ${stats.idsVersion ? `<div><dt>IDS version</dt><dd>${escapeHtml(stats.idsVersion)}</dd></div>` : ""}
                <div><dt>Specifications</dt><dd>${stats.specificationsTotal}</dd></div>
                <div><dt>Applicability facets</dt><dd>${stats.applicabilityFacetsTotal}</dd></div>
                <div><dt>Requirement facets</dt><dd>${stats.requirementFacetsTotal}</dd></div>
                <div><dt>Property requirements</dt><dd>${stats.propertyRequirementsTotal}</dd></div>
                <div><dt>Mapped Properties</dt><dd>${stats.mappedProperties}</dd></div>
                <div><dt>Mapped Groups</dt><dd>${stats.mappedGroups}</dd></div>
                <div><dt>Mapped DataObjects</dt><dd>${stats.mappedDataObjects}</dd></div>
                <div><dt>Created enums</dt><dd>${stats.customEnumsCreated}</dd></div>
                <div><dt>Created IFC types</dt><dd>${stats.ifcTypesCreated}</dd></div>
                <div><dt>Unsupported applicability</dt><dd>${stats.unsupportedApplicability}</dd></div>
                <div><dt>Unsupported requirements</dt><dd>${stats.unsupportedRequirements}</dd></div>
            </dl>
        `;
    }
}

function renderImportDiagnostics(jsonInput) {
    displayErrors(getCombinedDiagnostics(jsonInput), $('#errors-viewer'));
}

function displayJson(origin, json, parentElement, originalJson, keyChain = [], depth = 0) {
    parentElement = parentElement || $("#json-viewer");
    // If the parent element is json-viewer, clear it
    if (parentElement.attr("id") === "json-viewer") {
        parentElement.empty();
        $("#dss-filter").empty();

        //remove all hoverbubbles
        $(".hover-bubble").remove();
    }

    if (typeof json === "object" && json !== null) {
        if (parentElement.attr("id") === "json-viewer" && json.hasOwnProperty("data")) {
            const buttonsContainer = $("<div class='buttons-container'></div>");
            const filter = document.getElementById("dss-filter");
            $("#dss-filter").append(buttonsContainer);

            const selectAllButton = $("<button></button>").text("View All").addClass("select-all-btn");
            const filterOutAllButton = $("<button></button>").text("Filter Out All").addClass("filter-out-all-btn");
            buttonsContainer.append(selectAllButton, filterOutAllButton);

            for (const key in json.data) {
                const button = $("<button></button>").text(key).addClass("filter-btn");
                buttonsContainer.append(button);

                button.click(function () {
                    $(this).toggleClass("filtered-out");
                    const isFilteredOut = $(this).hasClass("filtered-out");
                    const viewer = $("#json-viewer");

                    if (isFilteredOut) {
                        $(viewer).find(`.json-node[data-table="${key}"]`).hide();
                    } else {
                        $(viewer).find(`.json-node[data-table="${key}"]`).show();
                    }
                });
            }

            selectAllButton.click(function () {
                //for each button check if is filtered out, if so, send click
                $(".filter-btn").each(function () {
                    if ($(this).hasClass("filtered-out")) {
                        $(this).trigger("click");
                    }
                });
            });

            filterOutAllButton.click(function () {
                //for each button check if is filtered out, if not, send click
                $(".filter-btn").each(function () {
                    if (!$(this).hasClass("filtered-out")) {
                        $(this).trigger("click");
                    }
                });
            });
        }

        if (Array.isArray(json)) {
            for (let i = 0; i < json.length; i++) {
                const value = json[i];
                const nodeElement = $("<div class='json-node json-array-item'></div>").attr("data-table", i);
                //if parentElement does not contains  json-array-item class add it
                if (!parentElement.hasClass("json-array-parent")) {
                    parentElement.addClass("json-array-parent");
                }
                parentElement.append(nodeElement);

                const expandCollapseSymbol = '-';  //depth === 0 ? '-' : '+';
                const indexElement = $("<span class='json-array-index'></span>").html(`<span class="expand-collapse">${expandCollapseSymbol}</span> ${i}: `);
                nodeElement.append(indexElement);

                displayJson(origin, value, nodeElement, originalJson, keyChain.concat([i]), depth + 1);
            
                // Make the key clickable
                indexElement.click(function () {
                    const expandCollapse = $(this).find('.expand-collapse');
                    if (expandCollapse.text() === '+') {
                        expandCollapse.text('-');
                    } else {
                        expandCollapse.text('+');
                    }
                    $(this).siblings().toggle();
                });
            }
        } else {
            for (const key in json) {
                const value = json[key];
                const nodeElement = $("<div class='json-node'></div>").attr("data-table", key);
                parentElement.append(nodeElement);

                const expandCollapseSymbol = '-';
                const keyElement = $("<span class='json-key'></span>").html(`<span class="expand-collapse">${expandCollapseSymbol}</span> ${key}: `);
                nodeElement.append(keyElement);

                displayJson(origin, value, nodeElement, originalJson, keyChain.concat([key]), depth + 1);

                // Make the key clickable
                keyElement.click(function () {
                    const expandCollapse = $(this).find('.expand-collapse');
                    if (expandCollapse.text() === '+') {
                        expandCollapse.text('-');
                    } else {
                        expandCollapse.text('+');
                    }
                    $(this).siblings().toggle();
                });
            }
        }

    } else {
        //if key of the element is guid make it not editable
        editable = true;
        if (keyChain[keyChain.length - 1] === "guid" || origin !== "json1") {
            editable = false;
        }

        valueElement = $("<span contenteditable='" + editable + "'></span>");

        //if key of the element is in the configDict make it select instead of span
        if (configDict.hasOwnProperty(keyChain[keyChain.length - 1]) && configDict[keyChain[keyChain.length - 1]] !== keyChain[1]) {
            

            const selectElement = $("<select></select>").attr("data-keychain", JSON.stringify(keyChain));
            valueElement.append(selectElement);

            // Add the available options for the user to choose from

            const tableDataName = configDict[keyChain[keyChain.length - 1]];

            const options = [];

            for (const item of originalJson.data[tableDataName]) {
                if (!options.includes(item)) {
                    options.push(item);
                }
            }

            //append empty option
            const optionElement = $("<option></option>").text("").attr("value", "");
            selectElement.append(optionElement);

            for (const option of options) {
                const optionElement = $("<option></option>").text(JSON.stringify(option)).attr("value", option.guid);

                if (option.guid === json && json !== null && json !== undefined && json !== "") {
                    optionElement.attr("selected", "selected");
                }

                selectElement.append(optionElement);
            }

            // Listen for changes in the selected value
            selectElement.on("change", function() {
                handleValueChange($(this), originalJson);
            });

        }
        //if value is string (not guid and not from config), make it editable by writing it in span
        else {
            valueElement = $("<span contenteditable='" + editable + "'></span>").text(JSON.stringify(json)).attr("data-keychain", JSON.stringify(keyChain));            
        }

        parentElement.append(valueElement);

        //if value is changed mark it as modified
        //if keychain is in changedValues, mark it as modified
        let keyChainFound = false;
        for (const change of changedValues) {
            const parsedChange = JSON.parse(change);
            if (JSON.stringify(parsedChange.keyChain) === JSON.stringify(keyChain)) {
                keyChainFound = true;
                break;
            }
        }

        if (keyChainFound) {
            markAsModified(valueElement);
        }


        valueElement.on("blur", function () {
            if (!$(this).find("select").length) {
                handleValueChange($(this), originalJson);
            }
        });

        //check if keychain is at least 2 levels deep
        key = null;
        if (keyChain.length >= 2) {
            key = keyChain[keyChain.length - 1];
        }
        //if key is number, get previous level of keychain
        if (typeof key === "number") {
            if (keyChain.length >= 3) {
                key = keyChain[keyChain.length - 2];
            }
            else {
                key = null;
            }
        }

        if (key !== null) {
            if (configDict.hasOwnProperty(key) && typeof json === 'string') {
                const guid = json; // Assuming value is the guid
                if (isGuid(guid)) {

                    const formattedData = createHoverBubble(JSON.parse(JSON.stringify(originalJson)), key, guid);
                    const bubble = $('<div class="hover-bubble"></div>').html(formattedData);
                    $('body').append(bubble);
                    bubble.hide();

                    const hoverBubble = bubble;

                    valueElement.hover(
                        function () {
                            const headerBottom = document.querySelector('.app-header')?.getBoundingClientRect().bottom || 0;
                            hoverBubble.css({ left: 10, top: headerBottom + 10 });
                            hoverBubble.show();
                        },
                        function () {
                            hoverBubble.hide();
                        }
                    );

                    // Add click event to open a new window with the data
                    valueElement.click(function () {
                        if (ctrlKeyPressed) {
                            const dataWindow = window.open('', '_blank');
                            dataWindow.document.write('<html><head><title>Data</title></head><body>');
                            dataWindow.document.write(formattedData);
                            dataWindow.document.write('</body></html>');
                            dataWindow.document.close();
                        }
                    });
                }
            }
        }
    }
}

function handleValueChange(element, originalJson) {
    const newValue = element.is("select") ? JSON.stringify(element.val()) : element.text();
    const keyChain = JSON.parse(element.attr("data-keychain"));

    try {
        const parsedValue = JSON.parse(newValue);
        let originalValue = "";
        for (const change of changedValues) {
            const parsedChange = JSON.parse(change);
            if (JSON.stringify(parsedChange.keyChain) === JSON.stringify(keyChain)) {
                originalValue = parsedChange.oldValue;
                break;
            }
        }

        if (originalValue === "") {
            originalValue = getValueFromKeyChain(keyChain, originalJson);
        }

        const oldValue = JSON.stringify(originalValue);

        if (newValue !== oldValue) {
            updateOriginalJson(keyChain, parsedValue, originalJson);
            markAsModified(element, originalValue, parsedValue);
        } else {
            unmarkAsModified(element);
        }

    } catch (error) {
        element.text(JSON.stringify(getValueFromKeyChain(keyChain, originalJson)));
        alert("Invalid JSON value. Please enter a valid JSON value.");
    }
}

//hover bubble
function findDataByGuid(originalJson, tableName, guid) {
    const tableData = originalJson.data[tableName];
    if (!tableData || !Array.isArray(tableData)) return null;

    const data = tableData.find(item => item.guid === guid);

    if (hasPropertiesToLoadRecursively(data)) {
        // Load more data recursively
        for (const key in data) {
            if (configDict.hasOwnProperty(key) && (typeof data[key] === 'string' || Array.isArray(data[key]))) {
                if (isGuid(data[key])) {
                    const nestedData = findDataByGuid(originalJson, configDict[key], data[key]);
                    data[key] = nestedData;
                }
                if (Array.isArray(data[key]) && data[key].every(item => isGuid(item))) {
                    data[key] = data[key].map(item => findDataByGuid(originalJson, configDict[key], item));
                }
            }
        }
    }

    return data;
}

function hasPropertiesToLoadRecursively(obj) {
    for (const key in obj) {
        //if obj[key] is guid or array of guids return true
        if (configDict.hasOwnProperty(key) && (typeof obj[key] === 'string' || Array.isArray(obj[key]))) {
            if (isGuid(obj[key])) return true;
            if (Array.isArray(obj[key]) && obj[key].every(item => isGuid(item))) return true;
        }
        if (typeof obj[key] === 'object' && hasPropertiesToLoadRecursively(obj[key])) {
            return true;
        }
    }
    return false;
}

function createHoverBubble(originalJson, key, guid) {
    const tableName = configDict[key];
    if (!tableName) return;

    const data = findDataByGuid(originalJson, tableName, guid);
    if (!data) return;

    const formattedData = formatDataForHoverBubble(data);

    return formattedData;
}

function formatDataForHoverBubble(data) {
    function formatRow(key, value) {
        if (typeof value === 'object') {
            value = formatDataForHoverBubble(value);
        }
        return `
            <tr>
                <td class="key">${key}:</td>
                <td class="value">${value}</td>
            </tr>`;
    }

    let content = '<table>';
    for (const key in data) {
        content += formatRow(key, data[key]);
    }
    content += '</table>';
    return content;
}

function getValueFromKeyChain(keyChain, json) {
    let obj = json;
    for (const key of keyChain) {
        obj = obj[key];
    }
    return obj;
}

function markAsModified(valueElement, oldValue, newValue) {
    valueElement.addClass('modified-value');
    const keyChain = JSON.parse(valueElement.attr('data-keychain'));
    const changeObject = {
        "keyChain": keyChain,
        "oldValue": oldValue,
        "newValue": newValue
    };
    changedValues.add(JSON.stringify(changeObject));
}

function unmarkAsModified(valueElement) {
    valueElement.removeClass('modified-value');
    const keyChain = JSON.parse(valueElement.attr('data-keychain'));
    let changeObject = null;
    for (const change of changedValues) {
        const parsedChange = JSON.parse(change);
        if (JSON.stringify(parsedChange.keyChain) === JSON.stringify(keyChain)) {
            changeObject = change;
            break;
        }
    }
    if (changeObject) {
        changedValues.delete(changeObject);
    }
}

function updateOriginalJson(keyChain, parsedValue, originalJson) {
    let currentObj = originalJson;

    // Iterate through the keyChain until the second-to-last key
    for (let i = 0; i < keyChain.length - 1; i++) {
        currentObj = currentObj[keyChain[i]];
    }

    // Update the value at the final key in the keyChain
    currentObj[keyChain[keyChain.length - 1]] = parsedValue;
}

//go through show buttons which has id with "load" in it, add selected one style "button_selected"
function removeSelectedButton() {
    //get all buttons in document
    const buttons = document.getElementsByTagName("button");
    for (let i = 0; i < buttons.length; i++) {
        if (buttons[i].id.includes("load")) {
            buttons[i].classList.remove("selected");
        }
    }
}



function openStandardBrowser(input, button, notice) {
    try {
        if (resourceJsonData) saveModifiedJson(resourceJsonData);
        resourceJsonData = null;
        const doc = window.DSS_DOCUMENTS.read(input);
        const viewState = activeStandardInput === input ? activeStandardView?.state : undefined;
        activeStandardInput = input;
        document.getElementById('standard-viewer').hidden = false;
        document.getElementById('json-viewer').hidden = true;
        document.getElementById('json-viewer').replaceChildren();
        document.getElementById('dss-filter').hidden = true;
        document.getElementById('dss-filter').replaceChildren();
        document.getElementById('standard-back-browser').hidden = true;
        document.getElementById('download-changes').hidden = true;
        document.getElementById('standard-open-editor').hidden = false;
        activeStandardView = window.DSS_VIEWER.render(document.getElementById('standard-viewer'), doc, {
            label: input.dataset.importFileName || (input === fileInputMerged ? 'Sloučený standard' : 'Standard'),
            viewState,
            notice,
            getAutomationLibrary: () => window.DSS_VIEWER.automationCatalog([jsonInput1, jsonInput2, fileInputMerged].filter(source => source.dataset.json).map(source => window.DSS_DOCUMENTS.read(source))),
            onChange: (next, change) => {
                // Defaults use the in-place editor; other edits replace the
                // selected definition and rebuild the viewer's cached indexes.
                if (!next) { window.DSS_DOCUMENTS.write(input, doc); return; }
                if (window.DSS_DOCUMENTS.read(input) !== doc) throw new Error('Standard se mezitím změnil. Zavřete výběr a otevřete vlastnost znovu.');
                window.DSS_DOCUMENTS.write(input, next);
                for (const entry of change.changes) changedValues.add(JSON.stringify({ ...entry, source: input.dataset.importFileName || input.id }));
                window.DSS_MATCHING.refreshPropertyCommands(doc, next);
                openStandardBrowser(input, null, (change.kind === 'propertyDefinition' ? 'Definice vlastnosti uložena.' : change.kind === 'enumerationRemoval' ? 'Číselník odstraněn. Zrušených přiřazení: ' + change.unlinked + '.' : change.kind === 'groupAssignment' ? 'Skupiny přiřazeny objektům: ' + change.objectsChanged + ', nových vazeb: ' + change.linksAdded + '.' : change.kind === 'groupLibrary' ? `Přidáno skupin: ${change.counts.groups}, doplněno skupin: ${change.counts.groupsUpdated || 0}, nových vlastností: ${change.counts.properties}.` : change.kind === 'propertyEnumeration' ? 'Přiřazení číselníku uloženo.' : change.kind === 'enumerationImport' ? `Import číselníků: přidáno ${change.added}, nahrazeno ${change.replaced}, ponecháno ${change.skipped}.` : change.kind === 'enumeration' ? 'Číselník uložen.' : change.kind === 'typeAspect' ? 'Typový aspekt uložen.' : 'Přiřazení automatu uloženo.') + ' Upravený standard stáhnete tlačítkem Stáhnout.');
            }
        });
        removeSelectedButton();
        const selectedButton = button || document.getElementById(input === jsonInput1 ? 'load-json1' : input === jsonInput2 ? 'load-json2' : 'load-json-merged');
        if (selectedButton) selectedButton.classList.add('selected');
    } catch (error) { alert('Standard nelze zobrazit: ' + error.message); }
}

$('#load-json1').click(function () { openStandardBrowser(jsonInput1, this); });
$('#load-json2').click(function () { openStandardBrowser(jsonInput2, this); });
$('#load-json-merged').click(function () { openStandardBrowser(fileInputMerged, this); });

document.getElementById('standard-open-editor').onclick = () => {
    if (!activeStandardInput) { alert('Nejdřív vyberte DSS1, DSS2 nebo výsledek.'); return; }
    showLoadingSpinner();
    setTimeout(() => {
        try {
            const doc = window.DSS_DOCUMENTS.read(activeStandardInput);
            resourceJsonData = activeStandardInput;
            document.getElementById('standard-viewer').hidden = true;
            document.getElementById('json-viewer').hidden = false;
            document.getElementById('dss-filter').hidden = false;
            document.getElementById('standard-back-browser').hidden = false;
            document.getElementById('download-changes').hidden = false;
            document.getElementById('standard-open-editor').hidden = true;
            const origin = activeStandardInput === jsonInput1 ? 'json1' : activeStandardInput === jsonInput2 ? 'json2' : 'merged';
            displayJson(origin, doc, $('#json-viewer'), JSON.parse(JSON.stringify(doc)), []);
        } catch (error) { alert('Editor nelze otevřít: ' + error.message); }
        finally { hideLoadingSpinner(); }
    }, 0);
};
document.getElementById('standard-back-browser').onclick = () => { if (activeStandardInput) openStandardBrowser(activeStandardInput); };

function removeDisabled(elementId) {
    const button = document.getElementById(elementId);
    button.classList.remove('disabled');
    button.disabled = false;
}

//merge file
$('#merge-json').click(function () {
    let mergeSucceeded = false;
    try {

        showLoadingSpinner();
        if (resourceJsonData === jsonInput1 || resourceJsonData === jsonInput2) saveModifiedJson(resourceJsonData);
        const jsonData1 = window.DSS_DOCUMENTS.read(jsonInput1);
        const jsonData2 = window.DSS_DOCUMENTS.read(jsonInput2);
        //check if both jsons are valid
        if (jsonData1 && jsonData2) {
            const prepared = window.DSS_MATCHING.prepare(jsonData1, jsonData2);
            const mergedJson = mergeJson(prepared.target, prepared.source);
            mergedJson.mergeReport = prepared.report;
            document.getElementById('matching-result-report').textContent = prepared.report.message;
            if (resourceJsonData === fileInputMerged) resourceJsonData = null;
            window.DSS_DOCUMENTS.write(fileInputMerged, mergedJson);
            fileInputMerged.dataset.importDiagnostics = '[]';
            fileInputMerged.dataset.importSourceType = 'merged';
            if (activeStandardInput === fileInputMerged) openStandardBrowser(fileInputMerged);
            const outputBytes = new Blob([JSON.stringify(mergedJson, null, 2)]).size;
            const outputSize = outputBytes < 1024 * 1024 ? (outputBytes / 1024).toLocaleString('cs', { maximumFractionDigits: 1 }) + ' kB' : (outputBytes / (1024 * 1024)).toLocaleString('cs', { maximumFractionDigits: 2 }) + ' MB';
            document.getElementById('matching-result-size').textContent = `Výsledek: ${outputSize} · ${(mergedJson.data.DataObjects || []).length} objektů · ${(mergedJson.data.Properties || []).length} vlastností`;

            removeDisabled('load-json-merged');
            removeDisabled('download-merge');
            removeDisabled('check-json-merged');
            mergeSucceeded = true;
        }
        else {
            alert('Invalid JSON data');
        }
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
    finally {
        hideLoadingSpinner();
    }

    if (!mergeSucceeded) return;
    const button = document.getElementById('load-json-merged');

    if (fileInputMerged.dataset.json === '') {
        button.classList.add('disabled');
        button.disabled = true;
    } else {
        button.classList.remove('disabled');
        button.disabled = false;
        //show messege popup to user that json is merged
        alert('Jsons are merged and available to show in viewer or download', 'success');

        //let download merge button blink for 3 seconds
        blinkButton('download-merge')
        blinkButton('load-json-merged')
    }

});

function blinkButton(buttonId) {
    // Get button by id
    const button = $('#' + buttonId);

    button.addClass('blink');
    setTimeout(function () {
        button.removeClass('blink');
    }, 3000);
}

function mergeDeep(target, source) {
    const isObject = (obj) => obj && typeof obj === 'object';

    if (!isObject(target) || !isObject(source)) {
        return source;
    }

    Object.keys(source).forEach((key) => {
        const targetValue = target[key];
        const sourceValue = source[key];
        if (key === 'propertyDefaults' && Array.isArray(sourceValue)) {
            window.DSS_MODEL.mergePropertyDefaults(target, source);
            return;
        }
        if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
            const seen = new Set(targetValue.map(JSON.stringify));
            const mergedArray = targetValue.concat(sourceValue.filter(item => {
                const duplicate = seen.has(JSON.stringify(item));
                seen.add(JSON.stringify(item));
                return !duplicate;
            }));
            target[key] = mergedArray;
        } else if (isObject(targetValue) && isObject(sourceValue)) {
            target[key] = mergeDeep(Object.assign({}, targetValue), sourceValue);
        } else {
            if (sourceValue !== undefined && sourceValue !== null && sourceValue !== "") {
                target[key] = sourceValue;
            }
        }
    });

    return target;
}

function mergeJson(json1, json2) {
    //iterate through json1 and get number of objects together
    let numberOfObjects = 0;
    for (const table in json1.data) {
        if (json1.data.hasOwnProperty(table)) {
            numberOfObjects += json1.data[table].length;
        }
    }

    let solvedObjects = 0;
    // Iterate through each table in the first JSON object
    for (const table in json2.data) {
        if (json2.data.hasOwnProperty(table)) {
            const table1 = json1.data[table];
            const table2 = json2.data[table] || [];

            // Iterate through each object in the second table
            if ((table1 == undefined) && table2.length > 0) {
                //if there is no data in first json, copy the data from second json
                json1.data[table] = table2;
            }
            else {
                for (const obj2 of table2) {
                    // Check if there is a corresponding object in the first table with the same GUID
                    const obj1 = table1.find((obj) => obj.guid === obj2.guid);
                    if (obj1) {
                        // If a corresponding object exists, merge the objects recursively
                        mergeDeep(obj1, obj2);
                    } else {
                        // If a corresponding object does not exist, append the object from the second table to the first table as is
                        table1.push(obj2);
                    }
                    solvedObjects++;
                    if (solvedObjects % 10 === 0) {
                        //update progress bar
                        const progress = solvedObjects / numberOfObjects * 100;
                        updateProgressBar(progress);
                    }

                }
            }
        }
    }

    //iterate through properties which are not "data" and merge them
    for (const prop in json2) {
        if (json2.hasOwnProperty(prop) && prop !== "data") {
            json1[prop] = json2[prop];
        }
    }

    // Return the merged JSON object
    return json1;
}


function reconstructJson(node) {
    let result;

    if (node.hasClass('json-array-parent')) {
        result = [];
        node.children('.json-array-item').each(function () {
            const childResult = reconstructJson($(this));
            result.push(childResult);
        });
    }
    else if (node.attr('id') === 'json-viewer') {
        result = {};
        node.children('.json-node').each(function () {
            const childResult = reconstructJson($(this));
            const key = $(this).children('.json-key').text().slice(2, -2);
            result[key] = childResult;
        });

    } else if (node.children('.json-node').length > 0) {
        result = {};
        const children = node.children('.json-node');
        for (let i = 0; i < children.length; i++) {
            const childrenNode = $(children[i]);
            const childResult = reconstructJson(childrenNode);
            const key = childrenNode.children('.json-key').text().slice(2, -2);
            result[key] = childResult;
        }
    } else {
        const siblingValue = node.children('span[contenteditable="true"], span[contenteditable="false"]');

        if (siblingValue.length > 0) {
            try {
                //if siblingValue has a child item select, get its value, else get span text value
                if (siblingValue.children('select').length > 0) {
                    result = siblingValue.children('select').val();
                }
                else {
                    result = JSON.parse(siblingValue.text());
                }
            } catch (error) {
                console.error('Error parsing value:', siblingValue.text());
            }
        }
    }

    return result;
}

function saveModifiedJson(jsonInput) {
    if (resourceJsonData !== jsonInput || document.getElementById('json-viewer').hidden) return;
    if (jsonInput.dataset.json !== "") {
        try {
            const jsonViewer = $("#json-viewer");
            const modifiedJson = reconstructJson(jsonViewer);
            window.DSS_DOCUMENTS.write(jsonInput, modifiedJson);
        } catch (error) {
            console.error("Failed to save modified JSON:", error);
        }
    }
}

function downloadJsonFile(content, fileName) {
    const data = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(data);

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

$('#download-merge').click(function () {
    try {
        if (resourceJsonData !== null) {
            saveModifiedJson(resourceJsonData);
        }

        const jsonData = window.DSS_DOCUMENTS.read(fileInputMerged);
        const jsonContent = JSON.stringify(jsonData, null, 2);
        downloadJsonFile(jsonContent, "merged.json");
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});


$('#download-json1').click(function () {
    try {
        if (resourceJsonData !== null) {
            saveModifiedJson(resourceJsonData);
        }

        const jsonData = window.DSS_DOCUMENTS.read(jsonInput1);
        const jsonContent = JSON.stringify(jsonData, null, 2);
        downloadJsonFile(jsonContent, "json1.json");
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});


$('#download-json2').click(function () {
    try {
        if (resourceJsonData !== null) {
            saveModifiedJson(resourceJsonData);
        }

        const jsonData = window.DSS_DOCUMENTS.read(jsonInput2);
        const jsonContent = JSON.stringify(jsonData, null, 2);
        downloadJsonFile(jsonContent, "json2.json");
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});


$('#download-changes').click(function () {
    try {
        //create empty json of arry, then add the changes to array each as one object, then download the array as json
        json = [];
        for (const change of changedValues) {
            const parsedChange = JSON.parse(change);
            json.push(parsedChange);
        }

        const jsonContent = JSON.stringify(json, null, 2);
        downloadJsonFile(jsonContent, "changes.json");
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});



//check json validity
$('#check-json1').click(function () {
    try {
        displayErrors(getCombinedDiagnostics(jsonInput1), $('#errors-viewer'));
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});

$('#check-json2').click(function () {
    try {
        displayErrors(getCombinedDiagnostics(jsonInput2), $('#errors-viewer'));
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});

$('#check-json-merged').click(function () {
    try {
        displayErrors(getCombinedDiagnostics(fileInputMerged), $('#errors-viewer'));
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});

function checkJsonValidity(json, options = {}) {
    const diagnostics = window.DSS_VALIDATOR.validate(json, { references: configDict });
    return options.structured ? diagnostics : diagnostics.filter(entry => entry.severity === 'error').map(entry => entry.details && entry.details.technicalMessage || entry.message);
}

function isGuid(value) {
    return typeof value === "string" && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

function showDiagnosticRecord(details) {
    let dialog = document.getElementById('diagnostic-record-dialog');
    if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'diagnostic-record-dialog';
        dialog.className = 'diagnostic-record-dialog';
        document.body.append(dialog);
    }
    dialog.replaceChildren();
    const append = (tag, text) => { const node = document.createElement(tag); node.textContent = text; dialog.append(node); return node; };
    const heading = append('h2', details.sourceLabel + ' → ' + details.table + ' → ' + details.rowName);
    heading.id = 'diagnostic-record-title'; dialog.setAttribute('aria-labelledby', heading.id);
    const close = append('button', 'Zavřít'); close.type = 'button'; close.onclick = () => dialog.close();
    append('p', details.hint);
    append('p', 'Přesná cesta k problému: ' + details.path);
    try {
        const input = document.getElementById(details.sourceInputId);
        const json = window.DSS_DOCUMENTS.read(input);
        const table = json.data[details.table] || [];
        let row = table[details.rowIndex];
        if (details.rowGuid && (!row || row.guid !== details.rowGuid)) {
            const found = table.filter(item => item && item.guid === details.rowGuid);
            if (found.length !== 1) throw new Error('Záznam se od poslední kontroly změnil. Spusťte kontrolu znovu.');
            row = found[0];
        }
        if (row === undefined) throw new Error('Záznam už na této pozici není. Spusťte kontrolu znovu.');
        append('p', 'Náhled záznamu je pouze pro čtení. Změny proveďte ve standardu v uvedené tabulce a poli.');
        append('pre', JSON.stringify(row, null, 2));
    } catch (error) { append('p', 'Záznam nelze načíst: ' + error.message); }
    if (!dialog.open) dialog.showModal();
}

function displayErrors(errors, parentElement) {
    parentElement.empty();

    const normalized = (errors || []).map(function (entry) {
        return normalizeDiagnostic(entry, "error");
    });

    if (normalized.length === 0) {
        const noErrorsElement = $("<div>Kontrola nenašla žádné chyby ani varování.</div>");
        parentElement.append(noErrorsElement);
        return;
    }

    const groups = {
        error: [],
        warning: [],
        info: []
    };

    normalized.forEach(function (entry) {
        const severity = groups[entry.severity] ? entry.severity : "warning";
        groups[severity].push(entry);
    });

    ["error", "warning", "info"].forEach(function (severity) {
        if (groups[severity].length === 0) {
            return;
        }

        const section = $(`<div class="diagnostic-group diagnostic-group-${severity}"></div>`);
        const severityLabel = { error: 'Chyby', warning: 'Varování', info: 'Informace' }[severity];
        section.append($('<h4></h4>').text(`${severityLabel} (${groups[severity].length})`));
        const byType = new Map();
        for (const entry of groups[severity]) {
            const key = JSON.stringify([entry.code, entry.message, entry.details && entry.details.facetType]);
            if (!byType.has(key)) byType.set(key, []);
            byType.get(key).push(entry);
        }
        for (const entries of byType.values()) {
            const first = entries[0];
            const detail = $('<details class="diagnostic-summary"></details>');
            const facet = first.details && first.details.facetType;
            const descriptions = {
                IDS_APPLICABILITY_NOT_MAPPED: 'Omezení převodu: podmínka výběru je zachovaná v metadatech IDS.',
                IDS_REQUIREMENT_NOT_MAPPED: 'Omezení převodu: požadavek je zachovaný v metadatech IDS.'
            };
            detail.append($('<summary></summary>').text(`${entries.length}× ${descriptions[first.code] || first.message}${facet ? ' (' + facet + ')' : ''}`));
            if (severity === 'error') detail.attr('open', true);
            detail.append($('<div class="diagnostic-code"></div>').text(first.code));
            const content = $('<div></div>'); detail.append(content);
            function appendEntry(entry) {
                const item = $(`<div class="error-message error-message-${severity}"></div>`);
                const info = entry.details || {};
                item.append($('<div class="diagnostic-location"></div>').text([info.sourceLabel, entry.location].filter(Boolean).join(' → ')));
                item.append($('<div class="diagnostic-message"></div>').text(entry.message));
                if (info.hint) item.append($('<p class="diagnostic-hint"></p>').text('Kde hledat a co ověřit: ' + info.hint));
                if (info.usedBy && info.usedBy.length) {
                    const owners = info.usedBy.map(obj => `„${obj.name}“${obj.group ? ' (' + obj.group + ')' : ''}${obj.typeAspectCode ? ' ' + obj.typeAspectCode : ''}`);
                    item.append($('<p class="diagnostic-owners"></p>').text('Týká se objektů: ' + owners.join(', ') + (info.affectedObjects > owners.length ? ` a dalších ${info.affectedObjects - owners.length}.` : '.')));
                } else if (info.table && info.table !== 'DataObjects') {
                    item.append($('<p class="diagnostic-owners"></p>').text('U této položky nebylo dohledáno použití datovým objektem; může jít o samostatnou definici v číselníku.'));
                }
                if (info.sourceInputId && info.table && typeof info.rowIndex === 'number') {
                    item.append($('<button type="button" class="diagnostic-open-record">Ukázat záznam</button>').on('click', () => showDiagnosticRecord(info)));
                }
                if (entry.details) {
                    const technical = $('<details></details>'); technical.append($('<summary>Technické podrobnosti</summary>'));
                    if (info.path) technical.append($('<code class="diagnostic-path"></code>').text(info.path));
                    if (info.actual !== undefined) technical.append($('<p></p>').text('Aktuální hodnota: ' + info.actual));
                    technical.append($('<pre class="diagnostic-details"></pre>').text(JSON.stringify(entry.details, null, 2))); item.append(technical);
                }
                content.append(item);
            }
            entries.slice(0, 30).forEach(appendEntry);
            if (entries.length > 30 && severity === 'error') {
                let shown = 30;
                const more = $('<button type="button">Ukázat dalších 30 chyb</button>').on('click', () => {
                    entries.slice(shown, shown + 30).forEach(appendEntry); shown += 30;
                    if (shown >= entries.length) more.remove();
                });
                detail.append(more);
            } else if (entries.length > 30) detail.append($('<p></p>').text(`Zobrazeno prvních 30 z ${entries.length} opakovaných hlášení tohoto typu.`));
            section.append(detail);
        }

        parentElement.append(section);
    });
}

function disableImportButtons(buttonLoadId, buttonCheckId, buttonDownloadId) {
    [buttonLoadId, buttonCheckId, buttonDownloadId].forEach(function (buttonId) {
        const button = document.getElementById(buttonId);
        button.classList.add('disabled');
        button.disabled = true;
    });
}

function handleImportFailure(jsonInput, buttonLoadId, buttonCheckId, buttonDownloadId, diagnostics) {
    clearImportState(jsonInput);
    renderJsonOverview(jsonInput);
    disableImportButtons(buttonLoadId, buttonCheckId, buttonDownloadId);
    checkMergePossible();
    displayErrors(diagnostics, $('#errors-viewer'));
}

function handleImportedFile(file, dropZoneId, jsonInputId, buttonLoadId, buttonCheckId, buttonDownloadId) {
    const jsonInput = document.getElementById(jsonInputId);
    if (!file) {
        handleImportFailure(jsonInput, buttonLoadId, buttonCheckId, buttonDownloadId, []);
        hideLoadingSpinner();
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const importResult = parseImportedContent(e.target.result, file);

        if (!importResult.success || !importResult.jsonData) {
            handleImportFailure(jsonInput, buttonLoadId, buttonCheckId, buttonDownloadId, importResult.diagnostics || []);
            hideLoadingSpinner();
            return;
        }

        storeImportedData(jsonInput, importResult, file);
        renderJsonOverview(jsonInput);
        $(`#${dropZoneId}-text`).text(`File loaded: ${file.name} (${importResult.importType.toUpperCase()})`);
        enableImportButtons(buttonLoadId, buttonCheckId, buttonDownloadId);
        renderImportDiagnostics(jsonInput);
        hideLoadingSpinner();
        checkMergePossible();

        const importLabel = importResult.importType === "ids" ? "IDS" : "JSON";
        const diagnostics = getCombinedDiagnostics(jsonInput);
        const errorCount = diagnostics.filter(x => x.severity === 'error').length;
        const warningCount = diagnostics.filter(x => x.severity === 'warning').length;
        const infoCount = diagnostics.filter(x => x.severity === 'info').length;
        alert(`${importLabel}: import dokončen. Chyby: ${errorCount}, varování: ${warningCount}, informace: ${infoCount}. Podrobnosti najdete v Kontrole importu.`);
        blinkButton(buttonLoadId);
        blinkButton(buttonDownloadId);
    };

    reader.onerror = function () {
        handleImportFailure(
            jsonInput,
            buttonLoadId,
            buttonCheckId,
            buttonDownloadId,
            [normalizeDiagnostic({
                severity: "error",
                code: "FILE_READ_ERROR",
                location: file.name,
                message: "The selected file could not be read."
            })]
        );
        hideLoadingSpinner();
    };

    reader.readAsText(file);
}

function handleFileSelect(event, dropZoneId, jsonInputId, buttonLoadId, buttonCheckId, buttonDownloadId) {
    event.stopPropagation();
    event.preventDefault();
    const file = event.dataTransfer ? event.dataTransfer.files[0] : event.target.files[0];
    showLoadingSpinner();
    handleImportedFile(file, dropZoneId, jsonInputId, buttonLoadId, buttonCheckId, buttonDownloadId);
}

function handleDragOver(event) {
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
}

dropZone1.addEventListener("dragover", handleDragOver);
dropZone1.addEventListener("drop", function (event) {
    handleFileSelect(event, 'drop-zone1', 'fileInput1', 'load-json1', 'check-json1', 'download-json1');
});
dropZone1.addEventListener("click", function () {
    clickToUpload('fileInput1', 'drop-zone1');
});

dropZone2.addEventListener("dragover", handleDragOver);
dropZone2.addEventListener("drop", function (event) {
    handleFileSelect(event, 'drop-zone2', 'fileInput2', 'load-json2', 'check-json2', 'download-json2');
});
dropZone2.addEventListener("click", function () {
    clickToUpload('fileInput2', 'drop-zone2');
});

function clickToUpload(inputId, dropZoneId) {
    const fileInput = document.getElementById(inputId);
    showLoadingSpinner();
    fileInput.click();
    setTimeout(function () {
        hideLoadingSpinner();
    }, 500);
}

function handleFileInputChange(event, dropZoneId, jsonInputId, buttonLoadId, buttonCheckId, buttonDownloadId) {
    if (event.target.files.length === 0) {
        hideLoadingSpinner();
        return;
    }

    handleImportedFile(event.target.files[0], dropZoneId, jsonInputId, buttonLoadId, buttonCheckId, buttonDownloadId);
}

function checkMergePossible() {
    const buttonMerge = document.getElementById('merge-json');

    if (jsonInput1.dataset.json !== '' && jsonInput2.dataset.json !== '' && jsonInput1.dataset.json !== undefined && jsonInput2.dataset.json !== undefined) {
        buttonMerge.classList.remove('disabled');
        buttonMerge.disabled = false;
    } else {
        buttonMerge.classList.add('disabled');
        buttonMerge.disabled = true;
    }
}

document.getElementById("fileInput1").addEventListener("change", function (event) {
    handleFileInputChange(event, 'drop-zone1', 'fileInput1', 'load-json1', 'check-json1', 'download-json1');
});

document.getElementById("fileInput2").addEventListener("change", function (event) {
    handleFileInputChange(event, 'drop-zone2', 'fileInput2', 'load-json2', 'check-json2', 'download-json2');
});

// Header shortcuts delegate to the original actions and mirror their availability.
function bindHeaderAction(headerId, actionId) {
    const shortcut = document.getElementById(headerId), action = document.getElementById(actionId);
    if (!shortcut || !action) return;
    const sync = () => {
        shortcut.disabled = action.disabled;
        shortcut.classList.toggle('disabled', action.disabled);
    };
    shortcut.onclick = () => { if (!action.disabled) action.click(); };
    new MutationObserver(sync).observe(action, { attributes: true, attributeFilter: ['disabled'] });
    sync();
}
bindHeaderAction('header-merge-json', 'merge-json');
bindHeaderAction('header-download-merge', 'download-merge');
