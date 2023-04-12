const dropZone1 = document.getElementById("drop-zone1");
const dropZone2 = document.getElementById("drop-zone2");
const jsonInput1 = document.getElementById("fileInput1");
const jsonInput2 = document.getElementById("fileInput2");

const localStructureData = {
    "groupsOfProperties": "GroupsOfProperties",
    "property": "Properties",
    "customEnum": "CustomEnums",
    "geometricalType": "GeometricalTypes",
    "color": "Colors",
    "precision": "GraphicalPrecisions",
    "properties": "Properties",
    "ifcType": "IfcTypes",
    "unit": "Units"
}
let configDict = {};

// Load the config file and store the data in the configDict object
fetch('../structure/structure.json')
    .then(response => response.json())
    .then(data => {
        configDict = data;
    })
    .catch(error => {

        configDict = localStructureData; // Assign the local JSON data directly
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

        //if displayJson is merge or json2 make it not editable        

        const valueElement = $("<span contenteditable='" + editable + "'></span>").text(JSON.stringify(json)).attr("data-keychain", JSON.stringify(keyChain));
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
            const newValue = $(this).text();
            const keyChain = JSON.parse($(this).attr("data-keychain"));

            try {
                const parsedValue = JSON.parse(newValue);
                //check if value is already changed
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
                    markAsModified($(this), originalValue, parsedValue);
                } else {
                    unmarkAsModified($(this));
                }

            } catch (error) {
                // If the input is invalid JSON, revert the change
                $(this).text(JSON.stringify(json));
                alert("Invalid JSON value. Please enter a valid JSON value.");
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

$('#load-json1').click(function () {
    try {
        showLoadingSpinner();
        const jsonData = JSON.parse(jsonInput1.dataset.json);

        if (resourceJsonData !== null) {
            saveModifiedJson(resourceJsonData);
        }
        resourceJsonData = jsonInput1;

        displayJson("json1", jsonData, $('#json-viewer'), JSON.parse(JSON.stringify(jsonData)), []);
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
     finally {
        hideLoadingSpinner();
    }
});

$('#load-json2').click(function () {
    try {
        showLoadingSpinner();
        const jsonData = JSON.parse(jsonInput2.dataset.json);

        if (resourceJsonData !== null) {
            saveModifiedJson(resourceJsonData);
        }
        resourceJsonData = jsonInput2;
        displayJson("json2", jsonData, $('#json-viewer'), JSON.parse(JSON.stringify(jsonData)), []);
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
    finally {
       hideLoadingSpinner();
   }
});

$('#load-json-merged').click(function () {
    try {
        showLoadingSpinner();
        const jsonData = JSON.parse(fileInputMerged.dataset.json);

        if (resourceJsonData !== null) {
            saveModifiedJson(resourceJsonData);
        }
        resourceJsonData = fileInputMerged;
        displayJson("merged", jsonData, $('#json-viewer'), JSON.parse(JSON.stringify(jsonData)), []);
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
    finally {
       hideLoadingSpinner();
   }
});


function removeDisabled(elementId) {
    const button = document.getElementById(elementId);
    button.classList.remove('disabled');
    button.disabled = false;
}

//merge file
$('#merge-json').click(function () {
    showLoadingSpinner();

    try {
        const jsonData1 = JSON.parse(jsonInput1.dataset.json);
        const jsonData2 = JSON.parse(jsonInput2.dataset.json);
        //check if both jsons are valid
        if (jsonData1 && jsonData2) {
            const mergedJson = mergeJson(jsonData1, jsonData2);

            if (resourceJsonData !== null) {
                saveModifiedJson(resourceJsonData);
            }
            resourceJsonData = fileInputMerged;
            displayJson("merged", mergedJson, $('#json-viewer'), JSON.parse(JSON.stringify(mergedJson)), []);
            fileInputMerged.dataset.json = JSON.stringify(mergedJson);

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
    finally{
        hideLoadingSpinner();
    }

    const button = document.getElementById('load-json-merged');

    if (fileInputMerged.dataset.json === '') {
        button.classList.add('disabled');
        button.disabled = true;
    } else {
        button.classList.remove('disabled');
        button.disabled = false;
    }

});

function mergeDeep(target, source) {
    const isObject = (obj) => obj && typeof obj === 'object';

    if (!isObject(target) || !isObject(source)) {
        return source;
    }

    Object.keys(source).forEach((key) => {
        const targetValue = target[key];
        const sourceValue = source[key];
        if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
            target[key] = targetValue.concat(sourceValue);
        } else if (isObject(targetValue) && isObject(sourceValue)) {
            target[key] = mergeDeep(Object.assign({}, targetValue), sourceValue);
        } else {
            if (sourceValue !== undefined && sourceValue !== null && sourceValue !== ""){
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
                const parsedValue = JSON.parse(siblingValue.text());
                result = parsedValue;
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
        const jsonData = JSON.parse(fileInputMerged.dataset.json);
        const jsonContent = JSON.stringify(jsonData, null, 2);
        downloadJsonFile(jsonContent, "merged.json");
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});


$('#download-json1').click(function () {
    try {
        const jsonData = JSON.parse(jsonInput1.dataset.json);
        const jsonContent = JSON.stringify(jsonData, null, 2);
        downloadJsonFile(jsonContent, "json1.json");
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});


$('#download-json2').click(function () {
    try {
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
        const jsonData = JSON.parse(jsonInput1.dataset.json);
        const errors = checkJsonValidity(jsonData);
        displayErrors(errors, $('#errors-viewer'));
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});

$('#check-json2').click(function () {
    try {
        const jsonData = JSON.parse(jsonInput2.dataset.json);
        const errors = checkJsonValidity(jsonData);
        displayErrors(errors, $('#errors-viewer'));
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});

$('#check-json-merged').click(function () {
    try {
        const jsonData = JSON.parse(fileInputMerged.dataset.json);
        const errors = checkJsonValidity(jsonData);
        displayErrors(errors, $('#errors-viewer'));
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});

function checkJsonValidity(json) {
    const guids = new Set();
    const errors = [];

    // Collect all the GUIDs from the JSON object
    for (const table in json.data) {
        if (json.data.hasOwnProperty(table)) {
            const tableData = json.data[table];
            for (const obj of tableData) {
                guids.add(obj.guid);
            }
        }
    }

    // Check that all the GUID references in the JSON object exist
    for (const table in json.data) {
        if (json.data.hasOwnProperty(table)) {
            const tableData = json.data[table];
            for (const objIndex in tableData) {
                if (tableData.hasOwnProperty(objIndex)) {
                    const obj = tableData[objIndex];
                    for (const prop in obj) {
                        if (obj.hasOwnProperty(prop)) {
                            const value = obj[prop];
                            if (Array.isArray(value)) {
                                // Check if the value is an array of GUID references
                                for (const item of value) {
                                    if (isGuid(item)) {
                                        if (!guids.has(item)) {
                                            errors.push(`Invalid GUID reference: ${item} in table ${table}, object index ${objIndex}, property ${prop}`);
                                        }
                                    }
                                }
                            } else if (isGuid(value)) {
                                // Check if the value is a single GUID reference
                                if (!guids.has(value)) {
                                    errors.push(`Invalid GUID reference: ${value} in table ${table}, object index ${objIndex}, property ${prop}`);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    return errors;
}

function isGuid(value) {
    const guidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    return typeof value === "string" && guidPattern.test(value);
}

function displayErrors(errors, parentElement) {
    parentElement.empty();

    if (errors.length === 0) {
        const noErrorsElement = $("<div>No errors found</div>");
        parentElement.append(noErrorsElement);
        return;
    }

    for (let i = 0; i < errors.length; i++) {
        const error = errors[i];
        const errorElement = $(
            `<div class="error-message">${error}</div>`
        );
        parentElement.append(errorElement);
    }
}

//get json file
function handleFileSelect(event, callback) {
    event.stopPropagation();
    event.preventDefault();

    const file = event.dataTransfer ? event.dataTransfer.files[0] : event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {

        callback(e.target.result, file);
    };
    reader.readAsText(file, 'UTF-8');
}

function handleDragOver(event) {
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
}

dropZone1.addEventListener("dragover", handleDragOver);
dropZone1.addEventListener("drop", function (event) {
    showLoadingSpinner();
    handleFileSelect(event, function (content, file) {
        jsonInput1.dataset.json = content;
        const jsonData = JSON.parse(jsonInput1.dataset.json);

        if (resourceJsonData !== null) {
            saveModifiedJson(resourceJsonData);
        }
        resourceJsonData = jsonInput1;
        displayJson("json1", jsonData, $('#json-viewer'), JSON.parse(JSON.stringify(jsonData)), []);
        $("#drop-zone1-text").text("File loaded: " + file.name);
        hideLoadingSpinner();
    });

});

dropZone1.addEventListener("click", function () {
    showLoadingSpinner();
    jsonInput1.click();
    //wait 500 ms and hide spinner
    setTimeout(function () {
        hideLoadingSpinner();
    }, 500);
});

dropZone2.addEventListener("dragover", handleDragOver);
dropZone2.addEventListener("drop", function (event) {
    showLoadingSpinner();
    handleFileSelect(event, function (content, file) {
        jsonInput2.dataset.json = content;
    });
    const jsonData = JSON.parse(jsonInput2.dataset.json);

    if (resourceJsonData !== null) {
        saveModifiedJson(resourceJsonData);
    }
    resourceJsonData = jsonInput2;
    displayJson("json2", jsonData, $('#json-viewer'), JSON.parse(JSON.stringify(jsonData)), []);
    $("#drop-zone2-text").text("File loaded: " + file.name);
    hideLoadingSpinner();
});

dropZone2.addEventListener("click", function () {
    showLoadingSpinner();
    jsonInput2.click();
    //wait 500 ms and hide spinner
    setTimeout(function () {
        hideLoadingSpinner();
    }, 500);
});

function clickToUpload(inputId, dropZoneId) {
    const fileInput = document.getElementById(inputId);
    //get spinner based on dropzone id
    showLoadingSpinner();
    fileInput.click();

    //wait 500 ms and hide spinner
    setTimeout(function () {
        hideLoadingSpinner();
    }, 500);
}

function handleFileInputChange(event, dropZoneId, jsonInputId, buttonLoadId, buttonCheckId, buttonDownloadId) {
    const jsonNumber = "json" + dropZoneId.slice(-1);
    const buttonLoad = document.getElementById(buttonLoadId);
    const buttonDownload = document.getElementById(buttonDownloadId);
    const buttonCheck = document.getElementById(buttonCheckId);
    const jsonInput = document.getElementById(jsonInputId);

    if (event.target.files.length === 0) {
        hideLoadingSpinner();
    }

    const file = event.target.files[0];
    if (file) {
        showLoadingSpinner();
        const reader = new FileReader();
        reader.onload = function (e) {
            const jsonData = JSON.parse(e.target.result);

            if (resourceJsonData !== null) {
                saveModifiedJson(resourceJsonData);
            }
            resourceJsonData = jsonInput;
            displayJson(jsonNumber, jsonData, $('#json-viewer'), JSON.parse(JSON.stringify(jsonData)), []);
            $(`#${dropZoneId}-text`).text("File loaded: " + file.name);
            jsonInput.dataset.json = JSON.stringify(jsonData);

            if (jsonInput.dataset.json !== '') {
                buttonLoad.classList.remove('disabled');
                buttonLoad.disabled = false;
                buttonCheck.classList.remove('disabled');
                buttonCheck.disabled = false;
                buttonDownload.classList.remove('disabled');
                buttonDownload.disabled = false;
            }

            hideLoadingSpinner();
            checkMergePossible();
        };
        reader.readAsText(file);
    } else {
        buttonLoad.classList.add('disabled');
        buttonLoad.disabled = true;
    }

}

function checkMergePossible() {
    const jsonInput1 = document.getElementById('fileInput1');
    const jsonInput2 = document.getElementById('fileInput2');
    const buttonMerge = document.getElementById('merge-json');

    //if both inputs hava data and are not undefined enable merge button
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