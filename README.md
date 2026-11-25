# HBH Standard Control

Kompletní verze pro publikování z 25. 11. 2026. Obsahuje všechny předchozí funkce editoru i nové vizuální motivy.

## Jak aktualizovat stávající web

1. ZIP rozbalte. Nahrává se celý rozbalený obsah, nikoli archiv ani jeho nadřazená složka.
2. V repozitáři otevřete místo s původním `index.html` a zvolte Add file → Upload files.
3. Přetáhněte najednou `index.html`, `README.md` a složky `js`, `css`, `assets`, `structure`. Zachovejte jejich strukturu. V seznamu mají být cesty například `css/calm-theme.css`, `js/ui-themes.js` a `assets/hbh-logo-white.png`.
4. Potvrďte Commit changes do větve, ze které se publikuje. Původní soubory se aktualizují, nové se přidají. Zachovejte stávající konfiguraci repozitáře a publikování, včetně případných `.github` a `CNAME`.
5. Počkejte na dokončení dosavadního publikování v Actions a obnovte web přes Ctrl+F5.

Aplikace je statická a sama nevyžaduje npm ani kompilaci. Publikování GitHub Pages proběhne podle dosavadního nastavení repozitáře; konfigurace publikování není součástí tohoto balíčku. Je potřeba přístup k `code.jquery.com` pro načtení jQuery.

## Novinky v tomto balíčku

- **SAI:** růžovo-tyrkysový plakátový motiv.
- **HEAVY:** kultivovaný antracitový motiv s červenými akcenty, přehlednějšími tabulkami, formuláři a stavovými barvami. Po načtení dat lze sbalit hlavní banner.
- **KLID:** samostatný světlý motiv s teplým pozadím, modrými akcenty, bannerem MÉNĚ ŠUMU. VÍCE SOUVISLOSTÍ. a jemnou geometrií vazeb.
- Žluté akcenty HEAVY při najetí na akční tlačítka, ve focusu polí, odkazech a rozbalovacích šipkách. Chyby a zakázané prvky si zachovávají vlastní rozlišení.
- Originální bílé logo HBH pro HEAVY; v SAI a KLID zůstává barevná varianta. Obě varianty mají průhledné okolí.
- Přehledné kapitálkové nadpisy sekcí a dialogů s většími rozestupy v SAI a HEAVY.
- Přepínač SAI / HEAVY / KLID pamatuje volbu v místním úložišti prohlížeče. Změna vzhledu nijak nemění data ani párování.
- Skrytý UI easter egg: třikrát rychle klikněte na logo HBH.

Zahrnuté jsou také dřívější úpravy párování objektů a vlastností, import JSON/IDS, editace definic, 85 HBHBIM automatů a doplňování `nameHBH` z IFC názvu, správa a odstranění číselníků, tvorba/import skupin, přiřazování skupin k objektům i odebrání uživatelsky přidaných vlastností s ochranou zdrojových vazeb.

## Struktura pro kořen repozitáře

```text
index.html
README.md
assets/
  hbh-logo.png
  hbh-logo-transparent.png
  hbh-logo-white.png
css/
  styles.css
  icy-theme.css
  heavy-theme.css
  calm-theme.css
js/
  ui-themes.js
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
```

Všechny uvedené soubory jsou potřeba k zachování celé aplikace. Nahrajte celý balíček; samotný nový `index.html` nestačí. Testovací data, zdrojové C# a WMF podklady, testy a lokální spouštěče nejsou pro publikování potřebné a v archivu nejsou.

Kontrola před zabalením zahrnuje syntaxi JavaScriptu, přepínání/ukládání motivů, sbalování banneru a 54 zvolených kombinací kontrastu barev dle prahů WCAG AA. Nejde o úplný vizuální audit stránky v prohlížeči. Po publikování doporučujeme ověřit načtení vlastního standardu, všechny tři režimy a stažení upraveného JSONu.
