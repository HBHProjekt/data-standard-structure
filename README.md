# HBH – prohlížení, úpravy a spojování datových standardů

Připravená verze pro publikování, 23. 11. 2026. Aplikace pracuje s JSON a IDS přímo v prohlížeči.

## Nahrání do stávajícího repozitáře

1. Rozbalte ZIP. Nahrávají se rozbalené soubory, nikoli archiv.
2. Obsah této složky vložte do stejného místa v repozitáři, kde byl původní `index.html`. Pokud byl v kořeni repozitáře, patří tam přímo nový `index.html`, `js/`, `css/`, `structure/` a `assets/`. Nevytvářejte nad nimi další složku `vystup-github-2026-11-23` ani `data-standard-structure-main`.
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