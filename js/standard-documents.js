(function (global) {
    'use strict';
    const cache = new WeakMap();
    function read(input) {
        const text = input?.dataset?.json;
        if (!text) throw new Error('Nejdřív načtěte standard.');
        const entry = cache.get(input);
        if (entry && entry.text === text) return entry.doc;
        const doc = JSON.parse(text); cache.set(input, { text, doc }); return doc;
    }
    function write(input, doc) {
        const text = JSON.stringify(doc); input.dataset.json = text; cache.set(input, { text, doc });
    }
    global.DSS_DOCUMENTS = { read, write, clear: input => cache.delete(input) };
})(window);
