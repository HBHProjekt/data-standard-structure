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
        return JSON.parse(jsonInput.dataset.importDiagnostics).map(function (entry) {
            return normalizeDiagnostic(entry, "warning");
        });
    } catch (error) {
        return [normalizeDiagnostic({
            severity: "warning",
            code: "IMPORT_DIAGNOSTICS_PARSE_ERROR",
            location: "Imported diagnostics",
            message: "Stored import diagnostics could not be parsed."
        })];
    }
}

function clearImportState(jsonInput) {
    jsonInput.dataset.json = '';
    jsonInput.dataset.importDiagnostics = '[]';
    jsonInput.dataset.importSourceType = '';
    jsonInput.dataset.importFileName = '';
}

function getCombinedDiagnostics(jsonInput) {
    const diagnostics = getStoredImportDiagnostics(jsonInput);

    if (!jsonInput || !jsonInput.dataset.json) {
        return diagnostics;
    }

    try {
        const jsonData = JSON.parse(jsonInput.dataset.json);
        return diagnostics.concat(createValidationDiagnostics(checkJsonValidity(jsonData)));
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
    jsonInput.dataset.json = JSON.stringify(importResult.jsonData);
    jsonInput.dataset.importDiagnostics = JSON.stringify(importResult.diagnostics || []);
    jsonInput.dataset.importSourceType = importResult.importType || "json";
    jsonInput.dataset.importFileName = file && file.name ? file.name : "";
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

                    // Update the hover bubble position to 10 pixels from left top corner according to scrolling
                    $(document).on('scroll', function (e) {
                        bubble.css({
                            left: $(window).scrollLeft() + 10,
                            top: $(window).scrollTop() + 10
                        });
                    });
                    const hoverBubble = bubble;

                    valueElement.hover(
                        function () {
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



$('#load-json1').click(function () {
    // Add the confirmation
    const userConfirmed = window.confirm('Loading the file to the viewer may take some time. Are you sure you want to proceed?');

    // If the user confirmed, proceed with loading the JSON
    if (userConfirmed) {
        showLoadingSpinner();

        setTimeout(() => {
            try {
                const jsonData = JSON.parse(jsonInput1.dataset.json);

                if (resourceJsonData !== null) {
                    saveModifiedJson(resourceJsonData);
                }
                resourceJsonData = jsonInput1;

                displayJson("json1", jsonData, $('#json-viewer'), JSON.parse(JSON.stringify(jsonData)), []);

                removeSelectedButton();
                this.classList.add("selected");
            } catch (error) {
                alert('Invalid JSON data: ' + error.message);
            }
            finally {
                hideLoadingSpinner();
            }

        }, 0);
    } else {
        console.log('User cancelled loading the file to the viewer.');
    }
});

$('#load-json2').click(function () {
    // Add the confirmation
    const userConfirmed = window.confirm('Loading the file to the viewer may take some time. Are you sure you want to proceed?');

    // If the user confirmed, proceed with loading the JSON
    if (userConfirmed) {
        showLoadingSpinner();

        setTimeout(() => {
            try {
                const jsonData = JSON.parse(jsonInput2.dataset.json);

                if (resourceJsonData !== null) {
                    saveModifiedJson(resourceJsonData);
                }
                resourceJsonData = jsonInput2;
                displayJson("json2", jsonData, $('#json-viewer'), JSON.parse(JSON.stringify(jsonData)), []);

                removeSelectedButton();
                this.classList.add("selected");
            } catch (error) {
                alert('Invalid JSON data: ' + error.message);
            }
            finally {
                hideLoadingSpinner();
            }

        }, 0);
    } else {
        console.log('User cancelled loading the file to the viewer.');
    }
});

$('#load-json-merged').click(function () {
    // Add the confirmation
    const userConfirmed = window.confirm('Loading the file to the viewer may take some time. Are you sure you want to proceed?');

    // If the user confirmed, proceed with loading the JSON
    if (userConfirmed) {
        showLoadingSpinner();

        setTimeout(() => {
            try {

                const jsonData = JSON.parse(fileInputMerged.dataset.json);

                if (resourceJsonData !== null) {
                    saveModifiedJson(resourceJsonData);
                }
                resourceJsonData = fileInputMerged;
                displayJson("merged", jsonData, $('#json-viewer'), JSON.parse(JSON.stringify(jsonData)), []);

                removeSelectedButton();
                this.classList.add("selected");
            } catch (error) {
                alert('Invalid JSON data: ' + error.message);
            }
            finally {
                hideLoadingSpinner();
            }

        }, 0);
    } else {
        console.log('User cancelled loading the file to the viewer.');
    }
});


function removeDisabled(elementId) {
    const button = document.getElementById(elementId);
    button.classList.remove('disabled');
    button.disabled = false;
}

//merge file
$('#merge-json').click(function () {

    try {

        showLoadingSpinner();
        const jsonData1 = JSON.parse(jsonInput1.dataset.json);
        const jsonData2 = JSON.parse(jsonInput2.dataset.json);
        //check if both jsons are valid
        if (jsonData1 && jsonData2) {
            const mergedJson = mergeJson(jsonData1, jsonData2);
            fileInputMerged.dataset.json = JSON.stringify(mergedJson);
            fileInputMerged.dataset.importDiagnostics = '[]';
            fileInputMerged.dataset.importSourceType = 'merged';

            removeDisabled('load-json-merged');
            removeDisabled('download-merge');
            removeDisabled('check-json-merged');
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
    if (jsonInput.dataset.json !== "") {
        try {
            const jsonViewer = $("#json-viewer");
            const modifiedJson = reconstructJson(jsonViewer);
            jsonInput.dataset.json = JSON.stringify(modifiedJson);
            console.log("Saving modified JSON:", modifiedJson);
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
        resourceJsonData = fileInputMerged;

        const jsonData = JSON.parse(fileInputMerged.dataset.json);
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
        resourceJsonData = jsonInput1;

        const jsonData = JSON.parse(jsonInput1.dataset.json);
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
        resourceJsonData = jsonInput2;

        const jsonData = JSON.parse(jsonInput2.dataset.json);
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

function checkJsonValidity(json) {
    if (!json || typeof json !== "object") {
        return ["JSON root must be an object."];
    }

    if (!json.data || typeof json.data !== "object") {
        return ["JSON must contain a data object."];
    }

    const guids = new Set();
    const errors = [];
    const tables = dssModel.tables || {};

    for (const tableName in tables) {
        if (!Object.prototype.hasOwnProperty.call(json.data, tableName)) {
            continue;
        }

        if (!Array.isArray(json.data[tableName])) {
            errors.push(`Invalid table definition: ${tableName} must be an array.`);
            continue;
        }

        for (const obj of json.data[tableName]) {
            if (typeof obj !== "object" || obj === null) {
                errors.push(`Invalid table row: ${tableName} contains a non-object value.`);
                continue;
            }

            for (const field of tables[tableName].requiredFields || []) {
                if (!Object.prototype.hasOwnProperty.call(obj, field)) {
                    errors.push(`Missing required field '${field}' in table ${tableName}.`);
                }
            }
        }
    }

    // Collect all the GUIDs from the JSON object
    for (const table in json.data) {
        if (json.data.hasOwnProperty(table)) {
            const tableData = json.data[table];
            if (!Array.isArray(tableData)) {
                continue;
            }
            for (const obj of tableData) {
                if (obj && typeof obj === "object" && isGuid(obj.guid)) {
                    //add guid and table name to set of guids
                    guids.add(obj.guid);
                }
                else {
                    errors.push(`Invalid GUID value: Table ${table}, object GUID ${obj && typeof obj === "object" ? obj.guid : obj}`);
                }

            }
        }
    }

    // Check that all the GUID references in the JSON object exist
    for (const table in json.data) {
        if (json.data.hasOwnProperty(table)) {

            const tableData = json.data[table];
            if (!Array.isArray(tableData)) {
                continue;
            }
            for (const objIndex in tableData) {
                if (tableData.hasOwnProperty(objIndex)) {
                    const obj = tableData[objIndex];
                    if (!obj || typeof obj !== "object") {
                        continue;
                    }
                    for (const prop in obj) {
                        if (obj.hasOwnProperty(prop)) {
                            const value = obj[prop];
                            const guid = obj.hasOwnProperty('guid') ? obj.guid : null;
                            checkGUIDRecursively(value, guids, errors, table, objIndex, prop, guid);
                        }
                    }
                }
            }
        }
    }

    return errors;
}

function checkGUIDRecursively(value, guids, errors, table, objIndex, prop, guid) {

    if (configDict.hasOwnProperty(prop)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                if (isGuid(item)) {
                    if (!guids.has(item)) {
                        errors.push(`Invalid GUID reference: ${item} has no reference. Table ${table}, object index ${objIndex}, object guid ${guid}, property ${prop}`);
                    }
                } else {
                    errors.push(`Invalid GUID definition: '${item}' is not GUID. Table ${table}, object index ${objIndex}, object guid ${guid}, property ${prop}`);
                }
            }
        } else {
            if (isGuid(value)) {
                if (!guids.has(value)) {
                    errors.push(`Invalid GUID reference: ${value} has no reference. Table ${table}, object index ${objIndex}, object guid ${guid}, property ${prop}`);
                }
            } else {
                if (!(prop === 'customEnum' && value === '') && !(prop === 'unit' && table === 'Units')) {
                    errors.push(`Invalid GUID definition: '${value}' is not GUID. Table ${table}, object index ${objIndex}, object guid ${guid}, property ${prop}`);
                }
            }
        }
    } else if (typeof value === 'object' && value !== null) {
        for (const key in value) {
            if (value.hasOwnProperty(key)) {
                const element = value[key];
                const guidUnder = value.hasOwnProperty('guid') ? value.guid : null;
                checkGUIDRecursively(element, guids, errors, table, objIndex, key, guidUnder);
            }
        }
    }
}

function isGuid(value) {
    const guidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    return typeof value === "string" && guidPattern.test(value);
}

function displayErrors(errors, parentElement) {
    parentElement.empty();

    const normalized = (errors || []).map(function (entry) {
        return normalizeDiagnostic(entry, "error");
    });

    if (normalized.length === 0) {
        const noErrorsElement = $("<div>No errors found</div>");
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
        section.append(`<h4>${severity.toUpperCase()} (${groups[severity].length})</h4>`);

        groups[severity].forEach(function (entry) {
            const location = entry.location ? `<div class="diagnostic-location">${entry.location}</div>` : "";
            const code = entry.code ? `<div class="diagnostic-code">${entry.code}</div>` : "";
            const details = entry.details ? `<pre class="diagnostic-details">${JSON.stringify(entry.details, null, 2)}</pre>` : "";
            section.append(`
                <div class="error-message error-message-${severity}">
                    ${location}
                    <div class="diagnostic-message">${entry.message}</div>
                    ${code}
                    ${details}
                </div>
            `);
        });

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
        $(`#${dropZoneId}-text`).text(`File loaded: ${file.name} (${importResult.importType.toUpperCase()})`);
        enableImportButtons(buttonLoadId, buttonCheckId, buttonDownloadId);
        renderImportDiagnostics(jsonInput);
        hideLoadingSpinner();
        checkMergePossible();

        const diagnosticCount = getStoredImportDiagnostics(jsonInput).length;
        const importLabel = importResult.importType === "ids" ? "IDS" : "JSON";
        alert(`${importLabel} import finished${diagnosticCount > 0 ? ` with ${diagnosticCount} diagnostics` : ""}.`);
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