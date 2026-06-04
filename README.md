# Rapportage

Marketing rapportage dashboard via de [Reporting Ninja REST API](https://api.reportingninja.com/docs).

Toont per klant de resultaten van **Meta Ads**, **Google Ads** en **Pinterest Ads**:
per campagne: impressies, clicks, CTR, kosten/uitgaven, CPC — met dagelijkse grafieken.

## Vereisten

- Node.js 18+
- Een Reporting Ninja account met API-toegang
- Verbonden ad-accounts in Reporting Ninja (zie hieronder)

## Installatie

```bash
npm install
cp .env.example .env
# Vul je API-sleutel in .env
```

## Configuratie

### 1. API-sleutel

Kopieer je API-sleutel uit Reporting Ninja → **REST API** tab en plak hem in `.env`:

```
REPORTING_NINJA_API_KEY=jouw_sleutel_hier
```

### 2. Accounts verbinden in Reporting Ninja

De API kan alleen accounts bevragen die al verbonden zijn.
Ga in de Reporting Ninja interface naar **Data Sources** (linkerzijbalk) en verbind:
- Meta Ads (Facebook) via OAuth
- Google Ads via OAuth
- Pinterest Ads via OAuth

Na het verbinden staan ze niet meer op "0 of 150" maar tellen ze als één account.

### 3. Connection keys & account IDs opvragen

Start de server en gebruik een tool als [Bruno](https://www.usebruno.com/) of Postman om
`POST http://localhost:3000/api/connections` aan te roepen met:

```json
{ "integration_id": "facebook_ads" }
```

De response bevat `connection_key` en `account_id` die je nodig hebt.

### 4. Klanten instellen

Bewerk `public/clients.js` en voeg klanten toe:

```js
const CLIENTS = [
  {
    id: 'klant-naam',
    name: 'Klant Naam BV',
    meta: {
      connection_key: 'jouw@email.nl',
      account_id: '1234567890',
    },
    google: {
      connection_key: 'jouw@email.nl',
      account_id: '1234567890',
      data_view: 'campaign',
    },
    pinterest: {
      connection_key: 'jouw@email.nl',
      account_id: '1234567890',
    },
  },
];
```

Een platform op `null` zetten zorgt dat die sectie niet geladen wordt:
```js
pinterest: null,
```

## Gebruik

```bash
npm start
# of voor development (auto-reload):
npm run dev
```

Open vervolgens: http://localhost:3000

Kies een klant, selecteer de periode en klik op **Laden**.

## Projectstructuur

```
rapportage/
  server.js          Express server + API proxy
  public/
    index.html       Dashboard HTML
    style.css        Stijlen
    app.js           Frontend logica
    clients.js       Klantconfiguratie
  .env.example       Voorbeeld omgevingsvariabelen
  package.json
```
