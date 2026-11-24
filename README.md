# HBH – prohlížení, úpravy a spojování datových standardů

Připravená verze pro publikování, 24. 11. 2026, revize 2. Aplikace pracuje s JSON a IDS přímo v prohlížeči.

## Nahrání do stávajícího repozitáře

1. Rozbalte ZIP. Nahrávají se rozbalené soubory, nikoli archiv.
2. Obsah této složky vložte do stejného místa v repozitáři, kde byl původní `index.html`. Pokud byl v kořeni repozitáře, patří tam přímo nový `index.html`, `js/`, `css/`, `structure/` a `assets/`. Nevytvářejte nad nimi další složku `vystup-github-2026-11-24-v2` ani `data-standard-structure-main`.
3. Nahraďte původní soubory a přidejte všechny nové soubory, zejména nové skripty a logo v `assets/`. Ponechte ostatní soubory repozitáře a stávající konfiguraci publikování (`.github/`, případně `CNAME` apod.).
4. Uložte změny do větve, ze které se web publikuje. V GitHub webovém rozhraní použijte Add file → Upload files a nahrajte soubory i složky při zachování struktury.
5. Nechte proběhnout dosavadní publikování webu. Tento balíček neobsahuje konfiguraci původního nasazování, protože nebyla součástí dodaných podkladů.
6. Po publikování obnovte stránku pomocí Ctrl+F5. Ověřte logo, načtení JSON/IDS a nové volby v záložkách standardu.

Samotná aplikace nevyžaduje npm, kompilaci ani build. Je určena pro statické publikování; vstupním souborem je `index.html`. Jestliže repozitář používá vlastní publikační workflow, jeho kroky zůstávají podle dosavadního nastavení.

## Obsah

```text
index.html
assets/
  hbh-logo.png
css/
  styles.css
js/
  app.js
  dss-model.js
  dss-validation.js
  group-library.js
  hbh-automations.js
  ids-import.js
  manual-matching.js
  property-matching.js
  standard-documents.js
  standard-viewer.js
structure/
  structure.json
README.md
```

Do publikované aplikace jsou zahrnuté úpravy párování objektů a vlastností, import IDS, přehledy a editace standardu, knihovna HBHBIM automatů s českými popisy, správa číselníků, tvorba a import skupin vlastností a přiřazování skupin k objektům. Logo je přiložené jako PNG. Pro načtení jQuery z `code.jquery.com` je potřeba internet.

Testovací datové standardy, zdrojový C# soubor PropertyWizard, lokální spouštěče a testovací skripty nejsou k publikování potřebné a v tomto balíčku nejsou zahrnuté. Katalog automatů je již obsažený v `js/hbh-automations.js`.

## Poslední úpravy oproti balíčku z 6. 11. 2026

- Hlavička s logem zůstává viditelná; pracovní plocha se posouvá pod ní.
- Ve druhém řádku hlavičky jsou tlačítka Spojit JSONy a Stáhnout výsledek, synchronizovaná s původními akcemi.
- Při načtení standardu se prázdné nameHBH doplní z nameIfc / nameIFC, pokud přesně odpovídá anglickému kódu v katalogu PropertyWizardu. Vyplněné nameHBH / NameHBH má vždy přednost, včetně vlastních příkazů.
- Doplněné přiřazení je uložené do pole nameHBH ve stahovaném JSONu. Pravidlo funguje také při importu skupin z dalšího souboru.

Nahrajte celý obsah tohoto balíčku. Kvůli posledním úpravám se měnily HTML, CSS i JavaScript; nestačí nahrát jen index.html. Stávající soubory balíček nahrazuje, proto není nutné mazat repozitář nebo měnit nastavení GitHub Pages.
## Revize 2 – odstranění číselníků

V záložce Číselníky hodnot je nové tlačítko Odstranit číselník. Dialog před potvrzením ukáže vlastnosti používající číselník. Odstraněním se vymaže definice z CustomEnums a zruší odpovídající odkazy customEnum ve vlastnostech; vlastnosti i jejich výchozí hodnoty se zachovají. Zrušení dialogu nic nemění. Změna je součástí stahovaného JSONu.

Tento balíček zahrnuje i všechny úpravy předchozí revize z 23. 11. 2026. Nahrajte celý rozbalený obsah stejně jako minule.
## Aktualizace 24. 11. 2026

- QuantityVolume (Objem) doplněný podle HBHBIMClassification.cs, včetně českého názvu, hintu a rozpoznání z nameIfc / nameIFC. Katalog nyní obsahuje 85 identifikátorů automatů.
- Přidávání nových vlastností do existujících skupin a přiřazování již definovaných vlastností standardu. U stejnojmenných variant se vybírá konkrétní skupina podle GUID. Existující GUID skupiny a vazby objektů se zachovávají.
- Editace definice vlastnosti: český název, IFC název, datový typ, IFC typ, jednotka a popis. Sdílená definice se upraví ve všech používajících skupinách a objektech. Automat, číselník a defaulty se zachovávají; změna typu sama nepřevádí jejich hodnoty.
- Zahrnuje také předchozí odstranění číselníků, stálou hlavičku a doplňování nameHBH z nameIfc.

Nahrajte celý rozbalený obsah tohoto balíčku do kořene stávajícího repozitáře. Zdrojové C# soubory nejsou ke spuštění webu potřebné; katalog a popisy jsou přímo v JavaScriptu.
## Revize 2 – odebrání přidaných vlastností ze skupin

- Ve skupinovém pohledu lze přes Odebrat ze skupiny odstranit uživatelsky přidaná přiřazení vlastností.
- Původní vazby ze zdrojového standardu jsou chráněné. Odebírá se pouze vazba v konkrétní skupině; definice vlastnosti a použití v ostatních skupinách zůstávají zachované.
- Dialog rozlišuje stejnojmenné varianty skupin podle GUID. Změna sdílené skupiny platí pro všechny objekty, které ji používají.
- Původ přidaných vazeb je uložený v hbhEditor.addedGroupProperties a zachovává se po stažení a novém načtení JSONu.
- Starší soubory bez záznamu původu mají všechna dosavadní přiřazení chráněná. Zpětně nelze spolehlivě rozlišit původní a dodatečně přidané vazby.

Balíček obsahuje i všechny předchozí funkce včetně editace vlastností, QuantityVolume a odstranění číselníků. Nahrajte celý rozbalený obsah do stejného místa v repozitáři jako minule.