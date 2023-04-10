
function displayJson(json, parentElement) {
    parentElement = parentElement || $("#json-viewer");
    parentElement.empty();

    if (typeof json === "object" && json !== null) {
        for (const key in json) {
            const value = json[key];
            const nodeElement = $("<div class='json-node'></div>");
            parentElement.append(nodeElement);

            const keyElement = $("<span class='json-key'></span>").text(key + ": ");
            nodeElement.append(keyElement);

            displayJson(value, nodeElement);

            // Make the key clickable
            keyElement.click(function() {
                $(this).siblings().toggle();
            });
        }
    } else {
        const valueElement = $("<span></span>").text(JSON.stringify(json));
        parentElement.append(valueElement);
    }
}

function mergeJson(json1, json2) {
    // Merge the two JSON objects
}
function handleFileSelect(event, callback) {
    event.stopPropagation();
    event.preventDefault();

    const file = event.dataTransfer ? event.dataTransfer.files[0] : event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        callback(e.target.result);
    };
    reader.readAsText(file);
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
    handleFileSelect(event, function (content) {
        jsonInput1.value = content;
    });
});
dropZone1.addEventListener("click", function () {
    jsonInput1.click();
});

dropZone2.addEventListener("dragover", handleDragOver);
dropZone2.addEventListener("drop", function (event) {
    handleFileSelect(event, function (content) {
        jsonInput2.value = content;
    });
});
dropZone2.addEventListener("click", function () {
    jsonInput2.click();
});

document.getElementById("fileInput1").addEventListener("change", function (event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const jsonData = JSON.parse(e.target.result);
            displayJson(jsonData, $('#json-viewer'));
            $("#drop-zone1").text("File loaded: " + file.name);
        };
        reader.readAsText(file);
    }
});

document.getElementById("fileInput2").addEventListener("change", function (event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const jsonData = JSON.parse(e.target.result);
            displayJson(jsonData, $('#json-viewer'));
            $("#drop-zone2").text("File loaded: " + file.name);
        };
        reader.readAsText(file);
    }
});

$('#load-json1').click(function () {
    try {
        const jsonData = JSON.parse($('#fileInput1').val());
        displayJson(jsonData, $('#json-viewer'));
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});

$('#load-json2').click(function () {
    try {
        const jsonData = JSON.parse($('#fileInput2').val());
        displayJson(jsonData, $('#json-viewer'));
    } catch (error) {
        alert('Invalid JSON data: ' + error.message);
    }
});