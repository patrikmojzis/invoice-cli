# invoice-generator

Agent-friendly CLI na slovenské faktúry. YAML je zdroj pravdy, PDF je len výstup.

## Rýchly štart

```bash
npm install
npm run build
node dist/invoice.cjs init
node dist/invoice.cjs clients list
node dist/invoice.cjs invoices list
```

Po `init` vznikne pracovný priečinok:

```text
invoice.config.yaml   globálny config
clients/*.yaml        odberatelia
drafts/*.yaml         rozpracované faktúry
invoices/*.yaml       vystavené faktúry
out/*.pdf             vygenerované PDF
```

CLI vieš spustiť aj mimo rootu projektu:

```bash
invoice --root /path/to/invoice-workspace invoices list
```

## Bežný flow

```bash
invoice clients search demo-sk
invoice items suggest --client demo-sk

invoice draft create \
  --client demo-sk \
  --issued 2026-04-30 \
  --delivered 2026-04-30 \
  --due 2026-05-14 \
  --item "Vývoj softvéru;6;480;23"

invoice validate drafts/2026-04-demo-sk.yaml
invoice issue drafts/2026-04-demo-sk.yaml
```

`draft create` číslo faktúry nespotrebuje. Číslo sa použije až pri `issue`.

## Položky

Krátky formát:

```bash
--item "Názov;množstvo;cenaBezDPH;DPH"
```

Formát s popisom:

```bash
--item "Názov;popis;množstvo;cenaBezDPH;DPH"
```

Príklady:

```bash
--item "Vývoj softvéru;6;480;23"
--item "Technická podpora;Mesačný paušál;5;24;23"
--item "Konzultačné služby;4;320;reverse"
```

DPH môže byť číslo `0..100`, `reverse`, alebo `exempt`. `quantity` musí byť kladné číslo. `unitPrice` je suma bez DPH s maximálne dvomi desatinnými miestami.

## Reverse charge

Najčistejšie je nastaviť klientovi:

```yaml
vatMode: reverse-charge
```

Potom aj obyčajná položka s cenou bez DPH skončí ako reverse charge. Text poznámky berie CLI z `invoice.config.yaml`:

```yaml
tax:
  reverseChargeText: "REVERSE CHARGE - Prenesenie daňovej povinnosti..."
```

## Číslovanie

Config:

```yaml
invoice:
  nextNumber: "20260007"
  variableSymbolFromNumber: true
```

`nextNumber` musí končiť číslicami. CLI inkrementuje posledný číselný blok a zachová padding:

```text
20260007  -> 20260008
0007      -> 0008
OF-0007   -> OF-0008
```

Ak je `variableSymbolFromNumber: true`, variabilný symbol sa odvádza z číslic vo faktúre:

```text
OF-0007 -> 0007
20260007 -> 20260007
```

VS musí mať najviac 10 číslic.

## PDF a PAY by square

`render` vytvorí PDF:

```bash
invoice render invoices/20260006.yaml
invoice render invoices/20260006.yaml --output out/custom.pdf
```

QR kód je PAY by square, nie obyčajný QR text. Generuje sa ako SVG, validuje sa round-trip decode a používa PAY by square `1.0.0`, lebo to funguje aj vo VÚB appke.

Vypnutie QR:

```yaml
pdf:
  showPayBySquare: false
```

## Vystavenie faktúry

```bash
invoice issue drafts/2026-04-demo-sk.yaml
```

Spraví toto:

1. zamkne workspace na krátky čas,
2. načíta aktuálny `nextNumber`,
3. zapíše `invoices/{number}.yaml`,
4. posunie `nextNumber`,
5. vyrenderuje PDF do `out/`.

Bez PDF:

```bash
invoice issue drafts/2026-04-demo-sk.yaml --no-render
```

## Klienti

Pridať klienta:

```bash
invoice clients add new-client.yaml
```

Minimálny klient:

```yaml
id: acme
name: ACME, s.r.o.
address:
  street: Hlavná 1
  postalCode: "811 01"
  city: Bratislava
  country: Slovenská republika
ico: "12345678"
dic: "2123456789"
icDph: "SK2123456789"
vatMode: domestic
```

## Config

Najdôležitejšie polia:

```yaml
seller:              dodávateľ na faktúre
bank:
  iban:              validovaný IBAN
  swift:             validovaný BIC/SWIFT
  currency: EUR      momentálne iba EUR
invoice:
  nextNumber:        najbližšie číslo faktúry
  defaultDueDays:    splatnosť pri draftoch bez --due
  outputDir: out
  filenamePattern: Faktura_{number}.pdf
  variableSymbolFromNumber: true
tax:
  defaultVatRate: 23
  reverseChargeText: ...
pdf:
  showPayBySquare: true
```

## Build ako jedna binárka

```bash
npm run build:bin
./dist/invoice invoices list
```

Lokálny Linux build:

```bash
npm run build:bin:linux
```

Publikovaný release obsahuje:

```text
invoice-macos-arm64.tar.gz
invoice-linux-x64.tar.gz
```

Po stiahnutí:

```bash
tar -xzf invoice-linux-x64.tar.gz
chmod +x invoice
./invoice --help
```

Agentovi stačí poslať:

```text
dist/invoice
invoice.config.yaml
clients/
drafts/
invoices/
```

`out/` môže vzniknúť až pri renderovaní.

## Agent workflow

Odporúčaný postup pre osobného agenta:

```bash
invoice clients search "<meno alebo ico>"
invoice items suggest --client <client-id>
invoice draft create --client <client-id> --item "Názov;1;100;23"
invoice validate drafts/<draft>.yaml
invoice issue drafts/<draft>.yaml
```

Keď si nie je istý, má najprv vytvoriť draft, nie rovno issue. `issue` je bod, kde sa spotrebuje číslo faktúry.

## Kontroly

```bash
npm run check
npm run smoke
```

`smoke` spraví build, validuje seed faktúru a vyrenderuje PDF.

## Troubleshooting

`Workspace is locked` znamená, že práve beží iné `issue`, alebo po zabitom procese ostal `.invoice-generator.lock`. Keď si si istý, že nič nebeží, zmaž lock priečinok.

`Variable symbol must contain digits only` znamená, že faktúra má ručne nastavený zlý VS. Použi číslice, max 10 znakov.

`Expected valid IBAN` znamená, že IBAN neprešiel checksumom. Medzery nevadia.
