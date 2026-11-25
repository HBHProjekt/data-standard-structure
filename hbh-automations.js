(function (global) {
    'use strict';
    // Display names for PropertyWizard.cs cases and QuantityVolume from HBHBIMClassification.cs.
    // Keys are the exact Civil/HBHBIM identifiers, including legacy spellings.
    const labels = {
        DataTemplateID: 'Identifikátor datové šablony',
        TextureOrColour: 'Textura / barva',
        PrecisionClass: 'Skupina přesnosti',
        ClassificationSystem: 'Klasifikační systém',
        ConstructionComplex: 'Stavební komplex',
        ConstructionEntity: 'Stavební entita',
        ConstructionEntityName: 'Název stavební entity',
        ConstructionElementFunction: 'Stavební element – funkční aspekt',
        ConstructionElementProduct: 'Stavební element – produktový aspekt',
        ConstructionElementLocation: 'Stavební element – aspekt umístění',
        ConstructionElementType: 'Stavební element – typový aspekt',
        ConstructionElementTypeName: 'Název typového aspektu stavebního elementu',
        BuildSpace: 'Vybudovaný prostor',
        FunctionalSystem: 'Funkční systém',
        ConstructionSystem: 'Konstrukční systém',
        CodeComponent: 'Komponent',
        AlignmentName: 'Název trasy',
        'Číslo stavebního objektu': 'Číslo stavebního objektu',
        ObjectDesignation: 'Číslo stavebního objektu',
        SiteObjectDesignation: 'Název stavebního objektu',
        ObjectReference: 'Označení stavebního objektu',
        ClassificationReference: 'Označení položky',
        IfcCZElement: 'Označení elementu',
        IfcCZElementGroup: 'Skupina elementů',
        'Název trasy': 'Název trasy',
        MaintenanceType: 'Typ údržby',
        CodeWBS: 'Kód WBS',
        ConstructionStart: 'Zahájení výstavby',
        ConstructionEndLatest: 'Nejpozdější ukončení výstavby',
        ConstructionEnd: 'Ukončení výstavby',
        ConstructionEndEarliest: 'Nejdřívější ukončení výstavby',
        ConstructionStartEarliest: 'Nejdřívější zahájení výstavby',
        ConstructionStartLatest: 'Nejpozdější zahájení výstavby',
        BuildingPhase: 'Fáze výstavby',
        ConstructionDuration: 'Doba výstavby',
        ConstructionPart_D4: 'Část stavby (D4)',
        PartialBuildingObject: 'Dílčí stavební objekt',
        Camera_inspection_D4: 'Kamerové prohlídky (D4)',
        LaboratoryDiary_D4: 'Laboratorní deník (D4)',
        GPS_Coordinates: 'GPS souřadnice',
        'Staničení od': 'Staničení od',
        StationingFrom: 'Staničení od',
        'Staničení do': 'Staničení do',
        StationingTo: 'Staničení do',
        Plocha: 'Plocha',
        QuantityArea: 'Plocha',
        SideSensitiveStationingFrom: 'Staničení od podle strany',
        SideSensitiveStationingTo: 'Staničení do podle strany',
        LinkCDE: 'Odkaz do CDE',
        LinkDSPS_D4: 'Odkaz na dokumentaci skutečného provedení (D4)',
        DesignDocumentation_D4: 'Projektová dokumentace (D4)',
        ConstructionDiary_D4: 'Stavební deník (D4)',
        UserManual_D4: 'Uživatelský návod (D4)',
        MaintenanceManual_D4: 'Návod k údržbě (D4)',
        OperatingDiary_D4: 'Provozní deník (D4)',
        Maintenance_D4: 'Údržba (D4)',
        RoadSectionNumber: 'Číslo úseku komunikace',
        IDElement_D4_specific: 'Specifický identifikátor elementu (D4)',
        MaterialType: 'Typ materiálu',
        MaterialName: 'Název materiálu a výrobce',
        CES_Varianta_vyrobku: 'Varianta výrobku (CES)',
        CES_Spolecnost: 'Společnost (CES)',
        CES_Vyrobek: 'Výrobek (CES)',
        CES_Pouziti_stavba: 'Použití ve stavbě (CES)',
        ElementID_D4: 'Identifikátor elementu (D4)',
        SideDestination: 'Strana',
        Stationing: 'Staničení',
        ElementHeight: 'Výška elementu',
        QuantityLength: 'Délka',
        QuantityCount: 'Počet',
        QuantityVolume: 'Objem',
        Thickness: 'Tloušťka',
        CzechName: 'Český název',
        LatinName: 'Latinský název',
        PipeInnerDiameter: 'Vnitřní průměr potrubí (DN)',
        PipeMaterial: 'Materiál potrubí',
        PipeSlope: 'Sklon potrubí (%)',
        ShaftCode: 'Označení šachty',
        ShatfDiameter: 'Průměr šachty',
        ShaftMaterial: 'Materiál šachty',
        TrafficSignCode: 'Kód značky',
        RoadSignSize: 'Velikost značky',
        Reflextion: 'Reflexe',
        Material: 'Materiál',
        // Handled through NameHBH outside the main switch, in the second pass.
        LengthCalculationMethod: 'Způsob stanovení délky'
    };
    const hints = {
        DataTemplateID: 'Vrátí seřazené názvy skupin vlastností spojené znakem +. Skupiny začínající HBH nebo _HBH vynechá.',
        TextureOrColour: 'Vrátí barvu objektu z grafických požadavků standardu ve tvaru R,G,B. Objekt hledá podle typového aspektu.',
        PrecisionClass: 'Vrátí skupinu grafické přesnosti objektu ze standardu podle jeho typového aspektu.',
        ClassificationSystem: 'Vyplní pevný text CCI jako název klasifikačního systému.',
        ConstructionComplex: 'Vrátí kód stavebního komplexu z klasifikace prvku.',
        ConstructionEntity: 'Vrátí kód stavební entity z klasifikace prvku.',
        ConstructionEntityName: 'Vrátí název stavební entity dohledaný v projektových BIM datech.',
        ConstructionElementFunction: 'Vrátí funkční aspekt z klasifikace prvku.',
        ConstructionElementProduct: 'Vrátí produktový aspekt z klasifikace prvku.',
        ConstructionElementLocation: 'Vrátí aspekt umístění z klasifikace prvku.',
        ConstructionElementType: 'Vrátí celý kód typového aspektu z klasifikace prvku.',
        ConstructionElementTypeName: 'Vrátí název odpovídající kódu typového aspektu z knihovny názvů.',
        BuildSpace: 'V dodané verzi tento automat žádnou hodnotu nevyplňuje; ponechá současnou hodnotu.',
        FunctionalSystem: 'Z produktového aspektu vybere část funkčního systému bez pořadových číslic a úvodních znaků - nebo %.',
        ConstructionSystem: 'Z produktového aspektu vybere část konstrukčního systému bez pořadových číslic a úvodních znaků - nebo %.',
        CodeComponent: 'Z produktového aspektu vybere kód komponentu bez pořadových číslic a úvodních znaků - nebo %.',
        AlignmentName: 'Vrátí název trasy přiřazené baseline koridoru. V druhém průchodu může převzít referenční trasu potrubí.',
        ObjectDesignation: 'Vrátí číslo stavebního objektu z projektových BIM dat příslušné stavební entity.',
        SiteObjectDesignation: 'Vrátí název stavebního objektu z projektových BIM dat příslušné stavební entity.',
        ObjectReference: 'Vrátí číslo stavebního objektu pouze po první pomlčku; část za pomlčkou vynechá.',
        ClassificationReference: 'Z typového aspektu odebere první znak a koncové číslice; vrátí zbývající označení položky.',
        IfcCZElement: 'Vrátí český název datového objektu ze standardu, například Svodidlo. Objekt dohledá podle typového aspektu.',
        IfcCZElementGroup: 'Vrátí český název skupiny datových objektů ze standardu podle typového aspektu prvku.',
        'Název trasy': 'Tento starší příkaz v dodané verzi vrací číslo stavební entity, nikoli název trasy. Pro název trasy slouží AlignmentName.',
        MaintenanceType: 'Vrátí typ údržby z doplňujících údajů příslušného objektu ve standardu.',
        CodeWBS: 'Vrátí kód WBS z harmonogramu přiřazeného stavební entitě.',
        ConstructionStart: 'Vrátí zahájení výstavby z harmonogramu přiřazeného stavební entitě.',
        ConstructionEndLatest: 'Vrátí nejpozdější ukončení výstavby z harmonogramu přiřazeného stavební entitě.',
        ConstructionEnd: 'Vrátí ukončení výstavby z harmonogramu přiřazeného stavební entitě.',
        ConstructionEndEarliest: 'Vrátí nejdřívější ukončení výstavby z harmonogramu přiřazeného stavební entitě.',
        ConstructionStartEarliest: 'Vrátí nejdřívější zahájení výstavby z harmonogramu přiřazeného stavební entitě.',
        ConstructionStartLatest: 'Vrátí nejpozdější zahájení výstavby z harmonogramu přiřazeného stavební entitě.',
        BuildingPhase: 'Vrátí fázi výstavby z harmonogramu přiřazeného stavební entitě.',
        ConstructionDuration: 'Vrátí dobu výstavby z harmonogramu přiřazeného stavební entitě.',
        ConstructionPart_D4: 'Vrátí název části stavby z doplňujících údajů objektu ve standardu.',
        PartialBuildingObject: 'Vrátí číslo příslušné stavební entity z projektových BIM dat.',
        Camera_inspection_D4: 'Sestaví odkaz na kamerové prohlídky v CDE projektu D4 podle čísla stavební entity.',
        LaboratoryDiary_D4: 'Sestaví odkaz na laboratorní deník D4 podle čísla dílčího objektu a zkratky části stavby.',
        GPS_Coordinates: 'Vrátí zeměpisnou šířku a délku bodu COGO; u jiného prvku převede střed jeho obálky ze S-JTSK do WGS84.',
        StationingFrom: 'Vrátí nejnižší staničení prvku vůči referenční trase. Vyžaduje dostupnou trasu a určení polohy prvku.',
        StationingTo: 'Vrátí nejvyšší staničení prvku vůči referenční trase. Vyžaduje dostupnou trasu a určení polohy prvku.',
        QuantityArea: 'Načte vypočtenou plochu z vlastnosti ComputedSurface sady _HBH_BIM_Solid na prvním dílčím prvku.',
        SideSensitiveStationingFrom: 'Vrátí počáteční staničení se zohledněním strany prvku vůči trase.',
        SideSensitiveStationingTo: 'Vrátí koncové staničení se zohledněním strany prvku vůči trase.',
        LinkCDE: 'Sestaví odkaz do CDE podle identifikátoru přiřazeného materiálu nebo výrobku.',
        LinkDSPS_D4: 'Sestaví odkaz na dokumentaci skutečného provedení D4 podle čísla stavební entity.',
        DesignDocumentation_D4: 'Sestaví odkaz na projektovou dokumentaci v CDE projektu D4 podle čísla stavební entity.',
        ConstructionDiary_D4: 'Sestaví odkaz na stavební deník v CDE projektu D4 podle čísla stavební entity.',
        UserManual_D4: 'Sestaví odkaz na uživatelský návod v CDE projektu D4 podle čísla stavební entity.',
        MaintenanceManual_D4: 'Sestaví odkaz na návod k údržbě v CDE projektu D4 podle čísla stavební entity.',
        OperatingDiary_D4: 'Sestaví odkaz na provozní deník v CDE projektu D4 podle čísla stavební entity.',
        Maintenance_D4: 'Pokud je hodnota prázdná, sestaví odkaz na údržbu D4 podle specifického identifikátoru elementu.',
        RoadSectionNumber: 'Podle začátku čísla stavební entity vrátí označení úseku: LC → 04_LC, CM → 05_CM nebo MR → 06_MR.',
        IDElement_D4_specific: 'Pokud je hodnota prázdná, načte uložené D4 ID elementu; jinak je vytvoří z čísla úseku a objektu a uloží k prvku.',
        MaterialType: 'Vrátí typ materiálu z knihovny podle přiřazených identifikátorů materiálů. Více různých hodnot oddělí středníkem.',
        MaterialName: 'Vrátí název materiálu a výrobce ve tvaru název - výrobce. Více různých hodnot oddělí středníkem.',
        CES_Varianta_vyrobku: 'Z knihovny materiálů vrátí variantu výrobku. Více různých hodnot oddělí středníkem.',
        CES_Spolecnost: 'Z knihovny materiálů vrátí společnost přiřazenou výrobku. Více různých hodnot oddělí středníkem.',
        CES_Vyrobek: 'Z knihovny materiálů vrátí výrobek podle přiřazeného identifikátoru. Více různých hodnot oddělí středníkem.',
        CES_Pouziti_stavba: 'Z knihovny materiálů vrátí použití varianty výrobku na stavbě. Více různých hodnot oddělí středníkem.',
        ElementID_D4: 'Sestaví ID ze zkratky typu prvku, úseku, objektu, strany a staničení od–do; pořadové číslo se doplňuje následně.',
        SideDestination: 'Vrátí stranu prvku vůči trase z jeho polohy a staničení.',
        Stationing: 'Vrátí uložené počáteční staničení prvního dílčího prvku.',
        ElementHeight: 'Vrátí výšku z geometrické obálky samostatného prvku, zaokrouhlenou na dvě desetinná místa.',
        QuantityLength: 'Vrátí délku podle typu geometrie: prostorovou délku potrubí, výšku piloty/sloupku, délku trasy nebo součet délek regionů koridoru.',
        QuantityCount: 'Vrátí počet dílčích prvků zahrnutých v klasifikovaném prvku.',
        QuantityVolume: 'Při automatickém zápisu v HBHBIMClassification vrátí objem konkrétního elementu přes AutoProperties.SolidVolume na 3 desetinná místa. Výpočet se spouští pro hodnotu <auto>.',
        Thickness: 'Načte tloušťku z parametru odpovídající podsestavy koridoru. Zápornou tloušťku nevyplní.',
        CzechName: 'Načte český název ze sady vlastností _HBH_Strom na přiřazeném prvku.',
        LatinName: 'Načte latinský název ze sady vlastností _HBH_Strom na přiřazeném prvku.',
        PipeInnerDiameter: 'V dodané verzi se nalezený vnitřní průměr potrubí do vlastnosti nezapíše; současná hodnota zůstane zachovaná.',
        PipeMaterial: 'Vrátí materiál potrubí dohledaného v potrubní síti Civilu podle názvu sítě a potrubí.',
        PipeSlope: 'Vrátí sklon potrubí přímo ze sítě Civilu. Dodaný kód jej nenásobí stem pro převod na procenta.',
        ShaftCode: 'Vrátí označení šachty dohledané v potrubní síti Civilu.',
        ShatfDiameter: 'Vrátí vnitřní průměr nebo šířku šachty z potrubní sítě Civilu, násobenou 1000 pro vyjádření v milimetrech.',
        ShaftMaterial: 'Vrátí materiál šachty dohledané v potrubní síti Civilu.',
        TrafficSignCode: 'Načte kód dopravní značky z vlastností odpovídající cedule ve výkresu.',
        RoadSignSize: 'Načte velikost dopravní značky z vlastností odpovídající cedule ve výkresu.',
        Reflextion: 'Načte údaj o reflexi z vlastností odpovídající cedule dopravní značky ve výkresu.',
        Material: 'Načte materiál z vlastností odpovídající cedule dopravní značky ve výkresu.',
        LengthCalculationMethod: 'Vrátí text Délka v prostoru nebo Délka 2D průmětu podle způsobu stanovení délky v předchozím průchodu.'
    };
    hints['Číslo stavebního objektu'] = hints.ObjectDesignation;
    hints['Staničení od'] = hints.StationingFrom;
    hints['Staničení do'] = hints.StationingTo;
    hints.Plocha = hints.QuantityArea;
    const hint = command => Object.hasOwn(hints, command) ? hints[command] : 'Vlastní příkaz z načteného standardu; jeho výstup není v dodané knihovně automatů popsán.';
    const englishCommands = new Set(Object.keys(labels).filter(command => /^[A-Za-z][A-Za-z0-9_]*$/.test(command) && command !== 'Plocha'));
    const populated = value => Array.isArray(value) ? value.some(populated) : value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');
    function completeFromIfc(doc) {
        if (!Array.isArray(doc?.data?.Properties)) return { doc, changes: [], count: 0 };
        const changes = []; let count = 0;
        const properties = doc.data.Properties.map((property, index) => {
            if (!property || typeof property !== 'object') return property;
            const fields = Object.entries(property), hbh = fields.filter(([key]) => key.toLowerCase() === 'namehbh');
            // An explicit assignment always wins, including an unknown/custom command.
            if (hbh.some(([, value]) => populated(value))) return property;
            const ifc = [...new Set(fields.filter(([key, value]) => key.toLowerCase() === 'nameifc' && typeof value === 'string' && value.trim()).map(([, value]) => value.trim()))];
            if (ifc.length !== 1 || !englishCommands.has(ifc[0])) return property;
            const next = { ...property, nameHBH: ifc[0] };
            for (const [key] of hbh) if (key !== 'nameHBH') {
                delete next[key]; changes.push({ keyChain: ['data', 'Properties', index, key], oldValue: property[key], newValue: null, action: 'remove' });
            }
            changes.push({ keyChain: ['data', 'Properties', index, 'nameHBH'], oldValue: property.nameHBH ?? null, newValue: ifc[0], action: 'set' });
            count++; return next;
        });
        return { doc: count ? { ...doc, data: { ...doc.data, Properties: properties } } : doc, changes, count };
    }
    global.DSS_HBH_AUTOMATIONS = {
        entries: Object.entries(labels).map(([command, label]) => ({ command, label, hint: hint(command) })),
        label: command => Object.hasOwn(labels, command) ? labels[command] : '',
        hint, completeFromIfc
    };
})(window);
