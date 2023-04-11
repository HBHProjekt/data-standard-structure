
function displayJson(json, parentElement, depth = 0) {
    parentElement = parentElement || $("#json-viewer");
    // If the parent element is json-viewer, clear it
    if (parentElement.attr("id") === "json-viewer") {
        parentElement.empty();
    }

    if (typeof json === "object" && json !== null) {
        if (parentElement.attr("id") === "json-viewer" && json.hasOwnProperty("data")) {
            const buttonsContainer = $("<div class='buttons-container'></div>");
            parentElement.append(buttonsContainer);

            const selectAllButton = $("<button></button>").text("Select All").addClass("select-all-btn");
            const filterOutAllButton = $("<button></button>").text("Filter Out All").addClass("filter-out-all-btn");
            buttonsContainer.append(selectAllButton, filterOutAllButton);

            for (const key in json.data) {
                const button = $("<button></button>").text(key).addClass("filter-btn");
                buttonsContainer.append(button);

                button.click(function () {
                    $(this).toggleClass("filtered-out");
                    const isFilteredOut = $(this).hasClass("filtered-out");

                    if (isFilteredOut) {
                        parentElement.find(`.json-node[data-table="${key}"]`).hide();
                    } else {
                        parentElement.find(`.json-node[data-table="${key}"]`).show();
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

        for (const key in json) {
            const value = json[key];
            const nodeElement = $("<div class='json-node'></div>").attr("data-table", key);
            parentElement.append(nodeElement);

            const expandCollapseSymbol = '-';
            const keyElement = $("<span class='json-key'></span>").html(`<span class="expand-collapse">${expandCollapseSymbol}</span> ${key}: `);
            nodeElement.append(keyElement);

            displayJson(value, nodeElement, depth + 1);

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
    } else {
        const valueElement = $("<span></span>").text(JSON.stringify(json));
        parentElement.append(valueElement);
    }
}

function mergeJson(json1, json2) {
    // Iterate through each table in the first JSON object
    for (const table in json1.data) {
        if (json1.data.hasOwnProperty(table)) {
            const table1 = json1.data[table];
            const table2 = json2.data[table] || [];

            // Iterate through each object in the first table
            for (const obj1 of table1) {
                // Check if there is a corresponding object in the second table with the same GUID
                const obj2 = table2.find((obj) => obj.guid === obj1.guid);
                if (obj2) {
                    // If a corresponding object exists, iterate through each property in the object from the first table
                    for (const prop in obj1) {
                        if (obj1.hasOwnProperty(prop)) {
                            // Check if the property value is not null or undefined, and if the corresponding property exists in the object from the second table
                            if ((obj2[prop] == null || obj2[prop] == undefined)) {
                                // If the property value is not null or undefined, and the corresponding property exists in the object from the second table, replace the property value in the second object with the value from the first object
                                obj2[prop] = obj1[prop];
                            }
                        }
                    }
                } else {
                    // If a corresponding object does not exist, append the object from the first table to the second table
                    table2.push(obj1);
                }
            }

            // If a corresponding table does not exist in the second JSON object, add the entire table from the first JSON object to the second JSON object
            if (!json2.data.hasOwnProperty(table)) {
                json2.data[table] = table2;
            }
        }
    }

    // Return the merged JSON object
    return json2;
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

const dropZone1 = document.getElementById("drop-zone1");
const dropZone2 = document.getElementById("drop-zone2");
const jsonInput1 = document.getElementById("fileInput1");
const jsonInput2 = document.getElementById("fileInput2");

dropZone1.addEventListener("dragover", handleDragOver);
dropZone1.addEventListener("drop", function (event) {
    const spinner = document.querySelector("#drop-zone1 .spinner");
    spinner.style.display = "block";
    handleFileSelect(event, function (content, file) {
        jsonInput1.dataset.json = content;
        const jsonData = JSON.parse(jsonInput1.dataset.json);
        displayJson(jsonData, $('#json-viewer'));
        $("#drop-zone1").text("File loaded: " + file.name);
        spinner.style.display = "none";
    });
    
});

dropZone1.addEventListener("click", function () {
    const spinner = document.querySelector("#drop-zone1 .spinner");
    spinner.style.display = "block";
    jsonInput1.click();
});

dropZone2.addEventListener("dragover", handleDragOver);
dropZone2.addEventListener("drop", function (event) {
    const spinner = document.querySelector("#drop-zone2 .spinner");
    spinner.style.display = "block";
    handleFileSelect(event, function (content,file) {
        jsonInput2.dataset.json = content;
    });
    const jsonData = JSON.parse(jsonInput2.dataset.json);
    displayJson(jsonData, $('#json-viewer'));
    $("#drop-zone2").text("File loaded: " + file.name);
    spinner.style.display = "none";
});

dropZone2.addEventListener("click", function () {
    const spinner = document.querySelector("#drop-zone2 .spinner");
    spinner.style.display = "block";
    jsonInput2.click();
});

function clickToUpload(inputId, dropZoneId) {
    const fileInput = document.getElementById(inputId);
    //get spinner based on dropzone id
    const dropZone = document.getElementById(dropZoneId);
    const spinner = dropZone.querySelector(".spinner");

    spinner.style.display = "block";
    fileInput.click();
}


document.getElementById("fileInput1").addEventListener("change", function (event) {
    const spinner = document.querySelector("#drop-zone1 .spinner");

    if (event.target.files.length === 0) {
        spinner.style.display = "none";
    }

    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const jsonData = JSON.parse(e.target.result);
            displayJson(jsonData, $('#json-viewer'));
            $("#drop-zone1").text("File loaded: " + file.name);
            jsonInput1.dataset.json = JSON.stringify(jsonData);
        };
        reader.readAsText(file);
    }
    
    spinner.style.display = "none";
});

document.getElementById("fileInput2").addEventListener("change", function (event) {
    const spinner = document.querySelector("#drop-zone2 .spinner");
    

    if (event.target.files.length === 0) {
        spinner.style.display = "none";
    }
    
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const jsonData = JSON.parse(e.target.result);
            displayJson(jsonData, $('#json-viewer'));
            $("#drop-zone2").text("File loaded: " + file.name);
            jsonInput2.dataset.json = JSON.stringify(jsonData);
        };
        reader.readAsText(file);
    }
    
    spinner.style.display = "none";
});

$('#load-json1').click(function () {
    try {
        const jsonData = JSON.parse(jsonInput1.dataset.json);
        displayJson(jsonData, $('#json-viewer'));
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});

$('#load-json2').click(function () {
    try {
        const jsonData = JSON.parse(jsonInput2.dataset.json);
        displayJson(jsonData, $('#json-viewer'));
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});

$('#merge-json').click(function () {
    try {
        const jsonData1 = JSON.parse(jsonInput1.dataset.json);
        const jsonData2 = JSON.parse(jsonInput2.dataset.json);
        //check if both jsons are valid
        if (jsonData1 && jsonData2) {
            const mergedJson = mergeJson(jsonData1, jsonData2);
            displayJson(mergedJson, $('#json-viewer'));
            fileInputMerged.dataset.json = JSON.stringify(mergedJson);
        }
        else {
            alert('Invalid JSON data');
        }
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }

});

$('#load-json-merged').click(function () {
    try {
        const jsonData = JSON.parse(fileInputMerged.dataset.json);
        displayJson(jsonData, $('#json-viewer'));
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});

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

