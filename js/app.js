const jsonInput = document.getElementById('json-input');
const loadJsonButton = document.getElementById('load-json');
const jsonViewer = document.getElementById('json-viewer');
const saveJsonButton = document.getElementById('save-json');
const mergeJsonButton = document.getElementById('merge-json');

let jsonData = null;

loadJsonButton.addEventListener('click', () => {
    try {
        jsonData = JSON.parse(jsonInput.value);
        jsonViewer.textContent = JSON.stringify(jsonData, null, 2);
    } catch (error) {
        alert('Invalid JSON');
    }
});

saveJsonButton.addEventListener('click', () => {
    if (jsonData) {
        const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'data.json';
        a.click();
        URL.revokeObjectURL(url);
    }
});

mergeJsonButton.addEventListener('click', () => {
    try {
        const newJsonData = JSON.parse(jsonInput.value);

        if (!jsonData) {
            jsonData = newJsonData;
        } else {
            jsonData = mergeObjects(jsonData, newJsonData);
        }

        jsonViewer.textContent = JSON.stringify(jsonData, null, 2);
    } catch (error) {
        alert('Invalid JSON');
    }
});

function mergeObjects(obj1, obj2) {
    const result = { ...obj1 };

    for (const key in obj2) {
        if (obj2.hasOwnProperty(key)) {
            if (typeof obj2[key] === 'object' && !Array.isArray(obj2[key])) {
                result[key] = mergeObjects(result[key], obj2[key]);
            } else {
                result[key] = obj2[key];
            }
        }
    }

    return result;
}
