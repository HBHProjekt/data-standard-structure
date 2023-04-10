$(document).ready(function () {
    let jsonData = null;
  
    function displayJson(json) {
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
          }
        } else {
          const valueElement = $("<span></span>").text(JSON.stringify(json));
          parentElement.append(valueElement);
        }
    }
  
    function mergeJson(json1, json2) {
      // Merge the two JSON objects
    }
  
    $("#load-json").click(function () {
      let jsonInput1 = $("#json-input1").val();
      try {
        jsonData = JSON.parse(jsonInput1);
        displayJson(jsonData);
      } catch (error) {
        alert("Invalid JSON data");
      }
    });
  
    $("#merge-json").click(function () {
      let jsonInput1 = $("#json-input1").val();
      let jsonInput2 = $("#json-input2").val();
      try {
        let jsonData1 = JSON.parse(jsonInput1);
        let jsonData2 = JSON.parse(jsonInput2);
        jsonData = mergeJson(jsonData1, jsonData2);
        displayJson(jsonData);
      } catch (error) {
        alert("Invalid JSON data");
      }
    });
  });
  